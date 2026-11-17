import Link from "next/link";
import { getDb } from "@/db";
import { listOpenDuplicates } from "@/server/queries";
import { PageHeader } from "@/components/server-ui";
import { date } from "@/lib/format";

export const metadata = { title: "Mogelijk dubbel" };

export default async function DuplicatesPage() {
  const rows = await listOpenDuplicates(getDb());
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Mogelijk dubbel" />
      <p className="mb-4 text-sm text-stone-600">
        Deze klanten lijken op elkaar, maar niet genoeg om automatisch samen te voegen. Bekijk ze naast elkaar en kies <strong>Samenvoegen</strong> of <strong>Niet dezelfde</strong>.
      </p>
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/dubbels/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
              <span className="font-medium">
                {r.a_name} <span className="text-stone-400">↔</span> {r.b_name}
              </span>
              <span className="shrink-0 text-xs text-stone-500">
                score {r.score} · {date(r.created_at)}
              </span>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-6 text-sm text-stone-500">Geen meldingen. 🎉</li>}
      </ul>
    </div>
  );
}
