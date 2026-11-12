import { store } from "./store";
import type { Offer } from "../shared/model";

// Keep records for recovery and feedback history; expose only the canonical offer.
export async function mergeDuplicates(
  ids: string[],
  table: "offer" | "catalog" = "offer",
) {
  const releases: (() => Promise<void>)[] = [];
  try {
    for (const id of [...new Set(ids)].sort()) {
      const release = await store.lock(
        table === "offer" ? `offer:${store.userId}:${id}` : `catalog:${id}`,
        30,
      );
      if (!release) return;
      releases.push(release);
    }
    const offers = (
      await Promise.all(ids.map((id) => store.get<Offer>(table, id)))
    ).filter((o): o is Offer => !!o && !o.duplicateOf);
    const working = offers.filter((o) => !["new", "hidden"].includes(o.stage));
    // Never collapse two independent participation histories automatically.
    if (offers.length < 2 || working.length > 1) return;
    const canonical =
      working[0] ||
      offers.find((o) => o.stage === "hidden") ||
      offers.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const others = offers.filter((o) => o.id !== canonical.id);
    await store.put(table, canonical.id, {
      ...canonical,
      createdAt: offers.map((o) => o.createdAt).sort()[0],
      updatedAt: new Date().toISOString(),
      sources: [
        ...new Map(
          offers.flatMap((o) => o.sources).map((s) => [s.messageId, s]),
        ).values(),
      ],
      note: [
        ...new Set(
          [canonical.note, ...others.map((o) => o.note)].filter(Boolean),
        ),
      ].join("\n\n"),
    });
    for (const other of others)
      await store.put(table, other.id, {
        ...other,
        duplicateOf: canonical.id,
      });
    if (table === "catalog") {
      const replaced = new Set(others.map((o) => o.id));
      for (const previous of await store.list<Offer>("catalog"))
        if (previous.duplicateOf && replaced.has(previous.duplicateOf))
          await store.put("catalog", previous.id, {
            ...previous,
            duplicateOf: canonical.id,
          });
    }
  } finally {
    for (const release of releases.reverse()) await release();
  }
}
