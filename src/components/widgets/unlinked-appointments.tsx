import Link from "next/link";
import type { UnlinkedAppointment } from "@/server/dashboard";

/** Widget "Afspraken zonder klant": agenda-afspraken die Atlas niet aan een klant kon koppelen. */
export function UnlinkedAppointmentsWidget({ items }: { items: UnlinkedAppointment[] }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 md:p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Afspraken zonder klant</h2>
        <span className="text-sm text-stone-500">{items.length}</span>
      </div>
      <p className="mb-3 text-sm text-stone-500">
        Deze afspraken staan in je agenda, maar Atlas kon ze aan geen klant koppelen. Met &lsquo;Klant aanmaken&rsquo; maak je de klant aan en koppelt Atlas de afspraak er meteen aan. Bestaat de klant al, dan herkent Atlas dat en koppelt hij de afspraak aan die klant.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-emerald-700">Alles is gekoppeld.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className={a.kind === "montage" ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800" : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"}>
                {a.kind === "montage" ? "Montage" : "Adviesgesprek"}
              </span>
              <span className="w-28 text-sm tabular-nums text-stone-600">
                {a.startsAt.toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short" })}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={a.location ?? undefined}>
                {a.title}
                {a.location && <span className="font-normal text-stone-500"> · {a.location}</span>}
              </span>
              <Link href={`/klanten/nieuw?${new URLSearchParams(a.prefill)}`} className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm hover:bg-stone-50">
                Klant aanmaken
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
