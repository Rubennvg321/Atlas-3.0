import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isNull } from "drizzle-orm";
import { closeDb } from "@/db";
import { customers, trajects } from "@/db/schema";
import { commitImport, previewImport } from "@/server/import";
import { intakeLead } from "@/server/intake";
import { db, lead, resetDb, uid } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

const CSV = `Naam;E-mail;Telefoon;Adres;Postcode;Plaats;Fase
Peter Jansen;p.jansen@ziggo.nl;06-12345678;Kerkstraat 12;6511 AB;Nijmegen;Review ontvangen
P. Janssen;;+31 6 12345678;Kerkstraat 12;6511AB;Nijmegen;
Sanne Bakker;sanne@hotmail.com;0687654321;Kerkstraat 12;6511AB;Nijmegen;
Jan van der Berg;jan@vdberg.nl;024-3456789;Dorpsstraat 3a;1234 ab;Elst;Review ontvangen
;;;;;;
Kees Onbekend;;;;;;Bestaatniet
`;

describe("import van bestaande klanten", () => {
  it("proefdraaien slaat niets op maar toont het resultaat", async () => {
    const s = await previewImport(db(), CSV, null);
    expect(s.counts).toEqual({ nieuw: 2, gekoppeld: 1, mogelijkDubbel: 1, fouten: 1, overgeslagen: 0 });
    expect(s.rows[1].decision).toBe("auto"); // P. Janssen -> Peter Jansen (binnen hetzelfde bestand)
    expect(s.rows[2].decision).toBe("doubt"); // Sanne op zelfde adres
    expect((await db().select().from(customers)).length).toBe(0);
  });

  it("importeren gebruikt dezelfde herkenningslogica en is herhaalbaar", async () => {
    await commitImport(db(), CSV, null);
    const active = await db().select().from(customers).where(isNull(customers.mergedIntoId));
    expect(active).toHaveLength(3); // Jansen, Bakker (mogelijk dubbel), van der Berg
    const tr = await db().select().from(trajects);
    expect(tr.map((t) => t.stage).sort()).toEqual(["review_ontvangen", "review_ontvangen"]);
    // nog een keer importeren verandert niets
    const again = await commitImport(db(), CSV, null);
    expect(again.counts.overgeslagen).toBe(4);
    expect(again.counts.fouten).toBe(1);
    expect((await db().select().from(customers)).length).toBe(3);
  });

  it("koppelt aan klanten die al in Atlas staan", async () => {
    const bestaand = await intakeLead(db(), lead({ name: "Jan Berg", email: "JAN@vdberg.nl" }), { provider: "handmatig", externalId: uid() });
    const s = await commitImport(db(), CSV, null);
    const row = s.rows.find((r) => r.name === "Jan van der Berg")!;
    expect(row.decision).toBe("auto");
    expect(row.customerId).toBe(bestaand.customerId);
  });
});
