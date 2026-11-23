/**
 * "2026-11" → "November 2026". Staat apart (zonder "use client") zodat zowel
 * servercomponenten als het keuzemenu hem kunnen gebruiken.
 */
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  const s = new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
