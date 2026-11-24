"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addContactAction, addContactPointAction, createCustomerAction, removeContactAction, removeContactPointAction, undoMergeAction, updateCustomerAction } from "@/app/actions";
import { AddressSearch } from "./address-search";
import { Button, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "./ui";

export type NewCustomerDefaults = Partial<Record<"appointmentId" | "lastName" | "postcode" | "houseNumber" | "addition" | "street" | "city" | "message", string>>;

export function NewCustomerForm({ defaults = {} }: { defaults?: NewCustomerDefaults }) {
  const [state, action] = useActionState(createCustomerAction, null);
  return (
    <form action={action} className="space-y-4">
      {defaults.appointmentId && (
        <>
          <input type="hidden" name="appointmentId" value={defaults.appointmentId} />
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">De agenda-afspraak wordt na het opslaan aan deze klant gekoppeld.</p>
        </>
      )}
      <fieldset className="grid grid-cols-6 gap-2">
        <Field label="Voornaam" className="col-span-6 sm:col-span-2">
          <Input name="firstName" autoComplete="off" />
        </Field>
        <Field label="Tussenv." className="col-span-2 sm:col-span-1">
          <Input name="infix" placeholder="van der" autoComplete="off" />
        </Field>
        <Field label="Achternaam" className="col-span-4 sm:col-span-3">
          <Input name="lastName" defaultValue={defaults.lastName} autoComplete="off" />
        </Field>
      </fieldset>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <Field label="Telefoon">
          <Input name="phone" type="tel" inputMode="tel" />
        </Field>
        <Field label="E-mail">
          <Input name="email" type="email" inputMode="email" />
        </Field>
        <Field label="Tweede telefoon (bijv. partner)">
          <Input name="phone2" type="tel" inputMode="tel" />
        </Field>
        <Field label="Tweede e-mail">
          <Input name="email2" type="email" inputMode="email" />
        </Field>
      </fieldset>
      <AddressSearch />
      <fieldset className="grid grid-cols-6 gap-2">
        <Field label="Postcode" className="col-span-3 sm:col-span-2">
          <Input name="postcode" defaultValue={defaults.postcode} placeholder="1234 AB" autoCapitalize="characters" />
        </Field>
        <Field label="Huisnr" className="col-span-2 sm:col-span-1">
          <Input name="houseNumber" defaultValue={defaults.houseNumber} inputMode="numeric" />
        </Field>
        <Field label="Toev." className="col-span-1">
          <Input name="addition" defaultValue={defaults.addition} />
        </Field>
        <Field label="Straat" className="col-span-6 sm:col-span-2">
          <Input name="street" defaultValue={defaults.street} />
        </Field>
        <Field label="Plaats" className="col-span-6 sm:col-span-3">
          <Input name="city" defaultValue={defaults.city} />
        </Field>
      </fieldset>
      <Field label="Vraag / omschrijving">
        <Textarea name="message" rows={3} defaultValue={defaults.message} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="noTraject" /> Alleen klant opslaan (geen traject op het bord)
      </label>
      <FormMessage state={state} />
      <p className="text-xs text-stone-500">Atlas controleert automatisch of deze klant al bestaat (adres, telefoon, e-mail, naam).</p>
      <SubmitButton>Opslaan</SubmitButton>
    </form>
  );
}

export function CustomerEditForm({
  c,
}: {
  c: { id: string; displayName: string; street: string | null; houseNumber: number | null; houseNumberAddition: string | null; postcode: string | null; city: string | null; notes: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateCustomerAction, null);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  if (!open)
    return (
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOpen(true)}>
        Bewerken
      </Button>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
      <form action={action} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Klant bewerken</h2>
        <input type="hidden" name="id" value={c.id} />
        <Field label="Naam (zoals op het bord)">
          <Input name="displayName" defaultValue={c.displayName} required />
        </Field>
        <AddressSearch />
        <div className="grid grid-cols-6 gap-2">
          <Field label="Straat" className="col-span-4">
            <Input name="street" defaultValue={c.street ?? ""} />
          </Field>
          <Field label="Nr" className="col-span-1">
            <Input name="houseNumber" inputMode="numeric" defaultValue={c.houseNumber ?? ""} />
          </Field>
          <Field label="Toev." className="col-span-1">
            <Input name="addition" defaultValue={c.houseNumberAddition ?? ""} />
          </Field>
          <Field label="Postcode" className="col-span-2">
            <Input name="postcode" defaultValue={c.postcode ?? ""} />
          </Field>
          <Field label="Plaats" className="col-span-4">
            <Input name="city" defaultValue={c.city ?? ""} />
          </Field>
        </div>
        <Field label="Notities over de klant">
          <Textarea name="notes" rows={3} defaultValue={c.notes ?? ""} />
        </Field>
        <FormMessage state={state} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Annuleren
          </Button>
          <SubmitButton>Opslaan</SubmitButton>
        </div>
      </form>
    </div>
  );
}

export function ContactPointForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(addContactPointAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="mt-3 space-y-2">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="flex gap-2">
        <Select name="kind" className="shrink-0">
          <option value="phone">Telefoon</option>
          <option value="email">E-mail</option>
        </Select>
        <Input name="value" required placeholder="Toevoegen…" />
        <SubmitButton variant="secondary">+</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function ContactForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(addContactAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="mt-3 space-y-2">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid grid-cols-6 gap-2">
        <Input name="firstName" placeholder="Voornaam" className="col-span-2" />
        <Input name="infix" placeholder="tv." className="col-span-1" />
        <Input name="lastName" placeholder="Achternaam" className="col-span-3" />
        <Input name="role" placeholder="Rol, bijv. partner" className="col-span-4" />
        <div className="col-span-2 flex justify-end">
          <SubmitButton variant="secondary">Toevoegen</SubmitButton>
        </div>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function RemoveButton({ kind, id, customerId }: { kind: "point" | "contact"; id: string; customerId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className="text-xs text-stone-400 hover:text-red-600"
      aria-label="Verwijderen"
      onClick={() => {
        if (confirm("Verwijderen?")) start(() => (kind === "point" ? removeContactPointAction(id, customerId) : removeContactAction(id, customerId)));
      }}
    >
      ✕
    </button>
  );
}

export function UndoMergeButton({ mergeId, customerId }: { mergeId: string; customerId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <Button
        variant="secondary"
        className="px-2 py-1 text-xs"
        disabled={pending}
        onClick={() =>
          confirm("Samenvoeging ongedaan maken? Alle gegevens gaan terug naar de oorspronkelijke klant.") &&
          start(async () => {
            const r = await undoMergeAction(mergeId, customerId);
            if (!r.ok) setError(r.error);
          })
        }
      >
        Ongedaan maken
      </Button>
      {error && <span className="ml-2 text-xs text-red-700">{error}</span>}
    </span>
  );
}
