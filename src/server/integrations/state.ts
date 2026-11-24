import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { integrations, syncRuns } from "@/db/schema";

/** Koppelingen: google (tokens), gmail, google_calendar, wefact, dagelijks, google_maps (adres zoeken). */
export type Provider = "google" | "gmail" | "google_calendar" | "wefact" | "dagelijks" | "push" | "google_maps";

export interface IntegrationConfig {
  nextRunAt?: string;
  failures?: number;
  [k: string]: unknown;
}

export async function getIntegration(db: DbOrTx, provider: Provider) {
  const [row] = await db.select().from(integrations).where(eq(integrations.provider, provider));
  return row ?? null;
}

export async function upsertIntegration(db: DbOrTx, provider: Provider, data: Partial<typeof integrations.$inferInsert>) {
  await db
    .insert(integrations)
    .values({ provider, ...data })
    .onConflictDoUpdate({ target: integrations.provider, set: { ...data, updatedAt: new Date() } });
}

export function cfg(row: { config: unknown } | null): IntegrationConfig {
  return ((row?.config as IntegrationConfig) ?? {}) as IntegrationConfig;
}

/** Oplopende wachttijd na fouten: 1, 2, 4, 8 … max 60 minuten. */
export function backoffMinutes(failures: number) {
  return Math.min(60, 2 ** Math.max(0, failures - 1));
}

/** Zet een fout om in een begrijpelijke melding. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid_grant|Token has been expired|revoked/i.test(msg)) return "De koppeling met Google is verlopen of ingetrokken. Koppel Google opnieuw via Koppelingen.";
  if (/insufficient|PERMISSION_DENIED|403/i.test(msg)) return "Atlas heeft niet genoeg rechten. Koppel opnieuw en geef alle gevraagde toestemmingen.";
  if (/ip.*(not|niet).*(allowed|toegestaan)|whitelist/i.test(msg)) return "WeFact weigert de verbinding: controleer of IP-adres 51.15.84.246 op de whitelist staat.";
  if (/api.?key|ongeldige.*sleutel|authentication/i.test(msg)) return "De WeFact API-sleutel klopt niet. Vul hem opnieuw in via Koppelingen.";
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket/i.test(msg)) return "Geen verbinding met de dienst. Atlas probeert het automatisch opnieuw.";
  if (/rate|quota|429/i.test(msg)) return "Te veel verzoeken achter elkaar. Atlas probeert het later automatisch opnieuw.";
  return `Er ging iets mis: ${msg.slice(0, 200)}`;
}

/** Voert een synchronisatie uit en legt het resultaat vast (laatste succes, fout, wachttijd). */
export async function runTracked(
  db: DbOrTx,
  provider: Provider,
  kind: string,
  intervalMinutes: number,
  fn: () => Promise<number>,
): Promise<{ ok: boolean; items: number; error?: string }> {
  const [run] = await db.insert(syncRuns).values({ provider, kind }).returning();
  const row = await getIntegration(db, provider);
  const c = cfg(row);
  try {
    const items = await fn();
    await db.update(syncRuns).set({ status: "ok", itemsProcessed: items, finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    await upsertIntegration(db, provider, {
      status: "gekoppeld",
      lastSuccessAt: new Date(),
      lastError: null,
      config: { ...cfg(await getIntegration(db, provider)), failures: 0, nextRunAt: new Date(Date.now() + intervalMinutes * 60000).toISOString() },
    });
    return { ok: true, items };
  } catch (e) {
    const failures = (c.failures ?? 0) + 1;
    const message = friendlyError(e);
    await db
      .update(syncRuns)
      .set({ status: "error", errorMessage: message, errorDetail: e instanceof Error ? (e.stack ?? e.message).slice(0, 4000) : String(e), finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    await upsertIntegration(db, provider, {
      status: /verlopen|ingetrokken|API-sleutel/.test(message) ? "verlopen" : "fout",
      lastErrorAt: new Date(),
      lastError: message,
      config: { ...cfg(await getIntegration(db, provider)), failures, nextRunAt: new Date(Date.now() + backoffMinutes(failures) * 60000).toISOString() },
    });
    return { ok: false, items: 0, error: message };
  }
}

export function isDue(row: { config: unknown } | null, now = new Date()) {
  const next = cfg(row).nextRunAt;
  return !next || new Date(next) <= now;
}
