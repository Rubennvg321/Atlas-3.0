"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/server/session";
import { DomainError } from "@/server/errors";
import { changeStage, createTraject, softDeleteTraject, updateTrajectDetails, type LostReason } from "@/server/trajects";
import { intakeLead } from "@/server/intake";
import { leadFromForm } from "@/server/customers";
import { addNote, createTask, deleteTask, setTaskDone } from "@/server/tasks";
import { markNotSame, mergeCustomers, undoMerge } from "@/server/merge";
import { addContact, addContactPoint, anonymizeCustomer, removeContact, removeContactPoint, updateCustomer } from "@/server/customer-edit";
import { commitImport, previewImport, type ImportSummary } from "@/server/import";
import { setSetting } from "@/server/settings";
import { duplicateCandidates, pipelineStages, quotes, trajects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { normalizeAddition, normalizePostcode, tidyCity } from "@/lib/normalize";
import { EVENT_TARGET } from "@/lib/stage-rules";
import { parseEuro } from "@/lib/finance";
import { amsterdamTime } from "@/lib/zoned";
import { setManualFinance } from "@/server/finance";
import { addManualPurchase, deletePurchase, linkPurchase } from "@/server/purchases";
import { decideProposal } from "@/server/automation";
import { liveWefact } from "@/server/integrations/wefact-client";
import { getWefactClient, linkQuoteToTraject } from "@/server/integrations/wefact-sync";
import { addPurchaseDocument, deletePurchaseDocument, validateDocument } from "@/server/purchase-documents";
import { cfg, friendlyError, getIntegration, upsertIntegration, type Provider } from "@/server/integrations/state";
import { decrypt, encrypt } from "@/server/crypto";
import { livePlaces } from "@/server/integrations/places-client";
import type { AddressFields, AddressSuggestion } from "@/lib/places";
import { audit } from "@/server/timeline";
import { linkAppointmentToCustomer } from "@/server/integrations/calendar-sync";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; conflict?: boolean };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, conflict: e.code === "conflict" };
    console.error(e);
    return { ok: false, error: "Er ging iets mis. Probeer het opnieuw." };
  }
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Fase: slepen én dropdown gebruiken exact deze actie
// ---------------------------------------------------------------------------

const moveSchema = z.object({
  trajectId: z.string().uuid(),
  toStage: z.string().min(1),
  expectedVersion: z.number().int().optional(),
  lostReason: z.enum(["te_duur", "geen_reactie", "concurrent", "anders"]).nullish(),
  lostNote: z.string().max(500).nullish(),
});

export async function moveTrajectAction(input: z.infer<typeof moveSchema>): Promise<ActionResult<{ version: number; stage: string }>> {
  const user = await requireUser();
  const p = moveSchema.parse(input);
  const res = await run(async () => {
    const t = await changeStage(getDb(), {
      trajectId: p.trajectId,
      toStage: p.toStage,
      expectedVersion: p.expectedVersion,
      source: "manual",
      userId: user.id,
      lostReason: (p.lostReason ?? null) as LostReason | null,
      lostNote: p.lostNote ?? null,
    });
    return { version: t.version, stage: t.stage };
  });
  revalidatePath("/bord");
  revalidatePath(`/trajecten/${p.trajectId}`);
  return res;
}

// ---------------------------------------------------------------------------
// Klanten
// ---------------------------------------------------------------------------

export async function createCustomerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const pcRaw = str(fd, "postcode");
  if (pcRaw && !normalizePostcode(pcRaw)) return { ok: false, error: `Ongeldige postcode: ${pcRaw}` };
  const lead = leadFromForm({
    firstName: str(fd, "firstName"),
    infix: str(fd, "infix"),
    lastName: str(fd, "lastName"),
    email: str(fd, "email"),
    email2: str(fd, "email2"),
    phone: str(fd, "phone"),
    phone2: str(fd, "phone2"),
    street: str(fd, "street"),
    houseNumber: int(fd, "houseNumber"),
    addition: str(fd, "addition"),
    postcode: pcRaw,
    city: str(fd, "city"),
    message: str(fd, "message"),
  });
  if (!lead.person.lastName && !lead.emails.length && !lead.phones.length) {
    return { ok: false, error: "Vul minimaal een achternaam, e-mailadres of telefoonnummer in." };
  }
  const appointmentId = str(fd, "appointmentId");
  const res = await run(async () => {
    const db = getDb();
    const r = await intakeLead(db, lead, { provider: "handmatig", externalId: crypto.randomUUID(), userId: user.id, traject: fd.get("noTraject") ? "none" : "lead" });
    // Aangemaakt vanuit "Afspraken zonder klant": de agenda-afspraak meteen koppelen.
    if (appointmentId && r.customerId) await linkAppointmentToCustomer(db, appointmentId, r.customerId, r.trajectId);
    return r;
  });
  if (!res.ok) return res;
  const r = res.data!;
  revalidatePath("/bord");
  const melding = r.decision === "auto" ? "gekoppeld" : r.decision === "doubt" ? "dubbel" : "nieuw";
  if (r.trajectId) redirect(`/trajecten/${r.trajectId}?melding=${melding}`);
  redirect(`/klanten/${r.customerId}?melding=${melding}`);
}

export async function updateCustomerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = str(fd, "id")!;
  const res = await run(() =>
    updateCustomer(
      getDb(),
      id,
      {
        displayName: str(fd, "displayName") ?? "",
        street: str(fd, "street"),
        houseNumber: int(fd, "houseNumber"),
        addition: str(fd, "addition"),
        postcode: str(fd, "postcode"),
        city: str(fd, "city"),
        notes: str(fd, "notes"),
      },
      user.id,
    ),
  );
  revalidatePath(`/klanten/${id}`);
  return res.ok ? { ok: true } : res;
}

export async function addContactPointAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const customerId = str(fd, "customerId")!;
  const kind = str(fd, "kind") === "phone" ? "phone" : "email";
  const res = await run(() => addContactPoint(getDb(), customerId, kind, str(fd, "value") ?? "", user.id));
  revalidatePath(`/klanten/${customerId}`);
  return res.ok ? { ok: true } : res;
}

export async function removeContactPointAction(id: string, customerId: string) {
  const user = await requireUser();
  await removeContactPoint(getDb(), id, user.id);
  revalidatePath(`/klanten/${customerId}`);
}

export async function addContactAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const customerId = str(fd, "customerId")!;
  const res = await run(() =>
    addContact(getDb(), customerId, { firstName: str(fd, "firstName"), infix: str(fd, "infix"), lastName: str(fd, "lastName"), role: str(fd, "role") }, user.id),
  );
  revalidatePath(`/klanten/${customerId}`);
  return res.ok ? { ok: true } : res;
}

export async function removeContactAction(id: string, customerId: string) {
  await requireUser();
  await removeContact(getDb(), id);
  revalidatePath(`/klanten/${customerId}`);
}

export async function anonymizeCustomerAction(customerId: string) {
  const user = await requireUser();
  await anonymizeCustomer(getDb(), customerId, user.id);
  revalidatePath(`/klanten/${customerId}`);
  revalidatePath("/bord");
}

// ---------------------------------------------------------------------------
// Trajecten, taken, notities
// ---------------------------------------------------------------------------

export async function newTrajectAction(customerId: string) {
  const user = await requireUser();
  const t = await createTraject(getDb(), { customerId, source: "handmatig" }, { userId: user.id, source: "manual" });
  revalidatePath("/bord");
  redirect(`/trajecten/${t.id}`);
}

export async function updateTrajectAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = str(fd, "id")!;
  const pc = str(fd, "sitePostcode");
  if (pc && !normalizePostcode(pc)) return { ok: false, error: `Ongeldige postcode: ${pc}` };
  const res = await run(() =>
    updateTrajectDetails(
      getDb(),
      id,
      {
        title: str(fd, "title"),
        description: str(fd, "description"),
        siteStreet: str(fd, "siteStreet"),
        siteHouseNumber: int(fd, "siteHouseNumber"),
        siteHouseNumberAddition: normalizeAddition(str(fd, "siteHouseNumberAddition")),
        sitePostcode: pc ? normalizePostcode(pc) : null,
        siteCity: tidyCity(str(fd, "siteCity")),
      },
      user.id,
    ),
  );
  revalidatePath(`/trajecten/${id}`);
  revalidatePath("/bord");
  return res.ok ? { ok: true } : res;
}

export async function deleteTrajectAction(id: string) {
  const user = await requireUser();
  await softDeleteTraject(getDb(), id, user.id);
  revalidatePath("/bord");
  redirect("/bord");
}

export async function addTaskAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const trajectId = str(fd, "trajectId")!;
  const due = str(fd, "dueAt");
  const time = str(fd, "dueTime");
  if (time && !due) return { ok: false, error: "Kies ook een datum bij de tijd." };
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: "Ongeldige datum." };
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "Ongeldige tijd." };
  // Nederlandse tijd (de server draait in UTC). Zonder tijd: einde werkdag, melding om 08:00.
  const dueAt = due ? amsterdamTime(due, time ?? "17:00") : null;
  const res = await run(() => createTask(getDb(), { trajectId, title: str(fd, "title") ?? "", dueAt, dueHasTime: !!time, userId: user.id }));
  revalidatePath(`/trajecten/${trajectId}`);
  revalidatePath("/bord");
  revalidatePath("/taken");
  return res.ok ? { ok: true } : res;
}

export async function toggleTaskAction(taskId: string, done: boolean, path?: string) {
  const user = await requireUser();
  await setTaskDone(getDb(), taskId, done, user.id);
  if (path) revalidatePath(path);
  revalidatePath("/bord");
  revalidatePath("/taken");
}

export async function deleteTaskAction(taskId: string, path: string) {
  await requireUser();
  await deleteTask(getDb(), taskId);
  revalidatePath(path);
  revalidatePath("/bord");
}

export async function addNoteAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const trajectId = str(fd, "trajectId")!;
  const res = await run(() => addNote(getDb(), { trajectId, body: str(fd, "body") ?? "", userId: user.id }));
  revalidatePath(`/trajecten/${trajectId}`);
  return res.ok ? { ok: true } : res;
}

// ---------------------------------------------------------------------------
// Ontdubbelen
// ---------------------------------------------------------------------------

export async function mergeAction(duplicateId: string, survivorId: string): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const [d] = await db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, duplicateId));
  if (!d) return { ok: false, error: "Melding niet gevonden" };
  const mergedId = d.customerAId === survivorId ? d.customerBId : d.customerAId;
  const res = await run(() => mergeCustomers(db, survivorId, mergedId, user.id));
  if (!res.ok) return res;
  revalidatePath("/dubbels");
  revalidatePath("/bord");
  redirect(`/klanten/${survivorId}?melding=samengevoegd`);
}

export async function notSameAction(duplicateId: string): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const [d] = await db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, duplicateId));
  if (!d) return { ok: false, error: "Melding niet gevonden" };
  await markNotSame(db, d.customerAId, d.customerBId, user.id);
  revalidatePath("/dubbels");
  revalidatePath("/bord");
  redirect("/dubbels");
}

export async function undoMergeAction(mergeId: string, customerId: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = await run(() => undoMerge(getDb(), mergeId, user.id));
  revalidatePath(`/klanten/${customerId}`);
  revalidatePath("/bord");
  revalidatePath("/dubbels");
  return res.ok ? { ok: true } : res;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importAction(
  _prev: (ActionResult<ImportSummary> & { mode?: string; csv?: string }) | null,
  fd: FormData,
): Promise<ActionResult<ImportSummary> & { mode?: string; csv?: string }> {
  const user = await requireUser();
  const mode = str(fd, "mode") === "commit" ? "commit" : "preview";
  let csv = str(fd, "csv");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) return { ok: false, error: "Bestand is te groot (max 5 MB)." };
    csv = await file.text();
  }
  if (!csv) return { ok: false, error: "Kies een CSV-bestand of plak de gegevens." };
  const res = await run(() => (mode === "commit" ? commitImport(getDb(), csv!, user.id) : previewImport(getDb(), csv!, user.id)));
  if (mode === "commit") {
    revalidatePath("/bord");
    revalidatePath("/klanten");
  }
  return { ...res, mode, csv };
}

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------

export async function saveMatchingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const n = (k: string) => {
    const v = int(fd, k);
    if (v === null || v < 0 || v > 100) throw new DomainError(`Ongeldige waarde voor ${k} (0–100).`);
    return v;
  };
  return run(async () => {
    const value = {
      weights: {
        address: n("address"),
        addressAdditionMissing: n("addressAdditionMissing"),
        streetHouseNumber: n("streetHouseNumber"),
        postcodeOnly: n("postcodeOnly"),
        phone: n("phone"),
        email: n("email"),
        nameMax: n("nameMax"),
      },
      nameOnlyCap: n("nameOnlyCap"),
      autoThreshold: n("autoThreshold"),
      doubtThreshold: n("doubtThreshold"),
    };
    if (value.doubtThreshold >= value.autoThreshold) throw new DomainError("De twijfeldrempel moet lager zijn dan de auto-drempel.");
    await setSetting(getDb(), "matching", value, user.id);
    revalidatePath("/instellingen");
  });
}

export async function saveStagesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireUser();
  return run(async () => {
    const db = getDb();
    const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.active, true));
    for (const s of stages) {
      const label = str(fd, `label_${s.key}`);
      const position = int(fd, `position_${s.key}`);
      if (!label) throw new DomainError("Elke fase heeft een naam nodig.");
      await db.update(pipelineStages).set({ label, position: position ?? s.position }).where(eq(pipelineStages.key, s.key));
    }
    revalidatePath("/instellingen");
    revalidatePath("/bord");
  });
}

export async function saveAutomationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    const value: Record<string, "automatic" | "proposal"> = {};
    for (const key of Object.keys(EVENT_TARGET)) value[key] = str(fd, key) === "automatic" ? "automatic" : "proposal";
    await setSetting(getDb(), "automation", value, user.id);
    revalidatePath("/instellingen");
  });
}

export async function saveDashboardAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    const target = euroInput(str(fd, "monthlyRevenueTarget")) ?? 0;
    if (target < 0) throw new DomainError("Het omzetdoel kan niet negatief zijn.");
    await setSetting(getDb(), "dashboard", { monthlyRevenueTarget: target }, user.id);
    revalidatePath("/instellingen");
    revalidatePath("/dashboard");
  });
}

// ---------------------------------------------------------------------------
// Financieel, inkoop en voorstellen
// ---------------------------------------------------------------------------

function euroInput(v: string | null): number | null {
  if (!v) return null;
  const n = parseEuro(v);
  if (n === null) throw new DomainError(`Ongeldig bedrag: ${v}`);
  return n;
}

export async function saveFinanceAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const trajectId = str(fd, "trajectId")!;
  const res = await run(async () => {
    const days = int(fd, "montageDays");
    await setManualFinance(getDb(), trajectId, { saleAmountExcl: euroInput(str(fd, "saleAmountExcl")), montageDays: days }, user.id);
  });
  revalidatePath(`/trajecten/${trajectId}`);
  revalidatePath("/bord");
  return res.ok ? { ok: true } : res;
}

export async function addPurchaseAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const trajectId = str(fd, "trajectId")!;
  const res = await run(async () => {
    const amount = euroInput(str(fd, "amountExcl"));
    if (amount === null) throw new DomainError("Vul een bedrag excl. btw in.");
    const choice = str(fd, "supplier") ?? "";
    const supplier = choice === "Anders" ? (str(fd, "supplierOther") ?? "") : choice;
    if (!supplier) throw new DomainError("Vul de naam van de leverancier in.");
    const dateStr = str(fd, "orderDate");
    const orderDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T12:00:00Z`) : null;
    const file = fd.get("file");
    const upload = file && typeof file === "object" && "arrayBuffer" in file && file.size > 0 ? file : null;
    if (upload) validateDocument(upload.name, upload.type, upload.size);
    const p = await addManualPurchase(getDb(), {
      trajectId,
      supplier,
      orderNumber: str(fd, "orderNumber"),
      amountExcl: amount,
      description: str(fd, "description"),
      orderDate,
      userId: user.id,
    });
    if (upload) {
      await addPurchaseDocument(getDb(), {
        purchaseOrderId: p.id,
        kind: "factuur",
        filename: upload.name || "factuur",
        mimeType: upload.type,
        data: Buffer.from(await upload.arrayBuffer()),
        userId: user.id,
      });
    }
  });
  revalidatePath(`/trajecten/${trajectId}`);
  revalidatePath("/bord");
  return res.ok ? { ok: true } : res;
}

export async function uploadPurchaseDocumentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const trajectId = str(fd, "trajectId")!;
  const res = await run(async () => {
    const files = fd.getAll("file").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
    if (!files.length) throw new DomainError("Kies een bestand (PDF of foto).");
    const kind = str(fd, "kind");
    for (const f of files) {
      await addPurchaseDocument(getDb(), {
        purchaseOrderId: str(fd, "purchaseOrderId") ?? "",
        kind: kind === "orderbevestiging" || kind === "overig" ? kind : "factuur",
        filename: f.name || "document",
        mimeType: f.type,
        data: Buffer.from(await f.arrayBuffer()),
        source: "upload",
        userId: user.id,
      });
    }
  });
  revalidatePath(`/trajecten/${trajectId}`);
  return res.ok ? { ok: true } : res;
}

export async function deletePurchaseDocumentAction(documentId: string, trajectId: string) {
  await requireUser();
  await deletePurchaseDocument(getDb(), documentId);
  revalidatePath(`/trajecten/${trajectId}`);
}

export async function deletePurchaseAction(purchaseId: string, trajectId: string) {
  await requireUser();
  await deletePurchase(getDb(), purchaseId);
  revalidatePath(`/trajecten/${trajectId}`);
  revalidatePath("/bord");
}

export async function linkPurchaseAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const res = await run(() => linkPurchase(getDb(), str(fd, "purchaseId")!, str(fd, "trajectId") ?? "", user.id));
  revalidatePath("/taken");
  revalidatePath("/bord");
  return res.ok ? { ok: true } : res;
}

export async function decideProposalAction(proposalId: string, accept: boolean, trajectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = await run(() => decideProposal(getDb(), proposalId, accept, user.id));
  revalidatePath(`/trajecten/${trajectId}`);
  revalidatePath("/bord");
  return res.ok ? { ok: true } : res;
}

// ---------------------------------------------------------------------------
// Koppelingen
// ---------------------------------------------------------------------------

export async function saveWefactKeyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const key = str(fd, "apiKey");
  if (!key) return { ok: false, error: "Vul de API-sleutel in." };
  try {
    await liveWefact(key).listQuotes(0, 1);
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
  await upsertIntegration(getDb(), "wefact", { encryptedTokens: encrypt(key), status: "gekoppeld", lastError: null, config: { nextRunAt: new Date().toISOString() } });
  await audit(getDb(), user.id, "wefact_connect", "integration", "wefact");
  revalidatePath("/koppelingen");
  return { ok: true };
}

export async function saveMapsKeyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const key = str(fd, "apiKey");
  if (!key) return { ok: false, error: "Vul de API-sleutel in." };
  try {
    await livePlaces(key).autocomplete("Kerkstraat 1 Nijmegen", crypto.randomUUID());
  } catch (e) {
    return { ok: false, error: placesError(e) };
  }
  await upsertIntegration(getDb(), "google_maps", { encryptedTokens: encrypt(key), status: "gekoppeld", lastError: null });
  await audit(getDb(), user.id, "google_maps_connect", "integration", "google_maps");
  revalidatePath("/koppelingen");
  return { ok: true };
}

function placesError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/API_KEY_INVALID|API key not valid|400/i.test(msg)) return "Google kent deze API-sleutel niet. Kopieer hem opnieuw uit Google Cloud.";
  if (/PERMISSION_DENIED|403|not been used|disabled|billing/i.test(msg))
    return "Google weigert: zet 'Places API (New)' aan in Google Cloud, koppel een betaalaccount, en controleer dat de sleutel IP-adres 51.15.84.246 toestaat.";
  if (/429|RESOURCE_EXHAUSTED/i.test(msg)) return "Te veel zoekopdrachten. Probeer het over een minuut opnieuw.";
  return friendlyError(e);
}

async function placesClient() {
  const row = await getIntegration(getDb(), "google_maps");
  return row?.encryptedTokens ? livePlaces(decrypt(row.encryptedTokens)) : null;
}

export type AddressSearchResult = { ok: true; configured: boolean; suggestions: AddressSuggestion[] } | { ok: false; error: string };

/** Adres zoeken terwijl je typt (Google). Zonder sleutel: configured=false. */
export async function searchAddressAction(input: string, sessionToken: string): Promise<AddressSearchResult> {
  await requireUser();
  const q = input.trim().slice(0, 200);
  const places = await placesClient();
  if (!places) return { ok: true, configured: false, suggestions: [] };
  if (q.length < 3) return { ok: true, configured: true, suggestions: [] };
  try {
    return { ok: true, configured: true, suggestions: await places.autocomplete(q, sessionToken.slice(0, 64)) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: placesError(e) };
  }
}

export async function addressDetailsAction(placeId: string, sessionToken: string): Promise<ActionResult<AddressFields>> {
  await requireUser();
  const places = await placesClient();
  if (!places) return { ok: false, error: "Adres zoeken staat uit. Zet het aan via Koppelingen." };
  try {
    return { ok: true, data: await places.details(placeId.slice(0, 300), sessionToken.slice(0, 64)) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: placesError(e) };
  }
}

export async function retrySyncAction(provider: string) {
  await requireUser();
  const p = provider as Provider;
  if (!["gmail", "google_calendar", "wefact", "dagelijks"].includes(p)) return;
  const row = await getIntegration(getDb(), p);
  await upsertIntegration(getDb(), p, { config: { ...cfg(row), nextRunAt: new Date().toISOString(), failures: 0 } });
  revalidatePath("/koppelingen");
}

export async function disconnectAction(provider: "google" | "wefact" | "google_maps") {
  const user = await requireUser();
  await upsertIntegration(getDb(), provider, { encryptedTokens: null, status: "niet_gekoppeld", account: null });
  if (provider === "google") for (const p of ["gmail", "google_calendar"] as const) await upsertIntegration(getDb(), p, { status: "niet_gekoppeld" });
  await audit(getDb(), user.id, "disconnect", "integration", provider);
  revalidatePath("/koppelingen");
}

export async function saveReviewSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const link = str(fd, "link");
  if (link && !/^https:\/\//.test(link)) return { ok: false, error: "De reviewlink moet met https:// beginnen." };
  const enabled = fd.get("enabled") === "on";
  if (enabled && !link) return { ok: false, error: "Vul eerst de reviewlink in." };
  const v = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
  await setSetting(getDb(), "reviews", { enabled, link: link ?? "", subject: v("subject"), body: v("body"), reminderSubject: v("reminderSubject"), reminderBody: v("reminderBody") }, user.id);
  revalidatePath("/koppelingen");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Offerte uit WeFact handmatig koppelen
// ---------------------------------------------------------------------------

export async function linkQuoteAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult<{ number: string | null }>> {
  const user = await requireUser();
  const trajectId = str(fd, "trajectId")!;
  let number = str(fd, "quoteNumber");
  const quoteId = str(fd, "quoteId");
  const res = await run(async () => {
    const db = getDb();
    if (!number && quoteId) {
      const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
      number = q?.number ?? null;
    }
    if (!trajectId) throw new DomainError("Kies het traject.");
    const q = await linkQuoteToTraject(db, await getWefactClient(db), trajectId, number ?? "", user.id);
    return { number: q?.number ?? number };
  });
  revalidatePath(`/trajecten/${trajectId}`);
  revalidatePath("/bord");
  revalidatePath("/taken");
  return res;
}

// ---------------------------------------------------------------------------
// Agenda-afspraak zonder klant aan een bestaand traject koppelen
// ---------------------------------------------------------------------------

export async function linkAppointmentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireUser();
  const appointmentId = str(fd, "appointmentId");
  const trajectId = str(fd, "trajectId");
  const res = await run(async () => {
    if (!appointmentId || !trajectId) throw new DomainError("Kies het traject.");
    const db = getDb();
    const [t] = await db.select().from(trajects).where(eq(trajects.id, trajectId));
    if (!t || t.deletedAt) throw new DomainError("Traject niet gevonden.");
    const done = await linkAppointmentToCustomer(db, appointmentId, t.customerId, t.id);
    if (!done) throw new DomainError("Deze afspraak is inmiddels al gekoppeld.");
  });
  revalidatePath("/dashboard");
  revalidatePath("/bord");
  if (trajectId) revalidatePath(`/trajecten/${trajectId}`);
  return res.ok ? { ok: true } : res;
}
