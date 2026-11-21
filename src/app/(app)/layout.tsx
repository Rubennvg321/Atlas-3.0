import { sql } from "drizzle-orm";
import { Nav } from "@/components/nav";
import { getDb } from "@/db";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const db = getDb();
  const [counts] = await db.execute<{ dups: number; overdue: number }>(sql`
    select
      (select count(*)::int from duplicate_candidates d
         join customers a on a.id = d.customer_a_id join customers b on b.id = d.customer_b_id
        where d.status = 'open' and a.merged_into_id is null and b.merged_into_id is null) as dups,
      (select count(*)::int from tasks t join trajects tr on tr.id = t.traject_id
        where t.done_at is null and t.deleted_at is null and tr.deleted_at is null
          and (t.due_at at time zone 'Europe/Amsterdam')::date < (now() at time zone 'Europe/Amsterdam')::date) as overdue
  `);
  return (
    <>
      <Nav duplicateCount={counts?.dups ?? 0} overdueCount={counts?.overdue ?? 0} />
      <main className="mx-auto max-w-[1600px] px-3 pb-28 pt-4 md:px-4 md:pb-10">{children}</main>
    </>
  );
}
