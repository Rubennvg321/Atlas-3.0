import { sql } from "drizzle-orm";
import type { DbOrTx } from "./index";
import { pipelineStages, settings } from "./schema";
import { DEFAULT_SETTINGS } from "../lib/settings-defaults";

export const DEFAULT_STAGES = [
  { key: "lead", label: "Lead", position: 1, kind: "open", color: "sky" },
  { key: "afspraak", label: "Afspraak", position: 2, kind: "open", color: "amber" },
  { key: "offerte", label: "Offerte", position: 3, kind: "open", color: "violet" },
  { key: "opdracht", label: "Opdracht", position: 4, kind: "won", color: "emerald" },
  { key: "montage", label: "Montage", position: 5, kind: "won", color: "rose" },
  { key: "afgerond", label: "Afgerond", position: 6, kind: "done", color: "slate" },
  { key: "vervallen", label: "Vervallen", position: 99, kind: "lost", color: "zinc" },
] as const;

/** Idempotent: overschrijft geen instellingen die al zijn aangepast. */
export async function seedDefaults(db: DbOrTx) {
  await db.insert(pipelineStages).values([...DEFAULT_STAGES]).onConflictDoNothing();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoNothing();
  }
  await db.execute(sql`select 1`);
}
