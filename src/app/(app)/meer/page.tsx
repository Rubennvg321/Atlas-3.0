import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser } from "@/server/session";

export default async function MorePage() {
  const user = await requireUser();
  const links = [
    { href: "/meldingen", label: "Meldingen en app op je telefoon" },
    { href: "/koppelingen", label: "Koppelingen (Gmail, Agenda, WeFact, reviews)" },
    { href: "/import", label: "Bestaande klanten importeren" },
    { href: "/instellingen", label: "Instellingen" },
  ];
  return (
    <div className="mx-auto max-w-md space-y-3">
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block px-4 py-3">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <p className="mb-2 text-sm text-stone-500">Ingelogd als {user.email}</p>
        <button className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm">Uitloggen</button>
      </form>
    </div>
  );
}
