/** Marge-berekening voor een traject. Alle bedragen excl. btw. */

export interface FinanceInput {
  saleExcl: number | null;
  purchaseExcl: number | null;
  montageDays: number | null;
}

export interface FinanceResult {
  saleExcl: number | null;
  purchaseExcl: number | null;
  margin: number | null;
  marginPct: number | null;
  montageDays: number | null;
  marginPerDay: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcFinance({ saleExcl, purchaseExcl, montageDays }: FinanceInput): FinanceResult {
  const margin = saleExcl !== null && purchaseExcl !== null ? round2(saleExcl - purchaseExcl) : null;
  const marginPct = margin !== null && saleExcl ? round2((margin / saleExcl) * 100) : null;
  const marginPerDay = margin !== null && montageDays && montageDays > 0 ? round2(margin / montageDays) : null;
  return { saleExcl, purchaseExcl, margin, marginPct, montageDays: montageDays || null, marginPerDay };
}

/** "1.361,20" / "€ 2.344,54" / "1361.20" -> 1361.2 */
export function parseEuro(input: string | null | undefined): number | null {
  if (!input) return null;
  let s = input.replace(/[€\s]/g, "").replace(/EUR/i, "");
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}(\.|$)/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}
