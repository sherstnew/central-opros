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
if (
  !config.demo &&
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
if (
  config.production &&
  (config.demo ||
    !config.passwordHash ||
    !/^([a-f0-9]{64})$/i.test(config.encryptionKey) ||
    !config.origin.startsWith("https://"))
)
  throw new Error(
    "Production requires MONGODB_URI, OWNER_PASSWORD_HASH, ENCRYPTION_KEY (64 hex), and HTTPS APP_ORIGIN",
  );
