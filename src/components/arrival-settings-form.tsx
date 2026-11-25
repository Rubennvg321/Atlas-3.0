"use client";

import { useActionState } from "react";
import { saveArrivalSettingsAction } from "@/app/(app)/aankomst/actions";
import { Field, Input, SubmitButton, Textarea } from "./ui";

export function ArrivalSettingsForm({ s }: { s: { enabled: boolean; askHour: number; reminderHour: number; times: string[]; subject: string; body: string } }) {
  const [state, action] = useActionState(saveArrivalSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Tijden om uit te kiezen (komma ertussen)">
        <Input name="times" defaultValue={s.times.join(", ")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vragen vanaf (uur, 2 dagen ervoor)">
          <Input name="askHour" type="number" min={5} max={22} defaultValue={s.askHour} />
        </Field>
        <Field label="Herinnering om (uur)">
          <Input name="reminderHour" type="number" min={5} max={23} defaultValue={s.reminderHour} />
        </Field>
      </div>
      <Field label="Onderwerp ({datum} wordt ingevuld)">
        <Input name="subject" defaultValue={s.subject} />
      </Field>
      <Field label="Tekst ({naam}, {datum} en {tijd} worden ingevuld)">
        <Textarea name="body" rows={8} defaultValue={s.body} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={s.enabled} className="h-4 w-4 accent-stone-900" />
        Twee dagen voor elke montage vragen hoe laat ik aankom (de mail gaat pas na mijn keuze)
      </label>
      {state && <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.ok ? state.message : state.error}</p>}
      <SubmitButton>Opslaan</SubmitButton>
    </form>
  );
}
