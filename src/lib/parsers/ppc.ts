import { parseEuro } from "../finance";

/** Orderbevestiging van PPC (Plinten- en Profielencentrale), tekst uit de PDF-bijlage. */
export interface SupplierOrder {
  supplier: string;
  orderNumber: string | null;
  orderDate: Date | null;
  commission: string | null;
  amountExcl: number | null;
  amountIncl: number | null;
}

const AMOUNT = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

export function parsePpcOrder(text: string): SupplierOrder | null {
  if (!/Orderbevestiging/i.test(text) || !/(PPC|plintenenprofielencentrale)/i.test(text)) return null;
  const orderNumber = text.match(/Ordernr\.?\s+(\d{5,})/i)?.[1] ?? null;
  const dateStr = text.match(/Orderdatum\s+(\d{2})-(\d{2})-(\d{4})/i);
  const orderDate = dateStr ? new Date(`${dateStr[3]}-${dateStr[2]}-${dateStr[1]}T12:00:00Z`) : null;
  const commission = text.match(/Commissie\s+(.+?)(?:\s{2,}|\n|$)/i)?.[1]?.trim() || null;

  let amountExcl: number | null = null;
  let amountIncl: number | null = null;
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => /Totaal\s+EUR\s+excl\.?\s+BTW/i.test(l));
  if (idx >= 0) {
    for (let i = idx; i < Math.min(lines.length, idx + 4); i++) {
      const nums = lines[i].match(AMOUNT);
      if (nums && nums.length >= 3) {
        amountExcl = parseEuro(nums[nums.length - 3]);
        amountIncl = parseEuro(nums[nums.length - 1]);
        break;
      }
    }
  }
  if (amountExcl === null) {
    const m = text.match(/excl\.?\s*BTW[^\d]{0,40}(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    amountExcl = parseEuro(m?.[1]);
  }
  if (!orderNumber && amountExcl === null) return null;
  return { supplier: "PPC", orderNumber, orderDate, commission, amountExcl, amountIncl };
}
