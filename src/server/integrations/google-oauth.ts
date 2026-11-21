import type { DbOrTx } from "@/db";
import { decryptJson, encryptJson } from "../crypto";
import { getIntegration, upsertIntegration } from "./state";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms
  scope?: string;
}

const appUrl = () => (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const redirectUri = () => `${appUrl()}/api/koppelingen/google/callback`;

export function authorizationUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.AUTH_GOOGLE_ID ?? "", client_secret: process.env.AUTH_GOOGLE_SECRET ?? "", ...body }),
  });
  const json = (await res.json()) as Record<string, string | number>;
  if (!res.ok) throw new Error(`Google token: ${json.error ?? res.status} ${json.error_description ?? ""}`);
  return json;
}

export async function exchangeCode(db: DbOrTx, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("Google gaf geen refresh_token terug. Trek de toegang in bij myaccount.google.com en koppel opnieuw.");
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json() as Promise<{ email?: string }>);
  const tokens: GoogleTokens = {
    access_token: String(t.access_token),
    refresh_token: String(t.refresh_token),
    expires_at: Date.now() + Number(t.expires_in) * 1000,
    scope: String(t.scope ?? ""),
  };
  await upsertIntegration(db, "google", { account: info.email ?? null, status: "gekoppeld", encryptedTokens: encryptJson(tokens), lastError: null });
  // Synchronisaties direct laten starten
  for (const p of ["gmail", "google_calendar"] as const) await upsertIntegration(db, p, { status: "gekoppeld", config: { nextRunAt: new Date().toISOString() } });
  return info.email ?? null;
}

/** Geldig access token; ververst automatisch met het refresh token. */
export async function getAccessToken(db: DbOrTx): Promise<{ token: string; account: string | null }> {
  const row = await getIntegration(db, "google");
  if (!row?.encryptedTokens) throw new Error("Google is nog niet gekoppeld. Ga naar Koppelingen en klik op 'Koppelen met Google'.");
  const t = decryptJson<GoogleTokens>(row.encryptedTokens);
  if (t.expires_at - 60_000 > Date.now()) return { token: t.access_token, account: row.account };
  try {
    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    const next: GoogleTokens = { ...t, access_token: String(r.access_token), expires_at: Date.now() + Number(r.expires_in) * 1000 };
    await upsertIntegration(db, "google", { encryptedTokens: encryptJson(next), status: "gekoppeld" });
    return { token: next.access_token, account: row.account };
  } catch (e) {
    await upsertIntegration(db, "google", { status: "verlopen", lastError: "De koppeling met Google is verlopen. Koppel opnieuw.", lastErrorAt: new Date() });
    throw e;
  }
}

/** Kleine fetch-helper voor Google-API's met nette foutmeldingen. */
export async function googleFetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Google ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
