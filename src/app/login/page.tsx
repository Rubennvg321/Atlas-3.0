import { redirect } from "next/navigation";
import { auth, devBypassEnabled, signIn } from "@/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const sp = await searchParams;
  const session = await auth();
  if (session?.user) redirect("/bord");
  const callbackUrl = sp.callbackUrl?.startsWith("/") ? sp.callbackUrl : "/bord";
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold">Atlas</h1>
            <p className="text-sm text-stone-500">Steps &amp; Stairs</p>
          </div>
        </div>
        {sp.error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {sp.error === "AccessDenied" ? "Dit Google-account heeft geen toegang tot Atlas." : "Inloggen is niet gelukt. Probeer het opnieuw."}
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white hover:bg-stone-700">
            Inloggen met Google
          </button>
        </form>
        {devBypassEnabled() && (
          <form
            className="mt-6 border-t border-stone-200 pt-4"
            action={async (fd: FormData) => {
              "use server";
              await signIn("dev", { email: String(fd.get("email") ?? ""), redirectTo: callbackUrl });
            }}
          >
            <p className="mb-2 text-xs text-stone-500">Alleen lokaal (ontwikkeling):</p>
            <input name="email" defaultValue="test@stepsandstairs.nl" className="mb-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
            <button className="w-full rounded-lg border border-stone-300 px-4 py-2 text-sm">Lokaal inloggen</button>
          </form>
        )}
      </div>
    </div>
  );
}
