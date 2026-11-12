import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer } from "../server/index";
let app: Awaited<ReturnType<typeof createServer>>;
const headers = { origin: "http://localhost:5173", "x-opros-client": "web" };
beforeAll(async () => {
  app = await createServer();
});
afterAll(async () => {
  await app.close();
});
describe("Личный сценарий", () => {
  it("добавляет объявление вручную без ИИ и проверяет ввод", async () => {
    const payload = { title: "Вода со вкусом", summary: "800 ₽ сертификатом Ozon, метро Марксистская", reward: 800, duration: 40, format: "offline", city: "Москва", dateLabel: "12 ноября, 13:00 или 15:20" };
    const r = await app.inject({ method: "POST", url: "/api/offers", headers, payload });
    expect(r.statusCode).toBe(200);
    const state = (await app.inject({ url: "/api/state" })).json();
    expect(state.offers.find((o: any) => o.id === r.json().id)).toMatchObject({ ...payload, manuallyAdded: true, match: "maybe", stage: "new" });
    for (const bad of [{ ...payload, title: " " }, { ...payload, reward: -1 }, { ...payload, applyUrl: "javascript:alert(1)" }])
      expect((await app.inject({ method: "POST", url: "/api/offers", headers, payload: bad })).statusCode).toBe(400);
  });
  it("проверяет период ручного сбора до запуска", async () => {
    for (const lookbackDays of [0, 31, 1.5])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/collect",
            headers,
            payload: { lookbackDays },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/collect",
          headers,
          payload: { lookbackDays: 7 },
        })
      ).json().demo,
    ).toBe(true);
  });
  it("явно сообщает деморежим", async () => {
    const r = await app.inject({ url: "/api/state" });
    expect(r.statusCode).toBe(200);
    expect(r.json().demo).toBe(true);
    expect(r.json().offers.length).toBeGreaterThan(0);
  });
  it("сохраняет предложение в работу и не меняет его при повторном чтении", async () => {
    const result = await app.inject({
      method: "PATCH",
      url: "/api/offers/demo-0",
      headers,
      payload: { stage: "saved", note: "Связаться вечером" },
    });
    expect(result.statusCode).toBe(200);
    const state = (await app.inject({ url: "/api/state" })).json();
    expect(state.offers.find((o: any) => o.id === "demo-0")).toMatchObject({
      stage: "saved",
      note: "Связаться вечером",
    });
  });
  it("сохраняет причину отказа и позволяет её удалить", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/feedback",
      headers,
      payload: {
        offerId: "demo-1",
        reason: "Не могу в этот день",
        permanent: false,
        rule: "",
      },
    });
    expect(r.statusCode).toBe(200);
    const s = (await app.inject({ url: "/api/state" })).json();
    expect(s.offers.find((o: any) => o.id === "demo-1").stage).toBe("hidden");
    expect(s.feedback.find((f: any) => f.id === r.json().id).permanent).toBe(
      false,
    );
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/feedback/${r.json().id}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("не принимает запрет без явного условия", async () =>
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/feedback",
          headers,
          payload: { offerId: "demo-2", permanent: true, rule: "" },
        })
      ).statusCode,
    ).toBe(400));
  it("отвергает запросы изменения с другого сайта", async () =>
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/profile",
          headers: { ...headers, origin: "https://evil.example" },
          payload: { name: "Changed" },
        })
      ).statusCode,
    ).toBe(403));
  it("проверяет формат источника и дубликаты", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources",
          headers,
          payload: { handle: "https://evil.example/test" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources",
          headers,
          payload: { handle: "https://t.me/example_channel" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources",
          headers,
          payload: { handle: "example_channel" },
        })
      ).statusCode,
    ).toBe(400);
  });
});
