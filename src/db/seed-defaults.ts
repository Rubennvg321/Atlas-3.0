import { sql } from "drizzle-orm";
import type { DbOrTx } from "./index";
import { pipelineStages, settings } from "./schema";
import { DEFAULT_SETTINGS } from "../lib/settings-defaults";

/**
 * Fases zoals de kaartenbak van Steps & Stairs. De `key` is vast (gebruikt door
 * de automatische regels); label, volgorde en kleur zijn aan te passen.
 *  open = loopt nog, won = opdracht binnen, done = klaar, lost = vervallen (archief)
 */
export const DEFAULT_STAGES = [
  { key: "in_afwachting", label: "In afwachting", position: 1, kind: "open", color: "zinc" },
  { key: "lead", label: "Lead", position: 2, kind: "open", color: "sky" },
  { key: "offerte_gepland", label: "Offerte gepland", position: 3, kind: "open", color: "amber" },
  { key: "offerte_gemaakt", label: "Offerte gemaakt", position: 4, kind: "open", color: "violet" },
  { key: "offerte_geaccepteerd", label: "Offerte geaccepteerd", position: 5, kind: "won", color: "emerald" },
  { key: "montage_gepland", label: "Montage gepland", position: 6, kind: "won", color: "rose" },
  { key: "materiaal_besteld", label: "Materiaal besteld", position: 7, kind: "won", color: "orange" },
  { key: "in_uitvoering", label: "In uitvoering", position: 8, kind: "won", color: "teal" },
  { key: "review_gestuurd", label: "Review gestuurd", position: 9, kind: "done", color: "indigo" },
  { key: "review_ontvangen", label: "Review ontvangen", position: 10, kind: "done", color: "slate" },
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
