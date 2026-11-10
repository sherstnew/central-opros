import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { telegramProxy } from "./telegram-proxy";
import { store } from "./store";
import { encrypt, decrypt } from "./security";
interface Flow {
  id: string;
  status: "connecting" | "code" | "password" | "connected" | "error";
  error?: string;
  resolve?: (value: string) => void;
  client: TelegramClient;
  timer: NodeJS.Timeout;
}
let flow: Flow | undefined;
function newClient(session = "") {
  return new TelegramClient(
    new StringSession(session),
    config.telegramId,
    config.telegramHash,
    {
      connectionRetries: 2,
      requestRetries: 2,
      floodSleepThreshold: 0,
      transport: telegramProxy(config.telegramProxyUrl),
    },
  );
}
export async function telegramConnected() {
  const session = await store.get<{ value: string; invalid?: boolean }>(
    "secret",
    "telegram",
  );
  return !!session && !session.invalid;
}
export async function telegramClient() {
  const secret = await store.get<{ value: string }>("secret", "telegram");
  if (!secret) throw new Error("Подключи Telegram в настройках");
  const client = newClient(decrypt(secret.value));
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      await store.put("secret", "telegram", { ...secret, invalid: true });
      throw new Error("Сессия Telegram истекла. Подключи аккаунт заново");
    }
    return client;
  } catch (error) {
    await client.disconnect();
    if (
      /SESSION_REVOKED|AUTH_KEY_UNREGISTERED|SESSION_EXPIRED/.test(
        String(error),
      )
    )
      await store.put("secret", "telegram", { ...secret, invalid: true });
    throw error;
  }
}
export async function startTelegram(phone: string) {
  if (!config.telegramId || !config.telegramHash)
    throw new Error("На сервере не заданы TELEGRAM_API_ID и TELEGRAM_API_HASH");
  if (flow && ["connecting", "code", "password"].includes(flow.status))
    throw new Error(
      "Подключение уже запущено. Заверши его или подожди 5 минут",
    );
  const client = newClient();
  const current: Flow = {
    id: randomUUID(),
    status: "connecting",
    client,
    timer: setTimeout(() => {}, 1),
  };
  flow = current;
  const ask = (status: "code" | "password") =>
    new Promise<string>((resolve) => {
      if (current.status === "error" || flow !== current)
        throw new Error("Подключение отменено");
      current.status = status;
      current.resolve = resolve;
    });
  current.timer = setTimeout(() => {
    current.status = "error";
    current.error = "Время подключения истекло. Начни заново";
    current.resolve?.("");
    void client.disconnect();
  }, 300000);
  current.timer.unref();
  void client
    .start({
      phoneNumber: phone,
      phoneCode: () => ask("code"),
      password: () => ask("password"),
      onError: async () => {
        if (current.status === "error" || flow !== current) return true;
        current.error = "Проверь код или пароль и попробуй снова";
        return false;
      },
    })
    .then(async () => {
      if (flow !== current || current.status === "error") return;
      await store.put("secret", "telegram", {
        value: encrypt(String(client.session.save())),
      });
      current.status = "connected";
      current.error = undefined;
    })
    .catch(() => {
      current.status = "error";
      current.error =
        "Не удалось подключить Telegram. Проверь номер, код и настройки API.";
    })
    .finally(() => {
      clearTimeout(current.timer);
      void client.disconnect();
    });
  return { id: current.id, status: current.status };
}
export function telegramFlow(id: string) {
  if (flow?.id !== id)
    return { status: "error", error: "Подключение не найдено. Начни заново" };
  return { id: flow.id, status: flow.status, error: flow.error };
}
export function submitTelegram(id: string, value: string) {
  if (
    flow?.id !== id ||
    !flow.resolve ||
    !["code", "password"].includes(flow.status)
  )
    throw new Error("Сначала запроси код");
  const resolve = flow.resolve;
  flow.resolve = undefined;
  flow.status = "connecting";
  flow.error = undefined;
  resolve(value);
}
export async function disconnectTelegram() {
  if (flow) {
    clearTimeout(flow.timer);
    flow.status = "error";
    flow.resolve?.("");
    await flow.client.disconnect();
    flow = undefined;
  }
  await store.remove("secret", "telegram");
}
