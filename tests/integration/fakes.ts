import type { GmailClient } from "@/server/integrations/gmail-client";
import type { CalendarClient, CalendarEvent } from "@/server/integrations/calendar-client";
import type { WefactClient, WefactDebtor, WefactQuote } from "@/server/integrations/wefact-client";
import type { GmailMessage } from "@/lib/mime";
import { b64urlEncode } from "@/lib/mime";

/** Fictief eigen adres voor de tests. */
export const OWN = "kantoor@example.nl";

export interface FakeMail {
  id: string;
  from: string;
  to?: string;
  subject: string;
  body?: string;
  /** Optioneel: aparte HTML-versie (zoals fedi: Duitse tekst + Nederlandse HTML). */
  html?: string;
  date?: Date;
  labels?: string[];
}

/** Nagebootste Gmail: zoekt op afzender, onderwerp en labels (genoeg voor de tests). */
export function fakeGmail(mails: FakeMail[], account = OWN) {
  const labels = new Map<string, string>();
  const sent: string[] = [];
  let failModifyOnce = false;
  const toMsg = (m: FakeMail): GmailMessage => ({
    id: m.id,
    threadId: m.id,
    labelIds: m.labels ?? ["INBOX"],
    snippet: (m.body ?? "").slice(0, 80),
    internalDate: String((m.date ?? new Date()).getTime()),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: m.from },
        { name: "To", value: m.to ?? account },
        { name: "Subject", value: m.subject },
      ],
      parts: [
        ...(m.body ? [{ mimeType: "text/plain", body: { data: b64urlEncode(m.body) } }] : []),
        ...(m.html ? [{ mimeType: "text/html", body: { data: b64urlEncode(m.html) } }] : []),
      ],
    },
  });
  const client: GmailClient & { sent: string[]; failNextModify(): void; mails: FakeMail[] } = {
    account,
    sent,
    mails,
    failNextModify() {
      failModifyOnce = true;
    },
    async search(q) {
      const from = q.match(/from:(\S+)/)?.[1];
      const subj = q.match(/subject:"([^"]+)"/)?.[1] ?? q.match(/subject:(\S+)/)?.[1];
      const excluded = [...q.matchAll(/-label:"([^"]+)"/g)].map((x) => labels.get(x[1]));
      return mails
        .filter((m) => !from || m.from.toLowerCase().includes(from.toLowerCase()))
        .filter((m) => !subj || m.subject.toLowerCase().includes(subj.toLowerCase()))
        .filter((m) => !excluded.some((l) => l && (m.labels ?? []).includes(l)))
        .map((m) => m.id);
    },
    async get(id) {
      return toMsg(mails.find((m) => m.id === id)!);
    },
    async attachment() {
      throw new Error("geen bijlagen in de nagebootste Gmail");
    },
    async ensureLabel(name) {
      if (!labels.has(name)) labels.set(name, `Label_${labels.size + 1}`);
      return labels.get(name)!;
    },
    async modify(id, add, remove) {
      if (failModifyOnce) {
        failModifyOnce = false;
        throw new Error("fetch failed (gesimuleerde storing)");
      }
      const m = mails.find((x) => x.id === id)!;
      m.labels = [...new Set([...(m.labels ?? ["INBOX"]), ...add])].filter((l) => !remove.includes(l));
    },
    async send(raw) {
      sent.push(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      return `sent-${sent.length}`;
    },
  };
  return client;
}

export function fakeCalendar(events: CalendarEvent[]) {
  let failAt: number | null = null;
  const client: CalendarClient & { events: CalendarEvent[]; failAfter(n: number): void } = {
    account: OWN,
    events,
    failAfter(n) {
      failAt = n;
    },
    async changes({ calendarId = "primary" } = {}) {
      // Nagebootst: alle testafspraken staan in de hoofdagenda.
      if (calendarId !== "primary") return { events: [], nextSyncToken: `tok-${calendarId}` };
      if (failAt !== null) {
        const n = failAt;
        failAt = null;
        return { events: [...events.slice(0, n), { id: "__boom__", status: "confirmed", summary: "Advies gesprek Steps&Stairs", colorId: "5" } as CalendarEvent], nextSyncToken: "tok-fail" };
      }
      return { events, nextSyncToken: `tok-${events.length}` };
    },
  };
  return client;
}

export function fakeWefact(quotes: WefactQuote[], debtors: WefactDebtor[]): WefactClient & { quotes: WefactQuote[] } {
  return {
    quotes,
    async listQuotes(offset, limit) {
      const sorted = [...quotes].sort((a, b) => (b.Modified ?? "").localeCompare(a.Modified ?? ""));
      return { quotes: sorted.slice(offset, offset + limit), total: sorted.length };
    },
    async debtor(code) {
      return debtors.find((d) => d.DebtorCode === code) ?? null;
    },
    async downloadQuote(ref) {
      const q = quotes.find((x) => (ref.identifier ? x.Identifier === ref.identifier : x.PriceQuoteCode === ref.code));
      return q ? { filename: `${q.PriceQuoteCode}.pdf`, pdf: Buffer.from(`%PDF-1.4 offerte ${q.PriceQuoteCode}`) } : null;
    },
  };
}
