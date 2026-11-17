import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { contactPoints, contacts, customers, duplicateCandidates, trajects } from "@/db/schema";
import { decide, scoreMatch, type MatchProfile, type MatchResult, type MatchSettings } from "@/lib/matching/score";
import type { LeadInput } from "@/lib/intake/types";
import {
  displayName,
  lastNameKey,
  normalizeAddition,
  normalizeEmail,
  normalizePhone,
  normalizePostcode,
  splitDutchName,
  streetKey,
  tidyCity,
} from "@/lib/normalize";
import { lastNameSimilarity } from "@/lib/matching/similarity";
import { getMatchSettings } from "./settings";
import { addTimeline } from "./timeline";

export interface Candidate {
  customerId: string;
  result: MatchResult;
}

export interface MatchOutcome {
  decision: "auto" | "doubt" | "none";
  best: Candidate | null;
  doubts: Candidate[];
}

/** Bouwt het matchprofiel van een binnenkomende lead. */
export function leadProfile(lead: LeadInput): MatchProfile {
  return {
    emails: lead.emails,
    phones: lead.phones,
    postcode: lead.postcode,
    houseNumber: lead.houseNumber,
    addition: lead.addition,
    streetKey: streetKey(lead.street),
    city: lead.city,
    names: lead.person.lastName ? [{ infix: lead.person.infix, lastName: lead.person.lastName }] : [],
  };
}

const activeCustomer = () =>
  and(isNull(customers.mergedIntoId), isNull(customers.deletedAt), isNull(customers.anonymizedAt));

/** Haalt klanten op die minstens één hard signaal delen (of naam, als instellingen dat toestaan). */
export async function findCandidateIds(db: DbOrTx, p: MatchProfile, s: MatchSettings, excludeIds: string[] = []): Promise<string[]> {
  const conds: SQL[] = [];
  const cpConds: SQL[] = [];
  if (p.emails.length) cpConds.push(and(eq(contactPoints.kind, "email"), inArray(contactPoints.normalized, p.emails))!);
  if (p.phones.length) cpConds.push(and(eq(contactPoints.kind, "phone"), inArray(contactPoints.normalized, p.phones))!);
  if (cpConds.length) {
    conds.push(
      sql`exists (select 1 from ${contactPoints} where ${contactPoints.customerId} = ${customers.id} and ${contactPoints.deletedAt} is null and (${or(...cpConds)}))`,
    );
  }
  if (p.postcode) {
    conds.push(eq(customers.postcode, p.postcode));
    conds.push(
      sql`exists (select 1 from ${trajects} where ${trajects.customerId} = ${customers.id} and ${trajects.sitePostcode} = ${p.postcode})`,
    );
  }
  if (p.streetKey && p.houseNumber) {
    conds.push(and(eq(customers.streetKey, p.streetKey), eq(customers.houseNumber, p.houseNumber))!);
  }
  if (s.nameOnlyCap >= s.doubtThreshold) {
    for (const n of p.names) {
      const key = lastNameKey(n.lastName);
      if (key)
        conds.push(
          sql`exists (select 1 from ${contacts} where ${contacts.customerId} = ${customers.id} and ${contacts.deletedAt} is null and similarity(${contacts.lastNameKey}, ${key}) > 0.5)`,
        );
    }
  }
  if (!conds.length) return [];
  const where = [activeCustomer(), or(...conds)];
  if (excludeIds.length) where.push(sql`${customers.id} not in ${excludeIds}`);
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(...where))
    .limit(50);
  return rows.map((r) => r.id);
}

/** Laadt matchprofielen van bestaande klanten. */
export async function loadProfiles(db: DbOrTx, ids: string[]): Promise<Map<string, MatchProfile>> {
  const out = new Map<string, MatchProfile>();
  if (!ids.length) return out;
  const custs = await db.select().from(customers).where(inArray(customers.id, ids));
  const cps = await db
    .select()
    .from(contactPoints)
    .where(and(inArray(contactPoints.customerId, ids), isNull(contactPoints.deletedAt)));
  const cts = await db
    .select()
    .from(contacts)
    .where(and(inArray(contacts.customerId, ids), isNull(contacts.deletedAt)));
  const sites = await db
    .select()
    .from(trajects)
    .where(and(inArray(trajects.customerId, ids), isNull(trajects.deletedAt)));
  for (const c of custs) {
    out.set(c.id, {
      emails: cps.filter((x) => x.customerId === c.id && x.kind === "email").map((x) => x.normalized),
      phones: cps.filter((x) => x.customerId === c.id && x.kind === "phone").map((x) => x.normalized),
      postcode: c.postcode,
      houseNumber: c.houseNumber,
      addition: c.houseNumberAddition,
      streetKey: c.streetKey,
      city: c.city,
      names: cts.filter((x) => x.customerId === c.id).map((x) => ({ infix: x.infix, lastName: x.lastName })),
      extraAddresses: sites
        .filter((t) => t.customerId === c.id && (t.sitePostcode || t.siteStreet))
        .map((t) => ({
          postcode: t.sitePostcode,
          houseNumber: t.siteHouseNumber,
          addition: t.siteHouseNumberAddition,
          streetKey: streetKey(t.siteStreet),
        })),
    });
  }
  return out;
}

export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Paren die eerder als "Niet dezelfde" zijn gemarkeerd. */
export async function notSamePairs(db: DbOrTx, ids: string[]): Promise<Set<string>> {
  if (ids.length < 2) return new Set();
  const rows = await db
    .select({ a: duplicateCandidates.customerAId, b: duplicateCandidates.customerBId })
    .from(duplicateCandidates)
    .where(
      and(
        eq(duplicateCandidates.status, "not_same"),
        inArray(duplicateCandidates.customerAId, ids),
        inArray(duplicateCandidates.customerBId, ids),
      ),
    );
  return new Set(rows.map((r) => `${r.a}|${r.b}`));
}

export async function matchProfile(db: DbOrTx, profile: MatchProfile, opts: { excludeIds?: string[] } = {}): Promise<MatchOutcome> {
  const s = await getMatchSettings(db);
  const ids = await findCandidateIds(db, profile, s, opts.excludeIds ?? []);
  const profiles = await loadProfiles(db, ids);
  const cands: Candidate[] = [];
  for (const [customerId, p] of profiles) {
    const result = scoreMatch(profile, p, s);
    if (result.decision !== "none") cands.push({ customerId, result });
  }
  const d = decide(cands);
  if (d.decision === "doubt") {
    // Meerdere auto-kandidaten die eerder als "niet dezelfde" zijn beoordeeld:
    // dan is de hoogst scorende de juiste.
    const autos = d.doubts.filter((c) => c.result.decision === "auto");
    if (autos.length > 1) {
      const [top, ...rest] = autos;
      const ns = await notSamePairs(db, autos.map((c) => c.customerId));
      const allNotSame = rest.every((r) => ns.has(orderedPair(top.customerId, r.customerId).join("|")));
      if (allNotSame && rest.every((r) => r.result.score < top.result.score)) {
        return { decision: "auto", best: top, doubts: [] };
      }
    }
  }
  return d;
}

/** Legt een "Mogelijk dubbel" vast, tenzij het paar al is beoordeeld. */
export async function recordDuplicate(db: DbOrTx, a: string, b: string, result: MatchResult, origin: string) {
  if (a === b) return;
  const [x, y] = orderedPair(a, b);
  await db
    .insert(duplicateCandidates)
    .values({ customerAId: x, customerBId: y, score: result.score, signals: result.signals, origin })
    .onConflictDoUpdate({
      target: [duplicateCandidates.customerAId, duplicateCandidates.customerBId],
      set: { score: result.score, signals: result.signals, updatedAt: new Date() },
      // Een eerder besluit (niet_dezelfde / samengevoegd) blijft staan.
      setWhere: sql`${duplicateCandidates.status} = 'open'`,
    });
}

/** Maakt een nieuwe klant aan vanuit een (genormaliseerde) lead. */
export async function createCustomerFromLead(db: DbOrTx, lead: LeadInput, source: string): Promise<string> {
  const name = displayName(lead.person) || lead.name || lead.emails[0] || lead.phones[0] || "Onbekende klant";
  const [c] = await db
    .insert(customers)
    .values({
      displayName: name,
      street: lead.street,
      houseNumber: lead.houseNumber,
      houseNumberAddition: lead.addition,
      postcode: lead.postcode,
      city: lead.city,
      streetKey: streetKey(lead.street),
      source,
    })
    .returning({ id: customers.id });
  let contactId: string | null = null;
  if (lead.person.lastName || lead.person.firstName) {
    const [ct] = await db
      .insert(contacts)
      .values({
        customerId: c.id,
        firstName: lead.person.firstName,
        infix: lead.person.infix,
        lastName: lead.person.lastName,
        lastNameKey: lastNameKey(lead.person.lastName),
        isPrimary: true,
      })
      .returning({ id: contacts.id });
    contactId = ct.id;
  }
  await addContactPoints(db, c.id, contactId, lead, true);
  return c.id;
}

async function addContactPoints(db: DbOrTx, customerId: string, contactId: string | null, lead: LeadInput, primary: boolean) {
  const rows = [
    ...lead.emails.map((e, i) => ({ kind: "email", value: i === 0 && lead.rawEmail ? lead.rawEmail.trim() : e, normalized: e })),
    ...lead.phones.map((t, i) => ({ kind: "phone", value: i === 0 && lead.rawPhone ? lead.rawPhone.trim() : t, normalized: t })),
  ];
  if (!rows.length) return [];
  const existing = await db
    .select({ kind: contactPoints.kind, normalized: contactPoints.normalized })
    .from(contactPoints)
    .where(and(eq(contactPoints.customerId, customerId), isNull(contactPoints.deletedAt)));
  const have = new Set(existing.map((e) => `${e.kind}:${e.normalized}`));
  const toAdd = rows.filter((r) => !have.has(`${r.kind}:${r.normalized}`));
  if (!toAdd.length) return [];
  const hasKind = (k: string) => existing.some((e) => e.kind === k);
  await db.insert(contactPoints).values(
    toAdd.map((r) => ({
      customerId,
      contactId,
      kind: r.kind,
      value: r.value,
      normalized: r.normalized,
      isPrimary: primary && !hasKind(r.kind),
    })),
  );
  return toAdd;
}

/**
 * Verrijkt een bestaande klant met nieuwe gegevens uit een lead (bij automatisch
 * koppelen). Overschrijft nooit bestaande gegevens; afwijkingen komen in de tijdlijn.
 */
export async function enrichCustomer(db: DbOrTx, customerId: string, lead: LeadInput, trajectId: string | null) {
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
  const changes: string[] = [];

  // Nieuwe persoon (bv. partner met eigen achternaam)?
  let contactId: string | null = null;
  if (lead.person.lastName) {
    const cts = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.customerId, customerId), isNull(contacts.deletedAt)));
    const same = cts.find(
      (x) =>
        lastNameSimilarity({ infix: x.infix, lastName: x.lastName }, { infix: lead.person.infix, lastName: lead.person.lastName }) >= 0.92 &&
        (!x.firstName || !lead.person.firstName || x.firstName[0]?.toLowerCase() === lead.person.firstName[0]?.toLowerCase()),
    );
    if (same) contactId = same.id;
    else {
      const [ct] = await db
        .insert(contacts)
        .values({
          customerId,
          firstName: lead.person.firstName,
          infix: lead.person.infix,
          lastName: lead.person.lastName,
          lastNameKey: lastNameKey(lead.person.lastName),
          isPrimary: cts.length === 0,
        })
        .returning({ id: contacts.id });
      contactId = ct.id;
      changes.push(`Contactpersoon toegevoegd: ${displayName(lead.person)}`);
    }
  }

  const added = await addContactPoints(db, customerId, contactId, lead, false);
  for (const a of added) changes.push(`${a.kind === "email" ? "E-mailadres" : "Telefoonnummer"} toegevoegd: ${a.value}`);

  // Adres aanvullen als dat ontbrak; afwijkend adres alleen melden.
  if (!c.postcode && lead.postcode) {
    await db
      .update(customers)
      .set({
        postcode: lead.postcode,
        houseNumber: c.houseNumber ?? lead.houseNumber,
        houseNumberAddition: c.houseNumberAddition ?? lead.addition,
        street: c.street ?? lead.street,
        streetKey: c.streetKey ?? streetKey(lead.street),
        city: c.city ?? lead.city,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId));
    changes.push("Adres aangevuld");
  } else if (!c.houseNumber && lead.houseNumber && c.postcode === lead.postcode) {
    await db
      .update(customers)
      .set({ houseNumber: lead.houseNumber, houseNumberAddition: lead.addition, street: c.street ?? lead.street, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
    changes.push("Huisnummer aangevuld");
  } else if (lead.postcode && c.postcode && lead.postcode !== c.postcode) {
    changes.push(
      `Let op: ander adres opgegeven: ${[lead.street, lead.houseNumber, lead.addition].filter(Boolean).join(" ")} ${lead.postcode} ${lead.city ?? ""}`.trim(),
    );
  }

  if (changes.length) {
    await addTimeline(db, { customerId, trajectId, type: "klant_bijgewerkt", title: "Klantgegevens aangevuld", body: changes.join("\n") });
  }
}

/** Werkt "Mogelijk dubbel"-meldingen bij voor een klant (na bewerken of aanmaken). */
export async function refreshDuplicatesFor(db: DbOrTx, customerId: string, origin = "bewerking") {
  const profiles = await loadProfiles(db, [customerId]);
  const p = profiles.get(customerId);
  if (!p) return;
  const s = await getMatchSettings(db);
  const ids = await findCandidateIds(db, p, s, [customerId]);
  const others = await loadProfiles(db, ids);
  for (const [otherId, op] of others) {
    const r = scoreMatch(p, op, s);
    if (r.decision !== "none") await recordDuplicate(db, customerId, otherId, r, origin);
  }
}

export function leadFromForm(f: {
  name?: string | null;
  firstName?: string | null;
  infix?: string | null;
  lastName?: string | null;
  email?: string | null;
  email2?: string | null;
  phone?: string | null;
  phone2?: string | null;
  street?: string | null;
  houseNumber?: number | null;
  addition?: string | null;
  postcode?: string | null;
  city?: string | null;
  message?: string | null;
}): LeadInput {
  const person =
    f.lastName || f.firstName
      ? { firstName: f.firstName || null, infix: f.infix || null, lastName: f.lastName || null }
      : splitDutchName(f.name ?? "");
  const emails = [f.email, f.email2].map((e) => normalizeEmail(e)).filter((x): x is string => !!x);
  const phones = [f.phone, f.phone2].map((t) => normalizePhone(t)).filter((x): x is string => !!x);
  return {
    name: f.name ?? displayName(person),
    person,
    emails: [...new Set(emails)],
    phones: [...new Set(phones)],
    rawEmail: f.email ?? null,
    rawPhone: f.phone ?? null,
    street: f.street?.trim() || null,
    houseNumber: f.houseNumber ?? null,
    addition: normalizeAddition(f.addition ?? ""),
    postcode: f.postcode ? normalizePostcode(f.postcode) : null,
    city: f.city ? tidyCity(f.city) : null,
    message: f.message ?? null,
  };
}
