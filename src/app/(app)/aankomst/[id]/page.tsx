import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Card, PageHeader } from "@/components/server-ui";
import { ArrivalPicker } from "@/components/arrival-picker";
import { formatWindow, getArrivalRequest } from "@/server/arrival";
import { dayKey } from "@/lib/montage-days";

export const metadata = { title: "Aankomsttijd" };

export default async function AankomstPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getArrivalRequest(getDb(), id);
  if (!r) notFound();
  const past = r.montageDate < dayKey(new Date());
  const sent = r.sentTime && r.sentAt;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Hoe laat kom je aan?" />
      <Card>
        <div className="space-y-1 text-sm">
          <p className="text-base font-semibold">{r.customer.displayName}</p>
          <p>Montage op {r.dateLabel}</p>
          {r.customer.address && <p className="text-stone-600">{r.customer.address}</p>}
          <p className="text-stone-600">
            {r.customer.email ? (
              <>Mail gaat naar {r.customer.email}</>
            ) : (
              <span className="text-red-700">
                Geen e-mailadres bekend. <Link href={`/klanten/${r.customerId}`} className="underline">Voeg het toe bij de klant</Link> en kies dan een tijd.
              </span>
            )}
          </p>
        </div>
      </Card>
      <Card title={sent ? "Andere tijd kiezen" : "Kies je aankomsttijd (tijdblok)"}>
        {sent && (
          <p className="mb-3 text-sm text-emerald-700">
            ✓ &ldquo;{formatWindow(r.sentTime!, r.times)} uur&rdquo; is gemaild naar {r.sentTo}. Kies je een andere tijd, dan krijgt de klant een nieuwe mail.
          </p>
        )}
        {r.status === "gekozen" && r.lastError && <p className="mb-3 text-sm text-amber-800">De mail is nog niet verstuurd: {r.lastError}</p>}
        {past ? (
          <p className="text-sm text-stone-500">Deze montage is al begonnen.</p>
        ) : (
          <ArrivalPicker id={r.id} windows={r.windows} current={r.chosenTime} disabled={!r.customer.email} shownError={r.status === "gekozen" ? r.lastError : null} />
        )}
      </Card>
      <p className="text-center text-sm">
        <Link href={`/trajecten/${r.trajectId}`} className="text-stone-500 underline">Naar het traject</Link>
      </p>
    </div>
  );
}
