import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  appointments,
  contactPoints,
  contacts,
  customerMerges,
  customers,
  duplicateCandidates,
  notes,
  pipelineStages,
  quotes,
  stageChanges,
  tasks,
  timelineEvents,
  trajects,
  users,
} from "@/db/schema";
import { normalizePhone, normalizePostcode } from "@/lib/normalize";

/** Zoekconditie op klant: naam, plaats, postcode, e-mail, telefoon, offertenummer. */
export function customerSearchCondition(q: string): SQL | undefined {
  const term = q.trim();
  if (!term) return undefined;
  const like = `%${term.toLowerCase()}%`;
  const conds: SQL[] = [
    sql`lower(${customers.displayName}) like ${like}`,
    sql`lower(coalesce(${customers.city}, '')) like ${like}`,
    sql`exists (select 1 from ${contacts} where ${contacts.customerId} = ${customers.id} and lower(coalesce(${contacts.firstName},'') || ' ' || coalesce(${contacts.infix} || ' ','') || coalesce(${contacts.lastName},'')) like ${like})`,
    sql`exists (select 1 from ${contactPoints} where ${contactPoints.customerId} = ${customers.id} and ${contactPoints.deletedAt} is null and lower(${contactPoints.normalized}) like ${like})`,
    sql`exists (select 1 from ${quotes} where ${quotes.customerId} = ${customers.id} and lower(coalesce(${quotes.number},'')) like ${like})`,
  ];
  const pc = normalizePostcode(term) ?? (term.replace(/\s/g, "").length >= 4 ? term.replace(/\s/g, "").toUpperCase() : null);
  if (pc && /^\d{4}/.test(pc)) conds.push(sql`${customers.postcode} like ${pc + "%"}`);
  const phone = normalizePhone(term);
  if (phone) conds.push(sql`exists (select 1 from ${contactPoints} where ${contactPoints.customerId} = ${customers.id} and ${contactPoints.normalized} = ${phone})`);
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 6) {
    const tail = digits.replace(/^0+/, "");
    conds.push(sql`exists (select 1 from ${contactPoints} where ${contactPoints.customerId} = ${customers.id} and ${contactPoints.kind} = 'phone' and ${contactPoints.normalized} like ${"%" + tail + "%"})`);
  }
  const num = term.match(/^#?(\d{1,7})$/);
  if (num) conds.push(sql`exists (select 1 from ${trajects} t2 where t2.customer_id = ${customers.id} and t2.number = ${Number(num[1])})`);
  return or(...conds);
}

export interface BoardCard {
  id: string;
  number: number;
  stage: string;
  version: number;
  customerId: string;
  name: string;
  city: string | null;
  quoteAmount: string | null;
  quoteNumber: string | null;
  nextAppointmentAt: Date | null;
  nextAppointmentTitle: string | null;
  nextTaskTitle: string | null;
  nextTaskDueAt: Date | null;
  openTasks: number;
  hasDuplicate: boolean;
  stageChangedAt: Date;
  lostReason: string | null;
}

export async function getBoard(db: DbOrTx, opts: { q?: string; showLost?: boolean } = {}) {
  const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.active, true)).orderBy(asc(pipelineStages.position));
  const visible = stages.filter((s) => opts.showLost || s.kind !== "lost");
  const where: SQL[] = [isNull(trajects.deletedAt), inArray(trajects.stage, visible.map((s) => s.key))];
  const search = opts.q ? customerSearchCondition(opts.q) : undefined;
  if (search) where.push(search);
  // Afgerond/Vervallen: alleen het laatste jaar op het bord (archief via zoeken).
  where.push(
    sql`(${trajects.stage} not in (select key from ${pipelineStages} where kind in ('done','lost')) or ${trajects.stageChangedAt} > now() - interval '365 days' or ${opts.q ? sql`true` : sql`false`})`,
  );

  const rows = await db
    .select({
      id: trajects.id,
      number: trajects.number,
      stage: trajects.stage,
      version: trajects.version,
      customerId: customers.id,
      name: customers.displayName,
      city: sql<string | null>`coalesce(${trajects.siteCity}, ${customers.city})`,
      stageChangedAt: trajects.stageChangedAt,
      lostReason: trajects.lostReason,
      quoteAmount: sql<string | null>`(select q.amount_incl::text from ${quotes} q where q.traject_id = ${trajects.id} and q.deleted_at is null order by q.quote_date desc nulls last, q.created_at desc limit 1)`,
      quoteNumber: sql<string | null>`(select q.number from ${quotes} q where q.traject_id = ${trajects.id} and q.deleted_at is null order by q.quote_date desc nulls last, q.created_at desc limit 1)`,
      nextAppointmentAt: sql<Date | null>`(select a.starts_at from ${appointments} a where a.traject_id = ${trajects.id} and a.deleted_at is null and a.status = 'gepland' and a.ends_at >= now() order by a.starts_at limit 1)`,
      nextAppointmentTitle: sql<string | null>`(select a.title from ${appointments} a where a.traject_id = ${trajects.id} and a.deleted_at is null and a.status = 'gepland' and a.ends_at >= now() order by a.starts_at limit 1)`,
      nextTaskTitle: sql<string | null>`(select t.title from ${tasks} t where t.traject_id = ${trajects.id} and t.deleted_at is null and t.done_at is null order by t.due_at asc nulls last, t.created_at limit 1)`,
      nextTaskDueAt: sql<Date | null>`(select t.due_at from ${tasks} t where t.traject_id = ${trajects.id} and t.deleted_at is null and t.done_at is null order by t.due_at asc nulls last, t.created_at limit 1)`,
      openTasks: sql<number>`(select count(*)::int from ${tasks} t where t.traject_id = ${trajects.id} and t.deleted_at is null and t.done_at is null)`,
      hasDuplicate: sql<boolean>`exists (select 1 from ${duplicateCandidates} d join ${customers} o on o.id = case when d.customer_a_id = ${customers.id} then d.customer_b_id else d.customer_a_id end where d.status = 'open' and o.merged_into_id is null and (d.customer_a_id = ${customers.id} or d.customer_b_id = ${customers.id}))`,
    })
    .from(trajects)
    .innerJoin(customers, eq(customers.id, trajects.customerId))
    .where(and(...where))
    .orderBy(desc(trajects.stageChangedAt))
    .limit(1000);

  const cards: BoardCard[] = rows.map((r) => ({
    ...r,
    nextAppointmentAt: r.nextAppointmentAt ? new Date(r.nextAppointmentAt) : null,
    nextTaskDueAt: r.nextTaskDueAt ? new Date(r.nextTaskDueAt) : null,
    stageChangedAt: new Date(r.stageChangedAt),
  }));
  return { stages, visible, cards };
}

export async function getTrajectDetail(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ traject: trajects, customer: customers })
    .from(trajects)
    .innerJoin(customers, eq(customers.id, trajects.customerId))
    .where(eq(trajects.id, id));
  if (!row) return null;
  const customerId = row.customer.id;
  const [cts, cps, tks, nts, apps, qts, timeline, otherTrajects, dups, changes, stages] = await Promise.all([
    db.select().from(contacts).where(and(eq(contacts.customerId, customerId), isNull(contacts.deletedAt))).orderBy(desc(contacts.isPrimary), asc(contacts.createdAt)),
    db.select().from(contactPoints).where(and(eq(contactPoints.customerId, customerId), isNull(contactPoints.deletedAt))).orderBy(desc(contactPoints.isPrimary), asc(contactPoints.createdAt)),
    db.select().from(tasks).where(and(eq(tasks.trajectId, id), isNull(tasks.deletedAt))).orderBy(sql`${tasks.doneAt} is not null`, sql`${tasks.dueAt} asc nulls last`),
    db.select().from(notes).where(and(eq(notes.trajectId, id), isNull(notes.deletedAt))).orderBy(desc(notes.createdAt)),
    db.select().from(appointments).where(and(eq(appointments.trajectId, id), isNull(appointments.deletedAt))).orderBy(asc(appointments.startsAt)),
    db.select().from(quotes).where(and(eq(quotes.trajectId, id), isNull(quotes.deletedAt))).orderBy(desc(quotes.createdAt)),
    db
      .select({ e: timelineEvents, actor: users.name, actorEmail: users.email })
      .from(timelineEvents)
      .leftJoin(users, eq(users.id, timelineEvents.actorUserId))
      .where(or(eq(timelineEvents.trajectId, id), and(eq(timelineEvents.customerId, customerId), isNull(timelineEvents.trajectId))))
      .orderBy(desc(timelineEvents.occurredAt), desc(timelineEvents.createdAt))
      .limit(500),
    db.select().from(trajects).where(and(eq(trajects.customerId, customerId), isNull(trajects.deletedAt))).orderBy(desc(trajects.createdAt)),
    openDuplicatesFor(db, customerId),
    db.select().from(stageChanges).where(eq(stageChanges.trajectId, id)).orderBy(desc(stageChanges.createdAt)),
    db.select().from(pipelineStages).where(eq(pipelineStages.active, true)).orderBy(asc(pipelineStages.position)),
  ]);
  return {
    ...row,
    contacts: cts,
    contactPoints: cps,
    tasks: tks,
    notes: nts,
    appointments: apps,
    quotes: qts,
    timeline,
    otherTrajects,
    duplicates: dups,
    stageChanges: changes,
    stages,
  };
}

export async function openDuplicatesFor(db: DbOrTx, customerId: string) {
  return db
    .select({ id: duplicateCandidates.id, score: duplicateCandidates.score, a: duplicateCandidates.customerAId, b: duplicateCandidates.customerBId })
    .from(duplicateCandidates)
    .where(
      and(
        eq(duplicateCandidates.status, "open"),
        or(eq(duplicateCandidates.customerAId, customerId), eq(duplicateCandidates.customerBId, customerId)),
        sql`not exists (select 1 from ${customers} c where c.id in (${duplicateCandidates.customerAId}, ${duplicateCandidates.customerBId}) and c.merged_into_id is not null)`,
      ),
    );
}

export async function getCustomerDetail(db: DbOrTx, id: string) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, id));
  if (!customer) return null;
  const [cts, cps, trs, dups, merges, timeline] = await Promise.all([
    db.select().from(contacts).where(and(eq(contacts.customerId, id), isNull(contacts.deletedAt))).orderBy(desc(contacts.isPrimary), asc(contacts.createdAt)),
    db.select().from(contactPoints).where(and(eq(contactPoints.customerId, id), isNull(contactPoints.deletedAt))).orderBy(desc(contactPoints.isPrimary), asc(contactPoints.createdAt)),
    db.select().from(trajects).where(and(eq(trajects.customerId, id), isNull(trajects.deletedAt))).orderBy(desc(trajects.createdAt)),
    openDuplicatesFor(db, id),
    db
      .select({ m: customerMerges, mergedName: customers.displayName })
      .from(customerMerges)
      .innerJoin(customers, eq(customers.id, customerMerges.mergedId))
      .where(and(eq(customerMerges.survivorId, id), isNull(customerMerges.undoneAt)))
      .orderBy(desc(customerMerges.createdAt)),
    db.select().from(timelineEvents).where(eq(timelineEvents.customerId, id)).orderBy(desc(timelineEvents.occurredAt)).limit(300),
  ]);
  return { customer, contacts: cts, contactPoints: cps, trajects: trs, duplicates: dups, merges, timeline };
}

export async function listCustomers(db: DbOrTx, q: string, limit = 100) {
  const where: SQL[] = [isNull(customers.mergedIntoId), isNull(customers.deletedAt)];
  const s = customerSearchCondition(q);
  if (s) where.push(s);
  return db
    .select({
      id: customers.id,
      name: customers.displayName,
      city: customers.city,
      postcode: customers.postcode,
      street: customers.street,
      houseNumber: customers.houseNumber,
      addition: customers.houseNumberAddition,
      anonymizedAt: customers.anonymizedAt,
      email: sql<string | null>`(select value from ${contactPoints} where customer_id = ${customers.id} and kind = 'email' and deleted_at is null order by is_primary desc, created_at limit 1)`,
      phone: sql<string | null>`(select value from ${contactPoints} where customer_id = ${customers.id} and kind = 'phone' and deleted_at is null order by is_primary desc, created_at limit 1)`,
      trajectCount: sql<number>`(select count(*)::int from ${trajects} where customer_id = ${customers.id} and deleted_at is null)`,
    })
    .from(customers)
    .where(and(...where))
    .orderBy(asc(customers.displayName))
    .limit(limit);
}

export async function listOpenDuplicates(db: DbOrTx) {
  const a = sql.raw("ca");
  const b = sql.raw("cb");
  return db.execute<{ id: string; score: number; signals: unknown; created_at: Date; a_id: string; a_name: string; b_id: string; b_name: string }>(sql`
    select d.id, d.score, d.signals, d.created_at, ${a}.id as a_id, ${a}.display_name as a_name, ${b}.id as b_id, ${b}.display_name as b_name
    from ${duplicateCandidates} d
    join ${customers} ${a} on ${a}.id = d.customer_a_id
    join ${customers} ${b} on ${b}.id = d.customer_b_id
    where d.status = 'open' and ${a}.merged_into_id is null and ${b}.merged_into_id is null
      and ${a}.deleted_at is null and ${b}.deleted_at is null
    order by d.score desc, d.created_at desc
  `);
}

export async function getDuplicate(db: DbOrTx, id: string) {
  const [d] = await db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, id));
  if (!d) return null;
  const [a, b] = await Promise.all([getCustomerDetail(db, d.customerAId), getCustomerDetail(db, d.customerBId)]);
  return { duplicate: d, a: a!, b: b! };
}

export async function getMyTasks(db: DbOrTx) {
  return db
    .select({
      task: tasks,
      trajectNumber: trajects.number,
      trajectStage: trajects.stage,
      customerName: customers.displayName,
      city: customers.city,
    })
    .from(tasks)
    .innerJoin(trajects, eq(trajects.id, tasks.trajectId))
    .innerJoin(customers, eq(customers.id, trajects.customerId))
    .where(and(isNull(tasks.deletedAt), isNull(tasks.doneAt), isNull(trajects.deletedAt)))
    .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt));
}

/** Lopende trajecten zonder open taak: die verdienen aandacht. */
export async function trajectsWithoutAction(db: DbOrTx) {
  return db
    .select({ id: trajects.id, number: trajects.number, stage: trajects.stage, name: customers.displayName, city: customers.city })
    .from(trajects)
    .innerJoin(customers, eq(customers.id, trajects.customerId))
    .where(
      and(
        isNull(trajects.deletedAt),
        sql`${trajects.stage} in (select key from ${pipelineStages} where kind in ('open','won'))`,
        sql`not exists (select 1 from ${tasks} t where t.traject_id = ${trajects.id} and t.done_at is null and t.deleted_at is null)`,
      ),
    )
    .orderBy(asc(trajects.stageChangedAt));
}
