import { createHash } from "node:crypto";
import Papa from "papaparse";
import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { customers, pipelineStages } from "@/db/schema";
import type { LeadInput } from "@/lib/intake/types";
import {
  displayName,
  normalizeAddition,
  normalizeEmail,
  normalizePhone,
  normalizePostcode,
  parseAddressLine,
  parseHouseNumber,
  parsePostcodeCity,
  splitDutchName,
  tidyCity,
} from "@/lib/normalize";
import { intakeLead } from "./intake";

/** Kolomnamen die we herkennen (kleine letters, zonder spaties/streepjes). */
const ALIASES: Record<string, string> = {
  naam: "name", volledigenaam: "name", klant: "name", klantnaam: "name",
  voornaam: "firstName",
  tussenvoegsel: "infix", tussenvoegsels: "infix",
  achternaam: "lastName",
  email: "email", emailadres: "email", mail: "email",
  email2: "email2", emailpartner: "email2", tweedeemail: "email2",
  telefoon: "phone", telefoonnummer: "phone", tel: "phone", mobiel: "phone2", mobielnummer: "phone2", telefoon2: "phone2",
  adres: "address", straat: "street", straatnaam: "street",
  huisnummer: "houseNumber", nr: "houseNumber", toevoeging: "addition", huisnummertoevoeging: "addition",
  postcode: "postcode", plaats: "city", woonplaats: "city", postcodeplaats: "postcodeCity",
  fase: "stage", status: "stage",
  omschrijving: "description", notitie: "description", opmerking: "description", opmerkingen: "description",
  debiteurnummer: "debtorCode", debiteur: "debtorCode",
};

export interface ImportRowResult {
  row: number;
  name: string;
  decision: "auto" | "doubt" | "none" | "error" | "skipped";
  matchedCustomer?: string | null;
  customerId?: string;
  trajectCreated?: boolean;
  message?: string;
}

export interface ImportSummary {
  rows: ImportRowResult[];
  counts: { nieuw: number; gekoppeld: number; mogelijkDubbel: number; fouten: number; overgeslagen: number };
  unknownColumns: string[];
}

class PreviewRollback extends Error {
  constructor(public summary: ImportSummary) {
    super("preview");
  }
}

export function parseCsv(text: string) {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", ",", "\t"],
    transformHeader: (h) => h.trim(),
  });
  const headers = res.meta.fields ?? [];
  const map: Record<string, string> = {};
  const unknown: string[] = [];
  for (const h of headers) {
    const key = ALIASES[h.toLowerCase().replace(/[\s\-_.]/g, "")];
    if (key) map[h] = key;
    else unknown.push(h);
  }
  const rows = res.data.map((r) => {
    const o: Record<string, string> = {};
    for (const [h, v] of Object.entries(r)) if (map[h] && v?.trim()) o[map[h]] = v.trim();
    return o;
  });
  return { rows, unknown };
}

export function rowToLead(r: Record<string, string>): LeadInput {
  const person =
    r.lastName || r.firstName
      ? { firstName: r.firstName ?? null, infix: r.infix ?? null, lastName: r.lastName ?? null }
      : splitDutchName(r.name);
  let street: string | null = r.street ?? null;
  let houseNumber: number | null = null;
  let addition = normalizeAddition(r.addition);
  if (r.houseNumber) {
    const hn = parseHouseNumber(r.houseNumber);
    houseNumber = hn?.number ?? null;
    addition = addition ?? hn?.addition ?? null;
  }
  if (r.address) {
    const a = parseAddressLine(r.address);
    street = street ?? a.street;
    houseNumber = houseNumber ?? a.houseNumber;
    addition = addition ?? a.addition;
  } else if (street && !houseNumber) {
    const a = parseAddressLine(street);
    if (a.houseNumber) {
      street = a.street;
      houseNumber = a.houseNumber;
      addition = addition ?? a.addition;
    }
  }
  let postcode = normalizePostcode(r.postcode);
  let city = tidyCity(r.city);
  if (r.postcodeCity) {
    const pc = parsePostcodeCity(r.postcodeCity);
    postcode = postcode ?? pc.postcode;
    city = city ?? pc.city;
  }
  const emails = [...new Set([normalizeEmail(r.email), normalizeEmail(r.email2)].filter((x): x is string => !!x))];
  const phones = [...new Set([normalizePhone(r.phone), normalizePhone(r.phone2)].filter((x): x is string => !!x))];
  return {
    name: r.name ?? displayName(person),
    person,
    emails,
    phones,
    rawEmail: r.email ?? null,
    rawPhone: r.phone ?? null,
    street,
    houseNumber,
    addition,
    postcode,
    city,
    message: r.description ?? null,
  };
}

function rowHash(lead: LeadInput, stage: string | undefined) {
  return createHash("sha1").update(JSON.stringify([lead, stage ?? null])).digest("hex");
}

async function runImport(db: DB, text: string, userId: string | null): Promise<ImportSummary> {
  const { rows, unknown } = parseCsv(text);
  const stages = await db.select().from(pipelineStages);
  const stageByLabel = new Map(stages.flatMap((s) => [[s.key.toLowerCase(), s.key], [s.label.toLowerCase(), s.key]]));
  const out: ImportRowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 2; // kopregel = 1
    try {
      const lead = rowToLead(r);
      const name = displayName(lead.person) || lead.name || "";
      if (!name && !lead.emails.length && !lead.phones.length) {
        out.push({ row: rowNo, name: "(leeg)", decision: "skipped", message: "Geen naam, e-mail of telefoon" });
        continue;
      }
      let stage: string | undefined;
      if (r.stage) {
        stage = stageByLabel.get(r.stage.toLowerCase());
        if (!stage) throw new Error(`Onbekende fase "${r.stage}"`);
        if (stage === "vervallen") throw new Error("Vervallen trajecten kunnen niet worden geïmporteerd (reden ontbreekt)");
      }
      const res = await intakeLead(db, lead, {
        provider: "import",
        externalId: `csv:${rowHash(lead, stage)}`,
        userId,
        traject: stage ? { stage } : "none",
      });
      if (r.debtorCode && res.createdCustomer) {
        await db.update(customers).set({ wefactDebtorCode: r.debtorCode }).where(eq(customers.id, res.customerId));
      }
      let matched: string | null = null;
      const lookup = res.decision === "auto" ? [res.customerId] : res.duplicateOf;
      if (lookup.length) {
        const m = await db.select({ n: customers.displayName }).from(customers).where(inArray(customers.id, lookup));
        matched = m.map((x) => x.n).join(", ");
      }
      out.push({
        row: rowNo,
        name,
        decision: res.alreadyProcessed ? "skipped" : res.decision,
        matchedCustomer: matched,
        customerId: res.customerId,
        trajectCreated: res.createdTraject,
        message: res.alreadyProcessed ? "Al eerder geïmporteerd" : undefined,
      });
    } catch (e) {
      out.push({ row: rowNo, name: r.name ?? r.lastName ?? "", decision: "error", message: (e as Error).message });
    }
  }
  return {
    rows: out,
    counts: {
      nieuw: out.filter((r) => r.decision === "none").length,
      gekoppeld: out.filter((r) => r.decision === "auto").length,
      mogelijkDubbel: out.filter((r) => r.decision === "doubt").length,
      fouten: out.filter((r) => r.decision === "error").length,
      overgeslagen: out.filter((r) => r.decision === "skipped").length,
    },
    unknownColumns: unknown,
  };
}

/** Proefdraaien: voert de hele import uit in een transactie en draait die terug. */
export async function previewImport(db: DB, text: string, userId: string | null): Promise<ImportSummary> {
  try {
    await db.transaction(async (tx) => {
      const summary = await runImport(tx as unknown as DB, text, userId);
      throw new PreviewRollback(summary);
    });
  } catch (e) {
    if (e instanceof PreviewRollback) return e.summary;
    throw e;
  }
  throw new Error("unreachable");
}

export async function commitImport(db: DB, text: string, userId: string | null): Promise<ImportSummary> {
  return db.transaction(async (tx) => runImport(tx as unknown as DB, text, userId));
}
