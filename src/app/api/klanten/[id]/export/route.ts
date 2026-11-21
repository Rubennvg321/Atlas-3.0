import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { exportCustomer } from "@/server/customer-edit";
import { audit } from "@/server/timeline";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Niet ingelogd", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Niet gevonden", { status: 404 });
  const db = getDb();
  const data = await exportCustomer(db, id);
  await audit(db, null, "export", "customer", id, { by: session.user.email });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="klant-${id.slice(0, 8)}.json"`,
    },
  });
}
