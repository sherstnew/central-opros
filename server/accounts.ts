import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { store, type Store } from "./store";
import { config } from "./config";
import { hashPassword, tokenHash } from "./security";
import {
  profileSchema,
  type User,
  type PublicUser,
  type Offer,
} from "../shared/model";

export const normalizeName = (name: string) =>
  name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ru-RU");
export const credentialsSchema = z.object({
  name: z.string().normalize().trim().min(1).max(80),
  password: z.string().min(1).max(512),
});
export const publicUser = ({ id, name, role }: User): PublicUser => ({
  id,
  name,
  role,
});
export interface Session {
  id: string;
  expires: number;
  activeUserId: string;
  userIds: string[];
}
declare module "fastify" {
  interface FastifyRequest {
    accountId: string;
    accountRole: User["role"];
    accountSession: Session | null;
  }
}

export async function migrateAccounts(db: Store = store) {
  // Both API and worker must finish migration before serving or collecting.
  while (true) {
    if (await db.get("control", "accounts:v1")) return;
    const release = await db.lock("accounts:migration", 60);
    if (!release) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      if (await db.get("control", "accounts:v1")) return;
      if (!(await db.get("user", "owner")))
        await db.put<User>("user", "owner", {
          id: "owner",
          name: "Денис",
          normalizedName: normalizeName("Денис"),
          passwordHash:
            config.passwordHash ||
            hashPassword(randomBytes(32).toString("hex")),
          createdAt: new Date(0).toISOString(),
          role: "owner",
        });
      if (!(await db.get("profile", "owner")))
        await db.put(
          "profile",
          "owner",
          profileSchema.parse({ name: "Денис" }),
        );
      for (const offer of await db.list<Offer>("offer")) {
        if (offer.manuallyAdded) continue;
        const {
          stage: _stage,
          note: _note,
          participationDate: _date,
          actualReward: _reward,
          match: _match,
          reasons: _reasons,
          questions: _questions,
          score: _score,
          matchVersion: _version,
          catalogUpdatedAt: _catalogVersion,
          ...facts
        } = offer;
        if (!(await db.get("catalog", offer.id)))
          await db.put("catalog", offer.id, {
            ...facts,
            stage: "new",
            note: "",
            participationDate: null,
            actualReward: null,
            match: "maybe",
            reasons: [],
            questions: [],
            score: 50,
          });
        await db.put("offer", offer.id, {
          ...offer,
          catalogId: offer.id,
          catalogUpdatedAt: offer.updatedAt,
        });
      }
      for (const session of await db.list<Session>("session"))
        if (!session.userIds)
          await db.put("session", session.id, {
            ...session,
            activeUserId: "owner",
            userIds: ["owner"],
          });
      await db.put("control", "accounts:v1", {
        completedAt: new Date().toISOString(),
      });
    } finally {
      await release();
    }
    return;
  }
}
export async function readSession(req: FastifyRequest) {
  const token = req.cookies.opros_session;
  const session = token
    ? await store.get<Session>("session", tokenHash(token))
    : null;
  return session && session.expires > Date.now() ? session : null;
}
export async function updateSession<T>(
  req: FastifyRequest,
  work: (session: Session | null) => Promise<T>,
) {
  const id = req.accountSession?.id;
  if (!id && config.demo) return work(null);
  if (!id)
    throw Object.assign(new Error("Войди в приложение"), { statusCode: 401 });
  const release = await store.lock(`session:${id}`, 30);
  if (!release)
    throw Object.assign(new Error("Аккаунт переключается. Попробуй ещё раз."), {
      statusCode: 409,
    });
  try {
    const current = await readSession(req);
    if (!current)
      throw Object.assign(new Error("Войди в приложение"), { statusCode: 401 });
    if (current.activeUserId !== req.accountId)
      throw Object.assign(new Error("Аккаунт изменился. Обнови страницу."), {
        statusCode: 409,
      });
    return await work(current);
  } finally {
    await release();
  }
}
export async function grantAccount(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
) {
  const old = await readSession(req);
  if (req.cookies.opros_demo_signed_out)
    reply.clearCookie("opros_demo_signed_out", { path: "/" });
  for (const session of await store.list<Session>("session"))
    if (session.expires < Date.now()) await store.remove("session", session.id);
  const token = randomBytes(32).toString("hex"),
    id = tokenHash(token);
  const session: Session = {
    id,
    expires: Date.now() + 30 * 86400000,
    activeUserId: userId,
    userIds: [
      ...new Set([
        ...(old?.userIds ||
          (config.demo && !req.cookies.opros_demo_signed_out ? ["owner"] : [])),
        userId,
      ]),
    ],
  };
  await store.put("session", id, session);
  if (old) await store.remove("session", old.id);
  reply.setCookie("opros_session", token, {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    path: "/",
    maxAge: 30 * 86400,
  });
}
export async function newAccountProfile(id: string, name: string) {
  await store.as(id, () =>
    store.put("profile", "owner", profileSchema.parse({ name })),
  );
}
