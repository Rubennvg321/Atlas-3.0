import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { getSetting } from "./settings";

/**
 * Cijfers voor de widget "Bedrijfsstand" op het dashboard. Alle bedragen excl. btw.
 *
 * Verkoopbedrag per traject = dezelfde regel als op de detailpagina
 * (`getTrajectFinance`): WeFact-offerte (geaccepteerd gaat voor), anders de
 * handmatig ingevulde prijs. Omzet telt in de maand waarin de montage begint.
 * Vervallen en verwijderde trajecten tellen nergens mee.
 */
export interface BusinessStats {
  year: number;
  revenueMonth: number;
  revenueYear: number;
  plannedRevenue: number;
  /** Trajecten in de geplande omzet zonder bekend bedrag. */
  plannedWithoutAmount: number;
  newLeadsMonth: number;
  accepted: number;
  montagesPlanned: number;
  monthlyTarget: number;
  /** Percentage van het maanddoel, of null als er geen doel is ingesteld. */
  targetPct: number | null;
}

export async function getBusinessStats(db: DbOrTx, now: Date = new Date()): Promise<BusinessStats> {
  const nowIso = now.toISOString();
  const [row] = await db.execute<{
    year: number;
    revenue_month: string | null;
    revenue_year: string | null;
    planned_revenue: string | null;
    planned_without_amount: number;
    new_leads: number;
    accepted: number;
    montages_planned: number;
  }>(sql`
    with p as (
      select d as today,
             date_trunc('month', d)::date as month_start,
             (date_trunc('month', d) + interval '1 month')::date as next_month,
             date_trunc('year', d)::date as year_start
        from (select (${nowIso}::timestamptz at time zone 'Europe/Amsterdam')::date as d) x
    ),
    t as (
      select tr.id, ps.kind,
        coalesce(
          (select q.amount_excl from quotes q
            where q.traject_id = tr.id and q.deleted_at is null and q.amount_excl is not null
            order by (q.status = 'geaccepteerd') desc, q.quote_date desc, q.created_at desc
            limit 1),
          tr.sale_amount_excl_manual
        ) as amount,
        (select min((a.starts_at at time zone 'Europe/Amsterdam')::date) from appointments a
          where a.traject_id = tr.id and a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null) as montage_date,
        exists (select 1 from appointments a, p
          where a.traject_id = tr.id and a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null
            and (a.starts_at at time zone 'Europe/Amsterdam')::date >= p.today) as has_future_montage
      from trajects tr
      join pipeline_stages ps on ps.key = tr.stage
      where tr.deleted_at is null and ps.kind <> 'lost'
    )
    select
      extract(year from p.today)::int as year,
      (select sum(amount) from t where montage_date >= p.month_start and montage_date < p.next_month) as revenue_month,
      (select sum(amount) from t where montage_date >= p.year_start and montage_date < p.next_month) as revenue_year,
      (select sum(amount) from t where kind = 'won' and (montage_date is null or montage_date >= p.next_month)) as planned_revenue,
      (select count(*)::int from t where kind = 'won' and amount is null and (montage_date is null or montage_date >= p.next_month)) as planned_without_amount,
      (select count(*)::int from trajects tr where tr.deleted_at is null
          and (tr.created_at at time zone 'Europe/Amsterdam')::date >= p.month_start) as new_leads,
      (select count(*)::int from t where kind = 'won') as accepted,
      (select count(*)::int from t where has_future_montage) as montages_planned
    from p
  `);
  const target = Number((await getSetting(db, "dashboard")).monthlyRevenueTarget) || 0;
  const revenueMonth = Number(row?.revenue_month ?? 0);
  return {
    year: row?.year ?? now.getFullYear(),
    revenueMonth,
    revenueYear: Number(row?.revenue_year ?? 0),
    plannedRevenue: Number(row?.planned_revenue ?? 0),
    plannedWithoutAmount: row?.planned_without_amount ?? 0,
    newLeadsMonth: row?.new_leads ?? 0,
    accepted: row?.accepted ?? 0,
    montagesPlanned: row?.montages_planned ?? 0,
    monthlyTarget: target,
    targetPct: target > 0 ? Math.round((revenueMonth / target) * 100) : null,
  };
}
