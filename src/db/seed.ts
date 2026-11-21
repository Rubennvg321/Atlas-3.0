import "dotenv/config";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "./index";
import { runMigrations } from "./migrate";
import { leadFromForm } from "../server/customers";
import { intakeLead } from "../server/intake";
import { changeStage } from "../server/trajects";
import { createTask } from "../server/tasks";
import { addManualPurchase } from "../server/purchases";
import { setManualFinance } from "../server/finance";
import { quotes } from "./schema";

/** Demo-gegevens (fictief) voor lokaal testen. Leegt eerst de database. */
async function main() {
  await runMigrations();
  const db = getDb();
  await db.execute(sql`
    truncate table purchase_orders, audit_log, sync_runs, external_refs, integrations, inbound_items, customer_merges,
      duplicate_candidates, timeline_events, emails, notes, tasks, quotes, appointments, stage_proposals,
      stage_changes, trajects, contact_points, contacts, customers restart identity cascade
  `);
  const day = (n: number) => new Date(Date.now() + n * 86400000);
  const people = [
    { f: { name: "Peter Jansen", email: "p.jansen@example.nl", phone: "0612345678", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB", city: "Nijmegen", message: "Trap bekleden met PVC" }, stage: "offerte_gemaakt", task: ["Offerte nabellen", day(-2)] },
    { f: { name: "Fatima El Amrani", email: "fatima@example.nl", phone: "0623456789", street: "Molenweg", houseNumber: 4, postcode: "6542AA", city: "Nijmegen" }, stage: "offerte_gepland", task: ["Adviesgesprek voorbereiden", day(1)] },
    { f: { name: "Jan van der Berg", email: "jan@example.nl", phone: "0243456789", street: "Dorpsstraat", houseNumber: 3, addition: "a", postcode: "6661AB", city: "Elst" }, stage: "lead", task: null },
    { f: { name: "Anna de Vries-Bakker", phone: "0634567890", postcode: "6663PP", houseNumber: 21, street: "Tintorettohof", city: "Lent" }, stage: "offerte_geaccepteerd", task: ["Materiaal bestellen", day(3)] },
    { f: { name: "Kees Meijer", email: "kees@example.nl", postcode: "6821AB", houseNumber: 9, street: "Velperweg", city: "Arnhem" }, stage: "montage_gepland", task: ["Montage 2 dagen", day(7)] },
    { f: { name: "Sanne Bakker", email: "sanne@example.nl", phone: "0687654321", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB", city: "Nijmegen" }, stage: "lead", task: ["Terugbellen", day(0)] },
  ] as const;
  for (const p of people) {
    const r = await intakeLead(db, leadFromForm(p.f), { provider: "handmatig", externalId: `seed-${p.f.name}` });
    if (r.trajectId && p.stage !== "lead") await changeStage(db, { trajectId: r.trajectId, toStage: p.stage, source: "manual" });
    if (r.trajectId && p.task) await createTask(db, { trajectId: r.trajectId, title: p.task[0], dueAt: p.task[1] });
    if (r.trajectId && p.f.name === "Anna de Vries-Bakker") {
      await db.insert(quotes).values({ trajectId: r.trajectId, customerId: r.customerId, number: "OF2026-0076", amountExcl: "6347.10", status: "geaccepteerd" });
      await addManualPurchase(db, { trajectId: r.trajectId, supplier: "PPC", orderNumber: "26510197", amountExcl: 2344.54 });
      await setManualFinance(db, r.trajectId, { montageDays: 2 });
    }
  }
  console.log("Demo-gegevens geladen");
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
