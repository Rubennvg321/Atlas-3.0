/** WeFact API v2. Werkt alleen vanaf een IP-adres op de whitelist (de server: 51.15.84.246). */
export interface WefactQuote {
  Identifier: string;
  PriceQuoteCode: string;
  DebtorCode?: string;
  CompanyName?: string;
  Initials?: string;
  SurName?: string;
  AmountExcl?: string;
  AmountIncl?: string;
  Date?: string;
  Status?: string;
  Modified?: string;
}

export interface WefactDebtor {
  DebtorCode: string;
  CompanyName?: string;
  Initials?: string;
  SurName?: string;
  EmailAddress?: string;
  PhoneNumber?: string;
  MobileNumber?: string;
  Address?: string;
  ZipCode?: string;
  City?: string;
}

export interface WefactClient {
  listQuotes(offset: number, limit: number): Promise<{ quotes: WefactQuote[]; total: number }>;
  debtor(code: string): Promise<WefactDebtor | null>;
}

export function liveWefact(apiKey: string): WefactClient {
  async function call<T>(params: Record<string, string>): Promise<T> {
    const res = await fetch("https://api.mijnwefact.nl/v2/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_key: apiKey, ...params }),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; errors?: string[] } & T;
    if (!res.ok || json.status !== "success") throw new Error(`WeFact: ${(json.errors ?? [res.statusText]).join("; ")}`);
    return json;
  }
  return {
    async listQuotes(offset, limit) {
      const r = await call<{ pricequotes?: WefactQuote[]; totalresults?: number }>({
        controller: "pricequote",
        action: "list",
        offset: String(offset),
        limit: String(limit),
        sort: "Modified",
        order: "DESC",
      });
      return { quotes: r.pricequotes ?? [], total: Number(r.totalresults ?? 0) };
    },
    async debtor(code) {
      try {
        const r = await call<{ debtor?: WefactDebtor }>({ controller: "debtor", action: "show", DebtorCode: code });
        return r.debtor ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * WeFact-offertestatus -> Atlas. (0 concept, 1 in wachtrij, 2 verzonden,
 * 3 geaccepteerd, 4 omgezet naar factuur, 8 geweigerd, 9 vervallen/gearchiveerd)
 */
export function mapQuoteStatus(s: string | undefined): string {
  switch (String(s ?? "")) {
    case "3":
    case "4":
      return "geaccepteerd";
    case "2":
      return "verzonden";
    case "8":
      return "afgewezen";
    case "9":
      return "vervallen";
    default:
      return "concept";
  }
}
