import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  appointments,
  contactPoints,
  contacts,
  customers,
  emails,
  inboundItems,
  notes,
  quotes,
  tasks,
  timelineEvents,
  trajects,
} from "@/db/schema";
import {
  displayName,
  lastNameKey,
  normalizeAddition,
  normalizeEmail,
  normalizePhone,
  normalizePostcode,
  streetKey,
  tidyCity,
} from "@/lib/normalize";
import { refreshDuplicatesFor } from "./customers";
import { DomainError, NotFoundError } from "./errors";
import { addTimeline, audit } from "./timeline";

export async function updateCustomer(
  db: DbOrTx,
  id: string,
  data: { displayName: string; street?: string | null; houseNumber?: number | null; addition?: string | null; postcode?: string | null; city?: string | null; notes?: string | null },
  userId?: string | null,
) {
  if (!data.displayName.trim()) throw new DomainError("Naam is verplicht.");
  const postcode = data.postcode ? normalizePostcode(data.postcode) : null;
  if (data.postcode && !postcode) throw new DomainError(`Ongeldige postcode: ${data.postcode}`);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(customers)
      .set({
        displayName: data.displayName.trim(),
        street: data.street?.trim() || null,
        streetKey: streetKey(data.street),
        houseNumber: data.houseNumber ?? null,
        houseNumberAddition: normalizeAddition(data.addition),
        postcode,
        city: tidyCity(data.city),
        notes: data.notes?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();
    if (!c) throw new NotFoundError("Klant");
    await addTimeline(tx, { customerId: id, type: "klant_bijgewerkt", title: "Klantgegevens gewijzigd", actorUserId: userId });
    await refreshDuplicatesFor(tx, id);
    return c;
  });
}

export async function addContactPoint(db: DbOrTx, customerId: string, kind: "email" | "phone", value: string, userId?: string | null) {
  const normalized = kind === "email" ? normalizeEmail(value) : normalizePhone(value);
  if (!normalized) throw new DomainError(kind === "email" ? `Ongeldig e-mailadres: ${value}` : `Ongeldig telefoonnummer: ${value}`);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(contactPoints)
      .where(and(eq(contactPoints.customerId, customerId), eq(contactPoints.normalized, normalized), isNull(contactPoints.deletedAt)));
    if (existing.length) return existing[0];
    const hasKind = (
      await tx
        .select()
        .from(contactPoints)
        .where(and(eq(contactPoints.customerId, customerId), eq(contactPoints.kind, kind), isNull(contactPoints.deletedAt)))
    ).length;
    const [cp] = await tx
      .insert(contactPoints)
      .values({ customerId, kind, value: value.trim(), normalized, isPrimary: !hasKind })
      .returning();
    await addTimeline(tx, {
      customerId,
      type: "klant_bijgewerkt",
      title: `${kind === "email" ? "E-mailadres" : "Telefoonnummer"} toegevoegd: ${value.trim()}`,
      actorUserId: userId,
    });
    await refreshDuplicatesFor(tx, customerId);
    return cp;
  });
}

export async function removeContactPoint(db: DbOrTx, id: string, userId?: string | null) {
  const [cp] = await db.update(contactPoints).set({ deletedAt: new Date() }).where(eq(contactPoints.id, id)).returning();
  if (cp)
    await addTimeline(db, {
      customerId: cp.customerId,
      type: "klant_bijgewerkt",
      title: `${cp.kind === "email" ? "E-mailadres" : "Telefoonnummer"} verwijderd: ${cp.value}`,
      actorUserId: userId,
    });
}

export async function addContact(
  db: DbOrTx,
  customerId: string,
  p: { firstName?: string | null; infix?: string | null; lastName?: string | null; role?: string | null },
  userId?: string | null,
) {
  if (!p.lastName?.trim() && !p.firstName?.trim()) throw new DomainError("Vul een naam in.");
  return db.transaction(async (tx) => {
    const [ct] = await tx
      .insert(contacts)
      .values({
        customerId,
        firstName: p.firstName?.trim() || null,
        infix: p.infix?.trim().toLowerCase() || null,
        lastName: p.lastName?.trim() || null,
        lastNameKey: lastNameKey(p.lastName),
        role: p.role?.trim() || null,
      })
      .returning();
    await addTimeline(tx, {
      customerId,
      type: "klant_bijgewerkt",
      title: `Contactpersoon toegevoegd: ${displayName({ firstName: ct.firstName, infix: ct.infix, lastName: ct.lastName })}`,
      actorUserId: userId,
    });
    await refreshDuplicatesFor(tx, customerId);
    return ct;
  });
}

export async function removeContact(db: DbOrTx, id: string) {
  await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, id));
}

// ---------------------------------------------------------------------------
// AVG: export en anonimiseren
// ---------------------------------------------------------------------------

export async function exportCustomer(db: DbOrTx, id: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw new NotFoundError("Klant");
  const by = <T extends { customerId: unknown }>(t: T) => eq(t.customerId as never, id);
  const [cts, cps, trs, tks, nts, apps, qts, ems, tl] = await Promise.all([
    db.select().from(contacts).where(by(contacts)),
    db.select().from(contactPoints).where(by(contactPoints)),
    db.select().from(trajects).where(by(trajects)),
    db.select().from(tasks).where(by(tasks)),
    db.select().from(notes).where(by(notes)),
    db.select().from(appointments).where(by(appointments)),
    db.select().from(quotes).where(by(quotes)),
    db.select().from(emails).where(by(emails)),
    db.select().from(timelineEvents).where(by(timelineEvents)),
  ]);
  return {
    geexporteerdOp: new Date().toISOString(),
    klant: c,
    contactpersonen: cts,
    contactgegevens: cps,
    trajecten: trs,
    taken: tks,
    notities: nts,
    afspraken: apps,
    offertes: qts,
    emails: ems,
    tijdlijn: tl,
  };
}

/**
 * Vervangt alle persoonsgegevens; bedragen, fases en datums blijven bewaard
 * voor de statistiek. Onomkeerbaar.
 */
export async function anonymizeCustomer(db: DbOrTx, id: string, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, id)).for("update");
    if (!c) throw new NotFoundError("Klant");
    if (c.anonymizedAt) return;
    const label = `Geanonimiseerd ${id.slice(0, 8)}`;
    await tx
      .update(customers)
      .set({
        displayName: label,
        street: null,
        streetKey: null,
        houseNumber: null,
        houseNumberAddition: null,
        // Postcodecijfers blijven voor regionale statistiek; letters weg.
        postcode: c.postcode ? c.postcode.slice(0, 4) : null,
        notes: null,
        anonymizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id));
    await tx.update(contacts).set({ firstName: null, infix: null, lastName: "Geanonimiseerd", lastNameKey: null }).where(eq(contacts.customerId, id));
    await tx.update(contactPoints).set({ value: "verwijderd", normalized: `anon:${crypto.randomUUID()}`, deletedAt: new Date() }).where(eq(contactPoints.customerId, id));
    await tx
      .update(trajects)
      .set({ description: null, siteStreet: null, siteHouseNumber: null, siteHouseNumberAddition: null, sitePostcode: null, siteCity: null, lostNote: null })
      .where(eq(trajects.customerId, id));
    await tx.update(notes).set({ body: "(geanonimiseerd)" }).where(eq(notes.customerId, id));
    await tx.update(tasks).set({ title: "(geanonimiseerd)" }).where(eq(tasks.customerId, id));
    await tx.update(timelineEvents).set({ body: null, payload: null }).where(eq(timelineEvents.customerId, id));
    await tx.update(emails).set({ fromAddress: null, toAddresses: null, subject: null, snippet: null }).where(eq(emails.customerId, id));
    await tx.update(appointments).set({ title: "(geanonimiseerd)", location: null }).where(eq(appointments.customerId, id));
    await tx.update(inboundItems).set({ payload: {} }).where(eq(inboundItems.customerId, id));
    await audit(tx, userId, "anonymize", "customer", id);
  });
}
