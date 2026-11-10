import { createHash, randomUUID } from "node:crypto";
import { store } from "./store";
import { config } from "./config";
import { extract, evaluate, summarize } from "./ai";
import { hardMismatch, dedupCandidate } from "./matching";
import { telegramClient } from "./telegram";
import { sourceEntity, sourceMessageUrl } from "./channels";
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
      updatedAt: new Date().toISOString(),
    };
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
  await store.put("job", id, next);
  return next;
}
async function collectSource(source: Source, job: Job) {
  const cursor = job.sourceCursors?.[source.id];
  if (cursor?.done) return;
  const client = await telegramClient();
  try {
    const window = job.window!;
    const since = Date.parse(window.since),
      until = Date.parse(window.until);
    const entity = await sourceEntity(client, source);
    let oldest = cursor?.offsetId || 0,
      top = source.lastMessageId,
      count = 0,
      complete = false;
    for await (const message of client.iterMessages(entity, {
      limit: config.maxMessages,
      offsetId: cursor?.offsetId || 0,
      offsetDate: Math.floor(until / 1000) + 1,
    })) {
      count++;
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
    await client.disconnect();
  }
}
export async function runCollection(job: Job) {
  const release = await store.lock("collection");
  if (!release) return false;
  const now = new Date().toISOString();
  job.window ??= collectionWindow();
  job.sourceCursors ??= {};
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
    const sources = (await store.list<Source>("source")).filter(
      (s) => s.enabled,
    );
    if (!sources.length)
      throw new Error("Добавь хотя бы один Telegram-канал в настройках");
    for (const source of sources) {
      try {
        await collectSource(source, job);
      } catch {
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
    for (const message of messages) {
      if (calls >= config.maxCalls) {
        errors.push(
          "Лимит запросов ИИ достигнут. Необработанные сообщения сохранены.",
        );
        break;
      }
      try {
        calls++;
        const { surveys } = await extract(
          message.text.slice(0, 18000),
          message.date,
        );
        if (calls + surveys.length > config.maxCalls) {
          errors.push(
            "Лимит запросов ИИ достигнут. Продолжи обработку повторным запуском.",
          );
          break;
        }
        for (const item of surveys) {
          if (!item.isSurvey) continue;
          calls++;
          const mismatch = hardMismatch(item, profile),
            assessment = mismatch
              ? {
                  match: "no" as const,
                  reasons: [mismatch],
                  questions: [],
                  score: 0,
                }
              : await evaluate(item, profile, feedback);
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
        }
        await store.put("message", message.id, {
          ...message,
          processedHash: message.hash,
        });
        processed++;
      } catch {
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
    for (const offer of stale) {
      if (calls >= config.maxCalls) {
        errors.push(
          "Персонализация обновлена частично: достигнут лимит запросов.",
        );
        break;
      }
      try {
        const mismatch = hardMismatch(offer, profile);
        calls++;
        const result = mismatch
          ? {
              match: "no" as const,
              reasons: [mismatch],
              questions: [],
              score: 0,
            }
          : await evaluate(offer, profile, feedback);
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
      } catch {
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
      try {
        summary = (await summarize(visible)).summary;
      } catch {
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
    await release();
  }
  return { added };
}
