import { describe, expect, it } from "vitest";
import { z } from "zod";
import { duplicateError } from "../server/duplicate-error";

describe("Безопасная диагностика повторов", () => {
  it("различает лимит, доступ, сбой сервиса, формат и группы", () => {
    for (const [status, category] of [[429, "rate_limit"], [401, "access"], [403, "access"], [503, "provider"], [400, "request"]] as const)
      expect(duplicateError(Object.assign(new Error("secret provider body"), { status })).category).toBe(category);
    expect(duplicateError(z.string().safeParse(42).error).category).toBe("response");
    expect(duplicateError(new SyntaxError("secret body")).category).toBe("response");
    expect(duplicateError(new Error("Некорректные группы повторов")).category).toBe("groups");
    expect(duplicateError(Object.assign(new Error(), {name: "APIConnectionTimeoutError"})).category).toBe("timeout");
  });
  it("не сохраняет произвольный текст ошибки, ключи и ответы провайдера", () => {
    for (const error of [null, new Error("secret-key and private prompt"), Object.assign(new Error("secret-key"), {status: 429})])
      expect(JSON.stringify(duplicateError(error))).not.toMatch(/secret|private/);
  });
});
