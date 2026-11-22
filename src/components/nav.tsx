"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/** Onderdelen in de zijbalk (computer). Nieuwe onderdelen hier toevoegen. */
const SECTIONS = [
  { href: "/dashboard", label: "Dashboard", icon: "◫" },
  { href: "/bord", label: "Klantenbord", icon: "▦" },
  { href: "/taken", label: "Taken", icon: "✓" },
  { href: "/klanten", label: "Klanten", icon: "☺" },
  { href: "/dubbels", label: "Mogelijk dubbel", icon: "⧉" },
];
const SYSTEM = [
  { href: "/koppelingen", label: "Koppelingen", icon: "⇄" },
  { href: "/import", label: "Import", icon: "⇪" },
  { href: "/instellingen", label: "Instellingen", icon: "⚙" },
];

/** Balk onderin (telefoon). */
const MOBILE = [
  { href: "/dashboard", label: "Dashboard", icon: "◫" },
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
  const SideLink = ({ i }: { i: { href: string; label: string; icon: string } }) => (
    <Link
      href={i.href}
      className={clsx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
        active(i.href) ? "bg-stone-900 font-medium text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
      )}
    >
      <span className="w-4 text-center text-base leading-none">{i.icon}</span>
      <span className="flex-1">{i.label}</span>
      {badge(i.href) > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{badge(i.href)}</span>}
    </Link>
  );
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-stone-200 bg-white md:flex">
        <Link href="/dashboard" className="flex h-14 items-center gap-2 px-4 font-semibold">
          <img src="/icon.svg" alt="" className="h-7 w-7" /> Atlas
        </Link>
        <div className="px-3 pb-3">
          <Link href="/klanten/nieuw" className="block rounded-lg bg-brand px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark">
            + Nieuwe klant
          </Link>
        </div>
        <nav aria-label="Onderdelen" className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {SECTIONS.map((i) => (
            <SideLink key={i.href} i={i} />
          ))}
          <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-stone-400">Beheer</p>
          {SYSTEM.map((i) => (
            <SideLink key={i.href} i={i} />
          ))}
        </nav>
        <div className="border-t border-stone-200 p-3">
          <SideLink i={{ href: "/meer", label: "Account", icon: "◎" }} />
        </div>
      </aside>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {MOBILE.map((i) => (
          <Link key={i.href} href={i.href} className={clsx("relative flex flex-col items-center py-2 text-[11px]", active(i.href) ? "text-stone-900" : "text-stone-500")}>
            <span className="text-lg leading-5">{i.icon}</span>
            {i.label}
            {badge(i.href) > 0 && <span className="absolute right-2 top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{badge(i.href)}</span>}
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
