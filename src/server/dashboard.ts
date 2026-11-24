import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments } from "@/db/schema";
import { parseLocation, parseMontageTitle } from "@/lib/parsers/calendar";
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
  /** Huidige maand als "JJJJ-MM". */
  month: string;
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
    month: string;
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
      to_char(p.today, 'YYYY-MM') as month,
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
    month: row?.month ?? now.toISOString().slice(0, 7),
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

export interface UnlinkedAppointment {
  id: string;
  kind: string;
  title: string;
  startsAt: Date;
  allDay: boolean;
  location: string | null;
  /** Velden om "Nieuwe klant" alvast mee in te vullen. */
  prefill: Record<string, string>;
}

/**
 * Herkende agenda-afspraken (adviesgesprek of montage) die Atlas aan geen klant
 * kon koppelen, van de afgelopen 60 dagen en later. Zo valt een klant die
 * alleen in de agenda staat (bijv. "Fam. Pater") niet stilletjes weg.
 */
export async function getUnlinkedAppointments(db: DbOrTx, now: Date = new Date()): Promise<UnlinkedAppointment[]> {
  const since = new Date(now.getTime() - 60 * 86400000);
  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        isNull(appointments.customerId),
        isNull(appointments.trajectId),
        isNull(appointments.deletedAt),
        eq(appointments.status, "gepland"),
        inArray(appointments.kind, ["advies", "montage"]),
        gte(appointments.endsAt, since),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(50);
  return rows.map((a) => {
    const prefill: Record<string, string> = { appointmentId: a.id };
    if (a.kind === "montage") {
      const c = parseMontageTitle(a.title)[0];
      if (c?.name) prefill.lastName = c.name;
      if (c?.street) prefill.street = c.street;
      if (c?.houseNumber) prefill.houseNumber = String(c.houseNumber);
      if (c?.addition) prefill.addition = c.addition;
    }
    const loc = parseLocation(a.location);
    if (loc?.street) prefill.street = loc.street;
    if (loc?.houseNumber) prefill.houseNumber = String(loc.houseNumber);
    if (loc?.addition) prefill.addition = loc.addition;
    if (loc?.postcode) prefill.postcode = loc.postcode;
    if (loc?.city) prefill.city = loc.city;
    const when = a.startsAt.toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long" });
    prefill.message = `${a.kind === "montage" ? "Montage" : "Adviesgesprek"} op ${when} (uit de agenda: ${a.title})`;
    return { id: a.id, kind: a.kind, title: a.title, startsAt: a.startsAt, allDay: a.allDay, location: a.location, prefill };
  });
}

export interface BestCustomerRow {
  customerId: string;
  name: string;
  city: string | null;
  /** Trajecten van deze klant met montage in de gekozen maand (meestal één). */
  trajectIds: string[];
  saleExcl: number;
  purchaseExcl: number;
  margin: number;
  montageDays: number;
  marginPerDay: number;
}

export interface BestCustomerOfMonth {
  /** Gekozen maand als "JJJJ-MM". */
  month: string;
  /** Maanden om uit te kiezen (nieuwste eerst): de huidige maand plus alle maanden met een montage. */
  months: string[];
  /** Klanten gesorteerd op marge per dag, hoogste eerst. */
  ranking: BestCustomerRow[];
  /** Trajecten met montage in deze maand die niet meetellen omdat verkoop, inkoop of montagedagen ontbreken. */
  incomplete: number;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Widget "Beste klant van de maand": welke klant leverde de hoogste gemiddelde
 * marge per montagedag op? Zelfde regels als de rest van Atlas:
 *  - verkoop = WeFact-offerte (geaccepteerd gaat voor), anders handmatige prijs;
 *  - inkoop = som van de gekoppelde inkooporders;
 *  - montagedagen = handmatig, anders afgeleid uit de geplande montage-afspraken;
 *  - een traject telt in de maand waarin de (eerste) montage begint.
 * Heeft een klant meerdere trajecten in de maand, dan is het gemiddelde
 * totale marge ÷ totale montagedagen. Vervallen/verwijderde trajecten tellen niet.
 */
export async function getBestCustomerOfMonth(db: DbOrTx, month?: string | null, now: Date = new Date()): Promise<BestCustomerOfMonth> {
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
  const chosen = month && MONTH_RE.test(month) ? month : current;
  const monthStart = `${chosen}-01`;

  const rows = await db.execute<{
    traject_id: string;
    customer_id: string;
    name: string;
    city: string | null;
    sale: string | null;
    purchase: string | null;
    days: number | null;
  }>(sql`
    with t as (
      select tr.id, tr.customer_id,
        (select min((a.starts_at at time zone 'Europe/Amsterdam')::date) from appointments a
          where a.traject_id = tr.id and a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null) as montage_date
      from trajects tr
      join pipeline_stages ps on ps.key = tr.stage
      where tr.deleted_at is null and ps.kind <> 'lost'
    )
    select t.id as traject_id, c.id as customer_id, c.display_name as name, coalesce(tr.site_city, c.city) as city,
      coalesce(
        (select q.amount_excl from quotes q
          where q.traject_id = t.id and q.deleted_at is null and q.amount_excl is not null
          order by (q.status = 'geaccepteerd') desc, q.quote_date desc nulls last, q.created_at desc
          limit 1),
        tr.sale_amount_excl_manual
      )::text as sale,
      (select sum(p.amount_excl) from purchase_orders p where p.traject_id = t.id and p.deleted_at is null)::text as purchase,
      coalesce(tr.montage_days_manual, (
        select nullif(count(distinct d), 0)::int from appointments a,
          generate_series((a.starts_at at time zone 'Europe/Amsterdam')::date,
                          ((a.ends_at - interval '1 second') at time zone 'Europe/Amsterdam')::date, interval '1 day') d
        where a.traject_id = t.id and a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null)) as days
    from t
    join trajects tr on tr.id = t.id
    join customers c on c.id = t.customer_id
    where t.montage_date >= ${monthStart}::date and t.montage_date < (${monthStart}::date + interval '1 month')
      and c.deleted_at is null
  `);

  const byCustomer = new Map<string, BestCustomerRow>();
  let incomplete = 0;
  for (const r of rows) {
    const days = r.days === null ? 0 : Number(r.days);
    if (r.sale === null || r.purchase === null || !(days > 0)) {
      incomplete++;
      continue;
    }
    const row =
      byCustomer.get(r.customer_id) ??
      { customerId: r.customer_id, name: r.name, city: r.city, trajectIds: [], saleExcl: 0, purchaseExcl: 0, margin: 0, montageDays: 0, marginPerDay: 0 };
    row.trajectIds.push(r.traject_id);
    row.saleExcl += Number(r.sale);
    row.purchaseExcl += Number(r.purchase);
    row.montageDays += days;
    byCustomer.set(r.customer_id, row);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const ranking = [...byCustomer.values()]
    .map((r) => {
      const margin = round2(r.saleExcl - r.purchaseExcl);
      return { ...r, saleExcl: round2(r.saleExcl), purchaseExcl: round2(r.purchaseExcl), margin, marginPerDay: round2(margin / r.montageDays) };
    })
    .sort((a, b) => b.marginPerDay - a.marginPerDay || b.margin - a.margin || a.name.localeCompare(b.name, "nl"));

  const monthRows = await db.execute<{ m: string }>(sql`
    select distinct to_char((a.starts_at at time zone 'Europe/Amsterdam'), 'YYYY-MM') as m
      from appointments a join trajects tr on tr.id = a.traject_id
     where a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null and tr.deleted_at is null
  `);
  const months = [...new Set([current, chosen, ...monthRows.map((r) => r.m)])].sort().reverse();

  return { month: chosen, months, ranking, incomplete };
}

export interface RevenueLine {
  trajectId: string;
  trajectNumber: number;
  customerId: string;
  name: string;
  city: string | null;
  /** Eerste montagedag (JJJJ-MM-DD, Nederlandse tijd). */
  montageDate: string;
  /** Verkoopbedrag excl. btw, of null als er nog geen bedrag bekend is. */
  amount: number | null;
}

export interface RevenueBreakdown {
  /** Gekozen periode: "JJJJ-MM" (maand) of "JJJJ" (jaar). */
  period: string;
  kind: "month" | "year";
  /** Voor het lopende jaar telt Atlas t/m de huidige maand (zoals de tegel "Omzet JJJJ"). */
  untilMonth: string | null;
  /** Keuzes voor het menu, nieuwste eerst: eerst de jaren, dan de maanden. */
  years: string[];
  months: string[];
  total: number;
  /** Klanten met hun trajecten, grootste bedrag eerst. Trajecten zonder bedrag onderaan. */
  lines: RevenueLine[];
  withoutAmount: number;
  monthlyTarget: number;
  /** Percentage van het maanddoel (alleen bij een maand met doel). */
  targetPct: number | null;
}

const YEAR_RE = /^\d{4}$/;

/**
 * Welke klanten zorgen voor de omzet van een maand of jaar? Zelfde regels als
 * de tegels in "Bedrijfsstand": verkoopbedrag = WeFact-offerte (geaccepteerd
 * gaat voor), anders handmatige prijs; omzet telt in de maand waarin de eerste
 * geplande montage begint; vervallen en verwijderde trajecten tellen niet.
 */
export async function getRevenueBreakdown(db: DbOrTx, period?: string | null, now: Date = new Date()): Promise<RevenueBreakdown> {
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
  const chosen = period && (MONTH_RE.test(period) || YEAR_RE.test(period)) ? period : current;
  const kind = YEAR_RE.test(chosen) ? "year" : "month";
  const from = kind === "year" ? `${chosen}-01-01` : `${chosen}-01`;
  const untilMonth = kind === "year" && chosen === current.slice(0, 4) ? current : null;
  // Eind (exclusief): volgende maand, of volgend jaar; lopend jaar t/m de huidige maand.
  const to = untilMonth ? sql`(${`${untilMonth}-01`}::date + interval '1 month')` : kind === "year" ? sql`(${from}::date + interval '1 year')` : sql`(${from}::date + interval '1 month')`;

  const rows = await db.execute<{
    traject_id: string;
    number: number;
    customer_id: string;
    name: string;
    city: string | null;
    montage_date: string;
    amount: string | null;
  }>(sql`
    with t as (
      select tr.id, tr.number, tr.customer_id, tr.site_city, tr.sale_amount_excl_manual,
        (select min((a.starts_at at time zone 'Europe/Amsterdam')::date) from appointments a
          where a.traject_id = tr.id and a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null) as montage_date
      from trajects tr
      join pipeline_stages ps on ps.key = tr.stage
      where tr.deleted_at is null and ps.kind <> 'lost'
    )
    select t.id as traject_id, t.number, c.id as customer_id, c.display_name as name, coalesce(t.site_city, c.city) as city,
      to_char(t.montage_date, 'YYYY-MM-DD') as montage_date,
      coalesce(
        (select q.amount_excl from quotes q
          where q.traject_id = t.id and q.deleted_at is null and q.amount_excl is not null
          order by (q.status = 'geaccepteerd') desc, q.quote_date desc, q.created_at desc
          limit 1),
        t.sale_amount_excl_manual
      )::text as amount
    from t
    join customers c on c.id = t.customer_id
    where t.montage_date >= ${from}::date and t.montage_date < ${to}
  `);

  const lines: RevenueLine[] = rows
    .map((r) => ({
      trajectId: r.traject_id,
      trajectNumber: Number(r.number),
      customerId: r.customer_id,
      name: r.name,
      city: r.city,
      montageDate: r.montage_date,
      amount: r.amount === null ? null : Number(r.amount),
    }))
    .sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || a.montageDate.localeCompare(b.montageDate) || a.name.localeCompare(b.name, "nl"));
  const total = Math.round(lines.reduce((s, l) => s + (l.amount ?? 0), 0) * 100) / 100;

  const monthRows = await db.execute<{ m: string }>(sql`
    select distinct to_char((a.starts_at at time zone 'Europe/Amsterdam'), 'YYYY-MM') as m
      from appointments a join trajects tr on tr.id = a.traject_id
     where a.kind = 'montage' and a.status = 'gepland' and a.deleted_at is null and tr.deleted_at is null
  `);
  const months = [...new Set([current, ...(kind === "month" ? [chosen] : []), ...monthRows.map((r) => r.m)])].sort().reverse();
  const years = [...new Set([...months.map((m) => m.slice(0, 4)), ...(kind === "year" ? [chosen] : [])])].sort().reverse();

  const target = Number((await getSetting(db, "dashboard")).monthlyRevenueTarget) || 0;
  return {
    period: chosen,
    kind,
    untilMonth,
    years,
    months,
    total,
    lines,
    withoutAmount: lines.filter((l) => l.amount === null).length,
    monthlyTarget: target,
    targetPct: kind === "month" && target > 0 ? Math.round((total / target) * 100) : null,
  };
}
