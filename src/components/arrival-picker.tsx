"use client";

import { useActionState, useTransition } from "react";
import { chooseArrivalAction } from "@/app/(app)/aankomst/actions";

/** Grote kwartierknoppen; één tik = keuze vastleggen en de klant mailen. */
export function ArrivalPicker({ id, times, current, disabled, shownError }: { id: string; times: string[]; current: string | null; disabled?: boolean; shownError?: string | null }) {
  const [state, action, actionPending] = useActionState(chooseArrivalAction, null);
  const [transitionPending, start] = useTransition();
  const pending = actionPending || transitionPending;
  const choose = (t: string) =>
    start(() => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("time", t);
      action(fd);
    });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {times.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => choose(t)}
            disabled={pending || disabled}
            className={`rounded-xl border px-3 py-4 text-lg font-semibold tabular-nums disabled:opacity-50 ${
              current === t ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white active:bg-stone-100"
            }`}
          >
            {t.replace(/^0/, "")}
          </button>
        ))}
      </div>
      {pending && <p className="text-sm text-stone-500">Bezig met mailen…</p>}
      {state && !(!state.ok && state.error === shownError) && <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.ok ? `✓ ${state.message}` : state.error}</p>}
    </div>
  );
}
