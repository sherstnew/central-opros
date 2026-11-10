import { afterEach, describe, expect, it, vi } from "vitest";
import { Store, databaseName } from "../server/store";
afterEach(() => vi.useRealTimers());
describe("Настройка MongoDB", () => {
  it("использует имя базы из обычного и SRV URI", () => {
    expect(databaseName("mongodb://localhost:27017/my_database")).toBe(
      "my_database",
    );
    expect(
      databaseName(
        "mongodb+srv://user:password@cluster.example/otklik?retryWrites=true",
      ),
    ).toBe("otklik");
    expect(
      databaseName("mongodb://host1:27017,host2:27017/research?replicaSet=rs0"),
    ).toBe("research");
  });
  it("применяет явное имя и безопасное значение по умолчанию", () => {
    expect(
      databaseName("mongodb+srv://cluster.example/?retryWrites=true"),
    ).toBe("otklik");
    expect(databaseName("mongodb://localhost:27017")).toBe("otklik");
    expect(databaseName("mongodb://localhost/in_uri", "override")).toBe(
      "override",
    );
  });
});
describe("Контракт хранилища и аренда блокировок", () => {
  it("возвращает независимые копии и заменяет запись по тому же ключу", async () => {
    const store = new Store("");
    await store.put("offer", "one", { id: "one", stage: "new" });
    const first = await store.get<{ id: string; stage: string }>(
      "offer",
      "one",
    );
    first!.stage = "hidden";
    expect((await store.get<any>("offer", "one")).stage).toBe("new");
    await store.put("offer", "one", { id: "one", stage: "saved" });
    expect(await store.list("offer")).toEqual([{ id: "one", stage: "saved" }]);
    await store.remove("offer", "one");
    expect(await store.get("offer", "one")).toBeNull();
    await store.close();
  });
  it("не даёт старому владельцу снять повторно занятую блокировку", async () => {
    vi.useFakeTimers();
    const store = new Store("");
    const releaseOld = await store.lock("collection", 1);
    expect(await store.lock("collection")).toBeNull();
    vi.setSystemTime(Date.now() + 1100);
    const releaseNew = await store.lock("collection", 1);
    expect(releaseNew).not.toBeNull();
    await releaseOld!();
    expect(await store.lock("collection")).toBeNull();
    await releaseNew!();
    const release = await store.lock("collection");
    expect(release).not.toBeNull();
    await release!();
  });
});
