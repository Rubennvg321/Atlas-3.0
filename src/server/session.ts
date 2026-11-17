import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

/** Ingelogde gebruiker; maakt bij de eerste keer een gebruikersrecord aan. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login");
  const db = getDb();
  let [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) {
    [u] = await db
      .insert(users)
      .values({ email, name: session?.user?.name ?? null, lastLoginAt: new Date() })
      .onConflictDoUpdate({ target: users.email, set: { lastLoginAt: new Date() } })
      .returning();
  }
  if (!u.active) redirect("/login?error=AccessDenied");
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}
