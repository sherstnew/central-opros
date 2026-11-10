import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
} from "../server/security";
describe("Хранение секретов", () => {
  it("шифрует с уникальным IV и проверяет подлинность", () => {
    const first = encrypt("session-secret"),
      second = encrypt("session-secret");
    expect(first).not.toBe(second);
    expect(decrypt(first)).toBe("session-secret");
    const corrupt = Buffer.from(first, "base64");
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => decrypt(corrupt.toString("base64"))).toThrow();
  });
  it("проверяет пароль и отвергает другой", () => {
    const hash = hashPassword("my-long-password");
    expect(verifyPassword("my-long-password", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifyPassword("wrong", "broken")).toBe(false);
  });
});
