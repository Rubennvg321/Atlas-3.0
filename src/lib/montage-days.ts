/**
 * Montagedagen afleiden uit agenda-afspraken. Een afspraak over meerdere dagen
 * telt elke kalenderdag (Nederlandse tijd) mee; dubbele dagen tellen één keer.
 * Bij hele-dag-afspraken is de einddatum (zoals Google die geeft) exclusief.
 */
const TZ = "Europe/Amsterdam";

export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface DayRange {
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
}

export function montageDays(ranges: DayRange[]): string[] {
  const days = new Set<string>();
  for (const r of ranges) {
    const first = dayKey(r.startsAt);
    // hele dag: eind is exclusief; met tijd: een eindtijd om 00:00 telt niet als extra dag
    const endRef = r.allDay ? new Date(r.endsAt.getTime() - 1) : new Date(r.endsAt.getTime() - 1);
    let last = dayKey(endRef < r.startsAt ? r.startsAt : endRef);
    if (last < first) last = first;
    for (let k = first, guard = 0; k <= last && guard < 60; k = addDays(k, 1), guard++) days.add(k);
  }
  return [...days].sort();
}

export function lastMontageDay(ranges: DayRange[]): string | null {
  const d = montageDays(ranges);
  return d.length ? d[d.length - 1] : null;
}

export { addDays };
