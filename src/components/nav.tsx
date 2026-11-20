"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const ITEMS = [
  { href: "/bord", label: "Bord", icon: "▦" },
  { href: "/taken", label: "Taken", icon: "✓" },
  { href: "/klanten", label: "Klanten", icon: "☺" },
  { href: "/dubbels", label: "Dubbel", icon: "⧉" },
  { href: "/meer", label: "Meer", icon: "≡" },
];

export function Nav({ duplicateCount, overdueCount }: { duplicateCount: number; overdueCount: number }) {
  const path = usePathname();
  const active = (href: string) =>
    path === href || path.startsWith(href + "/") || (href === "/meer" && ["/import", "/instellingen", "/meer", "/koppelingen"].some((p) => path.startsWith(p)));
  const badge = (href: string) => (href === "/dubbels" ? duplicateCount : href === "/taken" ? overdueCount : 0);
  return (
    <>
      <header className="sticky top-0 z-30 hidden border-b border-stone-200 bg-white/90 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
          <Link href="/bord" className="flex items-center gap-2 font-semibold">
            <img src="/icon.svg" alt="" className="h-7 w-7" /> Atlas
          </Link>
          <nav className="flex gap-1">
            {[...ITEMS.slice(0, 4), { href: "/koppelingen", label: "Koppelingen", icon: "" }, { href: "/import", label: "Import", icon: "" }, { href: "/instellingen", label: "Instellingen", icon: "" }].map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={clsx("relative rounded-lg px-3 py-1.5 text-sm", active(i.href) ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")}
              >
                {i.label === "Dubbel" ? "Mogelijk dubbel" : i.label}
                {badge(i.href) > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-xs text-white">{badge(i.href)}</span>}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/meer" className="text-sm text-stone-600 hover:underline">
              Account
            </Link>
            <Link href="/klanten/nieuw" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
              + Nieuwe klant
            </Link>
          </div>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className={clsx("relative flex flex-col items-center py-2 text-xs", active(i.href) ? "text-stone-900" : "text-stone-500")}>
            <span className="text-lg leading-5">{i.icon}</span>
            {i.label}
            {badge(i.href) > 0 && <span className="absolute right-4 top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{badge(i.href)}</span>}
          </Link>
        ))}
      </nav>
      <Link
        href="/klanten/nieuw"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl text-white shadow-lg md:hidden"
        aria-label="Nieuwe klant"
      >
        +
      </Link>
    </>
  );
}
