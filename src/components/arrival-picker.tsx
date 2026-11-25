"use client";

import { useActionState, useTransition } from "react";
import { chooseArrivalAction } from "@/app/(app)/aankomst/actions";

/** Grote knoppen per kwartierblok; één tik = keuze vastleggen en de klant mailen. */
export function ArrivalPicker({
  id,
  windows,
  current,
  disabled,
  shownError,
}: {
  id: string;
  windows: { from: string; to: string }[];
  current: string | null;
  disabled?: boolean;
  shownError?: string | null;
}) {
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
      <div className="grid grid-cols-2 gap-2">
        {windows.map((w) => (
          <button
            key={w.from}
            type="button"
            onClick={() => choose(w.from)}
            disabled={pending || disabled}
            className={`rounded-xl border px-3 py-4 text-lg font-semibold tabular-nums disabled:opacity-50 ${
              current === w.from ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white active:bg-stone-100"
            }`}
          >
            {w.from.replace(/^0/, "")} – {w.to.replace(/^0/, "")}
          </button>
        ))}
      </div>
      {pending && <p className="text-sm text-stone-500">Bezig met mailen…</p>}
      {state && !(!state.ok && state.error === shownError) && <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.ok ? `✓ ${state.message}` : state.error}</p>}
    </div>
  );
}
