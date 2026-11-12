import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createServer } from "../server/index";
import { notify } from "../server/notifications";
import { config } from "../server/config";
import { store } from "../server/store";
import { hashPassword, tokenHash } from "../server/security";

const mock = vi.hoisted(() => ({ send: vi.fn(async () => {}) }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mock.send },
}));
let app: Awaited<ReturnType<typeof createServer>>;
const headers = { origin: "http://localhost:5173", "x-opros-client": "web" };
function cookies(response: any) {
  return {
    opros_session: ([response.headers["set-cookie"]].flat() as string[])
      .find((s) => s.startsWith("opros_session="))!
      .match(/opros_session=([^;]+)/)![1],
  };
}
beforeAll(async () => {
  config.demo = false;
  config.passwordHash = hashPassword("notification-owner-pass");
  config.vapidPublic = "test";
  config.vapidPrivate = "test";
  config.vapidSubject = "mailto:test@example.com";
  app = await createServer();
});
afterAll(async () => {
  await app.close();
  config.demo = true;
  config.vapidPublic = "";
  config.vapidPrivate = "";
});
describe("Принадлежность уведомлений", () => {
  it("перепривязывает endpoint к активному кабинету и отправляет его личную сводку", async () => {
    let browser = cookies(
      await app.inject({
        method: "POST",
        url: "/api/auth",
        headers,
        payload: { name: "Денис", password: "notification-owner-pass" },
      }),
    );
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
      keys: { p256dh: "test", auth: "test" },
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/push",
          cookies: browser,
          headers,
          payload: subscription,
        })
      ).statusCode,
    ).toBe(200);
    const id = tokenHash(subscription.endpoint);
    expect(await store.get("subscription", id)).not.toBeNull();
    const registered = await app.inject({
      method: "POST",
      url: "/api/register",
      cookies: browser,
      headers,
      payload: { name: "Анна", password: "notification-anna-pass" },
    });
    browser = cookies(registered);
    const anna = registered.json().account.id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/push",
          cookies: browser,
          headers,
          payload: subscription,
        })
      ).statusCode,
    ).toBe(200);
    expect(await store.get("subscription", id)).toBeNull();
    expect(
      await store.as(anna, () => store.get("subscription", id)),
    ).not.toBeNull();
    await store.put("digest", "owner-digest", {
      id: "owner-digest",
      day: "2026-11-12",
      startedAt: "2026-11-12T00:00:00Z",
      status: "complete",
      newCount: 99,
    });
    await store.as(anna, async () => {
      await store.put("digest", "anna-digest", {
        id: "anna-digest",
        day: "2026-11-12",
        startedAt: "2026-11-12T00:00:00Z",
        status: "complete",
        newCount: 2,
      });
      await notify("2026-11-12");
      await notify("2026-11-12");
    });
    expect(mock.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      (mock.send.mock.calls[0] as unknown as [unknown, string])[1],
    );
    expect(payload.body).toContain("2");
    expect(payload.body).not.toContain("99");
    expect(payload.url).toBe(`/?day=2026-11-12&account=${anna}`);
    expect(payload.title).toContain("Анна");
    const state = (
      await app.inject({ url: "/api/state", cookies: browser })
    ).json();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/settings",
          cookies: browser,
          headers,
          payload: { ...state.settings, notificationTime: "10:15" },
        })
      ).statusCode,
    ).toBe(200);
    expect(await store.get("profile", "notification")).toBeNull();
    expect(
      await store.as(anna, () => store.get("profile", "notification")),
    ).toEqual({ notificationTime: "10:15" });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/settings",
          cookies: browser,
          headers,
          payload: { ...state.settings, collectionTime: "10:15" },
        })
      ).statusCode,
    ).toBe(403);
  });
});
