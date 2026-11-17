import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { seedDefaults } from "@/db/seed-defaults";
import type { LeadInput } from "@/lib/intake/types";
import { leadFromForm } from "@/server/customers";

export const db = () => getDb();

export async function resetDb() {
  const d = getDb();
  await d.execute(sql`
    truncate table audit_log, sync_runs, external_refs, integrations, inbound_items, customer_merges,
      duplicate_candidates, timeline_events, emails, notes, tasks, quotes, appointments, stage_proposals,
      stage_changes, trajects, contact_points, contacts, customers, settings restart identity cascade
  `);
  await seedDefaults(d);
}

let n = 0;
export const uid = (p = "t") => `${p}-${Date.now()}-${++n}`;

export function lead(f: Parameters<typeof leadFromForm>[0]): LeadInput {
  return leadFromForm(f);
}
