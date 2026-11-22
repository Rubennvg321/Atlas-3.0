"use client";

import { useActionState } from "react";
import { saveAutomationAction, saveDashboardAction, saveMatchingAction, saveStagesAction } from "@/app/actions";
import type { MatchSettings } from "@/lib/matching/score";
import { Field, FormMessage, Input, Select, SubmitButton } from "./ui";

function Saved({ state }: { state: { ok: boolean } | null }) {
  return state?.ok ? <span className="text-sm text-emerald-700">Opgeslagen</span> : null;
}

export function MatchingForm({ s }: { s: MatchSettings }) {
  const [state, action] = useActionState(saveMatchingAction, null);
  const fields: [keyof MatchSettings["weights"], string][] = [
    ["address", "Postcode + huisnummer gelijk"],
    ["addressAdditionMissing", "Idem, toevoeging ontbreekt aan één kant"],
    ["streetHouseNumber", "Straat + huisnummer gelijk (zonder postcode)"],
    ["postcodeOnly", "Alleen postcode gelijk (huisnummer onbekend)"],
    ["phone", "Telefoonnummer gelijk"],
    ["email", "E-mailadres gelijk"],
    ["nameMax", "Achternaam lijkt (maximaal)"],
  ];
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input name={k} type="number" min={0} max={100} defaultValue={s.weights[k]} />
          </Field>
        ))}
        <Field label="Maximum bij alleen naam (nooit samenvoegen op naam)">
          <Input name="nameOnlyCap" type="number" min={0} max={100} defaultValue={s.nameOnlyCap} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Automatisch koppelen vanaf score">
          <Input name="autoThreshold" type="number" min={0} max={100} defaultValue={s.autoThreshold} />
        </Field>
        <Field label="'Mogelijk dubbel' vanaf score">
          <Input name="doubtThreshold" type="number" min={0} max={100} defaultValue={s.doubtThreshold} />
        </Field>
      </div>
      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>Opslaan</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function StagesForm({ stages }: { stages: { key: string; label: string; position: number; kind: string }[] }) {
  const [state, action] = useActionState(saveStagesAction, null);
  return (
    <form action={action} className="space-y-3">
      {stages.map((s) => (
        <div key={s.key} className="flex items-end gap-2">
          <Field label={`Naam (${s.key})`} className="flex-1">
            <Input name={`label_${s.key}`} defaultValue={s.label} />
          </Field>
          <Field label="Volgorde" className="w-24">
            <Input name={`position_${s.key}`} type="number" defaultValue={s.position} />
          </Field>
        </div>
      ))}
      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>Opslaan</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function AutomationForm({ a, events }: { a: Record<string, string>; events: { key: string; label: string; target: string }[] }) {
  const [state, action] = useActionState(saveAutomationAction, null);
  return (
    <form action={action} className="space-y-3">
      {events.map((e) => (
        <Field key={e.key} label={`${e.label} → ${e.target}`}>
          <Select name={e.key} defaultValue={a[e.key] ?? "proposal"} className="w-full">
            <option value="automatic">Automatisch verplaatsen</option>
            <option value="proposal">Als voorstel (ik bevestig)</option>
          </Select>
        </Field>
      ))}
      <p className="text-xs text-stone-500">Kaarten gaan alleen vooruit, nooit terug en nooit uit &lsquo;Vervallen&rsquo;.</p>
      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>Opslaan</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function DashboardForm({ monthlyRevenueTarget }: { monthlyRevenueTarget: number }) {
  const [state, action] = useActionState(saveDashboardAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Omzetdoel per maand (€, excl. btw — leeg of 0 = geen doel)">
        <Input name="monthlyRevenueTarget" inputMode="decimal" defaultValue={monthlyRevenueTarget ? String(monthlyRevenueTarget).replace(".", ",") : ""} placeholder="bijv. 37.000" />
      </Field>
      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>Opslaan</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}
