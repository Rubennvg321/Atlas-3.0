"use client";

import { useEffect, useState, useTransition } from "react";
import { sendTestNotification, subscribePush, unsubscribePush } from "@/app/(app)/meldingen/actions";

type State = "laden" | "niet-ondersteund" | "ios-installeren" | "geweigerd" | "uit" | "aan";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) || isIos() ? "iPad" : /android/i.test(ua) ? "Android" : /mac/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "Computer";
  const app = isStandalone() ? "app" : /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "browser";
  return `${device} (${app})`;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function PushSetup({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("laden");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    setInstalled(isStandalone());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    (async () => {
      // iPhone/iPad: meldingen werken alleen in de app op het beginscherm, dus eerst installeren.
      if (isIos() && !isStandalone()) return setState("ios-installeren");
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState("niet-ondersteund");
      if (Notification.permission === "denied") return setState("geweigerd");
      const reg = await registerServiceWorker();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // Opnieuw doorgeven: herstelt de aanmelding als de server hem had opgeruimd.
        await subscribePush(sub.toJSON(), deviceLabel());
        setState("aan");
      } else setState("uit");
    })().catch(() => setState("niet-ondersteund"));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const enable = () =>
    start(async () => {
      setMsg(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "geweigerd" : "uit");
          return;
        }
        const reg = (await registerServiceWorker())!;
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) }));
        const r = await subscribePush(sub.toJSON(), deviceLabel());
        if (!r.ok) return setMsg({ ok: false, text: r.error });
        setState("aan");
        setMsg({ ok: true, text: "Meldingen staan aan op dit apparaat. Stuur gerust een testmelding." });
      } catch (e) {
        setMsg({ ok: false, text: `Aanzetten lukte niet: ${e instanceof Error ? e.message : String(e)}` });
      }
    });

  const disable = () =>
    start(async () => {
      setMsg(null);
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("uit");
    });

  const test = () =>
    start(async () => {
      setMsg(null);
      const r = await sendTestNotification();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Verstuurd." } : { ok: false, text: r.error });
    });

  const install = () =>
    start(async () => {
      if (!installEvent) return;
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallEvent(null);
    });

  const btn = "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";
  return (
    <div className="space-y-4">
      {/* App installeren */}
      {!installed && (
        <div className="rounded-lg bg-stone-50 p-3 text-sm">
          <p className="font-medium">Atlas als app op je telefoon</p>
          {installEvent ? (
            <>
              <p className="mt-1 text-stone-600">Zet Atlas met één tik op je beginscherm of bureaublad.</p>
              <button onClick={install} disabled={pending} className={`${btn} mt-2 bg-stone-900 text-white`}>
                App installeren
              </button>
            </>
          ) : state !== "laden" && isIos() ? (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-stone-600">
              <li>Open deze pagina in <b>Safari</b>.</li>
              <li>Tik onderin op de deel-knop (vierkantje met pijl omhoog).</li>
              <li>Kies <b>Zet op beginscherm</b> en tik op <b>Voeg toe</b>.</li>
              <li>Open Atlas voortaan via het nieuwe pictogram.</li>
            </ol>
          ) : (
            <p className="mt-1 text-stone-600">
              Android (Chrome): menu <b>⋮</b> → <b>App installeren</b> of <b>Toevoegen aan startscherm</b>. Computer (Chrome/Edge): het
              installeer-pictogram rechts in de adresbalk.
            </p>
          )}
        </div>
      )}

      {/* Meldingen op dit apparaat */}
      <div className="text-sm">
        {state === "laden" && <p className="text-stone-500">Even kijken wat dit apparaat ondersteunt…</p>}
        {state === "ios-installeren" && (
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
            Op een iPhone werken meldingen alleen in de geïnstalleerde app. Zet Atlas eerst op je beginscherm (zie hierboven), open
            Atlas via het pictogram en kom dan terug naar deze pagina (Meer → Meldingen).
          </p>
        )}
        {state === "niet-ondersteund" && (
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Deze browser ondersteunt geen meldingen. Gebruik Chrome, Edge, Firefox of Safari (iPhone: via de app op het beginscherm).</p>
        )}
        {state === "geweigerd" && (
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
            Meldingen zijn voor Atlas geblokkeerd op dit apparaat. iPhone: Instellingen → Meldingen → Atlas → Sta meldingen toe. Android/computer:
            tik op het slotje naast het adres → Meldingen → Toestaan. Laad daarna deze pagina opnieuw.
          </p>
        )}
        {state === "uit" && (
          <div className="space-y-2">
            <p className="text-stone-600">Meldingen staan nog uit op dit apparaat.</p>
            <button onClick={enable} disabled={pending} className={`${btn} bg-stone-900 text-white`}>
              {pending ? "Bezig…" : "Meldingen aanzetten op dit apparaat"}
            </button>
          </div>
        )}
        {state === "aan" && (
          <div className="space-y-2">
            <p className="font-medium text-emerald-700">✓ Meldingen staan aan op dit apparaat.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={test} disabled={pending} className={`${btn} bg-stone-900 text-white`}>
                {pending ? "Bezig…" : "Testmelding sturen"}
              </button>
              <button onClick={disable} disabled={pending} className={`${btn} border border-stone-300 bg-white`}>
                Uitzetten op dit apparaat
              </button>
            </div>
          </div>
        )}
        {msg && <p className={`mt-2 ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

/** Registreert de service worker op elke pagina, zodat Atlas installeerbaar is. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    registerServiceWorker()?.catch(() => {});
  }, []);
  return null;
}
