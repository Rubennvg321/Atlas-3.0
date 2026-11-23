"use client";

import { useActionState } from "react";
import { linkAppointmentAction } from "@/app/actions";
import { FormMessage, Select, SubmitButton } from "./ui";

/** "Afspraken zonder klant": de afspraak aan een bestaand traject koppelen. */
export function LinkAppointmentForm({ appointmentId, options }: { appointmentId: string; options: { id: string; label: string }[] }) {
  const [state, action] = useActionState(linkAppointmentAction, null);
  if (!options.length) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <Select name="trajectId" required defaultValue="" className="max-w-56 py-1 text-sm" aria-label="Koppelen aan traject">
        <option value="" disabled>
          Koppelen aan…
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
