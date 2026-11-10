import { beforeEach, describe, it, expect, vi } from "vitest";
import { Api } from "teleproto";
import bigInt from "big-integer";
import { randomUUID } from "node:crypto";
import { store } from "../server/store";
import {
  listAccountChannels,
  addAccountChannels,
  sourceEntity,
  sourceMessageUrl,
} from "../server/channels";
import type { Source } from "../shared/model";
const mock = vi.hoisted(() => ({
  dialogs: [] as { entity: unknown }[],
  getEntity: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../server/telegram", () => ({
  telegramClient: async () => ({
    iterDialogs: async function* () {
      yield* mock.dialogs;
    },
    getEntity: mock.getEntity,
    disconnect: mock.disconnect,
  }),
}));
const makeChannel = (id: string, title: string, extra: object = {}) =>
  new Api.Channel({
    id: bigInt(id),
    title,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
    broadcast: true,
    accessHash: bigInt("9012345678901234567"),
    ...extra,
  });
beforeEach(async () => {
  for (const source of await store.list<Source>("source")) {
    await store.remove("source", source.id);
    await store.remove("secret", `channel:${source.id}`);
  }
  await store.put("secret", "telegram", { value: randomUUID() });
  mock.getEntity.mockReset();
  mock.disconnect.mockReset();
  mock.disconnect.mockResolvedValue(undefined);
  mock.dialogs = [
    { entity: makeChannel("1234567890", "Закрытый канал") },
    {
      entity: makeChannel("987654321", "Открытый канал", {
        username: "public_channel",
      }),
    },
    {
      entity: makeChannel("111", "Группа", {
        broadcast: false,
        megagroup: true,
      }),
    },
    { entity: makeChannel("222", "Покинутый канал", { left: true }) },
    { entity: { firstName: "Личный контакт" } },
    {
      entity: new Api.Chat({
        id: bigInt("1234567890"),
        title: "Обычная группа",
        photo: new Api.ChatPhotoEmpty(),
        participantsCount: 3,
        date: 0,
        version: 1,
      }),
    },
    {
      entity: new Api.User({
        id: bigInt("1234567890"),
        firstName: "Личный чат",
        accessHash: bigInt("1234567890123456789"),
      }),
    },
  ];
});
describe("Выбор каналов подключённого аккаунта", () => {
  it("показывает каналы, группы и личные чаты, не раскрывая accessHash", async () => {
    const channels = await listAccountChannels();
    expect(channels).toHaveLength(5);
    expect(channels).toContainEqual({
      id: "1234567890",
      name: "Закрытый канал",
      username: null,
      kind: "channel",
    });
    expect(JSON.stringify(channels)).not.toContain("accessHash");
    expect(JSON.stringify(channels)).not.toContain("9012345678901234567");
    expect(mock.disconnect).toHaveBeenCalledOnce();
  });
  it("различает одинаковые числовые ID канала, обычной группы и пользователя", async () => {
    await addAccountChannels([
      "1234567890",
      "chat:1234567890",
      "user:1234567890",
      "111",
    ]);
    const sources = await store.list<Source>("source");
    expect(sources).toHaveLength(4);
    const group = sources.find((s) => s.telegramType === "chat")!,
      user = sources.find((s) => s.telegramType === "user")!,
      supergroup = sources.find((s) => s.telegramId === "111")!;
    expect(
      await sourceEntity({ getEntity: mock.getEntity } as any, group),
    ).toBeInstanceOf(Api.InputPeerChat);
    expect(
      await sourceEntity({ getEntity: mock.getEntity } as any, user),
    ).toBeInstanceOf(Api.InputPeerUser);
    expect(
      await sourceEntity({ getEntity: mock.getEntity } as any, supergroup),
    ).toBeInstanceOf(Api.InputPeerChannel);
    expect(sourceMessageUrl(group, 42)).toBe("");
    expect(sourceMessageUrl(supergroup, 42)).toBe("https://t.me/c/111/42");
  });
  it("сохраняет закрытый канал и читает его по InputPeerChannel без username", async () => {
    expect(await addAccountChannels(["1234567890"])).toMatchObject({
      added: 1,
    });
    const source = (await store.list<Source>("source"))[0];
    expect(source).toMatchObject({
      telegramId: "1234567890",
      handle: "",
      enabled: true,
    });
    const secret = await store.get<{ value: string }>(
      "secret",
      `channel:${source.id}`,
    );
    expect(secret?.value).toBeTruthy();
    expect(secret?.value).not.toContain("9012345678901234567");
    const peer = await sourceEntity(
      { getEntity: mock.getEntity } as any,
      source,
    );
    expect(peer).toBeInstanceOf(Api.InputPeerChannel);
    expect((peer as Api.InputPeerChannel).channelId.toString()).toBe(
      "1234567890",
    );
    expect((peer as Api.InputPeerChannel).accessHash.toString()).toBe(
      "9012345678901234567",
    );
    expect(mock.getEntity).not.toHaveBeenCalled();
    expect(sourceMessageUrl(source, 42)).toBe("https://t.me/c/1234567890/42");
    expect((await addAccountChannels(["1234567890"])).added).toBe(0);
    expect(await store.list("source")).toHaveLength(1);
  });
  it("не дублирует канал, ранее добавленный по публичной ссылке", async () => {
    await store.put<Source>("source", "public_channel", {
      id: "public_channel",
      name: "Моё название",
      handle: "public_channel",
      enabled: false,
      lastMessageId: 42,
    });
    expect((await addAccountChannels(["987654321"])).added).toBe(0);
    expect(await store.list("source")).toEqual([
      expect.objectContaining({
        id: "public_channel",
        name: "Моё название",
        telegramId: "987654321",
        enabled: false,
        lastMessageId: 42,
      }),
    ]);
  });
  it("отклоняет идентификатор, которого нет в каналах аккаунта, до добавления остальных", async () => {
    await expect(addAccountChannels(["1234567890", "999999"])).rejects.toThrow(
      "Обнови список",
    );
    expect(await store.list("source")).toHaveLength(0);
  });
  it("после смены аккаунта не использует старый accessHash", async () => {
    await addAccountChannels(["1234567890"]);
    const source = (await store.list<Source>("source"))[0];
    await store.put("secret", "telegram", { value: randomUUID() });
    mock.dialogs = [];
    await expect(
      sourceEntity({ getEntity: mock.getEntity } as any, source),
    ).rejects.toThrow("недоступен");
  });
});
