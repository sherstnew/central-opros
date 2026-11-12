import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { store } from "../server/store";
import { personalize, personalDigests } from "../server/personalization";
import { mergeDuplicates } from "../server/dedup";
import { CollectionControl } from "../server/collection-control";
import { config } from "../server/config";
import {
  extractedSchema,
  profileSchema,
  moscowDay,
  type User,
  type Offer,
  type Feedback,
  type Job,
  type Digest,
} from "../shared/model";

const mock = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("../server/ai", () => ({
  evaluate: (...args: unknown[]) => mock.evaluate(...args),
}));
const now = new Date().toISOString();
const facts = (id: string, createdAt = now): Offer => ({
  ...extractedSchema.parse({
    isSurvey: true,
    title: id,
    summary: "Исследование",
    reward: 1000,
    currency: "RUB",
    format: "online",
    city: null,
    duration: 30,
    startsAt: null,
    dateLabel: null,
    deadline: null,
    requirements: [],
    category: "Другое",
    ageMin: null,
    ageMax: null,
    gender: null,
    applyUrl: null,
    organizer: null,
    dedupKey: id,
  }),
  sources: [],
  id,
  createdAt,
  updatedAt: now,
  day: moscowDay(),
  stage: "new",
  note: "",
  participationDate: null,
  actualReward: null,
  match: "maybe",
  reasons: [],
  questions: [],
  score: 50,
});
const makeJob = (): Job => ({
  id: "test-job",
  day: moscowDay(),
  kind: "collect",
  status: "running",
  attempts: 0,
  updatedAt: now,
  progress: {
    phase: "evaluate",
    startedAt: now,
    deadlineAt: now,
    sourcesDone: 0,
    sourcesTotal: 0,
    messagesRead: 0,
    messagesDone: 0,
    messagesTotal: 0,
    aiCalls: 0,
    offersAdded: 0,
    rechecked: 0,
    recheckTotal: 0,
  },
});
let control: CollectionControl;
const previousLimit = config.maxCalls;
beforeEach(async () => {
  const previousUsers = await store.list<User>("user");
  for (const user of [...previousUsers, { id: "owner" }])
    await store.as(user.id, async () => {
      for (const table of ["offer", "feedback", "digest"] as const)
        for (const row of await store.list<{ id: string }>(table))
          await store.remove(table, row.id);
      await store.remove("profile", "revision");
      await store.remove("profile", "owner");
    });
  for (const table of ["user", "catalog"] as const)
    for (const row of await store.list<{ id: string }>(table))
      await store.remove(table, row.id);
  await store.remove("control", "matching:cursor");
  for (const id of ["owner", "anna"]) {
    await store.put<User>("user", id, {
      id,
      name: id,
      normalizedName: id,
      passwordHash: "unused",
      createdAt: "2026-01-01T00:00:00.000Z",
      role: id === "owner" ? "owner" : "member",
    });
    await store.as(id, () =>
      store.put(
        "profile",
        "owner",
        profileSchema.parse({ name: id, about: `Только ${id}` }),
      ),
    );
  }
  config.maxCalls = 100;
  control = new CollectionControl();
  mock.evaluate.mockReset().mockImplementation(async (_offer, profile) => ({
    match: "yes",
    reasons: [profile.about],
    questions: [],
    score: 80,
  }));
});
afterEach(() => {
  control.close();
  config.maxCalls = previousLimit;
});
async function run(job = makeJob()) {
  const errors: string[] = [];
  const calls = await personalize({
    job,
    control,
    calls: 0,
    report: async () => {},
    errors,
  });
  return { job, calls, errors };
}
describe("Личный подбор общего каталога", () => {
  it("обновляет общие факты даже после более свежего изменения личной заметки", async () => {
    const initial = facts("shared");
    await store.put("catalog", initial.id, initial);
    await run();
    const personal = (await store.get<Offer>("offer", initial.id))!;
    await store.put("catalog", initial.id, {
      ...initial,
      reward: 5000,
      updatedAt: "2098-01-01T00:00:00.000Z",
    });
    await store.put("offer", personal.id, {
      ...personal,
      stage: "paid",
      note: "Личная заметка",
      actualReward: 3000,
      updatedAt: "2099-01-01T00:00:00.000Z",
    });
    await run();
    expect(await store.get("offer", personal.id)).toMatchObject({
      reward: 5000,
      stage: "paid",
      note: "Личная заметка",
      actualReward: 3000,
    });
  });
  it("создаёт независимые карточки, передаёт только свои предпочтения и делает личные сводки", async () => {
    await store.put("catalog", "shared", facts("shared"));
    const rejection = {
      id: "reason",
      offerId: "old",
      title: "old",
      category: "Другое",
      reason: "Не люблю банки",
      permanent: true,
      rule: "Без банков",
      createdAt: now,
    } satisfies Feedback;
    await store.as("anna", () =>
      store.put("feedback", rejection.id, rejection),
    );
    const { job } = await run();
    expect(mock.evaluate).toHaveBeenCalledTimes(2);
    expect(
      mock.evaluate.mock.calls.find((c) => c[1].name === "owner")![2],
    ).toEqual([]);
    expect(
      mock.evaluate.mock.calls.find((c) => c[1].name === "anna")![2],
    ).toEqual([rejection]);
    const anna = await store.as("anna", () =>
      store.get<Offer>("offer", "shared"),
    );
    expect(anna!.reasons).toEqual(["Только anna"]);
    await store.as("anna", () =>
      store.put("offer", "shared", {
        ...anna!,
        stage: "hidden",
        note: "Личная заметка",
      }),
    );
    await run();
    expect(await store.get("offer", "shared")).toMatchObject({
      stage: "new",
      note: "",
      reasons: ["Только owner"],
    });
    expect(
      await store.as("anna", () => store.get("offer", "shared")),
    ).toMatchObject({ stage: "hidden", note: "Личная заметка" });
    await personalDigests(
      job,
      {
        id: "digest",
        day: job.day,
        status: "running",
        summary: "",
        newCount: 0,
        errors: [],
        startedAt: now,
      } as Digest,
      [],
    );
    expect(await store.get("digest", "digest")).toMatchObject({ newCount: 1 });
    expect(
      await store.as("anna", () => store.get("digest", "digest")),
    ).toMatchObject({ newCount: 0 });
  });
  it("сохраняет личный отказ ИИ, а изменение анкеты переоценивает только этот кабинет", async () => {
    mock.evaluate.mockImplementation(async (_offer, p) => ({
      match: p.name === "anna" ? "no" : "yes",
      reasons: [],
      questions: [],
      score: 50,
    }));
    await store.put("catalog", "shared", facts("shared"));
    await run();
    expect(
      await store.as("anna", () => store.get("offer", "shared")),
    ).toMatchObject({ match: "no" });
    mock.evaluate.mockClear();
    await store.as("anna", () =>
      store.put("profile", "revision", { value: "changed" }),
    );
    await run();
    expect(mock.evaluate).toHaveBeenCalledTimes(1);
    expect(mock.evaluate.mock.calls[0][1].name).toBe("anna");
  });
  it("не переносит старый каталог и его повтор после регистрации", async () => {
    const old = facts("old", "2025-01-01T00:00:00.000Z");
    await store.put("catalog", old.id, old);
    const duplicate = facts("repeat");
    await store.put("catalog", duplicate.id, duplicate);
    await mergeDuplicates([old.id, duplicate.id], "catalog");
    await run();
    expect(await store.list("offer")).toEqual([]);
    expect(await store.as("anna", () => store.list("offer"))).toEqual([]);
    await store.put("catalog", "new", facts("new"));
    await run();
    expect(await store.as("anna", () => store.list("offer"))).toHaveLength(1);
  });
  it("продолжает оценки по очереди между кабинетами после лимита и сбоя", async () => {
    await store.put("catalog", "one", facts("one"));
    await store.put("catalog", "two", facts("two"));
    config.maxCalls = 1;
    await run();
    expect(await store.list("offer")).toHaveLength(1);
    expect(await store.as("anna", () => store.list("offer"))).toHaveLength(0);
    await run();
    expect(await store.as("anna", () => store.list("offer"))).toHaveLength(1);
    mock.evaluate.mockRejectedValueOnce(new Error("API unavailable"));
    await run();
    await run();
    await run();
    expect(await store.list("offer")).toHaveLength(2);
    expect(await store.as("anna", () => store.list("offer"))).toHaveLength(2);
  });
  it("сохраняет этап и заметку при пользовательском изменении во время оценки", async () => {
    await store.put("catalog", "shared", facts("shared"));
    await run();
    await store.put("profile", "revision", { value: "changed" });
    mock.evaluate.mockImplementationOnce(async () => {
      const offer = (await store.get<Offer>("offer", "shared"))!;
      await store.put("offer", offer.id, {
        ...offer,
        stage: "booked",
        note: "Записался",
      });
      return { match: "no", reasons: [], questions: [], score: 0 };
    });
    await run();
    expect(await store.get("offer", "shared")).toMatchObject({
      stage: "booked",
      note: "Записался",
      match: "yes",
    });
  });
});
