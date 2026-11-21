import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

/**
 * Inloggen met Google. Alleen e-mailadressen uit AUTH_ALLOWED_EMAILS, of (als
 * ingesteld) accounts uit het Workspace-domein AUTH_ALLOWED_DOMAIN.
 * Deze config is edge-veilig (geen database), want hij draait ook in middleware.
 */
export function isAllowedEmail(email: string | null | undefined, hd?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  const list = (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes(e)) return true;
  const domain = process.env.AUTH_ALLOWED_DOMAIN?.trim().toLowerCase();
  if (domain && list.length === 0) return e.endsWith(`@${domain}`) && (hd === undefined || hd?.toLowerCase() === domain);
  return false;
}

export const devBypassEnabled = () => process.env.AUTH_DEV_BYPASS === "1" && process.env.NODE_ENV !== "production";

const providers: NextAuthConfig["providers"] = [
  Google({
    authorization: { params: { prompt: "select_account", ...(process.env.AUTH_ALLOWED_DOMAIN ? { hd: process.env.AUTH_ALLOWED_DOMAIN } : {}) } },
  }),
];

if (devBypassEnabled()) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Lokaal (ontwikkeling)",
      credentials: { email: { label: "E-mail" } },
      authorize: async (c) => {
        const email = String(c?.email ?? "").trim().toLowerCase();
        if (!email) return null;
        return { id: email, email, name: email.split("@")[0] };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ account, profile, user }) {
      if (account?.provider === "dev") return devBypassEnabled();
      if (account?.provider === "google") {
        const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
        const hd = (profile as { hd?: string } | undefined)?.hd ?? null;
        return verified && isAllowedEmail(user.email ?? profile?.email, hd);
      }
      return false;
    },
    authorized({ auth, request }) {
      const p = request.nextUrl.pathname;
      if (p.startsWith("/login") || p.startsWith("/api/auth")) return true;
      return !!auth?.user;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
