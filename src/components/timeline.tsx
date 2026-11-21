import { dateTime } from "@/lib/format";

const ICONS: Record<string, string> = {
  fase: "⇢",
  aanvraag: "✉",
  mail: "✉",
  notitie: "✎",
  taak: "✓",
  afspraak: "📅",
  offerte: "€",
  inkoop: "🛒",
  financieel: "€",
  samengevoegd: "⧉",
  samenvoeging_ongedaan: "↺",
  traject_aangemaakt: "★",
};

export function Timeline({
  items,
}: {
  items: { id: string; type: string; title: string; body: string | null; occurredAt: Date; actor?: string | null }[];
}) {
  if (!items.length) return <p className="text-sm text-stone-500">Nog geen activiteit.</p>;
  return (
    <ol className="relative space-y-4 border-l border-stone-200 pl-5">
      {items.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[29px] flex h-6 w-6 items-center justify-center rounded-full border border-stone-200 bg-white text-xs">{ICONS[e.type] ?? "•"}</span>
          <p className="text-sm font-medium">{e.title}</p>
          {e.body && <p className="mt-0.5 whitespace-pre-line text-sm text-stone-600">{e.body}</p>}
          <p className="mt-0.5 text-xs text-stone-400">
            {dateTime(e.occurredAt)}
            {e.actor ? ` · ${e.actor}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
