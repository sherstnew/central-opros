import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { config } from "./config";
import { isAllowedOrigin } from "./origin";
import { store } from "./store";
import { tokenHash, verifyPassword } from "./security";
import { seedDemo } from "./demo";
import {
  telegramConnected,
  startTelegram,
  telegramFlow,
  submitTelegram,
  disconnectTelegram,
  testTelegramConnection,
} from "./telegram";
import { enqueueCollection, cancelCollection } from "./pipeline";
import { validateAI } from "./ai";
import { pushConfigured } from "./notifications";
import { listAccountChannels, addAccountChannels } from "./channels";
import {
  profileSchema,
  settingsSchema,
  offerPatchSchema,
  feedbackSchema,
  sourceInputSchema,
  collectionInputSchema,
  manualOfferSchema,
  moscowDay,
  type Offer,
  type Profile,
  type Settings,
  type Feedback,
  type Source,
  type Digest,
  type Job,
  type PushSubscriptionRecord,
} from "../shared/model";
export async function createServer() {
  const app = Fastify({
    logger: process.env.VITEST
      ? false
      : {
          level: "info",
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
        },
    bodyLimit: 32768,
    trustProxy: config.production
      ? (_address: string, hop: number) => hop < 1
      : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 150, timeWindow: "1 minute" });
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        !isAllowedOrigin(origin, config.origin, config.production) ||
        req.headers["x-opros-client"] !== "web"
      )
        return reply.code(403).send({ error: "Недопустимый источник запроса" });
    }
    if (["/api/auth", "/api/health"].includes(req.url.split("?")[0])) return;
    if (config.demo) return;
    const token = req.cookies.opros_session,
      session = token
        ? await store.get<{ expires: number }>("session", tokenHash(token))
        : null;
    if (!session || session.expires < Date.now())
      return reply.code(401).send({ error: "Войди в приложение" });
  });
  app.setErrorHandler(
    (error: Error & { code?: string; statusCode?: number }, req, reply) => {
      if (error instanceof ZodError)
        return reply.code(400).send({
          error: error.issues[0]?.message || "Проверь введённые данные",
        });
      req.log.warn({ code: error.code }, "Request failed");
      const expected =
        error.constructor === Error ||
        (error.statusCode && error.statusCode < 500);
      return reply
        .code(
          error.statusCode && error.statusCode < 500
            ? error.statusCode
            : expected
              ? 400
              : 500,
        )
        .send({
          error:
            error.statusCode === 429
              ? "Слишком много запросов. Попробуй чуть позже."
              : expected
                ? error.message
                : "Не удалось выполнить действие",
        });
    },
  );
  app.get("/api/health", async () => {
    await store.health();
    return { ok: true };
  });
  app.get("/api/auth", async (req) => {
    if (config.demo) return { authenticated: true, demo: true };
    const session = req.cookies.opros_session
      ? await store.get<{ expires: number }>(
          "session",
          tokenHash(req.cookies.opros_session),
        )
      : null;
    return {
      authenticated: !!session && session.expires > Date.now(),
      demo: false,
    };
  });
  app.post(
    "/api/auth",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (config.demo) return { ok: true };
      const { password } = z
        .object({ password: z.string().max(512) })
        .parse(req.body);
      if (!verifyPassword(password, config.passwordHash))
        return reply.code(401).send({ error: "Неверный пароль" });
      for (const session of await store.list<{ id: string; expires: number }>(
        "session",
      ))
        if (session.expires < Date.now())
          await store.remove("session", session.id);
      const token = randomBytes(32).toString("hex"),
        id = tokenHash(token);
      await store.put("session", id, {
        id,
        expires: Date.now() + 30 * 86400000,
      });
      reply.setCookie("opros_session", token, {
        httpOnly: true,
        secure: config.production,
        sameSite: "strict",
        path: "/",
        maxAge: 30 * 86400,
      });
      return { ok: true };
    },
  );
  app.post("/api/logout", async (req, reply) => {
    if (req.cookies.opros_session)
      await store.remove("session", tokenHash(req.cookies.opros_session));
    reply.clearCookie("opros_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/state", async () => ({
    demo: config.demo,
    profile:
      (await store.get<Profile>("profile", "owner")) || profileSchema.parse({}),
    settings:
      settingsSchema.parse((await store.get<Settings>("profile", "settings")) || {}),
    offers: (await store.list<Offer>("offer")).filter((o) => !o.duplicateOf),
    sources: await store.list<Source>("source"),
    feedback: await store.list<Feedback>("feedback"),
    digests: await store.list<Digest>("digest"),
    jobs: await store.list<Job>("job"),
    telegram: {
      configured: !!(config.telegramId && config.telegramHash),
      connected: await telegramConnected(),
    },
    ai: {
      configured: !!(config.aiKey && config.aiModel),
      model: config.aiModel,
    },
    push: { configured: pushConfigured(), publicKey: config.vapidPublic },
  }));
  app.put("/api/profile", async (req) => {
    const p = profileSchema.parse(req.body);
    if (
      p.birthDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate) ||
        Number.isNaN(Date.parse(p.birthDate)) ||
        new Date(p.birthDate).toISOString().slice(0, 10) !== p.birthDate ||
        p.birthDate > moscowDay())
    )
      throw new Error("Проверь дату рождения");
    await store.put("profile", "owner", p);
    await store.put("profile", "revision", { value: randomUUID() });
    return { ok: true };
  });
  app.put("/api/settings", async (req) => {
    await store.put("profile", "settings", settingsSchema.parse(req.body));
    return { ok: true };
  });
  app.post("/api/offers", async (req) => {
    const input = manualOfferSchema.parse(req.body);
    const id = randomUUID(), now = new Date().toISOString();
    const offer: Offer = {
      ...input, id, isSurvey: true, manuallyAdded: true,
      createdAt: now, updatedAt: now, day: moscowDay(), stage: "new",
      match: "maybe", reasons: ["Добавлено вручную"], questions: [], score: 50,
      currency: "RUB", startsAt: null, deadline: null,
      requirements: [], category: "Другое", ageMin: null, ageMax: null,
      gender: null, organizer: null, dedupKey: `manual:${id}`,
      sources: [{ messageId: `manual:${id}`, name: "Добавлено вручную", url: input.applyUrl || "", text: input.summary }],
      note: "", participationDate: null, actualReward: null,
    };
    await store.put("offer", id, offer);
    return { id, day: offer.day };
  });
  app.patch<{ Params: { id: string } }>("/api/offers/:id", async (req) => {
    const patch = offerPatchSchema.parse(req.body),
      unlock = await store.lock(`offer:${req.params.id}`, 30);
    if (!unlock) throw new Error("Предложение обновляется, повтори действие");
    try {
      const offer = await store.get<Offer>("offer", req.params.id);
      if (!offer) throw new Error("Предложение не найдено");
      await store.put("offer", offer.id, {
        ...offer,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    } finally {
      await unlock();
    }
  });
  app.post("/api/feedback", async (req) => {
    const input = feedbackSchema.parse(req.body),
      unlock = await store.lock(`offer:${input.offerId}`, 30);
    if (!unlock) throw new Error("Предложение обновляется");
    try {
      const offer = await store.get<Offer>("offer", input.offerId);
      if (!offer) throw new Error("Предложение не найдено");
      const feedback: Feedback = {
        ...input,
        id: randomUUID(),
        title: offer.title,
        category: offer.category,
        createdAt: new Date().toISOString(),
      };
      await store.put("feedback", feedback.id, feedback);
      await store.put("profile", "revision", { value: randomUUID() });
      await store.put("offer", offer.id, { ...offer, stage: "hidden" });
      return { ok: true, id: feedback.id };
    } finally {
      await unlock();
    }
  });
  app.patch<{ Params: { id: string } }>("/api/feedback/:id", async (req) => {
    const patch = z
      .object({
        reason: z.string().max(1500),
        rule: z.string().max(300),
        permanent: z.boolean(),
      })
      .parse(req.body);
    if (patch.permanent && patch.rule.trim().length < 3)
      throw new Error("Укажи условие исключения");
    const f = await store.get<Feedback>("feedback", req.params.id);
    if (!f) throw new Error("Причина не найдена");
    if (f.scope === "timing" && patch.permanent)
      throw new Error("Разовая занятость не может быть постоянным запретом");
    await store.put("feedback", f.id, { ...f, ...patch });
    await store.put("profile", "revision", { value: randomUUID() });
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/feedback/:id", async (req) => {
    await store.remove("feedback", req.params.id);
    await store.put("profile", "revision", { value: randomUUID() });
    return { ok: true };
  });
  app.post("/api/sources", async (req) => {
    const input = sourceInputSchema.parse(req.body),
      handle = input.handle
        .replace("https://t.me/", "")
        .replace(/\/$/, "")
        .toLowerCase();
    const id = handle;
    if (await store.get("source", id))
      throw new Error("Этот канал уже добавлен");
    await store.put<Source>("source", id, {
      id,
      handle,
      name: input.name || `@${handle}`,
      enabled: true,
      lastMessageId: 0,
    });
    return { ok: true };
  });
  app.get("/api/telegram/channels", async () => ({
    channels: await listAccountChannels(),
  }));
  app.post("/api/sources/from-telegram", async (req) => {
    const { ids } = z
      .object({
        ids: z
          .array(z.string().regex(/^(?:(?:chat|user):)?[1-9]\d{0,19}$/))
          .min(1)
          .max(100),
      })
      .parse(req.body);
    return addAccountChannels(ids);
  });
  app.patch<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const source = await store.get<Source>("source", req.params.id);
    if (!source) throw new Error("Источник не найден");
    await store.put("source", source.id, { ...source, enabled });
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    await store.remove("source", req.params.id);
    await store.remove("secret", `channel:${req.params.id}`);
    return { ok: true };
  });
  app.post("/api/collect", async (req) => {
    const input = collectionInputSchema.parse(req.body ?? {});
    if (config.demo)
      return {
        demo: true,
        message:
          "Демонстрационные данные. Для настоящего сбора подключи сервер и Telegram.",
      };
    return enqueueCollection(moscowDay(), { manual: true, ...input });
  });
  app.post<{ Params: { id: string } }>("/api/collect/:id/cancel", async (req) => {
    return cancelCollection(z.string().min(1).max(100).parse(req.params.id));
  });
  app.post("/api/telegram/test", {
    config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
  }, async () => testTelegramConnection());
  app.post(
    "/api/ai/test",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async () => validateAI(),
  );
  app.post(
    "/api/telegram/start",
    { config: { rateLimit: { max: 3, timeWindow: "5 minutes" } } },
    async (req) => {
      const { phone } = z
        .object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) })
        .parse(req.body);
      return startTelegram(phone);
    },
  );
  app.get<{ Params: { id: string } }>("/api/telegram/flow/:id", async (req) =>
    telegramFlow(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/telegram/flow/:id",
    async (req) => {
      const { value } = z
        .object({ value: z.string().min(1).max(256) })
        .parse(req.body);
      submitTelegram(req.params.id, value);
      return { ok: true };
    },
  );
  app.delete("/api/telegram", async () => {
    await disconnectTelegram();
    return { ok: true };
  });
  app.post("/api/push", async (req) => {
    if (!pushConfigured())
      throw new Error("Сначала настрой VAPID-ключи на сервере");
    const subscription = z
      .object({
        endpoint: z.string().url().max(2048),
        keys: z.object({
          p256dh: z.string().max(256),
          auth: z.string().max(256),
        }),
      })
      .parse(req.body);
    const host = new URL(subscription.endpoint);
    if (
      host.protocol !== "https:" ||
      ![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
        "wns2-par02p.notify.windows.com",
      ].some((h) => host.hostname === h || host.hostname.endsWith("." + h))
    )
      throw new Error("Неподдерживаемый push-сервис");
    const id = tokenHash(subscription.endpoint);
    const existing = await store.get<PushSubscriptionRecord>(
      "subscription",
      id,
    );
    await store.put<PushSubscriptionRecord>("subscription", id, {
      id,
      subscription,
      lastDay: existing?.lastDay,
    });
    return { ok: true };
  });
  app.delete("/api/push", async (req) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    await store.remove("subscription", tokenHash(endpoint));
    return { ok: true };
  });
  if (existsSync(resolve("dist/index.html"))) {
    await app.register(staticPlugin, {
      root: resolve("dist"),
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api"))
        return reply.code(404).send({ error: "Не найдено" });
      return reply.sendFile("index.html");
    });
  }
  if (config.demo) await seedDemo();
  // Local `npm run dev` / `npm start` also processes queued manual jobs.
  // Production runs the same scheduler in the separate worker container.
  if (!config.production && !config.demo && !process.env.VITEST) {
    const { tick } = await import("./worker");
    let running: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (!running)
        running = tick()
          .catch(() => {
            app.log.warn("Local worker tick failed; will retry");
          })
          .finally(() => {
            running = null;
          });
    }, 15000);
    timer.unref();
    app.addHook("onClose", async () => {
      clearInterval(timer);
      await running;
    });
  }
  return app;
}
if (!process.env.VITEST) {
  const app = await createServer();
  await app.listen({
    port: config.port,
    host: config.production ? "0.0.0.0" : "127.0.0.1",
  });
  process.on("SIGTERM", async () => {
    await app.close();
    await store.close();
  });
}
