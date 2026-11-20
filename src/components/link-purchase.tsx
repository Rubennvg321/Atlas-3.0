"use client";

import { useActionState } from "react";
import { linkPurchaseAction } from "@/app/actions";
import { FormMessage, Select, SubmitButton } from "./ui";

export function LinkPurchaseForm({ purchaseId, options }: { purchaseId: string; options: { id: string; label: string }[] }) {
  const [state, action] = useActionState(linkPurchaseAction, null);
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="purchaseId" value={purchaseId} />
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
