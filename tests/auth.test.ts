import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer } from "../server/index";
import { config } from "../server/config";
import { hashPassword } from "../server/security";
let app: Awaited<ReturnType<typeof createServer>>;
const headers = { origin: "http://localhost:5173", "x-opros-client": "web" };
beforeAll(async () => {
  config.demo = false;
  config.passwordHash = hashPassword("test-owner-password");
  app = await createServer();
});
afterAll(async () => {
  await app.close();
  config.demo = true;
});
describe("Защищённый вход владельца", () => {
  it("не открывает анкету и ленту без сессии", async () =>
    expect((await app.inject({ url: "/api/state" })).statusCode).toBe(401));
  it("не принимает неправильный пароль", async () =>
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth",
          headers,
          payload: { password: "incorrect" },
        })
      ).statusCode,
    ).toBe(401));
  it("выдаёт HttpOnly-сессию и удаляет её при выходе", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth",
      headers,
      payload: { password: "test-owner-password" },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const cookies = {
      opros_session: cookie.match(/opros_session=([^;]+)/)![1],
    };
    expect((await app.inject({ url: "/api/state", cookies })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/logout",
          headers,
          cookies,
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/state", cookies })).statusCode).toBe(
      401,
    );
  });
});
