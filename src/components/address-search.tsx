"use client";

import { useEffect, useRef, useState } from "react";
import { addressDetailsAction, searchAddressAction } from "@/app/actions";
import type { AddressFields, AddressSuggestion } from "@/lib/places";

export type AddressFieldNames = Record<keyof AddressFields, string>;

export const CUSTOMER_ADDRESS_FIELDS: AddressFieldNames = { street: "street", houseNumber: "houseNumber", addition: "addition", postcode: "postcode", city: "city" };

/**
 * Zoekveld "Adres zoeken via Google". Kies je een adres, dan worden straat,
 * huisnummer, toevoeging, postcode en plaats in hetzelfde formulier ingevuld.
 * De gewone velden blijven gewoon zelf in te vullen.
 */
export function AddressSearch({ fields = CUSTOMER_ADDRESS_FIELDS }: { fields?: AddressFieldNames }) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const session = useRef<string>(newToken());
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setItems([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchAddressAction(term, session.current);
      if (n !== seq.current) return; // er is intussen verder getypt
      if (!r.ok) {
        setMsg(r.error);
        setItems([]);
        return;
      }
      if (!r.configured) {
        setOff(true);
        return;
      }
      setMsg(r.suggestions.length ? null : "Geen adres gevonden. Vul de velden hieronder zelf in.");
      setItems(r.suggestions);
      setActive(0);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function choose(s: AddressSuggestion) {
    setOpen(false);
    setMsg("Adres ophalen…");
    const r = await addressDetailsAction(s.placeId, session.current);
    session.current = newToken(); // volgende zoekopdracht = nieuwe sessie
    if (!r.ok || !r.data) {
      setMsg(r.ok ? "Adres niet gevonden." : r.error);
      return;
    }
    const form = ref.current?.closest("form");
    for (const k of Object.keys(fields) as (keyof AddressFields)[]) {
      const el = form?.elements.namedItem(fields[k]);
      if (el instanceof HTMLInputElement) el.value = r.data[k] ?? "";
    }
    setQ("");
    setItems([]);
    setMsg(r.data.houseNumber ? `Ingevuld: ${s.main}, ${s.secondary}` : "Ingevuld, maar zonder huisnummer: vul dat nog zelf in.");
  }

  if (off)
    return (
      <p className="text-xs text-stone-500">
        Adres zoeken via Google staat nog uit. Zet het aan via <a href="/koppelingen" className="underline">Koppelingen</a>.
      </p>
    );

  return (
    <div ref={ref} className="relative">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-stone-600">🔍 Adres zoeken via Google</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault(); // niet het formulier versturen
              if (open && items[active]) void choose(items[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Typ straat + huisnummer en plaats, bijv. Kerkstraat 12 Nijmegen"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="w-full rounded-lg border border-sky-300 bg-sky-50/50 px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
      </label>
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {items.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-stone-100" : ""}`}
            >
              <span className="font-medium">{s.main}</span> <span className="text-stone-500">{s.secondary}</span>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-1 text-xs text-stone-600">{msg}</p>}
    </div>
  );
}

function newToken() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
}
