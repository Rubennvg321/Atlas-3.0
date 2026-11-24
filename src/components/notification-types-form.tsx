"use client";

import { useActionState } from "react";
import { saveNotificationTypes } from "@/app/(app)/meldingen/actions";

export function NotificationTypesForm({ types }: { types: { key: string; label: string; description: string; enabled: boolean }[] }) {
  const [state, action, pending] = useActionState(saveNotificationTypes, null);
  return (
    <form action={action} className="space-y-3">
      {types.map((t) => (
        <label key={t.key} className="flex items-start gap-3 text-sm">
          <input type="checkbox" name={`type_${t.key}`} defaultChecked={t.enabled} className="mt-1 h-4 w-4" />
          <span>
            <span className="font-medium">{t.label}</span>
            <span className="block text-stone-500">{t.description}</span>
          </span>
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Opslaan
        </button>
        {state && <span className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.ok ? state.message : state.error}</span>}
      </div>
    </form>
  );
}
