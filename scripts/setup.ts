import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { createInterface } from "node:readline/promises";
import { prepareSecrets } from "./env";

async function password(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return await readline.question(prompt);
    } finally {
      readline.close();
    }
  }
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let input = "";
    const finish = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (data: string) => {
      for (const c of data) {
        if (c === "\u0003") {
          finish();
          reject(new Error("Настройка отменена"));
          return;
        }
        if (c === "\r" || c === "\n") {
          finish();
          resolve(input);
          return;
        }
        if (c === "\u007f" || c === "\b") {
          input = Array.from(input).slice(0, -1).join("");
          continue;
        }
        if (c >= " ") input += c;
      }
    };
    process.stdin.on("data", onData);
  });
}
async function main() {
  if (!existsSync(".env")) copyFileSync(".env.example", ".env");
  const existing = existsSync(".env.secrets")
    ? readFileSync(".env.secrets", "utf8")
    : "";
  let chosen: string | undefined;
  if (!parse(existing).OWNER_PASSWORD_HASH) {
    chosen = await password(
      "Придумай пароль для входа на сайт (минимум 12 символов; ввод скрыт): ",
    );
    if (chosen.length < 12)
      throw new Error("Пароль слишком короткий. Запусти npm run setup заново.");
    const repeated = await password("Повтори пароль: ");
    if (chosen !== repeated)
      throw new Error("Пароли не совпали. Ничего не изменено.");
  }
  writeFileSync(".env.secrets", prepareSecrets(existing, chosen), {
    mode: 0o600,
  });
  const env = parse(readFileSync(".env", "utf8"));
  console.log(
    "Готово. Технические ключи сохранены в .env.secrets. Их не нужно заполнять вручную.",
  );
  const missing = [
    "MONGODB_URI",
    "PROXYAPI_KEY",
    "AI_MODEL",
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
  ].filter((k) => !env[k]);
  if (missing.length)
    console.log(`В .env осталось заполнить: ${missing.join(", ")}.`);
  console.log(
    "На компьютере: npm run dev. На VPS: docker compose up -d --build.",
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  void main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Не удалось выполнить настройку",
    );
    process.exitCode = 1;
  });
