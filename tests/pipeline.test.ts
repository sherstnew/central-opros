import { beforeEach, describe, it, expect, vi } from "vitest";
import { store } from "../server/store";
import {
  runCollection,
  collectionWindow,
  enqueueCollection,
  cancelCollection,
} from "../server/pipeline";
import { config } from "../server/config";
import {
  extractedSchema,
  profileSchema,
  moscowDay,
  type Job,
  type Offer,
  type RawMessage,
} from "../shared/model";
const mock = vi.hoisted(() => ({
  text: "Первое объявление",
  extract: vi.fn(),
  evaluate: vi.fn(),
  duplicates: vi.fn(),
  messages: [] as { id: number; date: number; message: string }[],
}));
vi.mock("../server/telegram", () => ({
  telegramClient: async () => ({
    getEntity: async () => ({}),
    iterMessages: async function* (
      _entity: unknown,
      options: { offsetId?: number; limit: number },
    ) {
      if (mock.messages.length) {
        for (const m of mock.messages
          .filter((m) => !options.offsetId || m.id < options.offsetId)
          .slice(0, options.limit))
          yield m;
        return;
      }
      yield {
        id: 10,
        date: Math.floor(Date.now() / 1000) - 5,
        message: mock.text,
      };
    },
    disconnect: async () => {},
  }),
}));
vi.mock("../server/ai", () => ({
  summarize: async () => ({
    summary: "Подходят интервью о банковских приложениях.",
  }),
  analyze: async (...args: any[]) => {
    const result = await mock.extract(...args);
    return {
      surveys: result.surveys.map((item: any) => ({
        match: "yes",
        reasons: ["Подходит"],
        questions: [],
        score: 80,
        duplicateId: null,
        ...item,
      })),
    };
  },
  findDuplicates: (...args: any[]) => mock.duplicates(...args),
  evaluate: (...args: any[]) => mock.evaluate(...args),
}));
const item = extractedSchema.parse({
  isSurvey: true,
  title: "Тест банковских приложений",
  summary: "Интервью",
  reward: 3000,
  currency: "RUB",
  format: "online",
  city: null,
  duration: 60,
  startsAt: null,
  dateLabel: null,
  deadline: null,
  requirements: [],
  category: "Финансы",
  ageMin: null,
  ageMax: null,
  gender: null,
  applyUrl: "https://example.com/application",
  organizer: "Организатор",
  dedupKey: "bank-study-2026-11-10",
});
const job = (): Job => ({
  id: `collect:${moscowDay()}`,
  kind: "collect",
  day: moscowDay(),
  status: "pending",
  attempts: 0,
  updatedAt: new Date().toISOString(),
});
beforeEach(async () => {
  for (const table of [
    "source",
    "message",
    "offer",
    "feedback",
    "digest",
    "job",
    "control",
    "profile",
  ] as const) {
    for (const record of await store.list<{ id: string }>(table))
      if (record.id) await store.remove(table, record.id);
  }
  await store.put("profile", "owner", profileSchema.parse({}));
  await store.put("source", "one", {
    id: "one",
    name: "Канал",
    handle: "test_channel",
    enabled: true,
    lastMessageId: 0,
  });
  mock.text = "Первое объявление";
  mock.duplicates.mockReset().mockResolvedValue({ groups: [] });
  mock.messages = [];
  await store.remove("profile", "revision");
  mock.extract.mockReset().mockResolvedValue({ surveys: [item] });
  mock.evaluate.mockReset().mockResolvedValue({
    match: "yes",
    reasons: ["Подходит"],
    questions: [],
    score: 80,
  });
});
describe("Восстановление сбора и пользовательские действия", () => {
  it("обрабатывает несколько опросов одним вызовом при лимите в один запрос", async () => {
    const previousLimit = config.maxCalls;
    config.maxCalls = 1;
    try {
      mock.extract.mockResolvedValue({ surveys: [item, { ...item, title: "Другое исследование", dedupKey: "another-study", applyUrl: null }] });
      await runCollection(job());
      expect(await store.list("offer")).toHaveLength(2);
      expect(mock.extract).toHaveBeenCalledTimes(1);
      expect(mock.evaluate).not.toHaveBeenCalled();
      expect(mock.duplicates).not.toHaveBeenCalled();
    } finally { config.maxCalls = previousLimit; }
  });
  it("не объединяет две отдельные истории участия", async () => {
    await runCollection(job());
    const original = (await store.list<Offer>("offer"))[0];
    await store.put("offer", original.id, { ...original, stage: "paid" });
    await store.put("offer", "second", { ...original, id: "second", stage: "booked" });
    mock.duplicates.mockResolvedValue({ groups: [[original.id, "second"]] });
    await runCollection(job());
    expect((await store.list<Offer>("offer")).filter((o) => !o.duplicateOf)).toHaveLength(2);
  });
  it("не скрывает карточки при некорректной группе повторов от ИИ", async () => {
    await runCollection(job());
    const original = (await store.list<Offer>("offer"))[0];
    await store.put("offer", "second", { ...original, id: "second" });
    mock.duplicates.mockResolvedValue({ groups: [[original.id, "second"], ["invented", original.id]] });
    await runCollection(job());
    expect((await store.list<Offer>("offer")).every((o) => !o.duplicateOf)).toBe(true);
  });
  it("передаёт полную анкету и отказы в общий запрос без отдельной оценки", async () => {
    const profile = profileSchema.parse({
      about: "Есть ребёнок",
      profession: "Дизайнер",
    });
    await store.put("profile", "owner", profile);
    await runCollection(job());
    expect(mock.extract.mock.calls[0][2]).toEqual(profile);
    expect(mock.evaluate).not.toHaveBeenCalled();
  });
  it("объединяет семантический повтор с другим названием, сохраняя скрытие", async () => {
    await runCollection(job());
    const previous = (await store.list<Offer>("offer"))[0];
    await store.put("offer", previous.id, {
      ...previous,
      stage: "hidden",
      note: "Не подходит",
    });
    mock.text = "Иначе сформулированное объявление";
    mock.extract.mockResolvedValue({
      surveys: [
        {
          ...item,
          title: "Новое название",
          dedupKey: "different",
          duplicateId: previous.id,
        },
      ],
    });
    await runCollection(job());
    expect(await store.list("offer")).toHaveLength(1);
    expect(await store.get("offer", previous.id)).toMatchObject({
      stage: "hidden",
      note: "Не подходит",
    });
  });
  it("не принимает выдуманный моделью id повтора", async () => {
    mock.extract.mockResolvedValue({
      surveys: [{ ...item, duplicateId: "invented" }],
    });
    await runCollection(job());
    expect((await store.list<Offer>("offer"))[0].id).not.toBe("invented");
  });
  it("очищает накопленные повторы, сохраняя статус и источники", async () => {
    await runCollection(job());
    const original = (await store.list<Offer>("offer"))[0];
    await store.put("offer", "old-copy", {
      ...original,
      id: "old-copy",
      title: "Другая формулировка",
      stage: "saved",
      note: "Моя заметка",
    });
    mock.duplicates.mockResolvedValue({ groups: [[original.id, "old-copy"]] });
    await runCollection(job());
    expect(await store.get("offer", original.id)).toMatchObject({
      duplicateOf: "old-copy",
    });
    expect(await store.get("offer", "old-copy")).toMatchObject({
      stage: "saved",
      note: "Моя заметка",
    });
  });
  it("отменяет сбор до запуска worker", async () => {
    const queued = await enqueueCollection(moscowDay(), { manual: true });
    await cancelCollection(queued.id);
    expect(await runCollection(queued)).toBe(false);
    expect(mock.extract).not.toHaveBeenCalled();
    expect((await store.get<Job>("job", queued.id))?.cancelledBy).toBe("user");
  });
  it("прерывает ожидающий запрос ИИ при отмене и сохраняет исходные сообщения", async () => {
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      mock.extract.mockImplementation(() => {
        started();
        return new Promise(() => {});
      });
      const queued = await enqueueCollection(moscowDay(), { manual: true });
      const running = runCollection(queued);
      await entered;
      await cancelCollection(queued.id);
      await vi.advanceTimersByTimeAsync(1000);
      await running;
      const saved = await store.get<Job>("job", queued.id);
      expect(saved?.cancelledBy).toBe("user");
      expect(saved?.status).toBe("failed");
      expect(
        (await store.list<RawMessage>("message"))[0].processedHash,
      ).toBeUndefined();
      expect(mock.evaluate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("не отправляет старые необработанные сообщения в ИИ при ночном сборе", async () => {
    await store.put<RawMessage>("message", "one:old", {
      id: "one:old",
      sourceId: "one",
      messageId: 1,
      text: "Старое необработанное объявление",
      date: new Date(Date.now() - 5 * 86400000).toISOString(),
      url: "https://t.me/test_channel/1",
      hash: "unprocessed",
    });
    await runCollection(job());
    expect(mock.extract).toHaveBeenCalledTimes(1);
    expect(mock.extract.mock.calls[0][0]).not.toBe(
      "Старое необработанное объявление",
    );
  });
  it("ночью проверяет только последние 24 часа, включая запуск после долгого простоя", async () => {
    const now = new Date(),
      window = collectionWindow(30, now, "scheduled");
    expect(Date.parse(window.until) - Date.parse(window.since)).toBe(86400000);
    mock.messages = [
      { id: 12, date: Math.floor(+now / 1000) - 3600, message: "Новое" },
      {
        id: 11,
        date: Math.floor(+now / 1000) - 2 * 86400,
        message: "Два дня назад",
      },
    ];
    await store.put("source", "one", {
      id: "one",
      name: "Канал",
      handle: "test_channel",
      enabled: true,
      lastMessageId: 0,
      lastSuccess: new Date(+now - 7 * 86400000).toISOString(),
      pendingSince: new Date(+now - 30 * 86400000).toISOString(),
      pendingOffset: 99,
    });
    await runCollection({ ...job(), window });
    expect(
      (await store.list<RawMessage>("message")).map((m) => m.messageId),
    ).toEqual([12]);
    expect(mock.extract).toHaveBeenCalledTimes(1);
  });
  it("ручной период включает старые сообщения, но не сообщения за его границами", async () => {
    const now = new Date();
    mock.messages = [
      { id: 13, date: Math.floor(+now / 1000) - 3600, message: "Сегодня" },
      {
        id: 12,
        date: Math.floor(+now / 1000) - 3 * 86400,
        message: "Три дня назад",
      },
      {
        id: 11,
        date: Math.floor(+now / 1000) - 10 * 86400,
        message: "Десять дней назад",
      },
    ];
    const queued = await enqueueCollection(moscowDay(), {
      manual: true,
      lookbackDays: 7,
      now,
    });
    await runCollection(queued);
    expect(
      (await store.list<RawMessage>("message")).map((m) => m.messageId),
    ).toEqual([13, 12]);
    expect(mock.extract).toHaveBeenCalledTimes(2);
    const scheduled = await enqueueCollection(moscowDay(), { now });
    expect(scheduled.id).toBe(`collect:${moscowDay()}`);
    expect(scheduled.window?.lookbackDays).toBe(1);
  });
  it("продолжает большой ручной сбор с сохранённой позиции в том же периоде", async () => {
    const before = config.maxMessages;
    config.maxMessages = 1;
    try {
      const now = new Date();
      mock.messages = [
        { id: 13, date: Math.floor(+now / 1000) - 3600, message: "Первое" },
        {
          id: 12,
          date: Math.floor(+now / 1000) - 2 * 86400,
          message: "Второе",
        },
      ];
      const queued = await enqueueCollection(moscowDay(), {
        manual: true,
        lookbackDays: 7,
        now,
      });
      await runCollection(queued);
      const partial = await store.get<Job>("job", queued.id);
      expect(partial?.incomplete).toBe(true);
      expect(partial?.sourceCursors?.one.offsetId).toBe(13);
      const resumed = await enqueueCollection(moscowDay(), {
        manual: true,
        resumeJobId: queued.id,
      });
      expect(resumed.window).toEqual(queued.window);
      await runCollection(resumed);
      expect(
        (await store.list<RawMessage>("message")).map((m) => m.messageId),
      ).toEqual([13, 12]);
    } finally {
      config.maxMessages = before;
    }
  });
  it("обновляет дату и оплату в том же объявлении, сохраняя пользовательский статус", async () => {
    await runCollection(job());
    const offer = (await store.list<Offer>("offer"))[0];
    await store.put("offer", offer.id, { ...offer, stage: "booked" });
    mock.text = "В объявлении исправлены дата и оплата";
    mock.extract.mockResolvedValue({
      surveys: [
        {
          ...item,
          dedupKey: "changed-date-and-price",
          reward: 4500,
          startsAt: "2027-01-10T15:00:00+03:00",
        },
      ],
    });
    await runCollection(job());
    const next = await store.list<Offer>("offer");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: offer.id,
      stage: "booked",
      reward: 4500,
      startsAt: "2027-01-10T15:00:00+03:00",
    });
  });
  it("повторный запуск не создаёт повторных предложений и не трогает этапы", async () => {
    await runCollection(job());
    const offers = await store.list<Offer>("offer");
    expect(offers).toHaveLength(1);
    await store.put("offer", offers[0].id, {
      ...offers[0],
      stage: "saved",
      note: "Не потерять заметку",
    });
    mock.text = "Исправленное объявление";
    await runCollection(job());
    const next = await store.list<Offer>("offer");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      stage: "saved",
      note: "Не потерять заметку",
    });
    expect(next[0].sources[0].text).toBe(mock.text);
  });
  it("сохраняет исходное сообщение при отказе ИИ и обрабатывает после повтора", async () => {
    mock.extract.mockRejectedValueOnce(new Error("429"));
    await runCollection(job());
    expect(await store.list("offer")).toHaveLength(0);
    expect(
      (await store.list<RawMessage>("message"))[0].processedHash,
    ).toBeUndefined();
    await runCollection(job());
    expect(await store.list("offer")).toHaveLength(1);
    const message = (await store.list<RawMessage>("message"))[0];
    expect(message.processedHash).toBe(message.hash);
  });
  it("объединяет источники и сохраняет скрытие при повторной публикации", async () => {
    await runCollection(job());
    const offer = (await store.list<Offer>("offer"))[0];
    await store.put("offer", offer.id, { ...offer, stage: "hidden" });
    await store.put("source", "two", {
      id: "two",
      name: "Другой канал",
      handle: "other_channel",
      enabled: true,
      lastMessageId: 0,
    });
    await runCollection(job());
    const next = await store.list<Offer>("offer");
    expect(next).toHaveLength(1);
    expect(next[0].stage).toBe("hidden");
    expect(next[0].sources).toHaveLength(2);
  });
  it("переоценивает старые новые карточки после изменения профиля", async () => {
    await runCollection(job());
    await store.put("profile", "revision", { value: "changed" });
    mock.evaluate.mockResolvedValue({
      match: "maybe",
      reasons: [],
      questions: ["Уточнить профессию"],
      score: 40,
    });
    await runCollection(job());
    const offer = (await store.list<Offer>("offer"))[0];
    expect(offer.match).toBe("maybe");
    expect(offer.matchVersion).toBe("changed");
  });
  it("не запускает две обработки одновременно", async () => {
    const release = await store.lock("collection");
    expect(await runCollection(job())).toBe(false);
    await release!();
  });
});
