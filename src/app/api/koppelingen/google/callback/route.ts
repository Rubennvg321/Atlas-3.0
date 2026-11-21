import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { exchangeCode } from "@/server/integrations/google-oauth";
import { audit } from "@/server/timeline";

export async function GET(req: NextRequest) {
  const base = process.env.AUTH_URL ?? req.nextUrl.origin;
  const to = (q: string) => {
    const r = NextResponse.redirect(new URL(`/koppelingen?${q}`, base));
    r.cookies.delete("atlas_oauth_state");
    return r;
  };
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", base));
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) return to(`fout=${encodeURIComponent(error === "access_denied" ? "Je hebt geen toestemming gegeven." : error)}`);
  if (!state || state !== req.cookies.get("atlas_oauth_state")?.value || !code) return to("fout=Ongeldige%20aanvraag.%20Probeer%20het%20opnieuw.");
  try {
    const account = await exchangeCode(getDb(), code);
    await audit(getDb(), null, "google_connect", "integration", "google", { account, by: session.user.email });
    return to("gekoppeld=google");
  } catch (e) {
    return to(`fout=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
