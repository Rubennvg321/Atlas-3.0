import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { quotes } from "@/db/schema";
import { decrypt } from "./crypto";
import { DomainError, NotFoundError } from "./errors";
import { getIntegration } from "./integrations/state";
import { liveWefact, type WefactClient } from "./integrations/wefact-client";

/**
 * Haalt de offerte-PDF op bij WeFact (altijd de actuele versie). WeFact werkt
 * alleen vanaf de server (IP-whitelist), dus dit gebeurt via Atlas en niet in de browser.
 */
export async function getQuotePdf(db: DbOrTx, quoteId: string, client?: WefactClient) {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, quoteId), isNull(quotes.deletedAt)));
  if (!q) throw new NotFoundError("Offerte");
  if (!q.wefactId && !q.number) throw new DomainError("Deze offerte heeft geen WeFact-nummer.");
  let wf = client;
  if (!wf) {
    const row = await getIntegration(db, "wefact");
    if (!row?.encryptedTokens) throw new DomainError("WeFact is niet gekoppeld. Koppel WeFact via Koppelingen.");
    wf = liveWefact(decrypt(row.encryptedTokens));
  }
  const r = await wf.downloadQuote({ identifier: q.wefactId, code: q.number });
  if (!r) throw new NotFoundError("Offerte-PDF");
  const safeName = r.filename.replace(/[^\w.\- ]+/g, "_");
  return { filename: safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`, pdf: r.pdf };
}
