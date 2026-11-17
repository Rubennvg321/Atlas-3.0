import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_SETTINGS, type SettingsShape } from "@/lib/settings-defaults";
import type { MatchSettings } from "@/lib/matching/score";

export async function getSetting<K extends keyof SettingsShape>(db: DbOrTx, key: K): Promise<SettingsShape[K]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return DEFAULT_SETTINGS[key];
  // Nieuwe standaardvelden aanvullen als een opgeslagen instelling ouder is.
  return deepMerge(DEFAULT_SETTINGS[key], row.value) as SettingsShape[K];
}

export async function setSetting(db: DbOrTx, key: keyof SettingsShape, value: unknown, userId?: string | null) {
  await db
    .insert(settings)
    .values({ key, value, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date(), updatedBy: userId ?? null } });
}

export async function getMatchSettings(db: DbOrTx): Promise<MatchSettings> {
  return (await getSetting(db, "matching")) as unknown as MatchSettings;
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (base && typeof base === "object" && over && typeof over === "object") {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
    return out;
  }
  return over ?? base;
}
