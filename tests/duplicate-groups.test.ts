import { describe, expect, it } from "vitest";
import { duplicateGroupsSchema, validateDuplicateGroups } from "../server/duplicate-groups";
import { duplicateError } from "../server/duplicate-error";

describe("Группы повторов", () => {
  it("ограничивает ID в схеме ответа реальным списком карточек", () => {
    const schema = duplicateGroupsSchema(["a", "b", "c", "d"]);
    expect(schema.safeParse({ groups: [["a", "b"], ["c", "d"]] }).success).toBe(true);
    expect(schema.safeParse({ groups: [["a", "invented"]] }).success).toBe(false);
    expect(schema.safeParse({ groups: [] }).success).toBe(true);
  });
  it("различает неизвестные ID, повтор внутри группы и пересечение групп", () => {
    for (const [groups, violation] of [
      [[["a", "invented"]], "unknown_id"],
      [[["a", "a"]], "repeated_id"],
      [[["a", "b"], ["a", "c"]], "overlapping_groups"],
    ] as const) {
      try {
        validateDuplicateGroups(groups.map(g => [...g]), new Set(["a", "b", "c"]));
        expect.fail("Invalid groups must be rejected");
      } catch (error) {
        expect(duplicateError(error)).toMatchObject({category: "groups", violation});
      }
    }
    expect(() => validateDuplicateGroups([["a", "b", "c"]], new Set(["a", "b", "c"]))).not.toThrow();
  });
});
