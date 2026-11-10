import { createHash, randomUUID } from "node:crypto";
import { store } from "./store";
import { config } from "./config";
import { extract, evaluate, summarize } from "./ai";
import { hardMismatch, dedupCandidate } from "./matching";
import { telegramClient } from "./telegram";
import { sourceEntity, sourceMessageUrl } from "./channels";
import { CollectionControl, COLLECTION_TIMEOUT_MS } from "./collection-control";
import {
  moscowDay,
  profileSchema,
  type Profile,
  type Source,
  type RawMessage,
  type Offer,
  type Feedback,
  type Digest,
  type Job,
} from "../shared/model";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const cancellationKey = (id: string) => `cancel:${id}`;
export async function cancelCollection(id: string) {
  const job = await store.get<Job>("job", id);
  if (!job || job.kind !== "collect") throw new Error("Сбор не найден");
  if (!["pending", "running"].includes(job.status)) return { ok: true };
  await store.put("control", cancellationKey(id), { requestedAt: new Date().toISOString() });
  if (job.status === "pending")
    await store.put("job", id, {
      ...job, status: "failed", cancelledBy: "user", incomplete: true,
      error: "Сбор отменён пользователем", updatedAt: new Date().toISOString(),
    });
  return { ok: true };
}
export function collectionWindow(
  lookbackDays = 1,
  now = new Date(),
  mode: "manual" | "scheduled" = "scheduled",
): NonNullable<Job["window"]> {
  const days = mode === "scheduled" ? 1 : lookbackDays;
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error("Период должен быть от 1 до 30 дней");
  return {
    since: new Date(now.getTime() - days * 86400000).toISOString(),
    until: now.toISOString(),
    mode,
    lookbackDays: days,
  };
}
export async function enqueueCollection(
  day = moscowDay(),
  options: {
    manual?: boolean;
    lookbackDays?: number;
    now?: Date;
    resumeJobId?: string;
  } = {},
) {
  if (options.resumeJobId) {
    const previous = await store.get<Job>("job", options.resumeJobId);
    if (
      !previous ||
      previous.kind !== "collect" ||
      previous.window?.mode !== "manual" ||
      !previous.incomplete
    )
      throw new Error("Нет незавершённого ручного сбора");
    if (["pending", "running"].includes(previous.status)) return previous;
    const next: Job = {
      ...previous,
      status: "pending",
      attempts: 0,
      error: undefined,
      cancelledBy: undefined,
      updatedAt: new Date().toISOString(),
    };
    await store.remove("control", cancellationKey(next.id));
    await store.put("job", next.id, next);
    return next;
  }
  if (options.manual) {
    const pending = (await store.list<Job>("job")).find(
      (j) => j.kind === "collect" && ["pending", "running"].includes(j.status),
    );
    if (pending) return pending;
  }
  const id = options.manual
    ? `collect:manual:${randomUUID()}`
    : `collect:${day}`;
  const job = await store.get<Job>("job", id);
  if (job && ["pending", "running"].includes(job.status)) return job;
  const next: Job = {
    id,
    kind: "collect",
    day,
    status: "pending",
    attempts: 0,
    updatedAt: new Date().toISOString(),
    window: collectionWindow(
      options.lookbackDays,
      options.now,
      options.manual ? "manual" : "scheduled",
    ),
    sourceCursors: {},
  };
  await store.remove("control", cancellationKey(id));
  await store.put("job", id, next);
  return next;
}
async function collectSource(source: Source, job: Job, control: CollectionControl, report: (force?: boolean) => Promise<void>) {
  const cursor = job.sourceCursors?.[source.id];
  if (cursor?.done) return;
  const client = await control.wait(telegramClient(control.signal), "Telegram");
  const abort = () => { void client.disconnect().catch(() => {}); };
  control.signal.addEventListener("abort", abort, { once: true });
  try {
    const window = job.window!;
    const since = Date.parse(window.since),
      until = Date.parse(window.until);
    const entity = await control.wait(sourceEntity(client, source), "Telegram");
    let oldest = cursor?.offsetId || 0,
      top = source.lastMessageId,
      count = 0,
      complete = false;
    const iterator = client.iterMessages(entity, {
      limit: config.maxMessages,
      offsetId: cursor?.offsetId || 0,
      offsetDate: Math.floor(until / 1000) + 1,
    })[Symbol.asyncIterator]();
    while (true) {
      const next = await control.wait(iterator.next(), "Telegram");
      if (next.done) break;
      const message = next.value;
      count++;
      job.progress!.messagesRead++;
      await report();
      oldest = message.id;
      const published = message.date * 1000;
      if (published < since) {
        complete = true;
        break;
      }
      if (published > until) continue;
      top = Math.max(top, message.id);
      if (!message.message) continue;
      const id = `${source.id}:${message.id}`,
        previous = await store.get<RawMessage>("message", id);
      await store.put<RawMessage>("message", id, {
        id,
        sourceId: source.id,
        messageId: message.id,
        text: message.message,
        date: new Date(published).toISOString(),
        url: sourceMessageUrl(source, message.id),
        hash: hash(message.message),
        processedHash: previous?.processedHash,
      });
    }
    if (count < config.maxMessages) complete = true;
    job.sourceCursors![source.id] = { offsetId: oldest, done: complete };
    await store.put("job", job.id, {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
    });
    const latest = await store.get<Source>("source", source.id);
    if (latest)
      await store.put("source", source.id, {
        ...latest,
        lastMessageId: top,
        lastSuccess: complete ? new Date().toISOString() : latest.lastSuccess,
        error: complete
          ? undefined
          : "Достигнут лимит сообщений. Можно продолжить сбор.",
        pendingOffset: undefined,
        pendingTop: undefined,
        pendingSince: undefined,
      });
    if (!complete)
      throw new Error("Достигнут лимит сообщений; продолжение сохранено");
  } finally {
    control.signal.removeEventListener("abort", abort);
    void client.disconnect().catch(() => {});
  }
}
export async function runCollection(job: Job) {
  const release = await store.lock("collection");
  if (!release) return false;
  const currentJob = await store.get<Job>("job", job.id);
  if (currentJob?.cancelledBy === "user" && !["pending", "running"].includes(currentJob.status)) {
    await release();
    return false;
  }
  const control = new CollectionControl();
  let cancelledByUser = false;
  const checkCancellation = async () => {
    if (await store.get("control", cancellationKey(job.id))) {
      cancelledByUser = true;
      control.stop("Сбор отменён пользователем");
    }
  };
  const cancellationPoll = setInterval(() => {
    void checkCancellation().catch(() => {});
  }, 1000);
  const now = new Date().toISOString();
  job.window ??= collectionWindow();
  job.sourceCursors ??= {};
  job.status = "running";
  job.progress = {
    phase: "telegram", startedAt: now,
    deadlineAt: new Date(Date.now() + COLLECTION_TIMEOUT_MS).toISOString(),
    sourcesDone: 0, sourcesTotal: 0, messagesRead: 0,
    messagesDone: 0, messagesTotal: 0, aiCalls: 0, offersAdded: 0,
    rechecked: 0, recheckTotal: 0,
  };
  let lastReport = 0;
  const report = async (force = false) => {
    control.check();
    if (!force && Date.now() - lastReport < 2000) return;
    job.updatedAt = new Date().toISOString();
    await store.put("job", job.id, job);
    lastReport = Date.now();
  };
  const digestId = job.window.mode === "manual" ? job.id : job.day;
  let digest = await store.get<Digest>("digest", digestId);
  digest = {
    id: digestId,
    mode: job.window.mode,
    lookbackDays: job.window.lookbackDays,
    day: job.day,
    status: "running",
    summary: "Собираем новые предложения",
    newCount: digest?.newCount || 0,
    errors: [],
    startedAt: now,
  };
  await store.put("job", job.id, {
    ...job,
    status: "running",
    attempts: job.attempts + 1,
    updatedAt: now,
  });
  await store.put("digest", digestId, digest);
  const errors: string[] = [];
  let calls = 0,
    processed = 0,
    added = 0;
  try {
    await checkCancellation();
    control.check();
    const sources = (await store.list<Source>("source")).filter(
      (s) => s.enabled,
    );
    job.progress.sourcesTotal = sources.length;
    if (!sources.length)
      throw new Error("Добавь хотя бы один Telegram-канал в настройках");
    for (const source of sources) {
      control.check();
      job.progress.sourceName = source.name;
      await report(true);
      try {
        await collectSource(source, job, control, report);
      } catch {
        control.check();
        errors.push(
          `${source.name}: сбор не завершён. Проверь доступ к каналу и состояние Telegram.`,
        );
        const current = await store.get<Source>("source", source.id);
        if (current)
          await store.put("source", source.id, {
            ...current,
            error:
              "Не удалось завершить сбор. Проверь подключение или повтори позже.",
          });
      }
      job.progress.sourcesDone++;
      await report(true);
    }
    const profile =
        (await store.get<Profile>("profile", "owner")) ||
        profileSchema.parse({}),
      feedback = await store.list<Feedback>("feedback");
    const revision =
      (await store.get<{ value: string }>("profile", "revision"))?.value ||
      "initial";
    const active = new Set(sources.map((s) => s.id));
    const messages = (await store.list<RawMessage>("message"))
      .filter(
        (m) =>
          active.has(m.sourceId) &&
          m.hash !== m.processedHash &&
          m.date >= job.window!.since &&
          m.date <= job.window!.until,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    job.progress.sourceName = undefined;
    job.progress.messagesTotal = messages.length;
    for (const message of messages) {
      control.check();
      if (calls >= config.maxCalls) {
        errors.push(
          "Лимит запросов ИИ достигнут. Необработанные сообщения сохранены.",
        );
        break;
      }
      try {
        calls++;
        job.progress.phase = "extract";
        job.progress.aiCalls = calls;
        job.progress.sourceName = sources.find((s) => s.id === message.sourceId)?.name;
        await report(true);
        const { surveys } = await control.wait(extract(
          message.text.slice(0, 18000),
          message.date,
          control.signal,
        ), "ИИ");
        if (calls + surveys.length > config.maxCalls) {
          errors.push(
            "Лимит запросов ИИ достигнут. Продолжи обработку повторным запуском.",
          );
          break;
        }
        for (const item of surveys) {
          control.check();
          if (!item.isSurvey) continue;
          calls++;
          job.progress.phase = "evaluate";
          job.progress.aiCalls = calls;
          await report(true);
          const mismatch = hardMismatch(item, profile),
            assessment = mismatch
              ? {
                  match: "no" as const,
                  reasons: [mismatch],
                  questions: [],
                  score: 0,
                }
              : await control.wait(evaluate(item, profile, feedback, control.signal), "ИИ");
          const offers = await store.list<Offer>("offer");
          const fromMessage = offers.filter((o) =>
            o.sources.some((s) => s.messageId === message.id),
          );
          const existing =
            fromMessage.find(
              (o) => o.dedupKey === item.dedupKey || o.title === item.title,
            ) ||
            (surveys.length === 1 && fromMessage.length === 1
              ? fromMessage[0]
              : undefined) ||
            offers.find((o) => dedupCandidate(item, o));
          const source = sources.find((s) => s.id === message.sourceId)!;
          const reference = {
            messageId: message.id,
            name: source.name,
            url: message.url,
            text: message.text,
          };
          const id = existing?.id || randomUUID(),
            updatedAt = new Date().toISOString();
          // Re-read immediately before write so worker never overwrites a user's stage or note.
          const current = existing ? await store.get<Offer>("offer", id) : null;
          const offer: Offer = {
            ...item,
            id,
            createdAt: current?.createdAt || updatedAt,
            updatedAt,
            day: current?.day || job.day,
            stage: current?.stage || "new",
            ...assessment,
            matchVersion: revision,
            sources: [
              ...(current?.sources.filter((s) => s.messageId !== message.id) ||
                []),
              reference,
            ],
            note: current?.note || "",
            participationDate: current?.participationDate || null,
            actualReward: current?.actualReward ?? null,
          };
          const unlock = await store.lock(`offer:${id}`, 30);
          if (!unlock)
            throw new Error("Предложение изменяется, повторим позже");
          try {
            const fresh = await store.get<Offer>("offer", id);
            if (fresh)
              Object.assign(offer, {
                stage: fresh.stage,
                note: fresh.note,
                participationDate: fresh.participationDate,
                actualReward: fresh.actualReward,
              });
            await store.put("offer", id, offer);
          } finally {
            await unlock();
          }
          if (!existing && offer.match !== "no") added++;
          job.progress.offersAdded = added;
        }
        await store.put("message", message.id, {
          ...message,
          processedHash: message.hash,
        });
        processed++;
        job.progress.messagesDone = processed;
        await report(true);
      } catch {
        control.check();
        errors.push(
          "Не удалось обработать часть сообщений через ИИ. Они сохранены для повторного запуска.",
        );
        break;
      }
    }
    // A changed profile or deleted rejection must also affect already extracted offers.
    const stale = (await store.list<Offer>("offer"))
      .filter((o) => o.stage === "new" && o.matchVersion !== revision)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    job.progress.recheckTotal = stale.length;
    job.progress.sourceName = undefined;
    for (const offer of stale) {
      control.check();
      if (calls >= config.maxCalls) {
        errors.push(
          "Персонализация обновлена частично: достигнут лимит запросов.",
        );
        break;
      }
      try {
        const mismatch = hardMismatch(offer, profile);
        calls++;
        job.progress.phase = "recheck";
        job.progress.aiCalls = calls;
        await report(true);
        const result = mismatch
          ? {
              match: "no" as const,
              reasons: [mismatch],
              questions: [],
              score: 0,
            }
          : await control.wait(evaluate(offer, profile, feedback, control.signal), "ИИ");
        const unlock = await store.lock(`offer:${offer.id}`, 30);
        if (!unlock) continue;
        try {
          const fresh = await store.get<Offer>("offer", offer.id);
          if (fresh && fresh.stage === "new")
            await store.put("offer", offer.id, {
              ...fresh,
              ...result,
              matchVersion: revision,
            });
        } finally {
          await unlock();
        }
        job.progress.rechecked++;
        await report(true);
      } catch {
        control.check();
        errors.push(
          "Часть предложений не удалось повторно оценить. Повторим при следующем сборе.",
        );
        break;
      }
    }
    const visible = (await store.list<Offer>("offer")).filter(
      (o) => o.day === job.day && o.match !== "no",
    );
    let summary = visible.length
      ? `Найдено предложений: ${visible.length}. Открой карточки, чтобы выбрать интересное.`
      : "Новых подходящих опросов нет.";
    if (visible.length && calls < config.maxCalls) {
      calls++;
      job.progress.phase = "summary";
      job.progress.aiCalls = calls;
      await report(true);
      try {
        summary = (await control.wait(summarize(visible, control.signal), "ИИ")).summary;
      } catch {
        control.check();
        errors.push(
          "Не удалось составить краткую сводку. Сами предложения доступны.",
        );
      }
    }
    const state: Digest["status"] = errors.length
      ? processed || visible.length
        ? "partial"
        : "failed"
      : "complete";
    control.check();
    job.progress.phase = state === "failed" ? "failed" : "done";
    await store.put("digest", digestId, {
      ...digest,
      status: state,
      newCount: visible.length,
      summary,
      errors: [...new Set(errors)],
      finishedAt: new Date().toISOString(),
    });
    await store.put("job", job.id, {
      ...job,
      status: state === "failed" ? "failed" : "done",
      attempts: job.attempts + 1,
      incomplete: errors.length > 0,
      error: errors.join(" "),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    job.progress.phase = control.signal.aborted ? "cancelled" : "failed";
    job.cancelledBy = control.signal.aborted ? (cancelledByUser ? "user" : "timeout") : undefined;
    await store.put("digest", digestId, {
      ...digest,
      status: "failed",
      summary: "Сбор не завершён",
      errors: [error instanceof Error ? error.message : "Ошибка сбора"],
      finishedAt: new Date().toISOString(),
    });
    await store.put("job", job.id, {
      ...job,
      status: "failed",
      incomplete: true,
      error: error instanceof Error ? error.message : "Ошибка сбора",
      attempts: job.attempts + 1,
      updatedAt: new Date().toISOString(),
    });
  } finally {
    clearInterval(cancellationPoll);
    control.close();
    await release();
  }
  return { added };
}
