import { store } from "./store";
import { config } from "./config";
import { evaluate } from "./ai";
import { hardMismatch, MATCHING_VERSION } from "./matching";
import { mergeDuplicates } from "./dedup";
import { CollectionControl } from "./collection-control";
import {
  profileSchema,
  type User,
  type Offer,
  type Profile,
  type Feedback,
  type Job,
  type Digest,
} from "../shared/model";

async function users() {
  const all = await store.list<User>("user");
  return all.length
    ? all
    : [{ id: "owner", createdAt: new Date(0).toISOString() } as User];
}
type Options = {
  job: Job;
  control: CollectionControl;
  calls: number;
  report: (force?: boolean) => Promise<void>;
  errors: string[];
};
export async function personalize({
  job,
  control,
  calls,
  report,
  errors,
}: Options) {
  const catalog = await store.list<Offer>("catalog");
  const canonical = catalog.filter((o) => !o.duplicateOf);
  const queues = [];
  for (const user of await users()) {
    const queue = await store.as(user.id, async () => {
      const profile =
        (await store.get<Profile>("profile", "owner")) ||
        profileSchema.parse({});
      const feedback = await store.list<Feedback>("feedback");
      const revision = `${MATCHING_VERSION}:${(await store.get<{ value: string }>("profile", "revision"))?.value || "initial"}`;
      // Propagate canonical aliases separately in every cabinet; participation histories never cross users.
      for (const root of canonical) {
        const aliases = catalog
          .filter((o) => o.duplicateOf === root.id)
          .map((o) => o.id);
        if (aliases.length) await mergeDuplicates([root.id, ...aliases]);
      }
      const personal = await store.list<Offer>("offer");
      const tasks: { facts: Offer; current?: Offer }[] = [];
      for (const facts of canonical) {
        const aliases = new Set([
          facts.id,
          ...catalog.filter((o) => o.duplicateOf === facts.id).map((o) => o.id),
        ]);
        const existing = personal.filter(
          (o) =>
            !o.manuallyAdded &&
            !o.duplicateOf &&
            aliases.has(o.catalogId || o.id),
        );
        if (!existing.length && facts.createdAt < user.createdAt) continue;
        for (const current of existing.length ? existing : [undefined]) {
          if (
            !current ||
            (current.stage === "new" &&
              (current.matchVersion !== revision ||
                (current.catalogUpdatedAt || current.updatedAt) !==
                  facts.updatedAt))
          )
            tasks.push({ facts, current });
          else if (
            current &&
            (current.catalogUpdatedAt || current.updatedAt) !== facts.updatedAt
          ) {
            // Refresh shared source facts without touching private participation or assessment.
            const release = await store.lock(
              `offer:${user.id}:${current.id}`,
              30,
            );
            if (!release) continue;
            try {
              const fresh = await store.get<Offer>("offer", current.id);
              if (fresh)
                await store.put("offer", fresh.id, withFacts(facts, fresh));
            } finally {
              await release();
            }
          }
        }
      }
      return { user, profile, feedback, revision, tasks };
    });
    queues.push(queue);
  }
  // Resume after the last served cabinet, then take one assessment per cabinet per round.
  const cursor = await store.get<{ userId: string }>(
    "control",
    "matching:cursor",
  );
  const start = queues.findIndex((q) => q.user.id === cursor?.userId) + 1;
  const ordered = [...queues.slice(start), ...queues.slice(0, start)];
  job.progress!.recheckTotal =
    job.progress!.rechecked + queues.reduce((n, q) => n + q.tasks.length, 0);
  while (ordered.some((q) => q.tasks.length)) {
    let progress = false;
    for (const queue of ordered) {
      if (!queue.tasks.length) continue;
      control.check();
      if (calls >= config.maxCalls) {
        errors.push(
          "Персонализация обновлена частично: достигнут лимит запросов. Продолжим при следующем сборе.",
        );
        return calls;
      }
      const { facts, current } = queue.tasks.shift()!;
      try {
        job.progress!.phase = "recheck";
        const mismatch = hardMismatch(facts, queue.profile);
        const assessment = mismatch
          ? {
              match: "no" as const,
              reasons: [mismatch],
              questions: [],
              score: 0,
            }
          : await (async () => {
              calls++;
              job.progress!.aiCalls = calls;
              await report(true);
              return control.wait(
                evaluate(facts, queue.profile, queue.feedback, control.signal),
                "ИИ",
              );
            })();
        await store.as(queue.user.id, async () => {
          const id = current?.id || facts.id;
          const release = await store.lock(`offer:${queue.user.id}:${id}`, 30);
          if (!release) throw new Error("Карточка обновляется");
          try {
            const fresh = await store.get<Offer>("offer", id);
            const revision = `${MATCHING_VERSION}:${(await store.get<{ value: string }>("profile", "revision"))?.value || "initial"}`;
            if (revision !== queue.revision)
              throw new Error("Анкета изменилась во время оценки");
            if (fresh && (fresh.stage !== "new" || fresh.duplicateOf)) return;
            await store.put("offer", id, {
              ...withFacts(facts, fresh || undefined),
              id,
              catalogId: facts.id,
              ...assessment,
              matchVersion: queue.revision,
            });
            if (!fresh && assessment.match !== "no")
              job.progress!.offersAdded++;
          } finally {
            await release();
          }
        });
        await store.put("control", "matching:cursor", {
          userId: queue.user.id,
        });
        job.progress!.rechecked++;
        await report(true);
        progress = true;
      } catch {
        control.check();
        errors.push(
          "Часть личных оценок не готова. Повторим при следующем сборе.",
        );
        // Do not keep spending requests for the cabinet that just failed.
        queue.tasks.length = 0;
      }
    }
    if (!progress) break;
  }
  return calls;
}

function withFacts(facts: Offer, personal?: Offer): Offer {
  return {
    ...facts,
    ...personal,
    ...Object.fromEntries(
      Object.entries(facts).filter(
        ([key]) =>
          ![
            "id",
            "createdAt",
            "day",
            "stage",
            "note",
            "participationDate",
            "actualReward",
            "match",
            "reasons",
            "questions",
            "score",
            "matchVersion",
            "catalogUpdatedAt",
            "duplicateOf",
          ].includes(key),
      ),
    ),
    catalogId: facts.id,
    catalogUpdatedAt: facts.updatedAt,
    updatedAt: facts.updatedAt,
  } as Offer;
}

export async function personalDigests(
  job: Job,
  base: Digest,
  errors: string[],
  control?: CollectionControl,
) {
  for (const user of await users())
    await store.as(user.id, async () => {
      control?.check();
      const offers = (await store.list<Offer>("offer")).filter(
        (o) =>
          !o.duplicateOf &&
          o.day === job.day &&
          o.match !== "no" &&
          o.stage !== "hidden",
      );
      await store.put("digest", base.id, {
        ...base,
        status:
          base.status === "failed"
            ? "failed"
            : errors.length
              ? "partial"
              : "complete",
        newCount: offers.length,
        summary: offers.length
          ? `Подходящих предложений: ${offers.length}. Открой карточки, чтобы выбрать интересное.`
          : "Новых подходящих опросов нет.",
        errors: [...new Set(errors)],
        finishedAt: new Date().toISOString(),
      });
    });
}
