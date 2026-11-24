import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments, contactPoints, customers, emails, inboundItems, pipelineStages, purchaseDocuments, purchaseOrders, trajects } from "@/db/schema";
import { addresses, attachments, bodyHtml, bodyText, header, type GmailMessage } from "@/lib/mime";
import { htmlToText, parseWebsiteForm } from "@/lib/intake/website-form";
import { parsePpcOrder } from "@/lib/parsers/ppc";
import { parseFediOrder } from "@/lib/parsers/fedi";
import { parseWefactAccepted } from "@/lib/parsers/wefact-mail";
import { intakeLead } from "../intake";
import { handleQuoteAccepted, recordSupplierOrder } from "../purchases";
import { addPurchaseDocument, findPurchaseForInvoice } from "../purchase-documents";
import { getSetting } from "../settings";
import { addTimeline } from "../timeline";
import { pdfToText } from "../pdf";
import type { GmailClient } from "./gmail-client";
import { cfg, getIntegration, upsertIntegration } from "./state";

const text = (m: GmailMessage) => bodyText(m, htmlToText);
const htmlText = (m: GmailMessage) => bodyText(m, htmlToText, "html");

/** Voert `fn` één keer per bericht uit; een fout laat geen spoor na, zodat het opnieuw wordt geprobeerd. */
async function oncePerMessage(db: DbOrTx, kind: string, id: string, fn: () => Promise<{ status: string; payload?: unknown }>) {
  const [done] = await db.select().from(inboundItems).where(and(eq(inboundItems.provider, kind), eq(inboundItems.externalId, id)));
  if (done) return false;
  const r = await fn();
  await db
    .insert(inboundItems)
    .values({ provider: kind, externalId: id, payload: r.payload ?? {}, status: r.status, processedAt: new Date() })
    .onConflictDoNothing();
  return true;
}

/**
 * 1b. Aanvraagmail krijgt het label "Behandeld" zodra er met die klant een afspraak
 * (adviesgesprek of montage) in de agenda staat. Eén keer per mail; haal je het
 * label in Gmail zelf weg, dan zet Atlas het niet opnieuw.
 */
export async function syncHandledLabels(db: DbOrTx, gmail: GmailClient): Promise<number> {
  const s = await getSetting(db, "intakeFilters");
  if (!s.handledLabel) return 0;
  const rows = await db.execute<{ external_id: string }>(sql`
    select i.external_id
      from ${inboundItems} i
      join ${customers} c on c.id = i.customer_id
     where i.provider = 'website' and i.external_id like 'gmail:%' and i.status = 'done'
       and not exists (select 1 from ${inboundItems} h where h.provider = 'gmail-behandeld' and h.external_id = i.external_id)
       and exists (
         select 1 from ${appointments} a
          where a.deleted_at is null and a.status = 'gepland' and a.kind in ('advies', 'montage')
            and (a.customer_id in (c.id, c.merged_into_id) or (i.traject_id is not null and a.traject_id = i.traject_id))
            -- alleen afspraken na de aanvraag, niet een oude afspraak van een eerdere klus
            and a.starts_at >= i.created_at - interval '14 days')
     order by i.created_at
     limit 100
  `);
  if (!rows.length) return 0;
  const label = await gmail.ensureLabel(s.handledLabel);
  let n = 0;
  for (const r of rows) {
    await oncePerMessage(db, "gmail-behandeld", r.external_id, async () => {
      await gmail.modify(r.external_id.slice("gmail:".length), [label], []);
      return { status: "done" };
    });
    n++;
  }
  return n;
}

/** 1. Aanvraagmails van het websiteformulier -> lead, label en archiveren. */
export async function syncLeadMails(db: DbOrTx, gmail: GmailClient): Promise<number> {
  const s = await getSetting(db, "intakeFilters");
  const doneLabel = await gmail.ensureLabel(s.processedLabel);
  const badLabel = await gmail.ensureLabel(s.unrecognizedLabel);
  let n = 0;
  for (const rule of s.rules) {
    const q = `from:${rule.from} subject:"${rule.subjectContains}" -label:"${s.processedLabel}" -label:"${s.unrecognizedLabel}" newer_than:${s.lookbackDays}d`;
    for (const id of await gmail.search(q, 50)) {
      const m = await gmail.get(id, "full");
      const lead = parseWebsiteForm(text(m));
      if (!lead) {
        await gmail.modify(id, [badLabel], []);
        continue;
      }
      // intakeLead is idempotent op het message-id: opnieuw verwerken geeft hetzelfde resultaat.
      await intakeLead(db, lead, {
        provider: "website",
        externalId: `gmail:${id}`,
        occurredAt: m.internalDate ? new Date(Number(m.internalDate)) : undefined,
      });
      await gmail.modify(id, [doneLabel], ["INBOX"]);
      n++;
    }
  }
  return n;
}

/** 2. "Offerte … is online geaccepteerd" van WeFact. */
export async function syncWefactMails(db: DbOrTx, gmail: GmailClient): Promise<number> {
  const s = await getSetting(db, "wefactMail");
  let n = 0;
  for (const id of await gmail.search(`from:${s.from} subject:"${s.subjectContains}" newer_than:30d`, 50)) {
    const did = await oncePerMessage(db, "gmail-wefact", id, async () => {
      const m = await gmail.get(id, "full");
      const parsed = parseWefactAccepted(header(m, "Subject") ?? "", text(m));
      if (!parsed) return { status: "ignored" };
      const r = await handleQuoteAccepted(db, parsed, { gmailMessageId: id });
      return { status: r.matched ? "done" : "te_controleren", payload: { quote: parsed.quoteNumber, klant: parsed.customerName } };
    });
    if (did) n++;
  }
  return n;
}

type PdfText = (buf: Buffer) => Promise<string>;
const isPdf = (a: { mimeType: string; filename: string }) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename);

/**
 * Bewaart het document van een orderbevestiging bij de bestelling: de PDF-bijlage(n),
 * of (zonder PDF, zoals bij fedi) de mail zelf. Idempotent per mail + bestandsnaam.
 */
async function saveOrderDocuments(db: DbOrTx, gmail: GmailClient, m: GmailMessage, purchaseOrderId: string, label: string) {
  const pdfs = attachments(m).filter(isPdf);
  for (const a of pdfs) {
    await addPurchaseDocument(db, {
      purchaseOrderId,
      kind: "orderbevestiging",
      filename: a.filename,
      mimeType: "application/pdf",
      data: await gmail.attachment(m.id, a.attachmentId),
      source: "gmail",
      gmailMessageId: m.id,
    });
  }
  if (!pdfs.length) {
    const html = bodyHtml(m);
    const subject = header(m, "Subject") ?? "Orderbevestiging";
    const content = html ?? `<pre style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(text(m))}</pre>`;
    const page = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(subject)}</title><h3 style="font-family:sans-serif">${escapeHtml(subject)}</h3>${content}`;
    await addPurchaseDocument(db, {
      purchaseOrderId,
      kind: "orderbevestiging",
      filename: `orderbevestiging-${label}.html`.replace(/[^\w.\-]+/g, "-"),
      mimeType: "text/html",
      data: Buffer.from(page, "utf8"),
      source: "gmail",
      gmailMessageId: m.id,
    });
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 3. Orderbevestigingen van leveranciers -> inkoop (met het document erbij). */
export async function syncSupplierMails(db: DbOrTx, gmail: GmailClient, opts: { pdfText?: PdfText } = {}): Promise<number> {
  const pdfText = opts.pdfText ?? pdfToText;
  const s = await getSetting(db, "suppliers");
  let n = 0;
  for (const rule of s.rules) {
    for (const id of await gmail.search(`from:${rule.from} subject:orderbevestiging newer_than:60d`, 50)) {
      // "-v2": mails die met de oude fedi-herkenning zijn overgeslagen, worden één keer opnieuw bekeken
      // (het vastleggen is idempotent op leverancier + ordernummer, dus er ontstaan geen dubbelen).
      const did = await oncePerMessage(db, `gmail-inkoop-v2`, id, async () => {
        const m = await gmail.get(id, "full");
        let order = null;
        if (rule.parser === "ppc-pdf") {
          for (const a of attachments(m).filter(isPdf)) {
            order = parsePpcOrder(await pdfText(await gmail.attachment(id, a.attachmentId)));
            if (order) break;
          }
        } else if (rule.parser === "fedi-mail") {
          // fedi stuurt een Duitse tekstversie en een Nederlandse HTML-versie; alleen die laatste
          // bevat de commissie ("Comissie: Fam. …"). Daarom eerst de HTML proberen.
          order = parseFediOrder(htmlText(m)) ?? parseFediOrder(text(m));
        }
        if (!order || order.amountExcl === null) return { status: "ignored", payload: { reden: "niet herkend" } };
        const r = await recordSupplierOrder(db, order, { gmailMessageId: id, source: "gmail" });
        await saveOrderDocuments(db, gmail, m, r.purchase.id, `${order.supplier}-${order.orderNumber ?? id}`);
        await markDocumentsFetched(db, r.purchase.id);
        return { status: r.purchase.status === "gekoppeld" ? "done" : "te_controleren", payload: { leverancier: order.supplier, order: order.orderNumber } };
      });
      if (did) n++;
    }
    n += await syncSupplierInvoices(db, gmail, rule, pdfText);
  }
  n += await backfillOrderDocuments(db, gmail);
  return n;
}

const markDocumentsFetched = (db: DbOrTx, purchaseId: string) =>
  db.insert(inboundItems).values({ provider: "gmail-inkoop-doc", externalId: purchaseId, payload: {}, status: "done", processedAt: new Date() }).onConflictDoNothing();

/**
 * Inkoopfacturen per mail (onderwerp "factuur", "Rechnung" of "invoice", met PDF):
 * het ordernummer in de PDF bepaalt bij welke bestelling de factuur hoort.
 */
async function syncSupplierInvoices(db: DbOrTx, gmail: GmailClient, rule: { supplier: string; from: string }, pdfText: PdfText) {
  let n = 0;
  const ids = new Set<string>();
  for (const word of ["factuur", "rechnung", "invoice"]) {
    for (const id of await gmail.search(`from:${rule.from} subject:${word} has:attachment newer_than:60d`, 50)) ids.add(id);
  }
  for (const id of ids) {
    const did = await oncePerMessage(db, "gmail-inkoopfactuur", id, async () => {
      const m = await gmail.get(id, "full");
      const linked: string[] = [];
      for (const a of attachments(m).filter(isPdf)) {
        const buf = await gmail.attachment(id, a.attachmentId);
        const po = await findPurchaseForInvoice(db, rule.supplier, await pdfText(buf));
        if (!po) continue;
        await addPurchaseDocument(db, { purchaseOrderId: po.id, kind: "factuur", filename: a.filename, mimeType: "application/pdf", data: buf, source: "gmail", gmailMessageId: id });
        linked.push(po.orderNumber ?? po.id);
      }
      return { status: linked.length ? "done" : "te_controleren", payload: { leverancier: rule.supplier, orders: linked, onderwerp: header(m, "Subject") } };
    });
    if (did) n++;
  }
  return n;
}

/** Bestellingen die al uit Gmail kwamen vóór documenten werden bewaard: document alsnog ophalen. */
async function backfillOrderDocuments(db: DbOrTx, gmail: GmailClient, max = 20) {
  const todo = await db
    .select({ id: purchaseOrders.id, gmailMessageId: purchaseOrders.gmailMessageId, supplier: purchaseOrders.supplier, orderNumber: purchaseOrders.orderNumber })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.source, "gmail"),
        isNotNull(purchaseOrders.gmailMessageId),
        isNull(purchaseOrders.deletedAt),
        sql`not exists (select 1 from ${purchaseDocuments} d where d.purchase_order_id = ${purchaseOrders.id})`,
        sql`not exists (select 1 from ${inboundItems} i where i.provider = 'gmail-inkoop-doc' and i.external_id = ${purchaseOrders.id}::text)`,
      ),
    )
    .limit(max);
  for (const p of todo) {
    try {
      const m = await gmail.get(p.gmailMessageId!, "full");
      await saveOrderDocuments(db, gmail, m, p.id, `${p.supplier}-${p.orderNumber ?? p.gmailMessageId}`);
    } catch (e) {
      // Mail verwijderd of onleesbaar: niet elke keer opnieuw proberen, de bestelling zelf blijft staan.
      if (!/fetch failed|ECONN|ETIMEDOUT|429|rate/i.test(String(e))) {
        await markDocumentsFetched(db, p.id);
        continue;
      }
      throw e;
    }
    await markDocumentsFetched(db, p.id);
  }
  return todo.length;
}

/** 4. Mail met bekende klanten aan het traject koppelen (alleen afzender/onderwerp/fragment). */
export async function syncCustomerMails(db: DbOrTx, gmail: GmailClient): Promise<number> {
  const row = await getIntegration(db, "gmail");
  const c = cfg(row);
  const since = typeof c.mailCursor === "number" ? c.mailCursor : Math.floor(Date.now() / 1000) - 2 * 86400;
  const q = `after:${since - 600} -in:chats -category:promotions -category:social -category:forums`;
  const ids = await gmail.search(q, 300);
  if (!ids.length) return 0;
  const known = new Set((await db.select({ id: emails.gmailMessageId }).from(emails).where(inArray(emails.gmailMessageId, ids))).map((r) => r.id));
  const own = (gmail.account ?? "").toLowerCase();
  const openKeys = (await db.select().from(pipelineStages).where(inArray(pipelineStages.kind, ["open", "won"]))).map((s) => s.key);
  let newest = since;
  let n = 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    const m = await gmail.get(id, "metadata");
    const ts = m.internalDate ? Math.floor(Number(m.internalDate) / 1000) : since;
    newest = Math.max(newest, ts);
    const from = addresses(header(m, "From"));
    const others = [...from, ...addresses(header(m, "To")), ...addresses(header(m, "Cc"))].filter((a) => a !== own);
    if (!others.length) continue;
    const [hit] = await db
      .select({ customerId: contactPoints.customerId })
      .from(contactPoints)
      .innerJoin(customers, eq(customers.id, contactPoints.customerId))
      .where(and(eq(contactPoints.kind, "email"), inArray(contactPoints.normalized, [...new Set(others)]), isNull(contactPoints.deletedAt), isNull(customers.mergedIntoId)))
      .limit(1);
    if (!hit) continue; // niet-relevante mail wordt niet opgeslagen
    const ts2 = await db
      .select()
      .from(trajects)
      .where(and(eq(trajects.customerId, hit.customerId), isNull(trajects.deletedAt)))
      .orderBy(desc(trajects.createdAt));
    const traject = ts2.find((t) => openKeys.includes(t.stage)) ?? ts2[0] ?? null;
    const outgoing = from.includes(own);
    const subject = header(m, "Subject");
    const inserted = await db
      .insert(emails)
      .values({
        gmailMessageId: id,
        gmailThreadId: m.threadId ?? null,
        customerId: hit.customerId,
        trajectId: traject?.id ?? null,
        direction: outgoing ? "uit" : "in",
        fromAddress: header(m, "From"),
        toAddresses: header(m, "To"),
        subject,
        snippet: m.snippet ?? null,
        sentAt: new Date(ts * 1000),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await addTimeline(db, {
        customerId: hit.customerId,
        trajectId: traject?.id ?? null,
        type: "mail",
        title: `${outgoing ? "Mail verstuurd" : "Mail ontvangen"}: ${subject ?? "(geen onderwerp)"}`,
        body: m.snippet ?? null,
        payload: { gmailMessageId: id },
        occurredAt: new Date(ts * 1000),
      });
      n++;
    }
  }
  await upsertIntegration(db, "gmail", { config: { ...cfg(await getIntegration(db, "gmail")), mailCursor: newest } });
  return n;
}

export async function syncGmail(db: DbOrTx, gmail: GmailClient): Promise<number> {
  let n = 0;
  n += await syncLeadMails(db, gmail);
  n += await syncHandledLabels(db, gmail);
  n += await syncWefactMails(db, gmail);
  n += await syncSupplierMails(db, gmail);
  n += await syncCustomerMails(db, gmail);
  return n;
}
