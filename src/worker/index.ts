import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getAccessToken } from "../server/integrations/google-oauth";
import { liveGmail } from "../server/integrations/gmail-client";
import { liveCalendar } from "../server/integrations/calendar-client";
import { liveWefact } from "../server/integrations/wefact-client";
import { syncGmail } from "../server/integrations/gmail-sync";
import { syncCalendar } from "../server/integrations/calendar-sync";
import { syncWefact } from "../server/integrations/wefact-sync";
import { runDaily } from "../server/daily";
import { decrypt } from "../server/crypto";
import { getIntegration, isDue, runTracked, type Provider } from "../server/integrations/state";
import { deliverPending, liveSender } from "../server/notify";

/**
 * Achtergrondproces: draait elke 30 seconden en start synchronisaties die aan
 * de beurt zijn. Na een fout wacht een koppeling steeds langer (1, 2, 4 … 60 min).
 * Alles is idempotent, dus een herstart of dubbele run kan geen kwaad.
 */
const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const INTERVALS: Record<Exclude<Provider, "google" | "push" | "google_maps">, number> = { gmail: 2, google_calendar: 2, wefact: 15, dagelijks: 60 };

async function tick() {
  const db = getDb();
  // Eén worker tegelijk (ook als er bij een update even twee draaien): een "huurcontract" van 5 minuten.
  const lease = JSON.stringify({ id: WORKER_ID, until: new Date(Date.now() + 5 * 60000).toISOString() });
  const got = await db.execute(sql`
    insert into settings (key, value) values ('worker_lease', ${lease}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where (settings.value->>'until')::timestamptz < now() or settings.value->>'id' = ${WORKER_ID}
    returning key`);
  if (!got.length) return;
  {
    const google = await getIntegration(db, "google");
    const googleOk = !!google?.encryptedTokens;

    if (googleOk && isDue(await getIntegration(db, "gmail"))) {
      await runTracked(db, "gmail", "incremental", INTERVALS.gmail, async () => {
        const { token, account } = await getAccessToken(db);
        return syncGmail(db, liveGmail(token, account));
      });
    }
    if (googleOk && isDue(await getIntegration(db, "google_calendar"))) {
      await runTracked(db, "google_calendar", "incremental", INTERVALS.google_calendar, async () => {
        const { token, account } = await getAccessToken(db);
        return syncCalendar(db, liveCalendar(token, account));
      });
    }
    const wefact = await getIntegration(db, "wefact");
    if (wefact?.encryptedTokens && isDue(wefact)) {
      await runTracked(db, "wefact", "incremental", INTERVALS.wefact, async () => syncWefact(db, liveWefact(decrypt(wefact.encryptedTokens!))));
    }
    if (isDue(await getIntegration(db, "dagelijks"))) {
      await runTracked(db, "dagelijks", "daily", INTERVALS.dagelijks, async () => {
        let gmail = null;
        if (googleOk) {
          const { token, account } = await getAccessToken(db);
          gmail = liveGmail(token, account);
        }
        return runDaily(db, gmail);
      });
    }
    // Meldingen versturen die klaarstaan (bv. "Nieuwe aanvraag" van de Gmail-ronde hierboven).
    try {
      await deliverPending(db, await liveSender(db));
    } catch (e) {
      console.error("meldingen:", e);
    }
  }
}

async function main() {
  console.log("Atlas-worker gestart");
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error("worker:", e);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

void main();
