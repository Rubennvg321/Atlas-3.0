import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { syncRuns } from "@/db/schema";
import { getIntegration } from "@/server/integrations/state";
import { getSetting } from "@/server/settings";
import { Badge, Card, PageHeader } from "@/components/server-ui";
import { DisconnectButton, RetryButton, ReviewSettingsForm, WefactKeyForm } from "@/components/koppelingen-client";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Koppelingen" };

const STATUS: Record<string, { label: string; cls: string }> = {
  gekoppeld: { label: "Werkt", cls: "bg-emerald-100 text-emerald-800" },
  fout: { label: "Fout", cls: "bg-red-100 text-red-800" },
  verlopen: { label: "Opnieuw koppelen", cls: "bg-amber-100 text-amber-900" },
  niet_gekoppeld: { label: "Niet gekoppeld", cls: "bg-stone-200 text-stone-700" },
};

function Status({ s }: { s: string | undefined }) {
  const v = STATUS[s ?? "niet_gekoppeld"] ?? STATUS.niet_gekoppeld;
  return <Badge className={v.cls}>{v.label}</Badge>;
}

async function SyncLine({ provider, label }: { provider: "gmail" | "google_calendar" | "wefact" | "dagelijks"; label: string }) {
  const db = getDb();
  const row = await getIntegration(db, provider);
  const [last] = await db.select().from(syncRuns).where(eq(syncRuns.provider, provider)).orderBy(desc(syncRuns.startedAt)).limit(1);
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-t border-stone-100 py-2 first:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {label} <Status s={row?.status} />
        </p>
        <p className="text-xs text-stone-500">
          Laatst gelukt: {row?.lastSuccessAt ? dateTime(row.lastSuccessAt) : "nog niet"}
          {last?.status === "ok" ? ` · ${last.itemsProcessed} verwerkt` : ""}
        </p>
        {row?.lastError && row.status !== "gekoppeld" && <p className="mt-1 text-xs text-red-700">{row.lastError}</p>}
      </div>
      <RetryButton provider={provider} />
    </div>
  );
}

export default async function KoppelingenPage({ searchParams }: { searchParams: Promise<{ gekoppeld?: string; fout?: string }> }) {
  const sp = await searchParams;
  const db = getDb();
  const [google, wefact, reviews] = await Promise.all([getIntegration(db, "google"), getIntegration(db, "wefact"), getSetting(db, "reviews")]);
  const googleConnected = !!google?.encryptedTokens;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Koppelingen" />
      {sp.gekoppeld && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Google is gekoppeld. Mail en agenda worden binnen een minuut voor het eerst opgehaald.</p>}
      {sp.fout && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">Koppelen is niet gelukt: {sp.fout}</p>}

      <Card title={<span>Google (Gmail en Agenda) <Status s={google?.status} /></span>} actions={googleConnected ? <DisconnectButton provider="google" /> : null}>
        {googleConnected ? (
          <p className="mb-2 text-sm text-stone-600">Gekoppeld met {google?.account}.</p>
        ) : (
          <p className="mb-2 text-sm text-stone-600">Geef Atlas toegang tot je mail en agenda. Atlas leest alleen wat nodig is en verstuurt alleen reviewverzoeken.</p>
        )}
        <a href="/api/koppelingen/google/start" className="inline-block rounded-lg bg-stone-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-stone-700">
          {googleConnected ? "Opnieuw koppelen" : "Koppelen met Google"}
        </a>
        {googleConnected && (
          <div className="mt-4">
            <SyncLine provider="gmail" label="Gmail (aanvragen, orderbevestigingen, geaccepteerde offertes, klantmail) · elke 2 minuten" />
            <SyncLine provider="google_calendar" label="Google Agenda (gele en rode afspraken) · elke 5 minuten" />
          </div>
        )}
      </Card>

      <Card title={<span>WeFact <Status s={wefact?.status} /></span>} actions={wefact?.encryptedTokens ? <DisconnectButton provider="wefact" /> : null}>
        <p className="mb-3 text-sm text-stone-600">
          Offertes en debiteuren uit WeFact. Zorg dat IP-adres <code className="rounded bg-stone-100 px-1">51.15.84.246</code> op de whitelist staat in WeFact (Instellingen → API).
        </p>
        <WefactKeyForm connected={!!wefact?.encryptedTokens} />
        {wefact?.encryptedTokens && (
          <div className="mt-4">
            <SyncLine provider="wefact" label="Offertes · elke 15 minuten" />
          </div>
        )}
      </Card>

      <Card title="Dagelijkse controle">
        <SyncLine provider="dagelijks" label="Kaarten naar 'In uitvoering' en reviewverzoeken · elk uur" />
      </Card>

      <Card title="Reviewverzoeken">
        <ReviewSettingsForm r={reviews} />
      </Card>
    </div>
  );
}
