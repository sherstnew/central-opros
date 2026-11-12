import { z } from "zod";
export const stageSchema = z.enum([
  "new",
  "saved",
  "applied",
  "booked",
  "completed",
  "paid",
  "cancelled",
  "hidden",
]);
export type Stage = z.infer<typeof stageSchema>;
export const stageNames: Record<Stage, string> = {
  new: "Новое",
  saved: "Сохранён",
  applied: "Откликнулся",
  booked: "Записан",
  completed: "Прошёл",
  paid: "Оплачен",
  cancelled: "Отменён",
  hidden: "Скрыт",
};
export const profileSchema = z.object({
  name: z.string().max(80).default(""),
  birthDate: z.string().max(10).default(""),
  city: z.string().max(100).default(""),
  gender: z.string().max(80).default(""),
  employment: z.string().max(200).default(""),
  profession: z.string().max(200).default(""),
  family: z.string().max(500).default(""),
  about: z.string().max(3000).default(""),
  format: z.enum(["any", "online", "offline"]).default("any"),
  minReward: z.number().min(0).max(1000000).default(0),
  maxDuration: z.number().min(0).max(10080).default(0),
});
export type Profile = z.infer<typeof profileSchema>;
export const settingsSchema = z.object({
  eveningCollectionTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("21:00"),
  collectionTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("03:00"),
  notificationTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface Source {
  id: string;
  name: string;
  handle: string;
  telegramId?: string;
  telegramType?: "channel" | "chat" | "user";
  enabled: boolean;
  lastMessageId: number;
  lastSuccess?: string;
  error?: string;
  pendingOffset?: number;
  pendingTop?: number;
  pendingSince?: string;
}
export interface AccountChannel {
  kind: "channel" | "supergroup" | "group" | "user";
  id: string;
  name: string;
  username: string | null;
}
export interface RawMessage {
  collectedAt?: string;
  id: string;
  sourceId: string;
  messageId: number;
  text: string;
  date: string;
  url: string;
  hash: string;
  processedHash?: string;
}
export const extractedSchema = z.object({
  isSurvey: z.boolean(),
  title: z.string().max(200),
  summary: z.string().max(1500),
  reward: z.number().nonnegative().nullable(),
  currency: z.string().max(10),
  format: z.enum(["online", "offline", "unknown"]),
  city: z.string().max(100).nullable(),
  duration: z.number().positive().nullable(),
  startsAt: z.string().nullable(),
  dateLabel: z.string().max(160).nullable(),
  deadline: z.string().nullable(),
  requirements: z.array(z.string().max(300)).max(25),
  category: z.string().max(100),
  ageMin: z.number().int().min(0).nullable(),
  ageMax: z.number().int().max(120).nullable(),
  gender: z.string().nullable(),
  applyUrl: z.string().nullable(),
  organizer: z.string().nullable(),
  dedupKey: z.string().max(300),
});
export type Extracted = z.infer<typeof extractedSchema>;
export interface Offer extends Extracted {
  catalogId?: string;
  catalogUpdatedAt?: string;
  manuallyAdded?: boolean;
  id: string;
  createdAt: string;
  updatedAt: string;
  day: string;
  stage: Stage;
  match: "yes" | "maybe" | "no";
  reasons: string[];
  questions: string[];
  score: number;
  sources: { messageId: string; name: string; url: string; text: string }[];
  note: string;
  participationDate: string | null;
  actualReward: number | null;
  matchVersion?: string;
  duplicateOf?: string;
}
export interface Feedback {
  id: string;
  offerId: string;
  title: string;
  category: string;
  reason: string;
  permanent: boolean;
  rule: string;
  createdAt: string;
  scope?: "preference" | "timing";
}
export interface Digest {
  id: string;
  day: string;
  status: "running" | "complete" | "partial" | "failed";
  summary: string;
  newCount: number;
  errors: string[];
  startedAt: string;
  finishedAt?: string;
  mode?: "manual" | "scheduled";
  lookbackDays?: number;
}
export interface Job {
  id: string;
  kind: "collect" | "notify";
  day: string;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  error?: string;
  updatedAt: string;
  window?: {
    since: string;
    until: string;
    mode: "manual" | "scheduled";
    lookbackDays: number;
  };
  sourceCursors?: Record<string, { offsetId: number; done: boolean }>;
  incomplete?: boolean;
  cancelledBy?: "user" | "timeout";
  progress?: {
    phase:
      | "telegram"
      | "extract"
      | "evaluate"
      | "recheck"
      | "summary"
      | "done"
      | "failed"
      | "cancelled";
    startedAt: string;
    deadlineAt: string;
    sourceName?: string;
    sourcesDone: number;
    sourcesTotal: number;
    messagesRead: number;
    messagesDone: number;
    messagesTotal: number;
    aiCalls: number;
    offersAdded: number;
    rechecked: number;
    recheckTotal: number;
  };
}
export const collectionInputSchema = z.object({
  lookbackDays: z.number().int().min(1).max(30).default(1),
  resumeJobId: z.string().max(100).optional(),
});
export interface PushSubscriptionRecord {
  id: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  lastDay?: string;
}
export interface User {
  id: string;
  name: string;
  normalizedName: string;
  passwordHash: string;
  createdAt: string;
  role: "owner" | "member";
}
export type PublicUser = Pick<User, "id" | "name" | "role">;
export interface AuthState {
  authenticated: boolean;
  demo: boolean;
  account: PublicUser | null;
  accounts: PublicUser[];
}
export interface AppData {
  account: PublicUser;
  demo: boolean;
  profile: Profile;
  settings: Settings;
  offers: Offer[];
  sources: Source[];
  feedback: Feedback[];
  digests: Digest[];
  jobs: Job[];
  telegram: { configured: boolean; connected: boolean };
  ai: { configured: boolean; model: string };
  push: { configured: boolean; publicKey: string };
}
export const manualOfferSchema = z.object({
  title: z.string().trim().min(1, "Укажи тему опроса").max(200),
  summary: z.string().trim().min(1, "Вставь текст объявления").max(1500),
  reward: z.number().min(0).max(10000000).nullable(),
  duration: z.number().positive().max(10080).nullable(),
  format: z.enum(["online", "offline", "unknown"]).default("unknown"),
  city: z.string().trim().max(100).nullable().default(null),
  dateLabel: z.string().trim().max(160).nullable().default(null),
  applyUrl: z
    .string()
    .url()
    .max(2048)
    .refine((v) => /^https?:\/\//i.test(v), "Нужна ссылка http или https")
    .nullable()
    .default(null),
});
export const offerPatchSchema = z.object({
  stage: stageSchema.optional(),
  note: z.string().max(5000).optional(),
  participationDate: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
  actualReward: z.number().min(0).max(10000000).nullable().optional(),
});
export const feedbackSchema = z
  .object({
    offerId: z.string(),
    reason: z.string().max(1500).default(""),
    permanent: z.boolean().default(false),
    rule: z.string().max(300).default(""),
    scope: z.enum(["preference", "timing"]).default("preference"),
  })
  .refine((v) => !v.permanent || v.rule.trim().length > 2, {
    message: "Укажи постоянное условие исключения",
  })
  .refine((v) => v.scope !== "timing" || !v.permanent, {
    message: "Разовая занятость не может быть постоянным запретом",
  });
export const sourceInputSchema = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^(?:https:\/\/t\.me\/)?[a-zA-Z][a-zA-Z0-9_]{3,31}\/?$/),
  name: z.string().trim().max(100).default(""),
});
export function moscowDay(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(
    date,
  );
}
