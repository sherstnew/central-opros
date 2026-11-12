import webpush from "web-push";
import { config } from "./config";
import { store } from "./store";
import { type Digest, type PushSubscriptionRecord } from "../shared/model";
export const pushConfigured = () =>
  !!(config.vapidPublic && config.vapidPrivate && config.vapidSubject);
export async function notify(day: string) {
  if (!pushConfigured()) throw new Error("На сервере не настроены ключи push");
  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublic,
    config.vapidPrivate,
  );
  const digest = (await store.list<Digest>("digest"))
    .filter((d) => d.day === day)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const body =
    !digest || digest.status === "running"
      ? "Подборка пока не готова. Проверь состояние сбора."
      : digest.status === "failed"
        ? "Ночной сбор не завершён. Открой приложение для проверки."
        : digest.status === "partial"
          ? `Подборка готова частично. Предложений: ${digest.newCount}.`
          : digest.newCount
            ? `Новых предложений: ${digest.newCount}. Посмотри, что подходит тебе.`
            : "Новых подходящих опросов нет.";
  for (const record of await store.list<PushSubscriptionRecord>(
    "subscription",
  )) {
    if (record.lastDay === day) continue;
    // Claim before delivery: no duplicate daily push after a worker restart.
    await store.put("subscription", record.id, { ...record, lastDay: day });
    try {
      await webpush.sendNotification(
        record.subscription,
        JSON.stringify({
          title: `Отклик · ${(await store.get<{ name: string }>("user", store.userId))?.name || "Подборка"}`,
          body,
          url: `/?day=${day}&account=${store.userId}`,
          tag: `digest-${store.userId}-${day}`,
        }),
        { TTL: 86400 },
      );
    } catch (error) {
      if ([404, 410].includes((error as any).statusCode))
        await store.remove("subscription", record.id);
      else
        throw new Error(
          "Push-сервис недоступен; проверь настройки уведомлений",
        );
    }
  }
}
