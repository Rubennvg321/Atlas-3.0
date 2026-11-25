/** Nederlandse tijd omrekenen, onafhankelijk van de tijdzone van de server (die draait in UTC). */
const TZ = "Europe/Amsterdam";

/** Verschil tussen Nederlandse tijd en UTC op dat moment, in minuten (60 in de winter, 120 in de zomer). */
function offsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** "2026-11-27" + "14:30" (Nederlandse tijd) -> het juiste moment. */
export function amsterdamTime(day: string, time = "00:00"): Date {
  const guess = new Date(`${day}T${time}:00Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess) * 60000);
  // Rond de wisseling van zomer-/wintertijd nog een keer corrigeren.
  return new Date(guess.getTime() - offsetMinutes(first) * 60000);
}

/** "14:30" in Nederlandse tijd voor een moment. */
export function amsterdamClock(d: Date): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
