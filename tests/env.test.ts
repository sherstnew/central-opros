import { describe, it, expect } from "vitest";
import { parse } from "dotenv";
import { prepareSecrets } from "../scripts/env";
import { verifyPassword } from "../server/password";
describe("Понятная настройка окружения", () => {
  it("генерирует пароль, ключ шифрования и пару push без ключей внешних сервисов", () => {
    const result = parse(prepareSecrets("", "long-site-password"));
    expect(
      verifyPassword("long-site-password", result.OWNER_PASSWORD_HASH),
    ).toBe(true);
    expect(result.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/);
    expect(result.VAPID_PUBLIC_KEY).toBeTruthy();
    expect(result.VAPID_PRIVATE_KEY).toBeTruthy();
    expect(result).not.toHaveProperty("MONGODB_URI");
  });
  it("при повторном запуске сохраняет прежние секреты", () => {
    const initial = prepareSecrets("", "long-site-password");
    expect(parse(prepareSecrets(initial))).toEqual(parse(initial));
  });
  it("не создаёт технические ключи с коротким паролем", () =>
    expect(() => prepareSecrets("", "short")).toThrow("минимум 12"));
});
