import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parse } from "dotenv";
import { verifyPassword } from "../server/password";

it("настраивает заполненный MongoDB env до запуска приложения, не подключаясь к базе", async () => {
  const prefix = join(tmpdir(), "otklik-setup-test-"),
    directory = mkdtempSync(prefix);
  const original =
    "MONGODB_URI=mongodb://not-connected.example/otklik\nAPP_ORIGIN=http://localhost:5173\n";
  writeFileSync(join(directory, ".env"), original);
  try {
    const result = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
            fileURLToPath(new URL("../scripts/setup.ts", import.meta.url)),
          ],
          { cwd: directory, stdio: ["pipe", "pipe", "pipe"] },
        );
        let output = "",
          first = false,
          second = false;
        child.stdout.on("data", (data) => (output += data.toString()));
        child.stderr.on("data", (data) => {
          output += data.toString();
          if (!first && output.includes("Придумай пароль")) {
            first = true;
            child.stdin.write("test-setup-password\n");
          }
          if (!second && output.includes("Повтори пароль")) {
            second = true;
            child.stdin.end("test-setup-password\n");
          }
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      },
    );
    expect(result.code, result.output).toBe(0);
    expect(result.output).not.toContain("test-setup-password");
    expect(readFileSync(join(directory, ".env"), "utf8")).toBe(original);
    const secrets = parse(
      readFileSync(join(directory, ".env.secrets"), "utf8"),
    );
    expect(
      verifyPassword("test-setup-password", secrets.OWNER_PASSWORD_HASH),
    ).toBe(true);
    expect(secrets.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    if (directory.startsWith(prefix))
      rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
