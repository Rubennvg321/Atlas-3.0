import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import { notifications, pushSubscriptions } from "@/db/schema";
import { syncLeadMails } from "@/server/integrations/gmail-sync";
import { deliverPending, getVapidPublicKey, queueNotification, saveSubscription, type PushSender } from "@/server/notify";
import { setSetting } from "@/server/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { db, resetDb } from "./helpers";
import { OWN, fakeGmail } from "./fakes";

const FORM = readFileSync(path.join(__dirname, "../fixtures/aanvraag-website.txt"), "utf8");

/** Nagebootste pushdienst: onthoudt wat er verstuurd is, of geeft een foutcode per apparaat. */
function fakeSender(fail: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  const send: PushSender = async (t, payload) => {
    if (fail[t.endpoint]) throw Object.assign(new Error("push mislukt"), { statusCode: fail[t.endpoint] });
    sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload) });
  };
  return { send, sent };
}
const device = (n: string) => ({ endpoint: `https://push.example.nl/${n}`, p256dh: "BPubKeyVoorTest123", auth: "authtest", label: n });

beforeEach(async () => {
  await resetDb();
  await setSetting(db(), "intakeFilters", { ...DEFAULT_SETTINGS.intakeFilters, rules: [{ from: OWN, subjectContains: "Aanvraag website", parser: "website-form" }] });
});
afterAll(closeDb);

describe("meldingen", () => {
  it("nieuwe aanvraagmail -> één melding 'Nieuwe aanvraag' met link naar het traject; opnieuw verwerken geeft geen tweede", async () => {
    await saveSubscription(db(), device("telefoon"));
    const g = fakeGmail([{ id: "m1", from: `Website <${OWN}>`, subject: "Aanvraag website", body: FORM }]);
    expect(await syncLeadMails(db(), g)).toBe(1);
    const s = fakeSender();
    expect(await deliverPending(db(), s.send)).toBe(1);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].payload.title).toMatch(/^Nieuwe aanvraag: /);
    expect(s.sent[0].payload.url).toMatch(/^\/trajecten\//);
    // Mail opnieuw aangeboden (bv. label weggehaald): geen tweede melding.
    g.mails[0].labels = ["INBOX"];
    await syncLeadMails(db(), fakeGmail([{ id: "m1", from: `Website <${OWN}>`, subject: "Aanvraag website", body: FORM }]));
    expect(await deliverPending(db(), s.send)).toBe(0);
    expect(await db().select().from(notifications)).toHaveLength(1);
  });

  it("soort uitgezet -> niet verstuurd, wel gelogd", async () => {
    await saveSubscription(db(), device("telefoon"));
    await setSetting(db(), "notifications", { types: { nieuwe_lead: false } });
    expect(await queueNotification(db(), { type: "nieuwe_lead", refKey: "x1", title: "Nieuwe aanvraag: Test" })).toEqual({ queued: false });
    const s = fakeSender();
    expect(await deliverPending(db(), s.send)).toBe(0);
    expect((await db().select().from(notifications))[0].status).toBe("skipped");
  });

  it("naar alle apparaten; verdwenen apparaat (410) wordt afgemeld, tijdelijke fout niet", async () => {
    for (const n of ["telefoon", "laptop", "weg", "storing"]) await saveSubscription(db(), device(n));
    await queueNotification(db(), { type: "nieuwe_lead", refKey: "x2", title: "Nieuwe aanvraag: Test" });
    const s = fakeSender({ [device("weg").endpoint]: 410, [device("storing").endpoint]: 500 });
    expect(await deliverPending(db(), s.send)).toBe(1);
    expect(s.sent.map((x) => x.endpoint).sort()).toEqual([device("laptop").endpoint, device("telefoon").endpoint]);
    const left = await db().select().from(pushSubscriptions);
    expect(left.map((x) => x.label).sort()).toEqual(["laptop", "storing", "telefoon"]);
    expect(left.find((x) => x.label === "storing")?.failures).toBe(1);
  });

  it("geen enkel apparaat bereikt -> later opnieuw, na 5 pogingen 'mislukt'", async () => {
    await saveSubscription(db(), device("storing"));
    await queueNotification(db(), { type: "nieuwe_lead", refKey: "x3", title: "Nieuwe aanvraag: Test" });
    const s = fakeSender({ [device("storing").endpoint]: 503 });
    for (let i = 0; i < 4; i++) await deliverPending(db(), s.send);
    expect((await db().select().from(notifications))[0].status).toBe("pending");
    await deliverPending(db(), s.send);
    expect((await db().select().from(notifications))[0].status).toBe("failed");
  });

  it("zonder apparaten wordt niets opgespaard, en oude meldingen worden niet meer verstuurd", async () => {
    await queueNotification(db(), { type: "nieuwe_lead", refKey: "x4", title: "Nieuwe aanvraag: Test" });
    await deliverPending(db(), fakeSender().send);
    expect((await db().select().from(notifications))[0].status).toBe("skipped");

    await saveSubscription(db(), device("telefoon"));
    await queueNotification(db(), { type: "nieuwe_lead", refKey: "x5", title: "Nieuwe aanvraag: Oud" });
    const s = fakeSender();
    expect(await deliverPending(db(), s.send, { now: new Date(Date.now() + 25 * 3600_000) })).toBe(0);
    expect(s.sent).toHaveLength(0);
  });

  it("sleutels worden één keer aangemaakt en daarna hergebruikt", async () => {
    const a = await getVapidPublicKey(db());
    expect(a.length).toBeGreaterThan(40);
    expect(await getVapidPublicKey(db())).toBe(a);
  });

  it("ongeldige aanmelding wordt geweigerd", async () => {
    await expect(saveSubscription(db(), { endpoint: "http://onveilig.example.nl", p256dh: "x", auth: "y" })).rejects.toThrow();
  });
});
