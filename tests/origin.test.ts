import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { createServer } from "../server/index";
import { config } from "../server/config";
import { hashPassword } from "../server/password";
const previous = {
  demo: config.demo,
  production: config.production,
  origin: config.origin,
  passwordHash: config.passwordHash,
};
let app: Awaited<ReturnType<typeof createServer>>;
beforeEach(async () => {
  config.demo = false;
  config.production = false;
  config.origin = "http://localhost:5173";
  config.passwordHash = hashPassword("test-origin-password");
  app = await createServer();
});
afterEach(async () => {
  await app.close();
  Object.assign(config, previous);
});
async function login(origin?: string, client = "web") {
  return app.inject({
    method: "POST",
    url: "/api/auth",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      "x-opros-client": client,
    },
    payload: { password: "test-origin-password" },
  });
}
describe("Локальный вход с настоящим режимом авторизации", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://[::1]:5173",
  ])("принимает %s после выхода из деморежима", async (origin) => {
    const response = await login(origin);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
  });
  it.each([
    undefined,
    "null",
    "https://evil.example",
    "http://localhost.evil.example:5173",
    "http://127.0.0.1.evil.example:5173",
    "http://localhost:5173/",
    "http://evil@localhost:5173",
  ])("отклоняет посторонний или некорректный Origin %s", async (origin) =>
    expect((await login(origin)).statusCode).toBe(403),
  );
  it("сохраняет проверку заголовка клиента", async () =>
    expect((await login("http://localhost:5173", "")).statusCode).toBe(403));
});
describe("Вход на развёрнутом сервере", () => {
  it("принимает только настроенный origin, включая нормализацию завершающего слеша", async () => {
    config.production = true;
    config.origin = "https://research.example/";
    expect((await login("http://localhost:5173")).statusCode).toBe(403);
    expect((await login("https://evil.example")).statusCode).toBe(403);
    const response = await login("https://research.example");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Secure");
  });
});
