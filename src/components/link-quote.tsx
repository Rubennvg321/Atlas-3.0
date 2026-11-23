"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { linkQuoteAction } from "@/app/actions";
import { Button, FormMessage, Input, Select, SubmitButton } from "./ui";

/** Op de trajectpagina: offertenummer invullen, Atlas haalt de offerte uit WeFact en koppelt hem. */
export function LinkQuoteByNumber({ trajectId, startOpen = false }: { trajectId: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [state, action] = useActionState(linkQuoteAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      setOpen(false);
    }
  }, [state]);
  return (
    <div className="mt-3">
      {state?.ok && <p className="mb-2 text-sm text-emerald-700">Offerte {state.data?.number ?? ""} is gekoppeld.</p>}
      {!open ? (
        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setOpen(true)}>
          + Offerte uit WeFact koppelen
        </Button>
      ) : (
        <form ref={ref} action={action} className="space-y-2 rounded-lg bg-stone-50 p-3">
          <input type="hidden" name="trajectId" value={trajectId} />
          <label className="block text-xs font-medium text-stone-600" htmlFor={`qn-${trajectId}`}>
            Offertenummer uit WeFact
          </label>
          <div className="flex gap-2">
            <Input id={`qn-${trajectId}`} name="quoteNumber" placeholder="bijv. OF2026-0076" autoCapitalize="characters" required />
            <SubmitButton pendingText="Ophalen…">Koppelen</SubmitButton>
          </div>
          <FormMessage state={state} />
        </form>
      )}
    </div>
  );
}

/** Onder Taken: een offerte die Atlas niet zelf kon koppelen aan een traject hangen. */
export function LinkQuoteToTraject({ quoteId, options }: { quoteId: string; options: { id: string; label: string }[] }) {
  const [state, action] = useActionState(linkQuoteAction, null);
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="quoteId" value={quoteId} />
      <Select name="trajectId" required className="min-w-0 flex-1 py-1 text-sm" defaultValue="">
        <option value="" disabled>
          Kies het traject…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" className="px-2.5 py-1 text-xs">
        Koppelen
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
