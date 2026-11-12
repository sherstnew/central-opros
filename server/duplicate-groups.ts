import { z } from "zod";

export function duplicateGroupsSchema(ids: string[]) {
  const allowed = [...new Set(ids)];
  if (allowed.length < 2) throw new Error("Нужно минимум два предложения");
  return z.object({
    groups: z.array(z.array(z.enum(allowed)).min(2).max(allowed.length))
      .max(Math.floor(allowed.length / 2)),
  });
}

export class DuplicateGroupsError extends Error {
  constructor(readonly violation: "unknown_id" | "repeated_id" | "overlapping_groups") {
    super("Некорректные группы повторов");
  }
}

export function validateDuplicateGroups(groups: string[][], allowed: Set<string>) {
  const seen = new Set<string>();
  for (const group of groups) {
    if (group.some(id => !allowed.has(id))) throw new DuplicateGroupsError("unknown_id");
    if (new Set(group).size !== group.length) throw new DuplicateGroupsError("repeated_id");
    if (group.some(id => seen.has(id))) throw new DuplicateGroupsError("overlapping_groups");
    group.forEach(id => seen.add(id));
  }
}
