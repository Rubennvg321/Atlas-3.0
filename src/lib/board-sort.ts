/**
 * Volgorde van de kaarten binnen een kolom: chronologisch op de eerstvolgende
 * afspraak (adviesgesprek, montage, …), de vroegste bovenaan. Kaarten zonder
 * afspraak komen daaronder, in de volgorde waarin ze binnenkwamen (laatst
 * verschoven bovenaan).
 */
export function sortColumnCards<T extends { nextAppointmentAt: string | null }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    if (a.nextAppointmentAt && b.nextAppointmentAt) return Date.parse(a.nextAppointmentAt) - Date.parse(b.nextAppointmentAt);
    if (a.nextAppointmentAt) return -1;
    if (b.nextAppointmentAt) return 1;
    return 0;
  });
}
