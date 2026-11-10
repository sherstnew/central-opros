import { store } from "./store";
import {
  profileSchema,
  settingsSchema,
  moscowDay,
  type Offer,
  type Source,
} from "../shared/model";
export async function seedDemo() {
  if (await store.get("profile", "owner")) return;
  await store.put(
    "profile",
    "owner",
    profileSchema.parse({
      name: "Александр",
      city: "Москва",
      birthDate: "1999-04-12",
      employment: "Работаю",
      profession: "Разработчик",
      about: "Пользуюсь банковскими приложениями и заказываю продукты онлайн.",
    }),
  );
  await store.put("profile", "settings", settingsSchema.parse({}));
  const sources: Source[] = [
    {
      id: "demo1",
      name: "Опросы за вознаграждение",
      handle: "opros_demo",
      enabled: true,
      lastMessageId: 0,
      lastSuccess: new Date().toISOString(),
    },
    {
      id: "demo2",
      name: "Исследования и люди",
      handle: "research_demo",
      enabled: true,
      lastMessageId: 0,
      lastSuccess: new Date().toISOString(),
    },
    {
      id: "demo3",
      name: "Мнение имеет цену",
      handle: "opinion_demo",
      enabled: true,
      lastMessageId: 0,
      lastSuccess: new Date().toISOString(),
    },
  ];
  for (const s of sources) await store.put("source", s.id, s);
  const items = [
    {
      title: "Как ты пользуешься банковскими приложениями",
      summary:
        "Поговорить с исследователем о привычных переводах, платежах и о том, чего не хватает в приложении банка.",
      reward: 3500,
      duration: 90,
      category: "Финансы",
      requirements: [
        "Мужчины и женщины 23–40 лет",
        "Пользуетесь мобильным банком",
        "Не участвовали в похожих исследованиях 6 месяцев",
      ],
      reasons: [
        "Твой возраст подходит",
        "Пользуешься банковскими приложениями",
      ],
      questions: [],
      match: "yes",
      format: "online",
      dateLabel: "Завтра, 19:00",
      source: 0,
    },
    {
      title: "Продукты с доставкой: что можно сделать лучше",
      summary:
        "Небольшое онлайн-интервью про выбор продуктов, любимые сервисы и неожиданные замены в заказе.",
      reward: 2500,
      duration: 60,
      category: "Покупки",
      requirements: [
        "Заказываете продукты не реже раза в месяц",
        "Возраст 20–45 лет",
      ],
      reasons: ["Заказываешь продукты онлайн", "Подходит возраст"],
      questions: [],
      match: "yes",
      format: "online",
      dateLabel: "На этой неделе, время на выбор",
      source: 1,
    },
    {
      title: "Выбираем следующий отпуск",
      summary:
        "Обсуждение того, как мы ищем билеты и жильё. Исследователю интересен опыт самостоятельного планирования поездок.",
      reward: 4000,
      duration: 120,
      category: "Путешествия",
      requirements: [
        "Была поездка за последние 12 месяцев",
        "Самостоятельно бронировали жильё",
      ],
      reasons: ["Онлайн, можно из дома"],
      questions: ["Была ли у тебя поездка за последний год?"],
      match: "maybe",
      format: "online",
      dateLabel: "Пятница, 18:30",
      source: 2,
    },
    {
      title: "Тестирование нового приложения для города",
      summary:
        "Попробовать прототип приложения и рассказать, насколько легко разобраться с его возможностями.",
      reward: 3000,
      duration: 60,
      category: "Технологии",
      requirements: ["Живёте в Москве", "Пользуетесь смартфоном каждый день"],
      reasons: ["Твой город — Москва", "Не нужны специальные знания"],
      questions: [],
      match: "yes",
      format: "offline",
      dateLabel: "Время согласуют с тобой",
      source: 0,
    },
    {
      title: "Интервью о подписках на музыку",
      summary: "Расскажи, как выбираешь музыку и находишь новых исполнителей.",
      reward: 2000,
      duration: 45,
      category: "Досуг",
      requirements: ["Есть платная музыкальная подписка"],
      reasons: [],
      questions: ["Есть ли платная подписка?"],
      match: "maybe",
      format: "online",
      dateLabel: "Дата согласуется",
      source: 1,
    },
  ];
  for (const [i, item] of items.entries()) {
    const { source, ...fields } = item;
    const now = new Date().toISOString();
    const offer: Offer = {
      isSurvey: true,
      currency: "RUB",
      city: item.format === "offline" ? "Москва" : null,
      startsAt: null,
      deadline: null,
      ageMin: null,
      ageMax: null,
      gender: null,
      applyUrl: null,
      organizer: null,
      dedupKey: `demo-${i}`,
      id: `demo-${i}`,
      createdAt: now,
      updatedAt: now,
      day: moscowDay(),
      stage: i === 4 ? "saved" : "new",
      score: 90 - i * 4,
      note: "",
      participationDate: null,
      actualReward: null,
      sources: [
        {
          messageId: `demo-${i}`,
          name: sources[source].name,
          url: "https://t.me",
          text: `Демонстрационное объявление.\n${item.title}\nВознаграждение: ${item.reward} ₽\n${item.requirements.join("\n")}`,
        },
      ],
      ...fields,
      format: item.format as Offer["format"],
      match: item.match as Offer["match"],
    };
    await store.put("offer", offer.id, offer);
  }
  await store.put("digest", moscowDay(), {
    id: moscowDay(),
    day: moscowDay(),
    status: "complete",
    summary:
      "Сегодня есть интервью о банковских приложениях, доставке продуктов и городских сервисах. В исследовании путешествий нужно уточнить опыт поездок.",
    newCount: 4,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
}
