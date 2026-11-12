import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { describe, expect, it } from "vitest";
import { Store } from "../server/store";
import { migrateAccounts } from "../server/accounts";
import { profileSchema, type Offer } from "../shared/model";

// Opt-in only. Always create a unique database, never use the URI's application database.
describe.skipIf(!process.env.TEST_MONGODB_URI)(
  "Миграция на отдельной MongoDB",
  () => {
    it("координирует два процесса и изолирует кабинеты при чтении и записи", async () => {
      const uri = process.env.TEST_MONGODB_URI!;
      const database = `codex_accounts_test_${randomUUID().replaceAll("-", "")}`;
      const first = new Store(uri, database),
        second = new Store(uri, database);
      const cleanup = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
      let connected = false;
      try {
        await first.health();
        connected = true;
        await first.put(
          "profile",
          "owner",
          profileSchema.parse({ name: "Денис", city: "Москва" }),
        );
        await first.put("offer", "legacy", {
          id: "legacy",
          createdAt: "2026-01-01",
          stage: "paid",
          note: "История",
          sources: [],
          match: "yes",
          reasons: ["Личное"],
          questions: [],
          score: 80,
        } as unknown as Offer);
        await first.put("session", "legacy-session", {
          id: "legacy-session",
          expires: Date.now() + 60000,
        });
        await Promise.all([migrateAccounts(first), migrateAccounts(second)]);
        expect(await second.get("user", "owner")).toMatchObject({
          name: "Денис",
        });
        expect(await second.get("session", "legacy-session")).toMatchObject({
          activeUserId: "owner",
          userIds: ["owner"],
        });
        expect(await second.get("catalog", "legacy")).toMatchObject({
          note: "",
          stage: "new",
          reasons: [],
        });
        expect(await second.get("offer", "legacy")).toMatchObject({
          note: "История",
          stage: "paid",
        });
        await first.as("anna", async () => {
          expect(await first.list("offer")).toEqual([]);
          expect(await first.get("offer", "legacy")).toBeNull();
          await first.put("offer", "legacy", {
            id: "legacy",
            note: "Анна",
            stage: "hidden",
          });
          await first.put(
            "profile",
            "owner",
            profileSchema.parse({ name: "Анна", city: "Казань" }),
          );
        });
        expect(await second.as("anna", () => second.list("offer"))).toEqual([
          { id: "legacy", note: "Анна", stage: "hidden" },
        ]);
        expect(await second.get("offer", "legacy")).toMatchObject({
          note: "История",
          stage: "paid",
        });
        expect(await second.get("profile", "owner")).toMatchObject({
          city: "Москва",
        });
        await first.remove("control", "accounts:v1");
        await migrateAccounts(second);
        expect(await first.list("catalog")).toHaveLength(1);
        expect(
          await first.as("anna", () => first.get("offer", "legacy")),
        ).toMatchObject({ note: "Анна" });
      } finally {
        await Promise.all([first.close(), second.close()]);
        if (connected) {
          if (!/^codex_accounts_test_[a-f0-9]{32}$/.test(database))
            throw new Error("Invalid disposable database name");
          await cleanup.db(database).dropDatabase();
        }
        await cleanup.close();
      }
    }, 30000);
  },
);
