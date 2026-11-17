import { describe, expect, it } from "vitest";
import {
  lastNameKey,
  normalizeEmail,
  normalizePhone,
  normalizePostcode,
  parseAddressLine,
  parseHouseNumber,
  parsePostcodeCity,
  splitDutchName,
  streetKey,
} from "@/lib/normalize";

describe("normalizeEmail", () => {
  it.each([
    ["  Jan.Jansen@Ziggo.NL ", "jan.jansen@ziggo.nl"],
    ["mailto:info@voorbeeld.nl", "info@voorbeeld.nl"],
    ["geen-email", null],
    ["", null],
  ])("%s -> %s", (input, out) => expect(normalizeEmail(input)).toBe(out));
});

describe("normalizePhone", () => {
  it.each([
    ["0657896904", "+31657896904"],
    ["06-57896904", "+31657896904"],
    ["06 578 969 04", "+31657896904"],
    ["+31 6 57896904", "+31657896904"],
    ["+31 (0)6 57896904", "+31657896904"],
    ["0031657896904", "+31657896904"],
    ["024-3456789", "+31243456789"],
    ["(024) 345 67 89", "+31243456789"],
    ["+49 30 12345678", "+493012345678"],
    ["12", null],
    ["", null],
  ])("%s -> %s", (input, out) => expect(normalizePhone(input)).toBe(out));
});

describe("normalizePostcode", () => {
  it.each([
    ["6663Pp", "6663PP"],
    ["1234 ab", "1234AB"],
    [" 1234  AB ", "1234AB"],
    ["0123AB", null],
    ["1234SS", null],
    ["12345", null],
  ])("%s -> %s", (input, out) => expect(normalizePostcode(input)).toBe(out));
});

describe("huisnummers en adressen", () => {
  it.each([
    ["12", { number: 12, addition: null }],
    ["12a", { number: 12, addition: "A" }],
    ["12 A", { number: 12, addition: "A" }],
    ["12-2", { number: 12, addition: "2" }],
    ["12-hs", { number: 12, addition: "HS" }],
    ["12 bis", { number: 12, addition: "BIS" }],
  ])("huisnummer %s", (input, out) => expect(parseHouseNumber(input)).toEqual(out));

  it("straat met nummer", () => {
    expect(parseAddressLine("Tintorettohof 12a")).toEqual({ street: "Tintorettohof", houseNumber: 12, addition: "A" });
    expect(parseAddressLine("Van der Duyn van Maasdamlaan 3-II")).toEqual({
      street: "Van der Duyn van Maasdamlaan",
      houseNumber: 3,
      addition: "II",
    });
    expect(parseAddressLine("Plein 1944 12")).toEqual({ street: "Plein 1944", houseNumber: 12, addition: null });
  });

  it("straat zonder nummer (websiteformulier)", () => {
    expect(parseAddressLine("Tintorettohof")).toEqual({ street: "Tintorettohof", houseNumber: null, addition: null });
  });

  it("postcode + plaats", () => {
    expect(parsePostcodeCity("6663Pp Lent")).toEqual({ postcode: "6663PP", city: "Lent" });
    expect(parsePostcodeCity("5211 AB 's-hertogenbosch")).toEqual({ postcode: "5211AB", city: "'s-Hertogenbosch" });
  });

  it("straatsleutel", () => {
    expect(streetKey("Burg. de Withstraat")).toBe(streetKey("Burgemeester de Withstraat"));
    expect(streetKey("Kerkstr.")).toBe(streetKey("Kerkstraat"));
  });
});

describe("splitDutchName", () => {
  it.each([
    ["Katharina Klein", { firstName: "Katharina", infix: null, lastName: "Klein" }],
    ["Jan van der Berg", { firstName: "Jan", infix: "van der", lastName: "Berg" }],
    ["Berg, van der", { firstName: null, infix: "van der", lastName: "Berg" }],
    ["Berg, Jan van der", { firstName: "Jan", infix: "van der", lastName: "Berg" }],
    ["fam. Janssen", { firstName: null, infix: null, lastName: "Janssen" }],
    ["Fam. van den Heuvel", { firstName: null, infix: "van den", lastName: "Heuvel" }],
    ["J. de Vries-Bakker", { firstName: "J.", infix: "de", lastName: "Vries-Bakker" }],
    ["Anne-Marie in 't Veld", { firstName: "Anne-Marie", infix: "in 't", lastName: "Veld" }],
    ["Dhr. P. de Groot", { firstName: "P.", infix: "de", lastName: "Groot" }],
    ["Jansen", { firstName: null, infix: null, lastName: "Jansen" }],
  ])("%s", (input, out) => expect(splitDutchName(input)).toEqual(out));
});

describe("lastNameKey: spelvarianten krijgen dezelfde sleutel", () => {
  it.each([
    ["Jansen", "Janssen"],
    ["Meijer", "Meyer"],
    ["Meijer", "Meier"],
    ["Smit", "Smidt"],
    ["Smit", "Smid"],
    ["Claassen", "Klaasen"],
    ["Bakker", "Backer"],
    ["Philips", "Filips"],
    ["Mulder", "Mülder"],
  ])("%s ~ %s", (a, b) => expect(lastNameKey(a)).toBe(lastNameKey(b)));

  it("verschillende namen blijven verschillend", () => {
    expect(lastNameKey("Jansen")).not.toBe(lastNameKey("Hendriks"));
    expect(lastNameKey("Berg")).not.toBe(lastNameKey("Bos"));
  });
});
