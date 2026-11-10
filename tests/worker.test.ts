import { beforeEach, describe, it, expect, vi } from "vitest";
import { store } from "../server/store";
import { moscowDay, type Job } from "../shared/model";
import { tick } from "../server/worker";
vi.mock("../server/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/pipeline")>();
  return {
    ...actual,
    runCollection: async (job: Job) => {
      await store.put("job", job.id, { ...job, status: "done" });
      return { added: 0 };
    },
  };
});
vi.mock("../server/notifications", () => ({
  pushConfigured: () => false,
  notify: vi.fn(),
}));
beforeEach(async () => {
  for (const j of await store.list<Job>("job")) await store.remove("job", j.id);
});
describe("Ночное расписание", () => {
  it("использует московскую дату, включая границу UTC-суток", () =>
    expect(moscowDay(new Date("2026-11-10T22:00:00Z"))).toBe("2026-11-11"));
  it("запускает сбор после 03:00 МСК и не повторяет готовое задание", async () => {
    await tick(new Date("2026-11-10T23:59:00Z"));
    expect(await store.list("job")).toHaveLength(0);
    await tick(new Date("2026-11-11T00:00:00Z"));
    expect(await store.list("job")).toHaveLength(1);
    await tick(new Date("2026-11-11T01:00:00Z"));
    expect(await store.list("job")).toHaveLength(1);
    expect((await store.list<Job>("job"))[0].status).toBe("done");
  });
});
