import { describe, expect, it } from "vitest";
import { telegramProxy } from "../server/telegram-proxy";

const key = "0123456789abcdef0123456789abcdef";
describe("Telegram proxy", () => {
  it("keeps direct connections when unset", () => {
    expect(telegramProxy("")).toBeUndefined();
  });
  it.each([key, `dd${key}`, `ee${key}6578616d706c652e636f6d`])("accepts supported secrets %s", (secret) => {
    const transport = telegramProxy(`tg://proxy?server=proxy.example.com&port=443&secret=${secret}`);
    expect(transport?.options).toEqual({ host: "proxy.example.com", port: 443, secret });
  });
  it("accepts t.me links", () => {
    expect(telegramProxy(`https://t.me/proxy?server=localhost&port=8443&secret=${key}`)?.options.port).toBe(8443);
  });
  it.each([
    `https://other.example/proxy?server=localhost&port=443&secret=${key}`,
    `tg://proxy?server=localhost&port=65536&secret=${key}`,
    "tg://proxy?server=localhost&port=443&secret=private!invalid!secret",
  ])("rejects invalid settings without exposing credentials", (value) => {
    expect(() => telegramProxy(value)).toThrow(/^TELEGRAM_PROXY_URL:/);
    try { telegramProxy(value); } catch (error) {
      expect(String(error)).not.toContain("private!invalid!secret");
      expect(String(error)).not.toContain(key);
    }
  });
});

