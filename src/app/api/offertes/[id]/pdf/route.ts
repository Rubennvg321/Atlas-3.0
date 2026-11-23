import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { DomainError } from "@/server/errors";
import { friendlyError } from "@/server/integrations/state";
import { getQuotePdf } from "@/server/quote-pdf";

/** Offerte-PDF uit WeFact, om direct in de browser te bekijken. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Niet ingelogd", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Niet gevonden", { status: 404 });
  try {
    const { filename, pdf } = await getQuotePdf(getDb(), id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof DomainError ? e.message : friendlyError(e);
    return new NextResponse(`De offerte-PDF kon niet worden geopend.\n\n${msg}`, {
      status: e instanceof DomainError && e.code === "not_found" ? 404 : 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
