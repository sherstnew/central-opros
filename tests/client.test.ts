import { afterEach, describe, it, expect, vi } from "vitest";
import { api, setApiAccount } from "../src/api";
afterEach(() => {
  setApiAccount();
  vi.unstubAllGlobals();
});

describe("Запросы привязаны к кабинету", () => {
  it("передаёт ожидаемый аккаунт и отменяет запросы при переключении", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    setApiAccount("owner");
    await api("/state");
    expect(fetch.mock.calls[0][1].headers["X-Opros-Account"]).toBe("owner");
    let pendingSignal: AbortSignal;
    fetch.mockImplementationOnce(async (_url, options) => {
      pendingSignal = options.signal;
      return new Promise((_resolve, reject) =>
        pendingSignal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      );
    });
    const pending = api("/state");
    setApiAccount("anna");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(pendingSignal!.aborted).toBe(true);
    await expect(
      api("/profile", "PUT", {}, undefined, "owner"),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("поддерживает отмену загрузки через сигнал React Query", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      api("/state", "GET", undefined, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
describe("Запросы клиента без тела", () => {
  it("передаёт код ошибки авторизации интерфейсу", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
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
