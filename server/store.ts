import { MongoClient, MongoServerError, type Collection } from "mongodb";
import { config } from "./config";
import { randomUUID } from "node:crypto";

type Table =
  | "profile"
  | "source"
  | "message"
  | "offer"
  | "feedback"
  | "digest"
  | "job"
  | "control"
  | "subscription"
  | "secret"
  | "session";
interface RecordDocument {
  _id: string;
  data: unknown;
}
interface LeaseDocument {
  _id: string;
  owner: string;
  expiresAt: Date;
}

export function databaseName(uri: string, override?: string) {
  if (override) return override;
  const path = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/)?.[1];
  return path ? decodeURIComponent(path) : "otklik";
}

export class Store {
  private memory = new Map<string, Map<string, unknown>>();
  private readonly client: MongoClient | null;
  private readonly database;
  private leases = new Map<string, { owner: string; expires: number }>();
  constructor(
    uri = config.demo ? "" : config.mongoUri,
    name = config.mongoDatabase,
  ) {
    this.client = uri
      ? new MongoClient(uri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 10000,
        })
      : null;
    this.database = this.client?.db(databaseName(uri, name));
  }
  private collection(table: Table): Collection<RecordDocument> | undefined {
    return this.database?.collection<RecordDocument>(table);
  }
  async list<T>(table: Table): Promise<T[]> {
    const collection = this.collection(table);
    if (collection)
      return (
        await collection.find({}, { projection: { data: 1 } }).toArray()
      ).map((record) => record.data as T);
    return structuredClone([
      ...(this.memory.get(table)?.values() || []),
    ]) as T[];
  }
  async get<T>(table: Table, id: string): Promise<T | null> {
    const collection = this.collection(table);
    if (collection)
      return ((await collection.findOne({ _id: id }))?.data as T) ?? null;
    return structuredClone(this.memory.get(table)?.get(id) ?? null) as T | null;
  }
  async put<T>(table: Table, id: string, data: T): Promise<void> {
    const clean = JSON.parse(JSON.stringify(data));
    const collection = this.collection(table);
    if (collection) {
      // String _id is the unique application key, so retries replace rather than duplicate.
      await collection.replaceOne(
        { _id: id },
        { data: clean },
        { upsert: true },
      );
      return;
    }
    if (!this.memory.has(table)) this.memory.set(table, new Map());
    this.memory.get(table)!.set(id, clean);
  }
  async remove(table: Table, id: string) {
    const collection = this.collection(table);
    if (collection) await collection.deleteOne({ _id: id });
    else this.memory.get(table)?.delete(id);
  }
  async lock(id: string, seconds = 300): Promise<null | (() => Promise<void>)> {
    const owner = randomUUID(),
      now = new Date(),
      expiresAt = new Date(Date.now() + seconds * 1000);
    const leases = this.database?.collection<LeaseDocument>("lease");
    if (leases) {
      // Initialise separately: an occupied lock must never become a duplicate upsert.
      try {
        await leases.updateOne(
          { _id: id },
          { $setOnInsert: { owner: "", expiresAt: new Date(0) } },
          { upsert: true },
        );
      } catch (error) {
        if (!(error instanceof MongoServerError && error.code === 11000))
          throw error;
      }
      const claimed = await leases.findOneAndUpdate(
        { _id: id, expiresAt: { $lte: now } },
        { $set: { owner, expiresAt } },
        { returnDocument: "after", includeResultMetadata: false },
      );
      if (!claimed) return null;
    } else {
      if ((this.leases.get(id)?.expires || 0) > Date.now()) return null;
      this.leases.set(id, { owner, expires: expiresAt.getTime() });
    }
    const timer = setInterval(() => {
      if (leases)
        void leases
          .updateOne(
            { _id: id, owner, expiresAt: { $gt: new Date() } },
            { $set: { expiresAt: new Date(Date.now() + seconds * 1000) } },
          )
          .catch(() => {});
      else if (this.leases.get(id)?.owner === owner)
        this.leases.set(id, { owner, expires: Date.now() + seconds * 1000 });
    }, seconds * 300);
    timer.unref();
    return async () => {
      clearInterval(timer);
      if (leases)
        await leases.updateOne(
          { _id: id, owner },
          { $set: { expiresAt: new Date(0) } },
        );
      else if (this.leases.get(id)?.owner === owner) this.leases.delete(id);
    };
  }
  async health() {
    if (this.database) await this.database.command({ ping: 1 });
  }
  async close() {
    await this.client?.close();
  }
}
export const store = new Store();
