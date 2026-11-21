"use client";

import { useActionState } from "react";
import { importAction } from "@/app/actions";
import { FormMessage, SubmitButton, Textarea } from "./ui";

const LABEL = { none: "Nieuw", auto: "Gekoppeld", doubt: "Mogelijk dubbel", error: "Fout", skipped: "Overgeslagen" } as const;
const TONE = { none: "text-emerald-700", auto: "text-sky-700", doubt: "text-amber-700", error: "text-red-700", skipped: "text-stone-500" } as const;

export function ImportForm() {
  const [state, action] = useActionState(importAction, null);
  const summary = state?.ok ? state.data : null;
  const committed = state?.mode === "commit" && state.ok;
  return (
    <div className="space-y-4">
      {!committed && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="mode" value="preview" />
          <input type="file" name="file" accept=".csv,text/csv,text/plain" className="block text-sm" />
          <p className="text-xs text-stone-500">of plak de regels hieronder (eerste regel = kolomnamen)</p>
          <Textarea name="csv" rows={6} defaultValue={state?.csv ?? ""} placeholder={"Naam;Telefoon;E-mail;Adres;Postcode;Plaats;Fase\nPeter Jansen;06-12345678;p.jansen@ziggo.nl;Kerkstraat 12;6511 AB;Nijmegen;Afgerond"} className="font-mono text-xs" />
          <SubmitButton pendingText="Controleren…">Controleren (er wordt nog niets opgeslagen)</SubmitButton>
        </form>
      )}
      <FormMessage state={state} />
      {summary && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{summary.counts.nieuw} nieuw</span>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">{summary.counts.gekoppeld} gekoppeld aan bestaande klant</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">{summary.counts.mogelijkDubbel} mogelijk dubbel</span>
            <span className="rounded-full bg-red-50 px-3 py-1 text-red-800">{summary.counts.fouten} fouten</span>
            <span className="rounded-full bg-stone-100 px-3 py-1">{summary.counts.overgeslagen} overgeslagen</span>
          </div>
          {summary.unknownColumns.length > 0 && <p className="text-xs text-stone-500">Genegeerde kolommen: {summary.unknownColumns.join(", ")}</p>}
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="p-2">Regel</th>
                  <th className="p-2">Naam</th>
                  <th className="p-2">Resultaat</th>
                  <th className="p-2">Toelichting</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.row} className="border-t border-stone-100">
                    <td className="p-2 text-stone-500">{r.row}</td>
                    <td className="p-2">{r.name}</td>
                    <td className={`p-2 font-medium ${TONE[r.decision]}`}>{LABEL[r.decision]}</td>
                    <td className="p-2 text-stone-600">{r.message ?? (r.matchedCustomer ? `↔ ${r.matchedCustomer}` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {committed ? (
            <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Import voltooid. Controleer eventuele meldingen onder &lsquo;Mogelijk dubbel&rsquo;.</p>
          ) : (
            <form action={action}>
              <input type="hidden" name="mode" value="commit" />
              <input type="hidden" name="csv" value={state?.csv ?? ""} />
              <SubmitButton pendingText="Importeren…">Definitief importeren</SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
