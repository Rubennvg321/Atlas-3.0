const TZ = "Europe/Amsterdam";

export function euro(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

export function date(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(new Date(d));
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(new Date(d));
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d));
}

export function appointmentLabel(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d));
}

/** YYYY-MM-DD in Nederlandse tijd, voor <input type="date">. */
export function isoDay(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(d));
}

export function isOverdue(d: Date | string | null | undefined, now = new Date()): boolean {
  if (!d) return false;
  return isoDay(d) < isoDay(now);
}

export function isToday(d: Date | string | null | undefined, now = new Date()): boolean {
  if (!d) return false;
  return isoDay(d) === isoDay(now);
}

export function relativeDays(d: Date | string, now = new Date()): string {
  const a = new Date(isoDay(d)).getTime();
  const b = new Date(isoDay(now)).getTime();
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return "vandaag";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gisteren";
  if (diff < 0) return `${-diff} dagen te laat`;
  return `over ${diff} dagen`;
}
