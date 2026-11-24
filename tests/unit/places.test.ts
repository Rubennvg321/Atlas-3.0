import { describe, expect, it } from "vitest";
import { addressFromComponents, suggestionsFromAutocomplete } from "@/lib/places";

const c = (longText: string, ...types: string[]) => ({ longText, shortText: longText, types });

describe("adres uit Google", () => {
  it("zet adresonderdelen om naar de velden van Atlas", () => {
    expect(
      addressFromComponents([c("12", "street_number"), c("Kerkstraat", "route"), c("Nijmegen", "locality", "political"), c("Gelderland", "administrative_area_level_1"), c("Nederland", "country"), c("6511AB", "postal_code")]),
    ).toEqual({ street: "Kerkstraat", houseNumber: "12", addition: null, postcode: "6511 AB", city: "Nijmegen" });
  });

  it("haalt de toevoeging uit het huisnummer of uit subpremise", () => {
    expect(addressFromComponents([c("12A", "street_number"), c("Kerkstraat", "route")]).addition).toBe("A");
    expect(addressFromComponents([c("12", "street_number"), c("bis", "subpremise")]).addition).toBe("BIS");
  });

  it("laat een ontbrekend huisnummer leeg en houdt een Belgische postcode zoals hij is", () => {
    expect(addressFromComponents([c("Grote Markt", "route"), c("2000", "postal_code"), c("Antwerpen", "locality")])).toEqual({
      street: "Grote Markt",
      houseNumber: null,
      addition: null,
      postcode: "2000",
      city: "Antwerpen",
    });
    expect(addressFromComponents(undefined).street).toBeNull();
  });

  it("leest de suggesties", () => {
    const body = {
      suggestions: [
        { placePrediction: { placeId: "abc", text: { text: "Kerkstraat 12, Nijmegen, Nederland" }, structuredFormat: { mainText: { text: "Kerkstraat 12" }, secondaryText: { text: "Nijmegen, Nederland" } } } },
        { queryPrediction: { text: { text: "kerk" } } },
      ],
    };
    expect(suggestionsFromAutocomplete(body)).toEqual([{ placeId: "abc", main: "Kerkstraat 12", secondary: "Nijmegen, Nederland" }]);
    expect(suggestionsFromAutocomplete({})).toEqual([]);
  });
});
