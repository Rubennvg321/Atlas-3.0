import Link from "next/link";
import { getDb } from "@/db";
import { getMyTasks, openTrajectOptions, trajectsWithoutAction } from "@/server/queries";
import { getStages } from "@/server/trajects";
import { Card, PageHeader } from "@/components/server-ui";
import { TaskItem } from "@/components/traject-client";
import { euro, isoDay } from "@/lib/format";
import { unlinkedPurchases } from "@/server/purchases";
import { LinkPurchaseForm } from "@/components/link-purchase";
import { LinkQuoteToTraject } from "@/components/link-quote";
import { unlinkedQuotes } from "@/server/integrations/wefact-sync";

export const metadata = { title: "Taken" };

export default async function TasksPage() {
  const db = getDb();
  const [rows, idle, stages, unlinked] = await Promise.all([getMyTasks(db), trajectsWithoutAction(db), getStages(db), unlinkedPurchases(db)]);
  const looseQuotes = await unlinkedQuotes(db);
  const allOpen = await openTrajectOptions(db);
  const today = isoDay(new Date());
  const weekEnd = isoDay(new Date(Date.now() + 7 * 86400000));
  const groups = {
    "Te laat": rows.filter((r) => r.task.dueAt && isoDay(r.task.dueAt) < today),
    Vandaag: rows.filter((r) => r.task.dueAt && isoDay(r.task.dueAt) === today),
    "Komende 7 dagen": rows.filter((r) => r.task.dueAt && isoDay(r.task.dueAt) > today && isoDay(r.task.dueAt) <= weekEnd),
    Later: rows.filter((r) => r.task.dueAt && isoDay(r.task.dueAt) > weekEnd),
    "Zonder deadline": rows.filter((r) => !r.task.dueAt),
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Taken" />
      {looseQuotes.length > 0 && (
        <Card title={`Offertes te koppelen (${looseQuotes.length})`} className="border-violet-200">
          <p className="mb-2 text-xs text-stone-500">Deze offertes uit WeFact kon Atlas niet met zekerheid aan één traject koppelen.</p>
          <ul className="space-y-3">
            {looseQuotes.map((q) => (
              <li key={q.id} className="text-sm">
                <p>
                  <strong>{q.number ?? "Offerte"}</strong>
                  {q.amountExcl ? ` · ${euro(q.amountExcl)} excl. btw` : ""} · {q.status}
                </p>
                <LinkQuoteToTraject quoteId={q.id} options={allOpen} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {unlinked.length > 0 && (
        <Card title={`Inkoop te koppelen (${unlinked.length})`} className="border-orange-200">
          <p className="mb-2 text-xs text-stone-500">Atlas kon deze orderbevestigingen niet met zekerheid aan één traject koppelen.</p>
          <ul className="space-y-3">
            {unlinked.map((p) => (
              <li key={p.id} className="text-sm">
                <p>
                  <strong>{p.supplier}</strong>
                  {p.orderNumber ? ` ${p.orderNumber}` : ""} · {euro(p.amountExcl)} excl. btw
                  {p.commission ? <span className="text-stone-500"> · Commissie: {p.commission}</span> : null}
                </p>
                <LinkPurchaseForm purchaseId={p.id} options={allOpen} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {Object.entries(groups).map(([label, items]) =>
        items.length || label === "Vandaag" ? (
          <Card key={label} title={`${label} (${items.length})`} className={label === "Te laat" ? "border-red-200" : ""}>
            {items.length ? (
              <ul className="divide-y divide-stone-100">
                {items.map((r) => (
                  <div key={r.task.id}>
                    <TaskItem path="/taken" task={{ id: r.task.id, title: r.task.title, dueAt: r.task.dueAt?.toISOString() ?? null, dueHasTime: r.task.dueHasTime, doneAt: null }} />
                    <Link href={`/trajecten/${r.task.trajectId}`} className="-mt-1 mb-2 block pl-8 text-xs text-sky-700 underline">
                      {r.customerName}
                      {r.city ? `, ${r.city}` : ""} · #{r.trajectNumber}
                    </Link>
                  </div>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Niets voor vandaag.</p>
            )}
          </Card>
        ) : null,
      )}
      {idle.length > 0 && (
        <Card title={`Lopende trajecten zonder volgende actie (${idle.length})`} className="border-amber-200">
          <ul className="space-y-1 text-sm">
            {idle.map((t) => (
              <li key={t.id}>
                <Link href={`/trajecten/${t.id}`} className="underline">
                  {t.name}
                </Link>
                <span className="text-stone-500">
                  {" "}
                  · {t.city ?? ""} · {stages.find((s) => s.key === t.stage)?.label}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
