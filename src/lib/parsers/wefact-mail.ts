/** "Offerte OF2026-0076 is online geaccepteerd" (mail van WeFact). */
export interface QuoteAccepted {
  quoteNumber: string;
  customerName: string | null;
  acceptedAt: Date | null;
}

export function parseWefactAccepted(subject: string, body: string): QuoteAccepted | null {
  const m = subject.match(/Offerte\s+(\S+)\s+is\s+online\s+geaccepteerd/i) ?? body.match(/Offerte\s+(\S+)\s+geaccepteerd/i);
  if (!m) return null;
  const who = body.match(/is door\s+(.+?)\s+op\s+(\d{2})-(\d{2})-(\d{4})(?:\s+om\s+(\d{2}):(\d{2}))?/i);
  let acceptedAt: Date | null = null;
  if (who) {
    const [, , d, mo, y, h = "12", mi = "00"] = who;
    // Nederlandse tijd; voor de fase is de exacte minuut niet belangrijk
    acceptedAt = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+01:00`);
  }
  return { quoteNumber: m[1], customerName: who?.[1]?.trim() ?? null, acceptedAt };
}
