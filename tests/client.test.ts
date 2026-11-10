import { afterEach, describe, it, expect, vi } from "vitest";
import { api } from "../src/api";
afterEach(() => vi.unstubAllGlobals());
describe("Запросы клиента без тела", () => {
  it("передаёт код ошибки авторизации интерфейсу", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ error: "Войди в приложение" }),
        }),
    );
    await expect(api("/state")).rejects.toMatchObject({
      status: 401,
      message: "Войди в приложение",
    });
  });
  it("не добавляет JSON content-type к пустому DELETE или POST", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    await api("/feedback/123", "DELETE");
    await api("/collect", "POST");
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers).not.toHaveProperty("Content-Type");
      expect(options.headers["X-Opros-Client"]).toBe("web");
    }
  });
  it("сериализует тело изменений как JSON", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    await api("/offers/123", "PATCH", { stage: "saved" });
    expect(fetch.mock.calls[0][1].headers["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ stage: "saved" });
  });
});
