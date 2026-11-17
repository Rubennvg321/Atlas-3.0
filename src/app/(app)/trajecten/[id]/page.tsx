import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getTrajectDetail } from "@/server/queries";
import { Card, Badge, stageColor } from "@/components/server-ui";
import { Timeline } from "@/components/timeline";
import { ConfirmAction, NoteForm, TaskForm, TaskItem, TrajectEditForm, TrajectStageControl } from "@/components/traject-client";
import { appointmentLabel, date, euro, formatPostcodeSafe } from "@/lib/format-extra";
import { deleteTrajectAction } from "@/app/actions";
import { displayName } from "@/lib/normalize";

const MELDINGEN: Record<string, { text: string; tone: string }> = {
  nieuw: { text: "Nieuwe klant en traject aangemaakt.", tone: "bg-emerald-50 text-emerald-800" },
  gekoppeld: { text: "Deze klant bestond al. De gegevens zijn gekoppeld aan de bestaande klant.", tone: "bg-sky-50 text-sky-800" },
  dubbel: { text: "Let op: deze klant lijkt op een bestaande klant. Controleer onder 'Mogelijk dubbel'.", tone: "bg-amber-50 text-amber-900" },
};

export default async function TrajectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ melding?: string }> }) {
  const { id } = await params;
  const { melding } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await getTrajectDetail(getDb(), id);
  if (!d || d.traject.deletedAt) notFound();
  const { traject: t, customer: c } = d;
  const stage = d.stages.find((s) => s.key === t.stage);
  const hasSite = !!(t.siteStreet || t.sitePostcode);
  const address = hasSite
    ? { street: t.siteStreet, nr: t.siteHouseNumber, add: t.siteHouseNumberAddition, pc: t.sitePostcode, city: t.siteCity }
    : { street: c.street, nr: c.houseNumber, add: c.houseNumberAddition, pc: c.postcode, city: c.city };
  const addressLine = [address.street, [address.nr, address.add].filter(Boolean).join("")].filter(Boolean).join(" ");
  const mapsQuery = encodeURIComponent(`${addressLine} ${address.pc ?? ""} ${address.city ?? ""}`.trim());
  const path = `/trajecten/${t.id}`;
  const m = melding ? MELDINGEN[melding] : null;

  return (
    <div className="space-y-4">
      {m && <p className={`rounded-lg px-4 py-2 text-sm ${m.tone}`}>{m.text}</p>}
      {d.duplicates.length > 0 && (
        <Link href={`/dubbels/${d.duplicates[0].id}`} className="block rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800 hover:bg-red-100">
          ⚠ Mogelijk dubbel met een andere klant: bekijk en beslis →
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/klanten/${c.id}`} className="text-xl font-semibold hover:underline">
            {c.displayName}
          </Link>
          <p className="text-sm text-stone-500">
            Traject #{t.number}
            {t.title ? ` · ${t.title}` : ""} · gestart {date(t.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stage && <Badge className={stageColor(stage.color)}>{stage.label}</Badge>}
          <TrajectStageControl
            trajectId={t.id}
            stage={t.stage}
            version={t.version}
            stages={d.stages.map((s) => ({ key: s.key, label: s.label, kind: s.kind }))}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Contact" actions={<Link href={`/klanten/${c.id}`} className="text-xs text-stone-600 underline">Klant bewerken</Link>}>
            <ul className="space-y-1.5 text-sm">
              {d.contacts.map((p) => (
                <li key={p.id}>
                  {displayName({ firstName: p.firstName, infix: p.infix, lastName: p.lastName })}
                  {p.role && <span className="text-stone-500"> · {p.role}</span>}
                </li>
              ))}
              {d.contactPoints.map((cp) => (
                <li key={cp.id}>
                  <a className="text-sky-700 underline" href={cp.kind === "email" ? `mailto:${cp.normalized}` : `tel:${cp.normalized}`}>
                    {cp.kind === "phone" ? "☎ " : "✉ "}
                    {cp.value}
                  </a>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={hasSite ? "Montageadres (afwijkend)" : "Adres"} actions={<TrajectEditForm traject={t} />}>
            {addressLine || address.pc ? (
              <div className="text-sm">
                <p>{addressLine || <span className="text-stone-500">Huisnummer onbekend</span>}</p>
                <p>
                  {formatPostcodeSafe(address.pc)} {address.city}
                </p>
                <a className="mt-1 inline-block text-xs text-sky-700 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}>
                  Route in Google Maps
                </a>
              </div>
            ) : (
              <p className="text-sm text-stone-500">Geen adres bekend.</p>
            )}
            {t.description && <p className="mt-3 whitespace-pre-line border-t border-stone-100 pt-3 text-sm text-stone-700">{t.description}</p>}
            {t.referral && <p className="mt-2 text-xs text-stone-500">Bron: {t.referral}</p>}
          </Card>

          {d.otherTrajects.length > 1 && (
            <Card title="Andere trajecten van deze klant">
              <ul className="space-y-1 text-sm">
                {d.otherTrajects
                  .filter((o) => o.id !== t.id)
                  .map((o) => (
                    <li key={o.id}>
                      <Link className="underline" href={`/trajecten/${o.id}`}>
                        #{o.number}
                      </Link>{" "}
                      · {d.stages.find((s) => s.key === o.stage)?.label ?? o.stage} · {date(o.createdAt)}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Taken en vervolgacties">
            <TaskForm trajectId={t.id} />
            <ul className="mt-2 divide-y divide-stone-100">
              {d.tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  path={path}
                  task={{ id: task.id, title: task.title, dueAt: task.dueAt?.toISOString() ?? null, doneAt: task.doneAt?.toISOString() ?? null }}
                />
              ))}
            </ul>
          </Card>

          <Card title="Afspraken">
            {d.appointments.length ? (
              <ul className="space-y-1 text-sm">
                {d.appointments.map((a) => (
                  <li key={a.id} className={a.status === "geannuleerd" ? "text-stone-400 line-through" : ""}>
                    {appointmentLabel(a.startsAt)} · {a.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Nog geen afspraken. (Koppeling met Google Agenda volgt in fase 2.)</p>
            )}
          </Card>

          <Card title="Offertes">
            {d.quotes.length ? (
              <ul className="space-y-1 text-sm">
                {d.quotes.map((q) => (
                  <li key={q.id}>
                    {q.number} · {euro(q.amountIncl)} · {q.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Nog geen offertes. (Koppeling met WeFact volgt in fase 3.)</p>
            )}
          </Card>

          <Card title="Notitie">
            <NoteForm trajectId={t.id} />
          </Card>
        </div>

        <Card title="Tijdlijn">
          <Timeline items={d.timeline.map((x) => ({ ...x.e, actor: x.actor ?? x.actorEmail }))} />
        </Card>
      </div>

      <div className="flex justify-end">
        <ConfirmAction
          label="Traject verwijderen"
          variant="ghost"
          className="text-red-700"
          confirm="Traject verwijderen? Het gaat naar de prullenbak en kan door een beheerder worden teruggezet."
          action={deleteTrajectAction.bind(null, t.id)}
        />
      </div>
    </div>
  );
}
