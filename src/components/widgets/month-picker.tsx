"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { monthLabel } from "./month-label";

/** Keuzemenu voor de maand; zet `?maand=JJJJ-MM` in de adresbalk. */
export function MonthPicker({ value, months, param = "maand" }: { value: string; months: string[]; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Kies een maand"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set(param, e.target.value);
        start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
      }}
      className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-sm disabled:opacity-60"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
  );
}
