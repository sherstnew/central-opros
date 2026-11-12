import { migrateAccounts } from "./accounts";
import type { User } from "../shared/model";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { store } from "./store";
import { enqueueCollection, runCollection } from "./pipeline";
import { notify, pushConfigured } from "./notifications";
import {
  moscowDay,
  settingsSchema,
  type Settings,
  type Job,
} from "../shared/model";
export async function tick(now = new Date()) {
  await migrateAccounts();
  const day = moscowDay(now),
    time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  const settings = settingsSchema.parse(
    (await store.get<Settings>("profile", "settings")) || {},
  );
  if (
    time >= settings.collectionTime &&
    !(await store.get("job", `collect:${day}`))
  )
    await enqueueCollection(day, { now });
  if (
    time >= settings.eveningCollectionTime &&
    !(await store.get("job", `collect:${day}:evening`))
  )
    await enqueueCollection(day, { now, scheduledSlot: "evening" });
  for (const job of await store.list<Job>("job")) {
    if (job.kind !== "collect" || !["pending", "running"].includes(job.status))
      continue;
    if (job.attempts >= 3) {
      await store.put("job", job.id, {
        ...job,
        status: "failed",
        error: "Превышено число восстановлений. Запусти сбор вручную.",
      });
      continue;
    }
    await runCollection(job);
  }
  if (pushConfigured())
    for (const user of await store.list<User>("user"))
      await store.as(user.id, async () => {
        const personal = await store.get<{ notificationTime: string }>(
          "profile",
          "notification",
        );
        if (time < (personal?.notificationTime || settings.notificationTime))
          return;
        const id = `notify:${user.id}:${day}`;
        const release = await store.lock(id);
        if (!release) return;
        try {
          const existing = await store.get<Job>("job", id);
          if (existing?.status === "done") return;
          if ((existing?.attempts || 0) >= 3) return;
          const job: Job = {
            id,
            kind: "notify",
            day,
            status: "running",
            attempts: (existing?.attempts || 0) + 1,
            updatedAt: new Date().toISOString(),
          };
          await store.put("job", id, job);
          try {
            await notify(day);
            await store.put("job", id, { ...job, status: "done" });
          } catch {
            await store.put("job", id, {
              ...job,
              status: "failed",
              error: "Не удалось отправить уведомления",
            });
          }
        } finally {
          await release();
        }
      });
}
async function main() {
  if (config.demo)
    throw new Error(
      "Worker требует MONGODB_URI. Деморежим запускается командой npm run dev",
    );
  console.log("Worker started; timezone Europe/Moscow");
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      await tick();
    } catch {
      console.error("Worker tick failed; will retry");
    }
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  await store.close();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  void main();
