import Link from "next/link";
import { getDb } from "@/db";
import { getBoard } from "@/server/queries";
import { Board, type CardData } from "@/components/board";

export const metadata = { title: "Bord" };

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ q?: string; vervallen?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const showLost = sp.vervallen === "1";
  const { stages, visible, cards } = await getBoard(getDb(), { q, showLost });
  const data: CardData[] = cards.map((c) => ({
    ...c,
    nextAppointmentAt: c.nextAppointmentAt?.toISOString() ?? null,
    nextTaskDueAt: c.nextTaskDueAt?.toISOString() ?? null,
  }));
  const lost = stages.find((s) => s.kind === "lost");
  return (
    <div>
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Zoek op naam, plaats, postcode, e-mail, telefoon of offertenummer"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 md:max-w-xl"
        />
        {showLost && <input type="hidden" name="vervallen" value="1" />}
        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white">Zoeken</button>
        {q && (
          <Link href={showLost ? "/bord?vervallen=1" : "/bord"} className="text-sm text-stone-600 underline">
            Wissen
          </Link>
        )}
        <Link
          href={`/bord?${new URLSearchParams({ ...(q ? { q } : {}), ...(showLost ? {} : { vervallen: "1" }) })}`}
          className="ml-auto rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {showLost ? "Verberg vervallen" : "Toon vervallen"}
        </Link>
      </form>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-stone-500">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-amber-400 bg-amber-50" />Geen volgende actie</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-red-400 bg-red-50" />Actie verlopen</span>
        <span className="hidden md:inline">Sleep een kaart naar een andere kolom of kies de fase in de keuzelijst.</span>
      </div>
      <Board
        columns={visible.map((s) => ({ key: s.key, label: s.label, kind: s.kind, color: s.color }))}
        allStages={stages.map((s) => ({ key: s.key, label: s.label, kind: s.kind }))}
        cards={data}
        lostKey={lost?.key ?? null}
      />
    </div>
  );
}
