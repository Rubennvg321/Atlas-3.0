import Link from "next/link";
import type { RevenueBreakdown } from "@/server/dashboard";
import { DashboardForm } from "@/components/settings-forms";
import { monthLabel } from "./month-label";
import { PeriodPicker } from "./period-picker";

const euro = (n: number) => "€ " + new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(Math.round(n));
const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Widget "Omzet per klant": opent na een klik op een omzet-tegel. */
export function RevenueBreakdownWidget({ data }: { data: RevenueBreakdown }) {
  const title =
    data.kind === "month"
      ? `Omzet ${monthLabel(data.period).toLowerCase()}`
      : `Omzet ${data.period}${data.untilMonth ? ` (t/m ${monthLabel(data.untilMonth).split(" ")[0].toLowerCase()})` : ""}`;
  return (
    <section id="omzet" className="scroll-mt-4 rounded-2xl border border-stone-200 bg-white p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="flex items-center gap-2">
          <PeriodPicker value={data.period} years={data.years} months={data.months} />
          <Link href="/dashboard" scroll={false} className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm hover:bg-stone-50" aria-label="Sluiten">
            Sluiten
          </Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-3xl font-bold tabular-nums">{euro(data.total)}</p>
        <p className="text-sm text-stone-500">
          {data.lines.length} {data.lines.length === 1 ? "traject" : "trajecten"} · excl. btw
          {data.targetPct !== null && ` · ${data.targetPct}% van het doel (${euro(data.monthlyTarget)})`}
        </p>
      </div>

      {data.lines.length === 0 ? (
        <p className="text-sm text-stone-500">Geen montages in deze periode.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr className="border-b border-stone-200">
                <th className="py-2 pr-3 font-normal">Klant</th>
                <th className="py-2 pr-3 font-normal">Montage</th>
                <th className="py-2 text-right font-normal">Omzet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.lines.map((l) => (
                <tr key={l.trajectId} className="hover:bg-stone-50">
                  <td className="py-2 pr-3">
                    <Link href={`/trajecten/${l.trajectId}`} className="font-medium hover:underline">
                      {l.name}
                    </Link>
                    {l.city && <span className="text-stone-500"> · {l.city}</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-stone-600">{date(l.montageDate)}</td>
                  <td className="whitespace-nowrap py-2 text-right font-medium tabular-nums">
                    {l.amount === null ? <span className="font-normal text-amber-700">geen bedrag</span> : euro(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.withoutAmount > 0 && (
        <p className="mt-3 text-sm text-amber-700">
          {data.withoutAmount} {data.withoutAmount === 1 ? "traject heeft" : "trajecten hebben"} nog geen verkoopbedrag en {data.withoutAmount === 1 ? "telt" : "tellen"} dus niet mee in het totaal.
        </p>
      )}

      {data.kind === "month" && (
        <details className="mt-4 rounded-xl bg-stone-50 p-3" open={data.monthlyTarget === 0}>
          <summary className="cursor-pointer text-sm font-medium">Omzetdoel per maand {data.monthlyTarget > 0 ? `(${euro(data.monthlyTarget)})` : "instellen"}</summary>
          <div className="mt-3 max-w-sm">
            <DashboardForm monthlyRevenueTarget={data.monthlyTarget} />
          </div>
        </details>
      )}
    </section>
  );
}
