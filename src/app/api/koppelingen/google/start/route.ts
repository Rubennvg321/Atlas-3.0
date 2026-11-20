import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizationUrl } from "@/server/integrations/google-oauth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", process.env.AUTH_URL ?? "http://localhost:3000"));
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authorizationUrl(state));
  res.cookies.set("atlas_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
