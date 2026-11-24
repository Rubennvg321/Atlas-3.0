"use client";

import { useActionState, useTransition } from "react";
import { disconnectAction, retrySyncAction, saveMapsKeyAction, saveReviewSettingsAction, saveWefactKeyAction } from "@/app/actions";
import { Button, Field, FormMessage, Input, SubmitButton, Textarea } from "./ui";

export function RetryButton({ provider }: { provider: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={pending} onClick={() => start(() => retrySyncAction(provider))}>
      {pending ? "Bezig…" : "Opnieuw proberen"}
    </Button>
  );
}

export function DisconnectButton({ provider }: { provider: "google" | "wefact" | "google_maps" }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="px-2.5 py-1 text-xs text-red-700"
      disabled={pending}
      onClick={() => confirm("Koppeling verbreken?") && start(() => disconnectAction(provider))}
    >
      Ontkoppelen
    </Button>
  );
}

export function WefactKeyForm({ connected }: { connected: boolean }) {
  const [state, action] = useActionState(saveWefactKeyAction, null);
  return (
    <form action={action} className="space-y-2">
      <Field label={connected ? "Nieuwe API-sleutel (alleen invullen om te vervangen)" : "API-sleutel uit WeFact (Instellingen → API)"}>
        <Input name="apiKey" type="password" autoComplete="off" placeholder="Plak hier de API-sleutel" />
      </Field>
      <FormMessage state={state} />
      {state?.ok && <p className="text-sm text-emerald-700">Gekoppeld. De eerste offertes worden binnen een minuut opgehaald.</p>}
      <SubmitButton pendingText="Controleren…">Opslaan en testen</SubmitButton>
    </form>
  );
}

export function MapsKeyForm({ connected }: { connected: boolean }) {
  const [state, action] = useActionState(saveMapsKeyAction, null);
  return (
    <form action={action} className="space-y-2">
      <Field label={connected ? "Nieuwe API-sleutel (alleen invullen om te vervangen)" : "API-sleutel uit Google Cloud (Places API (New))"}>
        <Input name="apiKey" type="password" autoComplete="off" placeholder="Plak hier de API-sleutel (begint met AIza)" />
      </Field>
      <FormMessage state={state} />
      {state?.ok && <p className="text-sm text-emerald-700">Werkt. Je kunt nu bij elk adresveld zoeken via Google.</p>}
      <SubmitButton pendingText="Controleren…">Opslaan en testen</SubmitButton>
    </form>
  );
}

export function ReviewSettingsForm({ r }: { r: { enabled: boolean; link: string; subject: string; body: string; reminderSubject: string; reminderBody: string } }) {
  const [state, action] = useActionState(saveReviewSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Google-reviewlink">
        <Input name="link" defaultValue={r.link} placeholder="https://g.page/r/…/review" />
      </Field>
      <Field label="Onderwerp reviewverzoek">
        <Input name="subject" defaultValue={r.subject} />
      </Field>
      <Field label="Tekst reviewverzoek ({naam} en {link} worden ingevuld)">
        <Textarea name="body" rows={7} defaultValue={r.body} />
      </Field>
      <Field label="Onderwerp herinnering">
        <Input name="reminderSubject" defaultValue={r.reminderSubject} />
      </Field>
      <Field label="Tekst herinnering">
        <Textarea name="reminderBody" rows={6} defaultValue={r.reminderBody} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={r.enabled} className="h-4 w-4 accent-stone-900" />
        Reviewverzoeken automatisch versturen (2 dagen na de laatste montagedag, herinnering na 7 dagen)
      </label>
      <FormMessage state={state} />
      {state?.ok && <p className="text-sm text-emerald-700">Opgeslagen.</p>}
      <SubmitButton>Opslaan</SubmitButton>
    </form>
  );
}
