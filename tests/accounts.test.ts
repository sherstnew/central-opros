import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer } from "../server/index";
import { config } from "../server/config";
import { hashPassword } from "../server/security";
import { tokenHash } from "../server/security";
import { store, Store } from "../server/store";
import { migrateAccounts, normalizeName } from "../server/accounts";
import { profileSchema, type Offer } from "../shared/model";

const headers = { origin: "http://localhost:5173", "x-opros-client": "web" };
let app: Awaited<ReturnType<typeof createServer>>;
function cookies(response: any) {
  const lines = [response.headers["set-cookie"]].flat() as string[];
  return {
    opros_session: lines
      .find((v) => v.startsWith("opros_session="))!
      .match(/opros_session=([^;]+)/)![1],
  };
}
beforeAll(async () => {
  config.demo = false;
  config.passwordHash = hashPassword("denis-password-123");
  app = await createServer();
});
afterAll(async () => {
  await app.close();
  config.demo = true;
});

describe("Аккаунты и границы личных данных", () => {
  it("ограничивает попытки регистрации и входа", async () => {
    const limited = await createServer();
    try {
      for (const url of ["/api/register", "/api/auth"]) {
        const responses = [];
        for (let i = 0; i < 6; i++)
          responses.push(
            await limited.inject({
              method: "POST",
              url,
              headers,
              payload: { name: "Несуществующий", password: "short" },
            }),
          );
        expect(responses[0].statusCode).toBe(
          url === "/api/register" ? 400 : 401,
        );
        expect(responses[5].statusCode).toBe(429);
      }
    } finally {
      await limited.close();
    }
  });
  it("нормализует имена, но сохраняет отображаемое написание", () => {
    expect(normalizeName("  Анна\u00a0  ИВАНОВА  ")).toBe("анна иванова");
    expect(normalizeName("Ａｎｎａ")).toBe("anna");
  });
  it("сохраняет входы, переключает кабинеты, изолирует карточки и запрещает чужие действия", async () => {
    const denis = cookies(
      await app.inject({
        method: "POST",
        url: "/api/auth",
        headers,
        payload: { name: "денис", password: "denis-password-123" },
      }),
    );
    const manual = await app.inject({
      method: "POST",
      url: "/api/offers",
      headers,
      cookies: denis,
      payload: {
        title: "Личное",
        summary: "Только Денис",
        reward: 1000,
        duration: 60,
      },
    });
    expect(manual.statusCode).toBe(200);
    const registration = await app.inject({
      method: "POST",
      url: "/api/register",
      headers,
      cookies: denis,
      payload: { name: "Анна", password: "anna-password-123" },
    });
    expect(registration.statusCode).toBe(200);
    const browser = cookies(registration),
      annaId = registration.json().account.id;
    const auth = (
      await app.inject({ url: "/api/auth", cookies: browser })
    ).json();
    expect(auth.accounts.map((a: any) => a.name)).toEqual(["Денис", "Анна"]);
    expect(JSON.stringify(auth)).not.toContain("passwordHash");
    const state = (
      await app.inject({ url: "/api/state", cookies: browser })
    ).json();
    expect(state.account.id).toBe(annaId);
    expect(state.profile).toEqual(profileSchema.parse({ name: "Анна" }));
    expect(state.offers).toEqual([]);
    expect(state.feedback).toEqual([]);
    for (const id of [manual.json().id, `user:owner:${manual.json().id}`]) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/api/offers/${encodeURIComponent(id)}`,
            headers,
            cookies: browser,
            payload: { stage: "paid" },
          })
        ).statusCode,
      ).toBe(404);
    }
    for (const url of [
      "/api/collect",
      "/api/telegram/start",
      "/api/sources",
      "/api/ai/test",
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers,
            cookies: browser,
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/profile",
          headers,
          cookies: browser,
          payload: { name: "Моя анкета", city: "Казань" },
        })
      ).statusCode,
    ).toBe(200);
    const switchResult = await app.inject({
      method: "POST",
      url: "/api/accounts/switch",
      headers,
      cookies: browser,
      payload: { userId: "owner" },
    });
    expect(switchResult.statusCode).toBe(200);
    const ownerState = (
      await app.inject({ url: "/api/state", cookies: browser })
    ).json();
    expect(ownerState.profile.city).not.toBe("Казань");
    expect(ownerState.offers.some((o: any) => o.id === manual.json().id)).toBe(
      true,
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/profile",
          headers: { ...headers, "x-opros-account": annaId },
          cookies: browser,
          payload: { city: "Устаревшая вкладка" },
        })
      ).statusCode,
    ).toBe(409);
    // Leaving owner keeps Anna's grant; leaving all removes it.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/logout",
          headers,
          cookies: browser,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/auth", cookies: browser })).json().account
        .id,
    ).toBe(annaId);
    await app.inject({
      method: "POST",
      url: "/api/logout",
      headers,
      cookies: browser,
      payload: { all: true },
    });
    expect(
      (await app.inject({ url: "/api/state", cookies: browser })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/register",
          headers,
          payload: { name: "  АННА ", password: "another-password" },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("не разрешает переключение на аккаунт без входа", async () => {
    const browser = cookies(
      await app.inject({
        method: "POST",
        url: "/api/auth",
        headers,
        payload: { name: "Денис", password: "denis-password-123" },
      }),
    );
    const anna = (await store.list<any>("user")).find((u) => u.name === "Анна");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/accounts/switch",
          headers,
          cookies: browser,
          payload: { userId: anna.id },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("не принимает истёкшую сессию", async () => {
    const browser = cookies(
      await app.inject({
        method: "POST",
        url: "/api/auth",
        headers,
        payload: { name: "Денис", password: "denis-password-123" },
      }),
    );
    const id = tokenHash(browser.opros_session);
    const session = await store.get<any>("session", id);
    await store.put("session", id, { ...session, expires: Date.now() - 1 });
    expect(
      (await app.inject({ url: "/api/state", cookies: browser })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/api/auth", cookies: browser })).json()
        .authenticated,
    ).toBe(false);
  });
  it("миграция повторяется без сброса пароля, карточек и сессий", async () => {
    const db = new Store("");
    await db.put("offer", "old", {
      id: "old",
      stage: "paid",
      note: "Сохранить",
      sources: [],
      createdAt: "2026-01-01",
      match: "yes",
      reasons: ["Личная причина"],
      questions: [],
      score: 90,
    } as unknown as Offer);
    await db.put("session", "legacy", {
      id: "legacy",
      expires: Date.now() + 10000,
    });
    await migrateAccounts(db);
    const owner = await db.get<any>("user", "owner");
    expect(owner.name).toBe("Денис");
    expect(await db.get("offer", "old")).toMatchObject({
      id: "old",
      stage: "paid",
      note: "Сохранить",
      catalogId: "old",
    });
    expect(await db.get("catalog", "old")).toMatchObject({
      stage: "new",
      note: "",
      reasons: [],
    });
    expect(await db.get("session", "legacy")).toMatchObject({
      userIds: ["owner"],
      activeUserId: "owner",
    });
    // Simulate interruption before completion marker.
    await db.remove("control", "accounts:v1");
    await migrateAccounts(db);
    expect(await db.get("user", "owner")).toEqual(owner);
    expect(await db.list("catalog")).toHaveLength(1);
  });
});
