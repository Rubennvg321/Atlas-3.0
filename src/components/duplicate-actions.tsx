"use client";

import { useState, useTransition } from "react";
import { mergeAction, notSameAction } from "@/app/actions";
import { Button } from "./ui";

export function DuplicateActions({ duplicateId, a, b }: { duplicateId: string; a: { id: string; name: string }; b: { id: string; name: string } }) {
  const [survivor, setSurvivor] = useState(a.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium">Welke klant blijft over?</p>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        {[a, b].map((x) => (
          <label key={x.id} className="flex items-center gap-2">
            <input type="radio" name="survivor" checked={survivor === x.id} onChange={() => setSurvivor(x.id)} className="h-4 w-4 accent-stone-900" />
            {x.name}
          </label>
        ))}
      </div>
      <p className="mb-3 text-xs text-stone-500">Alle gegevens, trajecten en historie van beide klanten blijven bewaard. Samenvoegen kan later ongedaan worden gemaakt.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await mergeAction(duplicateId, survivor);
              if (r && !r.ok) setError(r.error);
            })
          }
        >
          Samenvoegen
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await notSameAction(duplicateId);
              if (r && !r.ok) setError(r.error);
            })
          }
        >
          Niet dezelfde
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
