import { parseEuro } from "../finance";
import type { SupplierOrder } from "./ppc";

/**
 * Orderbevestiging van fedi (Gelsenkirchen), tekst uit de mail.
 * fedi levert btw-verlegd (intracommunautair), dus "Totaal" is excl. btw.
 */
const COMMISSION =
  /Comm?iss(?:ie|ion)\s*:\s*(.+?)\.?(?=\s+(?:Levering|Leverdatum|Lieferung|Grote|Goederen|Opmerking|Bezorging|Totaal)\b|[;\n]|$)/i;

export function parseFediOrder(text: string): SupplierOrder | null {
  if (!/fedi/i.test(text) || !/bestelling/i.test(text)) return null;
  const orderNumber = text.match(/bestelling met nummer\s+([A-Z]{0,4}\d{1,})/i)?.[1] ?? null;
  const commission = text.match(COMMISSION)?.[1]?.trim() || null;
  const total = text.match(/Totaal\s*:\s*€?\s*([\d.,]+)/i)?.[1];
  const amountExcl = parseEuro(total);
  if (!orderNumber && amountExcl === null) return null;
  return { supplier: "fedi", orderNumber, orderDate: null, commission, amountExcl, amountIncl: null };
}
