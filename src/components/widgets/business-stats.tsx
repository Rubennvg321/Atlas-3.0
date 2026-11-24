import Link from "next/link";
import clsx from "clsx";
import type { BusinessStats } from "@/server/dashboard";

const euro = (n: number) => "€ " + new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(Math.round(n));

function Tile({ label, value, sub, help, highlight, href, active }: { label: string; value: string; sub?: React.ReactNode; help: string; highlight?: boolean; href?: string; active?: boolean }) {
  const className = clsx(
    "flex min-h-28 flex-col justify-center rounded-2xl border p-4 md:p-5",
    highlight ? "border-[#1b2a5c] bg-[#1b2a5c] text-white" : "border-stone-200 bg-white text-stone-900",
    href && "transition hover:shadow-md",
    active && "ring-2 ring-[#1b2a5c] ring-offset-2",
  );
  const body = (
    <>
      <p className={clsx("text-sm", highlight ? "text-white/85" : "text-stone-500")}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums md:text-3xl">{value}</p>
      {sub && <p className={clsx("mt-1 text-sm", highlight ? "text-white/85" : "text-stone-500")}>{sub}</p>}
      {href && <p className={clsx("mt-1 text-xs", highlight ? "text-white/70" : "text-stone-400")}>Bekijk klanten →</p>}
    </>
  );
  return href ? (
    <Link href={href} scroll={false} title={help} className={className}>
      {body}
    </Link>
  ) : (
    <div title={help} className={className}>
      {body}
    </div>
  );
}

/** Widget "Bedrijfsstand": omzet, portefeuille en aantallen in één oogopslag. */
export function BusinessStatsWidget({ s, open }: { s: BusinessStats; open?: string | null }) {
  return (
    <section className="rounded-2xl bg-stone-50 p-4 md:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Bedrijfsstand</h2>
        <span className="text-sm text-stone-500">Bedragen excl. btw</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          highlight
          href={`/dashboard?omzet=${s.month}#omzet`}
          active={open === s.month}
          label="Omzet deze maand"
          value={euro(s.revenueMonth)}
          help="Verkoopbedrag van alle trajecten waarvan de montage deze maand begint (uitgevoerd én nog gepland)."
          sub={
            s.targetPct !== null ? (
              `${s.targetPct}% van target`
            ) : (
              "Doel instellen"
            )
          }
        />
        <Tile href={`/dashboard?omzet=${s.year}#omzet`} active={open === String(s.year)} label={`Omzet ${s.year}`} value={euro(s.revenueYear)} help={`Verkoopbedrag van alle montages vanaf 1 januari ${s.year} tot en met deze maand.`} />
        <Tile
          label="Geplande omzet"
          value={euro(s.plannedRevenue)}
          help="Opdrachten die binnen zijn (offerte geaccepteerd t/m in uitvoering) met een montage na deze maand of nog zonder montagedatum."
          sub={s.plannedWithoutAmount > 0 ? `${s.plannedWithoutAmount} zonder bedrag` : undefined}
        />
        <Tile label="Nieuwe leads" value={String(s.newLeadsMonth)} sub="deze maand" help="Trajecten die deze maand zijn aangemaakt." />
        <Tile label="Akkoord" value={String(s.accepted)} sub="opdrachten in portefeuille" help="Trajecten met een geaccepteerde offerte die nog niet klaar zijn." />
        <Tile label="Montages gepland" value={String(s.montagesPlanned)} sub="vanaf vandaag" help="Trajecten met een montage vandaag of later in de agenda." />
      </div>
    </section>
  );
}
