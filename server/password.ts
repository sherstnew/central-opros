import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
  try {
    const [salt, expected] = hash.split(":");
    const a = scryptSync(password, salt, 64),
      b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
