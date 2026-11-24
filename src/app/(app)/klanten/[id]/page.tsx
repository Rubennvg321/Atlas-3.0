import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCustomerDetail } from "@/server/queries";
import { getStages } from "@/server/trajects";
import { Badge, Card, PageHeader, stageColor } from "@/components/server-ui";
import { ContactForm, ContactPointForm, CustomerEditForm, RemoveButton, UndoMergeButton } from "@/components/customer-forms";
import { ConfirmAction } from "@/components/traject-client";
import { Timeline } from "@/components/timeline";
import { CopyButton } from "@/components/copy-button";
import { anonymizeCustomerAction, newTrajectAction } from "@/app/actions";
import { date, euro } from "@/lib/format";
import { QuotePdfLink } from "@/components/quote-pdf-link";
import { displayName, formatPostcode } from "@/lib/normalize";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ melding?: string }> }) {
  const { id } = await params;
  const { melding } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const d = await getCustomerDetail(db, id);
  if (!d) notFound();
  if (d.customer.mergedIntoId) redirect(`/klanten/${d.customer.mergedIntoId}`);
  const stages = await getStages(db);
  const c = d.customer;
  const streetLine = [c.street, [c.houseNumber, c.houseNumberAddition].filter(Boolean).join("")].filter(Boolean).join(" ");
  return (
    <div className="space-y-4">
      {melding === "samengevoegd" && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Klanten samengevoegd. Je kunt dit hieronder ongedaan maken.</p>}
      {c.anonymizedAt && <p className="rounded-lg bg-stone-200 px-4 py-2 text-sm">Deze klant is geanonimiseerd op {date(c.anonymizedAt)}.</p>}
      {d.duplicates.length > 0 && (
        <Link href={`/dubbels/${d.duplicates[0].id}`} className="block rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800 hover:bg-red-100">
          ⚠ Mogelijk dubbel met een andere klant: bekijk en beslis →
        </Link>
      )}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1">
            {c.displayName}
            <CopyButton text={c.displayName} label="Naam" />
          </span>
        }
      >
        <form action={newTrajectAction.bind(null, c.id)}>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white">+ Nieuw traject</button>
        </form>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Adres" actions={<CustomerEditForm c={c} />}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm">{streetLine || <span className="text-stone-500">Straat/huisnummer onbekend</span>}</p>
                <p className="text-sm">
                  {formatPostcode(c.postcode)} {c.city}
                </p>
              </div>
              {(streetLine || c.postcode || c.city) && (
                <CopyButton text={[streetLine, [formatPostcode(c.postcode), c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")} label="Adres" />
              )}
            </div>
            {c.notes && <p className="mt-3 whitespace-pre-line border-t border-stone-100 pt-3 text-sm text-stone-700">{c.notes}</p>}
            {c.wefactDebtorCode && <p className="mt-2 text-xs text-stone-500">WeFact-debiteur: {c.wefactDebtorCode}</p>}
          </Card>
          <Card title="Contactgegevens">
            <ul className="space-y-1.5 text-sm">
              {d.contactPoints.map((cp) => (
                <li key={cp.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">
                    <a className="break-all text-sky-700 underline" href={cp.kind === "email" ? `mailto:${cp.normalized}` : `tel:${cp.normalized}`}>
                      {cp.kind === "phone" ? "☎ " : "✉ "}
                      {cp.value}
                    </a>
                    <CopyButton text={cp.value} label={cp.kind === "email" ? "E-mailadres" : "Telefoonnummer"} />
                  </span>
                  <RemoveButton kind="point" id={cp.id} customerId={c.id} />
                </li>
              ))}
            </ul>
            <ContactPointForm customerId={c.id} />
          </Card>
          <Card title="Contactpersonen">
            <ul className="space-y-1.5 text-sm">
              {d.contacts.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span>
                      {displayName({ firstName: p.firstName, infix: p.infix, lastName: p.lastName })}
                      {p.role && <span className="text-stone-500"> · {p.role}</span>}
                    </span>
                    {displayName({ firstName: p.firstName, infix: p.infix, lastName: p.lastName }) && (
                      <CopyButton text={displayName({ firstName: p.firstName, infix: p.infix, lastName: p.lastName })} label="Naam" />
                    )}
                  </span>
                  <RemoveButton kind="contact" id={p.id} customerId={c.id} />
                </li>
              ))}
            </ul>
            <ContactForm customerId={c.id} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Trajecten">
            <ul className="divide-y divide-stone-100">
              {d.trajects.map((t) => {
                const s = stages.find((x) => x.key === t.stage);
                return (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/trajecten/${t.id}`} className="underline">
                      #{t.number} {t.title ?? ""}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-stone-500">{date(t.createdAt)}</span>
                      {s && <Badge className={stageColor(s.color)}>{s.label}</Badge>}
                    </span>
                  </li>
                );
              })}
              {!d.trajects.length && <li className="py-2 text-sm text-stone-500">Nog geen trajecten.</li>}
            </ul>
          </Card>
          {d.quotes.length > 0 && (
            <Card title="Offertes">
              <ul className="space-y-1.5 text-sm">
                {d.quotes.map((q) => {
                  const t = d.trajects.find((x) => x.id === q.trajectId);
                  return (
                    <li key={q.id} className="flex flex-wrap items-center justify-between gap-x-2">
                      <span>
                        {q.number ?? "Offerte"} · {euro(q.amountExcl)} excl. btw · {q.status}
                        {t && <span className="text-xs text-stone-500"> · traject #{t.number}</span>}
                      </span>
                      {(q.wefactId || q.number) && <QuotePdfLink quoteId={q.id} />}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          {d.merges.length > 0 && (
            <Card title="Samengevoegd">
              <ul className="space-y-2 text-sm">
                {d.merges.map(({ m, mergedName }) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>
                      {mergedName} <span className="text-xs text-stone-500">· {date(m.createdAt)}</span>
                    </span>
                    <UndoMergeButton mergeId={m.id} customerId={c.id} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Privacy (AVG)">
            <div className="flex flex-wrap gap-2">
              <a href={`/api/klanten/${c.id}/export`} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
                Gegevens exporteren
              </a>
              {!c.anonymizedAt && (
                <ConfirmAction
                  label="Anonimiseren"
                  variant="danger"
                  confirm="Alle persoonsgegevens van deze klant worden definitief verwijderd. Bedragen en fases blijven bewaard voor statistiek. Dit kan niet ongedaan worden gemaakt. Doorgaan?"
                  action={anonymizeCustomerAction.bind(null, c.id)}
                />
              )}
            </div>
          </Card>
        </div>
        <Card title="Tijdlijn (alle trajecten)">
          <Timeline items={d.timeline} />
        </Card>
      </div>
    </div>
  );
}
