/** Hulpfuncties voor Gmail-berichten (MIME). */

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export function b64urlDecode(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function header(m: GmailMessage, name: string): string | null {
  const h = m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function walk(p: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!p) return out;
  out.push(p);
  for (const c of p.parts ?? []) walk(c, out);
  return out;
}

/** Leesbare tekst van een bericht: text/plain, anders text/html omgezet. */
export function bodyText(m: GmailMessage, htmlToText: (h: string) => string): string {
  const parts = walk(m.payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain?.body?.data) return b64urlDecode(plain.body.data).toString("utf8");
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html?.body?.data) return htmlToText(b64urlDecode(html.body.data).toString("utf8"));
  return m.snippet ?? "";
}

export function attachments(m: GmailMessage) {
  return walk(m.payload)
    .filter((p) => p.filename && p.body?.attachmentId)
    .map((p) => ({ filename: p.filename!, mimeType: p.mimeType ?? "", attachmentId: p.body!.attachmentId! }));
}

/** Alle e-mailadressen uit From/To/Cc. */
export function addresses(value: string | null): string[] {
  if (!value) return [];
  return [...value.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((x) => x[0].toLowerCase());
}

/** Bouwt een RFC 822-bericht (UTF-8) voor gmail.users.messages.send. */
export function buildRawEmail(o: { from?: string; to: string; subject: string; text: string }): string {
  const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [
    ...(o.from ? [`From: ${o.from}`] : []),
    `To: ${o.to}`,
    `Subject: ${enc(o.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(o.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return b64urlEncode(lines.join("\r\n"));
}
