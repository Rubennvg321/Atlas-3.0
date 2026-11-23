import Link from "next/link";
import clsx from "clsx";
import type { BestCustomerOfMonth } from "@/server/dashboard";
import { MonthPicker, monthLabel } from "./month-picker";

const euro = (n: number) => "€ " + new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(Math.round(n));

/** Widget "Beste klant van de maand": hoogste gemiddelde marge per montagedag. */
export function BestCustomerWidget({ data }: { data: BestCustomerOfMonth }) {
  const [best, ...rest] = data.ranking;
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 md:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Beste klant van de maand</h2>
        <MonthPicker value={data.month} months={data.months} />
      </div>
      <p className="mb-3 text-sm text-stone-500">
        De klant met de hoogste gemiddelde marge per montagedag (verkoop min inkoop, gedeeld door het aantal montagedagen), voor montages die in {monthLabel(data.month).toLowerCase()} begonnen. Bedragen excl. btw.
      </p>

      {!best ? (
        <p className="text-sm text-stone-500">Nog geen montages met verkoop, inkoop én montagedagen in deze maand.</p>
      ) : (
        <>
          <Link
            href={best.trajectIds.length === 1 ? `/trajecten/${best.trajectIds[0]}` : `/klanten/${best.customerId}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1b2a5c] p-4 text-white hover:opacity-95 md:p-5"
          >
            <div className="min-w-0">
              <p className="text-sm text-white/85">🏆 Nummer 1</p>
              <p className="truncate text-xl font-bold md:text-2xl">{best.name}</p>
              {best.city && <p className="text-sm text-white/85">{best.city}</p>}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums md:text-3xl">{euro(best.marginPerDay)}<span className="text-base font-normal">/dag</span></p>
              <p className="text-sm text-white/85">
                {euro(best.margin)} marge · {best.montageDays} {best.montageDays === 1 ? "dag" : "dagen"}
              </p>
            </div>
          </Link>

          {rest.length > 0 && (
            <ol start={2} className="mt-3 divide-y divide-stone-100">
              {rest.slice(0, 4).map((r, i) => (
                <li key={r.customerId}>
                  <Link
                    href={r.trajectIds.length === 1 ? `/trajecten/${r.trajectIds[0]}` : `/klanten/${r.customerId}`}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-stone-50"
                  >
                    <span className="w-5 tabular-nums text-stone-500">{i + 2}.</span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {r.name}
                      {r.city && <span className="font-normal text-stone-500"> · {r.city}</span>}
                    </span>
                    <span className="text-stone-500 tabular-nums">
                      {r.montageDays} {r.montageDays === 1 ? "dag" : "dagen"}
                    </span>
                    <span className={clsx("w-24 text-right font-medium tabular-nums", r.marginPerDay >= 0 ? "text-emerald-700" : "text-red-700")}>
                      {euro(r.marginPerDay)}/dag
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {data.incomplete > 0 && (
        <p className="mt-3 text-sm text-amber-700">
          {data.incomplete} {data.incomplete === 1 ? "traject telt" : "trajecten tellen"} niet mee omdat verkoop, inkoop of montagedagen nog ontbreken.
        </p>
      )}
    </section>
  );
}
