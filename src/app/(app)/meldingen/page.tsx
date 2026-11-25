import { getDb } from "@/db";
import { Card, PageHeader } from "@/components/server-ui";
import { PushSetup } from "@/components/push-setup";
import { NotificationTypesForm } from "@/components/notification-types-form";
import { getSetting } from "@/server/settings";
import { getVapidPublicKey, listSubscriptions, notificationTypes, recentNotifications } from "@/server/notify";
import { openArrivalRequests } from "@/server/arrival";

export const metadata = { title: "Meldingen" };

const STATUS: Record<string, string> = { sent: "verstuurd", pending: "wacht", sending: "wordt verstuurd", skipped: "niet verstuurd", failed: "mislukt" };
const fmt = (d: Date | null) => (d ? d.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" }) : "–");

export default async function MeldingenPage() {
  const db = getDb();
  const [publicKey, s, devices, recent, openArrivals] = await Promise.all([
    getVapidPublicKey(db),
    getSetting(db, "notifications"),
    listSubscriptions(db),
    recentNotifications(db, 15),
    openArrivalRequests(db),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Meldingen" />
      {openArrivals.length > 0 && (
        <Card title="Nog te kiezen: aankomsttijd">
          <ul className="divide-y divide-stone-100 text-sm">
            {openArrivals.map((a) => (
              <li key={a.id}>
                <a href={`/aankomst/${a.id}`} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">{a.customer.displayName}</span>
                  <span className="text-stone-500">montage {a.dateLabel} →</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Dit apparaat">
        <PushSetup publicKey={publicKey} />
      </Card>
      <Card title="Welke meldingen wil je krijgen?">
        <NotificationTypesForm types={notificationTypes.map((t) => ({ ...t, enabled: s.types[t.key] !== false }))} />
      </Card>
      <Card title="Apparaten met meldingen">
        {devices.length ? (
          <ul className="divide-y divide-stone-100 text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex justify-between gap-3 py-2">
                <span>{d.label ?? "Onbekend apparaat"}</span>
                <span className="text-stone-500">sinds {fmt(d.createdAt)}{d.lastSuccessAt ? ` · laatste melding ${fmt(d.lastSuccessAt)}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Nog geen apparaten. Zet hierboven meldingen aan op je telefoon of computer.</p>
        )}
      </Card>
      <Card title="Laatste meldingen">
        {recent.length ? (
          <ul className="divide-y divide-stone-100 text-sm">
            {recent.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex justify-between gap-3">
                  {n.url ? <a href={n.url} className="font-medium hover:underline">{n.title}</a> : <span className="font-medium">{n.title}</span>}
                  <span className="shrink-0 text-stone-500">{fmt(n.createdAt)} · {STATUS[n.status] ?? n.status}</span>
                </div>
                {n.body && <p className="whitespace-pre-line text-stone-500">{n.body}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Nog geen meldingen.</p>
        )}
      </Card>
    </div>
  );
}
