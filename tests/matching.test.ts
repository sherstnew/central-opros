import { describe, it, expect } from "vitest";
import {
  hardMismatch,
  ageAt,
  dedupCandidate,
  feedbackContext,
} from "../server/matching";
import {
  profileSchema,
  feedbackSchema,
  extractedSchema,
  type Offer,
  type Feedback,
} from "../shared/model";
const extracted = extractedSchema.parse({
  isSurvey: true,
  title: "Банковские приложения",
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
  ageMin: 20,
  ageMax: 40,
  gender: null,
  applyUrl: null,
  organizer: null,
  dedupKey: "banks-interview-2026",
});
describe("Подбор по подтверждённым фактам", () => {
  it("считает возраст до и после дня рождения", () => {
    expect(ageAt("2000-11-11", new Date("2026-11-10"))).toBe(25);
    expect(ageAt("2000-11-10", new Date("2026-11-10T12:00:00Z"))).toBe(26);
  });
  it("не считает отсутствие возраста несовпадением", () =>
    expect(hardMismatch(extracted, profileSchema.parse({}))).toBeNull());
  it("исключает подтверждённое несовпадение по возрасту", () =>
    expect(
      hardMismatch(extracted, profileSchema.parse({ birthDate: "1970-01-01" })),
    ).toBe("Не подходит возраст"));
  it("проверяет город только для очного участия", () => {
    const p = profileSchema.parse({ city: "Казань" });
    expect(hardMismatch({ ...extracted, city: "Москва" }, p)).toBeNull();
    expect(
      hardMismatch({ ...extracted, city: "Москва", format: "offline" }, p),
    ).toBe("Другой город");
  });
  it("исключает прошедшую дату", () =>
    expect(
      hardMismatch(
        { ...extracted, startsAt: "2026-01-01T12:00:00+03:00" },
        profileSchema.parse({}),
        new Date("2026-11-10"),
      ),
    ).toBe("Дата участия прошла"));
  it("пожелания по цене и формату не становятся жёсткими запретами", () =>
    expect(
      hardMismatch(
        extracted,
        profileSchema.parse({
          minReward: 10000,
          format: "offline",
          maxDuration: 20,
        }),
      ),
    ).toBeNull());
});
describe("Повторные публикации", () => {
  it("не передаёт разовую занятость в предпочтения ИИ", () => {
    expect(
      feedbackContext([
        {
          scope: "timing",
          reason: "Сегодня не успеваю",
          permanent: false,
        } as Feedback,
      ]),
    ).toEqual([]);
    expect(
      feedbackSchema.safeParse({
        offerId: "1",
        scope: "timing",
        permanent: true,
        rule: "Никогда",
      }).success,
    ).toBe(false);
  });
  it("объединяет одинаковые условия, а не просто одинаковую ссылку", () => {
    const previous = { ...extracted } as Offer;
    expect(dedupCandidate(extracted, previous)).toBe(true);
    expect(
      dedupCandidate({ ...extracted, title: "Другая тема" }, previous),
    ).toBe(false);
    expect(
      dedupCandidate(
        { ...extracted, startsAt: "2026-12-01T12:00:00Z" },
        previous,
      ),
    ).toBe(false);
  });
  it("не превращает мягкую причину в запрет", () => {
    const feedback = {
      id: "1",
      offerId: "1",
      title: "Опрос",
      category: "Банки",
      reason: "Не могу завтра",
      permanent: false,
      rule: "",
      createdAt: new Date().toISOString(),
    } satisfies Feedback;
    expect(feedbackContext([feedback])[0].permanent).toBe(false);
  });
});
