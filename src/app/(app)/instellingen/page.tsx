import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pipelineStages } from "@/db/schema";
import { getMatchSettings, getSetting } from "@/server/settings";
import { Card, PageHeader } from "@/components/server-ui";
import { AutomationForm, MatchingForm, StagesForm } from "@/components/settings-forms";
import { EVENT_LABEL, EVENT_TARGET, type StageEvent } from "@/lib/stage-rules";

export const metadata = { title: "Instellingen" };

export default async function SettingsPage() {
  const db = getDb();
  const [matching, automation, intake, calendar, stages] = await Promise.all([
    getMatchSettings(db),
    getSetting(db, "automation"),
    getSetting(db, "intakeFilters"),
    getSetting(db, "calendarRules"),
    db.select().from(pipelineStages).where(eq(pipelineStages.active, true)).orderBy(asc(pipelineStages.position)),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Instellingen" />
      <Card title="Klantherkenning en ontdubbeling">
        <p className="mb-4 text-sm text-stone-600">
          Bij elke nieuwe aanvraag, invoer of import berekent Atlas een score per bestaande klant. Vanaf de bovenste drempel wordt automatisch gekoppeld; tussen de twee drempels verschijnt een melding &lsquo;Mogelijk dubbel&rsquo;; daaronder wordt het een nieuwe klant.
        </p>
        <MatchingForm s={matching} />
      </Card>
      <Card title="Fases">
        <StagesForm stages={stages} />
      </Card>
      <Card title="Automatische fasewijzigingen">
        <AutomationForm
          a={automation}
          events={(Object.keys(EVENT_TARGET) as StageEvent[]).map((k) => ({
            key: k,
            label: EVENT_LABEL[k],
            target: stages.find((s) => s.key === EVENT_TARGET[k])?.label ?? EVENT_TARGET[k],
          }))}
        />
      </Card>
      <Card title="Herkenning aanvraagmails en agenda (fase 2)">
        <div className="space-y-2 text-sm text-stone-700">
          {intake.rules.map((r, i) => (
            <p key={i}>
              Aanvraagmail: afzender <code className="rounded bg-stone-100 px-1">{r.from}</code>, onderwerp bevat <code className="rounded bg-stone-100 px-1">{r.subjectContains}</code>
            </p>
          ))}
          <p>
            Adviesgesprek: gele afspraak met &ldquo;{calendar.advies.titleContains}&rdquo; (klant via locatie en gast-e-mail)
          </p>
          <p>Montage: rode afspraak met &ldquo;fam. Naam + straat en huisnummer&rdquo;</p>
          <p className="text-xs text-stone-500">Deze regels worden actief zodra Gmail en Google Agenda zijn gekoppeld.</p>
        </div>
      </Card>
    </div>
  );
}
