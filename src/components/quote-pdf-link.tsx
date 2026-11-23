/** Opent de offerte-PDF (rechtstreeks uit WeFact) in een nieuw tabblad. */
export function QuotePdfLink({ quoteId }: { quoteId: string }) {
  return (
    <a
      href={`/api/offertes/${quoteId}/pdf`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50"
    >
      📄 PDF bekijken
    </a>
  );
}
