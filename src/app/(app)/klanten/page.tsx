import Link from "next/link";
import { getDb } from "@/db";
import { listCustomers } from "@/server/queries";
import { PageHeader } from "@/components/server-ui";
import { formatPostcode } from "@/lib/normalize";

export const metadata = { title: "Klanten" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const rows = await listCustomers(getDb(), q, 200);
  return (
    <div>
      <PageHeader title="Klanten">
        <Link href="/klanten/nieuw" className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white">
          + Nieuwe klant
        </Link>
      </PageHeader>
      <form className="mb-3 flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Zoek op naam, plaats, postcode, e-mail, telefoon of offertenummer" className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 md:max-w-xl" />
        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white">Zoeken</button>
      </form>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <ul className="divide-y divide-stone-100">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/klanten/${r.id}`} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-stone-50 md:flex-row md:items-center md:gap-4">
                <span className="font-medium md:w-64">{r.name}</span>
                <span className="text-sm text-stone-600 md:w-72">
                  {[r.street, [r.houseNumber, r.addition].filter(Boolean).join("")].filter(Boolean).join(" ")} {formatPostcode(r.postcode)} {r.city}
                </span>
                <span className="text-sm text-stone-500 md:flex-1">{[r.phone, r.email].filter(Boolean).join(" · ")}</span>
                <span className="text-xs text-stone-400">{r.trajectCount} traject(en)</span>
              </Link>
            </li>
          ))}
          {!rows.length && <li className="px-4 py-6 text-sm text-stone-500">Geen klanten gevonden.</li>}
        </ul>
      </div>
    </div>
  );
}
