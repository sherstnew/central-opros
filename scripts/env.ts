import { parse } from "dotenv";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { hashPassword } from "../server/password";

/** Create only missing credentials; never rotate an existing encryption key or password. */
export function prepareSecrets(existing: string, password?: string) {
  const values = parse(existing);
  if (!values.OWNER_PASSWORD_HASH) {
    if (!password || password.length < 12)
      throw new Error("Пароль должен содержать минимум 12 символов");
    values.OWNER_PASSWORD_HASH = hashPassword(password);
  }
  if (!values.ENCRYPTION_KEY)
    values.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/i.test(values.ENCRYPTION_KEY))
    throw new Error(
      "Повреждён ENCRYPTION_KEY в .env.secrets. Восстанови исходный ключ из резервной копии.",
    );
  if (!values.VAPID_PUBLIC_KEY && !values.VAPID_PRIVATE_KEY) {
    const keys = webpush.generateVAPIDKeys();
    values.VAPID_PUBLIC_KEY = keys.publicKey;
    values.VAPID_PRIVATE_KEY = keys.privateKey;
  }
  if (!values.VAPID_PUBLIC_KEY || !values.VAPID_PRIVATE_KEY)
    throw new Error(
      "В .env.secrets неполная пара ключей уведомлений. Восстанови файл из резервной копии.",
    );
  return (
    "# Создано командой npm run setup. Не редактируй и никому не отправляй.\n# Сохрани этот файл в резервной копии: без него не расшифровать Telegram-сессию.\n" +
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") +
    "\n"
  );
}
