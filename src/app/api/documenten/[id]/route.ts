import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { DomainError } from "@/server/errors";
import { getPurchaseDocument } from "@/server/purchase-documents";

/** Een inkoopdocument (orderbevestiging/factuur) bekijken in de browser. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Niet ingelogd", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Niet gevonden", { status: 404 });
  try {
    const d = await getPurchaseDocument(getDb(), id);
    const headers: Record<string, string> = {
      "content-type": d.mimeType === "text/html" ? "text/html; charset=utf-8" : d.mimeType,
      "content-disposition": `inline; filename="${encodeURIComponent(d.filename)}"; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    };
    // Mails van buiten worden in een afgeschermde omgeving getoond: geen scripts, geen formulieren.
    if (d.mimeType === "text/html") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline' *";
    return new NextResponse(new Uint8Array(d.data), { headers });
  } catch (e) {
    return new NextResponse(e instanceof DomainError ? e.message : "Het document kon niet worden geopend.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
