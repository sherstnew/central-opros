import { personalize, personalDigests } from "./personalization";
import { createHash, randomUUID } from "node:crypto";
import { store } from "./store";
import { config } from "./config";
import { analyze, findDuplicates } from "./ai";
import { dedupCandidate, duplicateCandidates } from "./matching";
import { mergeDuplicates } from "./dedup";
import { duplicateError } from "./duplicate-error";
import { validateDuplicateGroups } from "./duplicate-groups";
import { telegramClient } from "./telegram";
import { sourceEntity, sourceMessageUrl } from "./channels";
import { CollectionControl, COLLECTION_TIMEOUT_MS } from "./collection-control";
import {
  moscowDay,
  profileSchema,
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
  await store.put("control", cancellationKey(id), {
    requestedAt: new Date().toISOString(),
  });
  if (job.status === "pending")
    await store.put("job", id, {
      ...job,
      status: "failed",
      cancelledBy: "user",
      incomplete: true,
      error: "Сбор отменён пользователем",
      updatedAt: new Date().toISOString(),
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
    scheduledSlot?: string;
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
    : `collect:${day}${options.scheduledSlot ? `:${options.scheduledSlot}` : ""}`;
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
async function collectSource(
  source: Source,
  job: Job,
  control: CollectionControl,
  report: (force?: boolean) => Promise<void>,
) {
  const cursor = job.sourceCursors?.[source.id];
  if (cursor?.done) return;
  const client = await control.wait(telegramClient(control.signal), "Telegram");
  const abort = () => {
    void client.disconnect().catch(() => {});
  };
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
    const iterator = client
      .iterMessages(entity, {
        limit: config.maxMessages,
        offsetId: cursor?.offsetId || 0,
        offsetDate: Math.floor(until / 1000) + 1,
      })
      [Symbol.asyncIterator]();
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
        collectedAt: previous?.collectedAt || new Date().toISOString(),
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
  if (
    currentJob?.cancelledBy === "user" &&
    !["pending", "running"].includes(currentJob.status)
  ) {
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
    phase: "telegram",
    startedAt: now,
    deadlineAt: new Date(Date.now() + COLLECTION_TIMEOUT_MS).toISOString(),
    sourcesDone: 0,
    sourcesTotal: 0,
    messagesRead: 0,
    messagesDone: 0,
    messagesTotal: 0,
    aiCalls: 0,
    offersAdded: 0,
    rechecked: 0,
    recheckTotal: 0,
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
    processed = 0;
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
    const profile = profileSchema.parse({});
    const feedback: Feedback[] = [];
    const revision = "catalog:v1";
    calls = await personalize({ job, control, calls, report, errors });
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
        job.progress.sourceName = sources.find(
          (s) => s.id === message.sourceId,
        )?.name;
        await report(true);
        const candidates = duplicateCandidates(
          message.text,
          await store.list<Offer>("catalog"),
        );
        const { surveys } = await control.wait(
          analyze(
            message.text.slice(0, 18000),
            message.date,
            profile,
            feedback,
            candidates,
            control.signal,
          ),
          "ИИ",
        );
        for (const analyzed of surveys) {
          const { duplicateId, ...item } = analyzed;
          control.check();
          if (!item.isSurvey) continue;
          const assessment = {
            match: "maybe" as const,
            reasons: [],
            questions: [],
            score: 50,
          };
          const offers = (await store.list<Offer>("catalog")).filter(
            (o) => !o.duplicateOf && !o.manuallyAdded,
          );
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
            offers.find((o) => dedupCandidate(item, o)) ||
            (candidates.some((o) => o.id === duplicateId)
              ? offers.find((o) => o.id === duplicateId)
              : undefined);
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
          const current = existing
            ? await store.get<Offer>("catalog", id)
            : null;
          const offer: Offer = {
            ...item,
            id,
            createdAt: current?.createdAt || message.collectedAt || updatedAt,
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
          const unlock = await store.lock(`catalog:${id}`, 30);
          if (!unlock)
            throw new Error("Предложение изменяется, повторим позже");
          try {
            const fresh = await store.get<Offer>("catalog", id);
            if (fresh)
              Object.assign(offer, {
                stage: fresh.stage,
                note: fresh.note,
                participationDate: fresh.participationDate,
                actualReward: fresh.actualReward,
              });
            await store.put("catalog", id, offer);
          } finally {
            await unlock();
          }
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
    // One-time semantic cleanup of accumulated offers, resumable within the call budget.
    const unchecked = (await store.list<Offer>("catalog"))
      .filter((o) => !o.duplicateOf && !o.manuallyAdded)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const offer of unchecked) {
      if (calls >= config.maxCalls - 1) break;
      const marker = `catalog-dedup:v1:${offer.id}`;
      if (await store.get("control", marker)) continue;
      const candidates = duplicateCandidates(
        `${offer.title} ${offer.summary} ${offer.organizer} ${offer.applyUrl}`,
        unchecked.filter((o) => o.id !== offer.id),
        39,
      );
      if (!candidates.length) continue;
      calls++;
      job.progress.phase = "evaluate";
      job.progress.aiCalls = calls;
      await report(true);
      try {
        const batch = [offer, ...candidates];
        const { groups } = await control.wait(
          findDuplicates(batch, control.signal),
          "ИИ",
        );
        const allowed = new Set(batch.map((o) => o.id));
        validateDuplicateGroups(groups, allowed);
        for (const group of groups) await mergeDuplicates(group, "catalog");
        for (const checked of batch)
          await store.put("control", `catalog-dedup:v1:${checked.id}`, {
            checkedAt: new Date().toISOString(),
          });
      } catch (error) {
        control.check();
        const diagnostic = {
          ...duplicateError(error),
          jobId: job.id,
          offerId: offer.id,
          candidateIds: candidates.map((o) => o.id),
          at: new Date().toISOString(),
        };
        console.warn("Duplicate check failed", diagnostic);
        // Failure to save diagnostics must not fail the completed message import.
        await store
          .put("control", "dedup:last-error", diagnostic)
          .catch(() => {});
        errors.push(
          `Не удалось проверить накопленные повторы. ${diagnostic.detail} Повторим при следующем сборе.`,
        );
        break;
      }
    }
    calls = await personalize({ job, control, calls, report, errors });
    const failed =
      errors.length > 0 &&
      processed === 0 &&
      (await store.list("catalog")).length === 0;
    await personalDigests(
      job,
      failed ? { ...digest, status: "failed" } : digest,
      errors,
      control,
    );
    control.check();
    job.progress.phase = failed ? "failed" : "done";
    await store.put("job", job.id, {
      ...job,
      status: failed ? "failed" : "done",
      attempts: job.attempts + 1,
      incomplete: errors.length > 0,
      error: errors.join(" "),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    job.progress.phase = control.signal.aborted ? "cancelled" : "failed";
    job.cancelledBy = control.signal.aborted
      ? cancelledByUser
        ? "user"
        : "timeout"
      : undefined;
    await personalDigests(job, { ...digest, status: "failed" }, [
      error instanceof Error ? error.message : "Ошибка сбора",
    ]);
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
  return { added: job.progress?.offersAdded || 0 };
}
