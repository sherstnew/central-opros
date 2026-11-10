import dotenv from "dotenv";
dotenv.config({ path: [".env", ".env.secrets"], quiet: true });
export const config = {
  production: process.env.NODE_ENV === "production",
  demo: !process.env.MONGODB_URI,
  mongoUri: process.env.MONGODB_URI || "",
  mongoDatabase: process.env.MONGODB_DB_NAME || "",
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || "http://localhost:5173",
  passwordHash: process.env.OWNER_PASSWORD_HASH || "",
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  aiKey: process.env.PROXYAPI_KEY || "",
  aiModel: process.env.AI_MODEL || "",
  aiBase: process.env.PROXYAPI_BASE_URL || "https://api.proxyapi.ru/v1",
  maxCalls: Number(process.env.MAX_AI_CALLS_PER_RUN || 100),
  maxMessages: Number(process.env.MAX_MESSAGES_PER_SOURCE || 500),
  telegramId: Number(process.env.TELEGRAM_API_ID || 0),
  telegramHash: process.env.TELEGRAM_API_HASH || "",
  vapidPublic: process.env.VAPID_PUBLIC_KEY || "",
  vapidPrivate: process.env.VAPID_PRIVATE_KEY || "",
  vapidSubject: process.env.VAPID_SUBJECT || process.env.APP_ORIGIN || "",
};
if (config.production) {
  const problems: string[] = [];
  if (config.demo) problems.push("MONGODB_URI: не задан");
  if (!config.passwordHash) problems.push("OWNER_PASSWORD_HASH: не задан");
  if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey))
    problems.push("ENCRYPTION_KEY: нужны ровно 64 шестнадцатеричных символа");
  if (!config.origin.startsWith("https://"))
    problems.push("APP_ORIGIN: укажи https://твой-домен без / в конце");
  if (problems.length)
    throw new Error(`Ошибка окружения production: ${problems.join("; ")}`);
}
if (
  !config.production && !config.demo &&
  (!config.passwordHash || !/^([a-f0-9]{64})$/i.test(config.encryptionKey))
)
  throw new Error(
    "Сначала выполни npm run setup: нужны пароль владельца и ключ шифрования в .env.secrets",
  );
if (
  !Number.isInteger(config.maxCalls) ||
  config.maxCalls < 1 ||
  config.maxCalls > 1000 ||
  !Number.isInteger(config.maxMessages) ||
  config.maxMessages < 1 ||
  config.maxMessages > 10000
)
  throw new Error("Invalid MAX_AI_CALLS_PER_RUN or MAX_MESSAGES_PER_SOURCE");
