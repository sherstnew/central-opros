import { Api, type TelegramClient } from "teleproto";
import bigInt from "big-integer";
import { telegramClient } from "./telegram";
import { store } from "./store";
import { encrypt, decrypt, tokenHash } from "./security";
import type { AccountChannel, Source } from "../shared/model";

interface ChannelRecord extends AccountChannel {
  peerId: string;
  peerType: "channel" | "chat" | "user";
  accessHash: string;
}
interface ChannelCache {
  session: string;
  expires: number;
  channels: Map<string, ChannelRecord>;
}
let cache: ChannelCache | undefined;
let loading: { session: string; promise: Promise<ChannelCache> } | undefined;
async function sessionKey() {
  const secret = await store.get<{ value: string }>("secret", "telegram");
  if (!secret)
    throw new Error("Сначала подключи Telegram в разделе «Подключения»");
  return tokenHash(secret.value);
}
async function accountChannels(refresh = false): Promise<ChannelCache> {
  const session = await sessionKey();
  if (loading?.session === session) return loading.promise;
  if (!refresh && cache?.session === session && cache.expires > Date.now())
    return cache;
  const promise = (async () => {
    const client = await telegramClient();
    try {
      const channels = new Map<string, ChannelRecord>();
      // No folder filter: include archived chats and channels.
      for await (const dialog of client.iterDialogs({})) {
        const entity = dialog.entity;
        if (entity instanceof Api.Channel) {
          if (entity.left || entity.accessHash === undefined) continue;
          const id = entity.id.toString();
          channels.set(id, {
            id,
            peerId: id,
            peerType: "channel",
            kind: entity.broadcast ? "channel" : "supergroup",
            name: entity.title,
            username: entity.username || null,
            accessHash: entity.accessHash.toString(),
          });
        } else if (entity instanceof Api.Chat) {
          if (entity.left || entity.deactivated || entity.migratedTo) continue;
          const peerId = entity.id.toString(),
            id = `chat:${peerId}`;
          channels.set(id, {
            id,
            peerId,
            peerType: "chat",
            kind: "group",
            name: entity.title,
            username: null,
            accessHash: "",
          });
        } else if (entity instanceof Api.User) {
          if (entity.deleted || entity.self || entity.accessHash === undefined)
            continue;
          const peerId = entity.id.toString(),
            id = `user:${peerId}`;
          channels.set(id, {
            id,
            peerId,
            peerType: "user",
            kind: "user",
            name:
              [entity.firstName, entity.lastName].filter(Boolean).join(" ") ||
              entity.username ||
              "Без имени",
            username: entity.username || null,
            accessHash: entity.accessHash.toString(),
          });
        }
      }
      return (cache = {
        session,
        expires: Date.now() + 5 * 60 * 1000,
        channels,
      });
    } catch (error) {
      if (/FLOOD_WAIT/.test(String(error)))
        throw new Error("Telegram ограничил загрузку списка. Повтори позже.");
      throw new Error(
        "Не удалось загрузить чаты. Проверь подключение Telegram и повтори.",
      );
    } finally {
      await client.disconnect();
    }
  })();
  loading = { session, promise };
  try {
    return await promise;
  } finally {
    if (loading?.promise === promise) loading = undefined;
  }
}
export async function listAccountChannels(): Promise<AccountChannel[]> {
  const result = await accountChannels(true);
  return [...result.channels.values()]
    .map(({ id, name, username, kind }) => ({ id, name, username, kind }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
async function saveReference(
  sourceId: string,
  channel: ChannelRecord,
  session: string,
) {
  await store.put("secret", `channel:${sourceId}`, {
    value: encrypt(
      JSON.stringify({
        channelId: channel.peerId,
        type: channel.peerType,
        accessHash: channel.accessHash,
        session,
      }),
    ),
  });
}
export async function addAccountChannels(ids: string[]) {
  const result = await accountChannels();
  const selected = [...new Set(ids)].map((id) => result.channels.get(id));
  if (selected.some((c) => !c))
    throw new Error("Чат больше не доступен аккаунту. Обнови список.");
  const unlock = await store.lock("sources-selection", 30);
  if (!unlock) throw new Error("Источники обновляются. Повтори добавление.");
  try {
    const sources = await store.list<Source>("source");
    let added = 0;
    for (const channel of selected as ChannelRecord[]) {
      const previous = sources.find(
        (s) =>
          (s.telegramId === channel.peerId &&
            (s.telegramType || "channel") === channel.peerType) ||
          (!!channel.username &&
            s.handle.toLowerCase() === channel.username.toLowerCase()),
      );
      const id = previous?.id || `tg:${channel.id}`;
      const source: Source = {
        ...previous,
        id,
        name: previous?.name || channel.name,
        handle: channel.username?.toLowerCase() || "",
        telegramId: channel.peerId,
        telegramType: channel.peerType,
        enabled: previous?.enabled ?? true,
        lastMessageId: previous?.lastMessageId || 0,
      };
      await saveReference(id, channel, result.session);
      await store.put("source", id, source);
      if (!previous) {
        sources.push(source);
        added++;
      }
    }
    return { ok: true, added };
  } finally {
    await unlock();
  }
}
export async function sourceEntity(client: TelegramClient, source: Source) {
  if (!source.telegramId) return client.getEntity(source.handle);
  const session = await sessionKey();
  const secret = await store.get<{ value: string }>(
    "secret",
    `channel:${source.id}`,
  );
  let reference:
    | {
        channelId: string;
        accessHash: string;
        session: string;
        type?: "channel" | "chat" | "user";
      }
    | undefined;
  if (secret) reference = JSON.parse(decrypt(secret.value));
  if (
    !reference ||
    reference.session !== session ||
    reference.channelId !== source.telegramId ||
    (reference.type || "channel") !== (source.telegramType || "channel")
  ) {
    const current = await accountChannels();
    const key =
      (source.telegramType === "chat"
        ? "chat:"
        : source.telegramType === "user"
          ? "user:"
          : "") + source.telegramId;
    const channel = current.channels.get(key);
    if (!channel)
      throw new Error("Чат недоступен подключённому Telegram-аккаунту");
    await saveReference(source.id, channel, current.session);
    reference = {
      channelId: channel.peerId,
      type: channel.peerType,
      accessHash: channel.accessHash,
      session: current.session,
    };
  }
  if (reference.type === "chat")
    return new Api.InputPeerChat({ chatId: bigInt(reference.channelId) });
  if (reference.type === "user")
    return new Api.InputPeerUser({
      userId: bigInt(reference.channelId),
      accessHash: bigInt(reference.accessHash),
    });
  return new Api.InputPeerChannel({
    channelId: bigInt(reference.channelId),
    accessHash: bigInt(reference.accessHash),
  });
}
export function sourceMessageUrl(source: Source, messageId: number) {
  if (source.telegramType === "chat" || source.telegramType === "user")
    return source.handle ? `https://t.me/${source.handle}` : "";
  return source.telegramId
    ? `https://t.me/c/${source.telegramId}/${messageId}`
    : `https://t.me/${source.handle}/${messageId}`;
}
