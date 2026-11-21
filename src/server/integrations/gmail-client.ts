import type { GmailMessage } from "@/lib/mime";
import { googleFetch } from "./google-oauth";

/** Wat Atlas van Gmail nodig heeft. In tests vervangen door een nagebootste versie. */
export interface GmailClient {
  account: string | null;
  search(q: string, max?: number): Promise<string[]>;
  get(id: string, format?: "full" | "metadata"): Promise<GmailMessage>;
  attachment(messageId: string, attachmentId: string): Promise<Buffer>;
  ensureLabel(name: string): Promise<string>;
  modify(id: string, add: string[], remove: string[]): Promise<void>;
  send(raw: string): Promise<string>;
}

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export function liveGmail(token: string, account: string | null): GmailClient {
  const labelCache = new Map<string, string>();
  return {
    account,
    async search(q, max = 100) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const p = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
        if (pageToken) p.set("pageToken", pageToken);
        const r = await googleFetch<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `${BASE}/messages?${p}`);
        for (const m of r.messages ?? []) ids.push(m.id);
        pageToken = r.nextPageToken;
      } while (pageToken && ids.length < max);
      return ids;
    },
    async get(id, format = "full") {
      const extra = format === "metadata" ? "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date" : "";
      return googleFetch<GmailMessage>(token, `${BASE}/messages/${id}?format=${format}${extra}`);
    },
    async attachment(messageId, attachmentId) {
      const r = await googleFetch<{ data: string }>(token, `${BASE}/messages/${messageId}/attachments/${attachmentId}`);
      return Buffer.from(r.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    },
    async ensureLabel(name) {
      if (labelCache.has(name)) return labelCache.get(name)!;
      const r = await googleFetch<{ labels: { id: string; name: string }[] }>(token, `${BASE}/labels`);
      let found = r.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (!found) {
        found = await googleFetch<{ id: string; name: string }>(token, `${BASE}/labels`, {
          method: "POST",
          body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
        });
      }
      labelCache.set(name, found.id);
      return found.id;
    },
    async modify(id, add, remove) {
      await googleFetch(token, `${BASE}/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
    },
    async send(raw) {
      const r = await googleFetch<{ id: string }>(token, `${BASE}/messages/send`, { method: "POST", body: JSON.stringify({ raw }) });
      return r.id;
    },
  };
}
