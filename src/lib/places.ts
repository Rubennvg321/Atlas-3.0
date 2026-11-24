import { formatPostcode, normalizeAddition, normalizePostcode, parseHouseNumber, tidyCity } from "./normalize";

/**
 * Adres zoeken via Google (Places API, "New"). Hier alleen het omzetten van het
 * antwoord van Google naar de adresvelden van Atlas — zonder netwerk, dus te testen.
 */
export interface AddressFields {
  street: string | null;
  houseNumber: string | null;
  addition: string | null;
  postcode: string | null; // "1234 AB"
  city: string | null;
}

export interface AddressSuggestion {
  placeId: string;
  main: string;
  secondary: string;
}

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export function suggestionsFromAutocomplete(body: unknown): AddressSuggestion[] {
  const list = (body as { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] })?.suggestions ?? [];
  const out: AddressSuggestion[] = [];
  for (const s of list) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
    const secondary = p.structuredFormat?.secondaryText?.text ?? "";
    if (main) out.push({ placeId: p.placeId, main, secondary });
  }
  return out;
}

export function addressFromComponents(components: GoogleAddressComponent[] | null | undefined): AddressFields {
  const get = (type: string) => components?.find((c) => c.types?.includes(type))?.longText?.trim() || null;
  const street = get("route");
  const nr = parseHouseNumber(get("street_number"));
  // Toevoeging staat bij Google soms los (subpremise), soms in het huisnummer ("12A").
  const sub = get("subpremise");
  const rawPc = get("postal_code");
  const pc = normalizePostcode(rawPc);
  const city = tidyCity(get("locality") ?? get("postal_town") ?? get("administrative_area_level_2"));
  return {
    street,
    houseNumber: nr ? String(nr.number) : null,
    addition: nr?.addition ?? (normalizeAddition(sub)),
    postcode: pc ? formatPostcode(pc) : rawPc, // Belgische postcode (4 cijfers) blijft zoals hij is
    city,
  };
}
