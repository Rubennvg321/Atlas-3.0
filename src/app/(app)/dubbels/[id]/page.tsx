import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getDuplicate } from "@/server/queries";
import { getStages } from "@/server/trajects";
import { DuplicateActions } from "@/components/duplicate-actions";
import { PageHeader } from "@/components/server-ui";
import { date } from "@/lib/format";
import { displayName, formatPostcode } from "@/lib/normalize";
import type { Signal } from "@/lib/matching/score";

type Detail = NonNullable<Awaited<ReturnType<typeof getDuplicate>>>["a"];

export default async function DuplicatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const d = await getDuplicate(db, id);
  if (!d) notFound();
  const stages = await getStages(db);
  const signals = (d.duplicate.signals as Signal[]) ?? [];
  const decided = d.duplicate.status !== "open" || d.a.customer.mergedIntoId || d.b.customer.mergedIntoId;

  const rowsFor = (x: Detail) => ({
    Naam: x.customer.displayName,
    Personen: x.contacts.map((p) => displayName({ firstName: p.firstName, infix: p.infix, lastName: p.lastName })).join(", "),
    Adres: [x.customer.street, [x.customer.houseNumber, x.customer.houseNumberAddition].filter(Boolean).join("")].filter(Boolean).join(" "),
    Postcode: formatPostcode(x.customer.postcode),
    Plaats: x.customer.city ?? "",
    Telefoon: x.contactPoints.filter((c) => c.kind === "phone").map((c) => c.value).join(", "),
    "E-mail": x.contactPoints.filter((c) => c.kind === "email").map((c) => c.value).join(", "),
    Trajecten: x.trajects.map((t) => `#${t.number} ${stages.find((s) => s.key === t.stage)?.label ?? t.stage}`).join(", "),
    "Aangemaakt": date(x.customer.createdAt),
  });
  const A = rowsFor(d.a);
  const B = rowsFor(d.b);
  const norm = (s: string) => s.toLowerCase().replace(/\s/g, "");

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Mogelijk dubbel">
        <Link href="/dubbels" className="text-sm underline">
          ← Alle meldingen
        </Link>
      </PageHeader>
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium">Waarom deze melding? (score {d.duplicate.score})</p>
        <ul className="flex flex-wrap gap-2">
          {signals.map((s, i) => (
            <li key={i} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs">
              {s.label} {s.points ? `(+${s.points})` : ""}
            </li>
          ))}
        </ul>
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left">
              <th className="w-28 p-3" />
              <th className="p-3">
                <Link className="underline" href={`/klanten/${d.a.customer.id}`}>
                  Klant A
                </Link>
              </th>
              <th className="p-3">
                <Link className="underline" href={`/klanten/${d.b.customer.id}`}>
                  Klant B
                </Link>
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(A).map((k) => {
              const a = A[k as keyof typeof A];
              const b = B[k as keyof typeof B];
              const same = k !== "Aangemaakt" && a && b && norm(a) === norm(b);
              return (
                <tr key={k} className="border-b border-stone-100 align-top">
                  <th className="p-3 text-left text-xs font-medium text-stone-500">{k}</th>
                  <td className={`p-3 ${same ? "bg-emerald-50" : ""}`}>{a || <span className="text-stone-300">—</span>}</td>
                  <td className={`p-3 ${same ? "bg-emerald-50" : ""}`}>{b || <span className="text-stone-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {decided ? (
        <p className="rounded-lg bg-stone-100 px-4 py-3 text-sm">Over deze melding is al beslist.</p>
      ) : (
        <DuplicateActions duplicateId={d.duplicate.id} a={{ id: d.a.customer.id, name: `A: ${d.a.customer.displayName}` }} b={{ id: d.b.customer.id, name: `B: ${d.b.customer.displayName}` }} />
      )}
    </div>
  );
}
