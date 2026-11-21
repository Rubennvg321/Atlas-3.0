import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { contactPoints, customers, emails, inboundItems, pipelineStages, trajects } from "@/db/schema";
import { addresses, attachments, bodyText, header, type GmailMessage } from "@/lib/mime";
import { htmlToText, parseWebsiteForm } from "@/lib/intake/website-form";
import { parsePpcOrder } from "@/lib/parsers/ppc";
import { parseFediOrder } from "@/lib/parsers/fedi";
import { parseWefactAccepted } from "@/lib/parsers/wefact-mail";
import { intakeLead } from "../intake";
import { handleQuoteAccepted, recordSupplierOrder } from "../purchases";
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

/** 3. Orderbevestigingen van leveranciers -> inkoop. */
export async function syncSupplierMails(db: DbOrTx, gmail: GmailClient): Promise<number> {
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
          for (const a of attachments(m).filter((x) => /pdf/i.test(x.mimeType) || /\.pdf$/i.test(x.filename))) {
            order = parsePpcOrder(await pdfToText(await gmail.attachment(id, a.attachmentId)));
            if (order) break;
          }
        } else if (rule.parser === "fedi-mail") {
          // fedi stuurt een Duitse tekstversie en een Nederlandse HTML-versie; alleen die laatste
          // bevat de commissie ("Comissie: Fam. …"). Daarom eerst de HTML proberen.
          order = parseFediOrder(htmlText(m)) ?? parseFediOrder(text(m));
        }
        if (!order || order.amountExcl === null) return { status: "ignored", payload: { reden: "niet herkend" } };
        const r = await recordSupplierOrder(db, order, { gmailMessageId: id, source: "gmail" });
        return { status: r.purchase.status === "gekoppeld" ? "done" : "te_controleren", payload: { leverancier: order.supplier, order: order.orderNumber } };
      });
      if (did) n++;
    }
  }
  return n;
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
  n += await syncWefactMails(db, gmail);
  n += await syncSupplierMails(db, gmail);
  n += await syncCustomerMails(db, gmail);
  return n;
}
