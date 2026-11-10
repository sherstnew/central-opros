import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { config } from "./config";
const demoKey = randomBytes(32);
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      config.encryptionKey ? Buffer.from(config.encryptionKey, "hex") : demoKey,
      iv,
    );
  return seal(cipher, iv, value);
}
function seal(
  cipher: ReturnType<typeof createCipheriv>,
  iv: Buffer,
  value: string,
) {
  const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, (cipher as any).getAuthTag(), content]).toString(
    "base64",
  );
}
export function decrypt(value: string) {
  const b = Buffer.from(value, "base64"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      config.encryptionKey ? Buffer.from(config.encryptionKey, "hex") : demoKey,
      b.subarray(0, 12),
    );
  cipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    cipher.update(b.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export { hashPassword, verifyPassword } from "./password";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
