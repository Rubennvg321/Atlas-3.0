"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addPurchaseAction, decideProposalAction, deletePurchaseAction, saveFinanceAction } from "@/app/actions";
import { date, euroCents as euro } from "@/lib/format";
import { Button, Field, FormMessage, Input, Select, SubmitButton } from "./ui";

export interface FinanceView {
  saleExcl: number | null;
  saleSource: string | null;
  saleManual: number | null;
  hasWefactAmount: boolean;
  purchaseExcl: number | null;
  margin: number | null;
  marginPct: number | null;
  montageDays: number | null;
  montageDaysManual: number | null;
  montageDates: string[];
  marginPerDay: number | null;
  /** Oudste eerst: de eerste is de hoofdbestelling, de rest zijn extra bestellingen. */
  purchases: {
    id: string;
    supplier: string;
    orderNumber: string | null;
    amountExcl: string;
    source: string;
    commission: string | null;
    description: string | null;
    date: string;
  }[];
}

function Row({ label, value, strong, tone }: { label: string; value: React.ReactNode; strong?: boolean; tone?: "pos" | "neg" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-sm text-stone-600">{label}</span>
      <span className={`text-sm ${strong ? "font-semibold" : ""} ${tone === "pos" ? "text-emerald-700" : tone === "neg" ? "text-red-700" : ""}`}>{value}</span>
    </div>
  );
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

export function FinanceCard({ trajectId, f }: { trajectId: string; f: FinanceView }) {
  const [edit, setEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [supplier, setSupplier] = useState("PPC");
  const [state, action] = useActionState(saveFinanceAction, null);
  const [pState, pAction] = useActionState(addPurchaseAction, null);
  const pRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (state?.ok) setEdit(false);
  }, [state]);
  useEffect(() => {
    if (pState?.ok) {
      pRef.current?.reset();
      setSupplier("PPC");
      setAddOpen(false);
    }
  }, [pState]);
  const dash = <span className="text-stone-400">—</span>;
  return (
    <div>
      <Row label={`Verkoop excl. btw${f.saleSource ? ` (${f.saleSource})` : ""}`} value={f.saleExcl !== null ? euro(f.saleExcl) : dash} />
      <Row label="Inkoop excl. btw" value={f.purchaseExcl !== null ? euro(f.purchaseExcl) : dash} />
      <div className="my-1 border-t border-stone-100" />
      <Row
        label="Marge"
        strong
        tone={f.margin === null ? undefined : f.margin >= 0 ? "pos" : "neg"}
        value={f.margin !== null ? `${euro(f.margin)}${f.marginPct !== null ? ` (${f.marginPct.toLocaleString("nl-NL")}%)` : ""}` : dash}
      />
      <Row
        label={`Montagedagen${f.montageDaysManual ? " (handmatig)" : f.montageDates.length ? " (uit agenda)" : ""}`}
        value={f.montageDays ?? dash}
      />
      <Row label="Marge per dag" strong tone={f.marginPerDay === null ? undefined : f.marginPerDay >= 0 ? "pos" : "neg"} value={f.marginPerDay !== null ? euro(f.marginPerDay) : dash} />

      {f.purchases.length > 0 && (
        <div className="mt-3 border-t border-stone-100 pt-2">
          <p className="mb-1 text-xs font-medium text-stone-500">Bestellingen</p>
          <ul className="space-y-1.5 text-xs text-stone-600">
            {f.purchases.map((p, i) => (
              <li key={p.id} className="flex items-start justify-between gap-2">
                <span>
                  <span className={`mr-1 rounded px-1 py-px text-[10px] font-medium ${i === 0 ? "bg-stone-200 text-stone-700" : "bg-amber-100 text-amber-800"}`}>
                    {i === 0 ? "Hoofd" : "Extra"}
                  </span>
                  <span className="font-medium text-stone-800">{p.supplier}</span>
                  {p.orderNumber ? ` ${p.orderNumber}` : ""} · {euro(p.amountExcl)} · {date(p.date)}
                  {p.source === "gmail" ? " · automatisch uit Gmail" : " · handmatig"}
                  {p.description && <span className="block text-stone-500">{p.description}</span>}
                </span>
                <button
                  disabled={pending}
                  className="text-stone-400 hover:text-red-600"
                  aria-label="Bestelling verwijderen"
                  onClick={() => confirm("Deze bestelling verwijderen?") && start(() => deletePurchaseAction(p.id, trajectId))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setAddOpen((v) => !v)}>
          {f.purchases.length ? "+ Extra bestelling" : "+ Bestelling"}
        </Button>
        <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setEdit((v) => !v)}>
          {f.hasWefactAmount ? "Montagedagen aanpassen" : "Verkoop / dagen invullen"}
        </Button>
      </div>

      {addOpen && (
        <form ref={pRef} action={pAction} className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
          <input type="hidden" name="trajectId" value={trajectId} />
          <p className="text-xs text-stone-500">
            Orderbevestigingen van PPC en fedi komen automatisch uit Gmail. Hier voeg je een bestelling met de hand toe, bijvoorbeeld bij een andere leverancier.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Leverancier">
              <Select name="supplier" className="w-full" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option>PPC</option>
                <option>fedi</option>
                <option value="Anders">Anders…</option>
              </Select>
            </Field>
            <Field label="Ordernummer (optioneel)">
              <Input name="orderNumber" />
            </Field>
          </div>
          {supplier === "Anders" && (
            <Field label="Naam leverancier">
              <Input name="supplierOther" placeholder="bijv. Hornbach" required />
            </Field>
          )}
          <Field label="Omschrijving (optioneel)">
            <Input name="description" placeholder="bijv. 2 extra traptreden" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bedrag excl. btw">
              <Input name="amountExcl" inputMode="decimal" placeholder="bijv. 2.344,54" required />
            </Field>
            <Field label="Besteldatum">
              <Input name="orderDate" type="date" defaultValue={today()} />
            </Field>
          </div>
          <FormMessage state={pState} />
          <SubmitButton>Opslaan</SubmitButton>
        </form>
      )}

      {edit && (
        <form action={action} className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
          <input type="hidden" name="trajectId" value={trajectId} />
          {!f.hasWefactAmount && (
            <Field label="Verkoopprijs excl. btw (tot de offerte uit WeFact komt)">
              <Input name="saleAmountExcl" inputMode="decimal" defaultValue={f.saleManual?.toString().replace(".", ",") ?? ""} />
            </Field>
          )}
          {f.hasWefactAmount && <input type="hidden" name="saleAmountExcl" value={f.saleManual?.toString().replace(".", ",") ?? ""} />}
          <Field label="Montagedagen (leeg = uit de rode agenda-afspraken)">
            <Input name="montageDays" inputMode="numeric" defaultValue={f.montageDaysManual ?? ""} />
          </Field>
          <FormMessage state={state} />
          <SubmitButton>Opslaan</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function ProposalBanner({ trajectId, proposals }: { trajectId: string; proposals: { id: string; label: string; reason: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!proposals.length) return null;
  return (
    <div className="space-y-2">
      {proposals.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <span>
            Voorstel: naar <strong>{p.label}</strong> · {p.reason}
          </span>
          <span className="flex gap-2">
            <Button
              className="px-2.5 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await decideProposalAction(p.id, true, trajectId);
                  if (!r.ok) setError(r.error);
                })
              }
            >
              Akkoord
            </Button>
            <Button
              variant="secondary"
              className="px-2.5 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await decideProposalAction(p.id, false, trajectId);
                  if (!r.ok) setError(r.error);
                })
              }
            >
              Niet doen
            </Button>
          </span>
        </div>
      ))}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
