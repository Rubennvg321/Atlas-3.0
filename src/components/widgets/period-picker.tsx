"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { monthLabel } from "./month-label";

/** Keuzemenu met hele jaren en losse maanden; zet `?omzet=JJJJ` of `?omzet=JJJJ-MM` in de adresbalk. */
export function PeriodPicker({ value, years, months, param = "omzet" }: { value: string; years: string[]; months: string[]; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Kies een maand of jaar"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set(param, e.target.value);
        start(() => router.replace(`${pathname}?${next}#omzet`, { scroll: false }));
      }}
      className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-sm disabled:opacity-60"
    >
      <optgroup label="Maand">
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Heel jaar">
        {years.map((y) => (
          <option key={y} value={y}>
            Heel {y}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
