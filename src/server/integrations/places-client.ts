import { addressFromComponents, suggestionsFromAutocomplete, type AddressFields, type AddressSuggestion, type GoogleAddressComponent } from "@/lib/places";

/**
 * Google Places API (New): adres zoeken terwijl je typt. De sleutel blijft op de
 * server; de browser praat alleen met Atlas.
 * Kosten: Google rekent per zoeksessie (typen + kiezen = één sessie, dankzij sessionToken).
 */
export interface PlacesClient {
  autocomplete(input: string, sessionToken: string): Promise<AddressSuggestion[]>;
  details(placeId: string, sessionToken: string): Promise<AddressFields>;
}

const BASE = "https://places.googleapis.com/v1";

async function call<T>(key: string, url: string, init: RequestInit & { fieldMask?: string } = {}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}) },
    signal: AbortSignal.timeout(8000),
  });
  const body = (await r.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
  if (!r.ok) throw new Error(`Google adres zoeken ${r.status} ${body.error?.status ?? ""}: ${body.error?.message ?? "onbekende fout"}`);
  return body as T;
}

export function livePlaces(key: string): PlacesClient {
  return {
    async autocomplete(input, sessionToken) {
      const body = await call<unknown>(key, `${BASE}/places:autocomplete`, {
        method: "POST",
        body: JSON.stringify({ input, sessionToken, languageCode: "nl", regionCode: "nl", includedRegionCodes: ["nl", "be", "de"] }),
      });
      return suggestionsFromAutocomplete(body);
    },
    async details(placeId, sessionToken) {
      const p = new URLSearchParams({ languageCode: "nl", regionCode: "nl", sessionToken });
      const body = await call<{ addressComponents?: GoogleAddressComponent[] }>(key, `${BASE}/places/${encodeURIComponent(placeId)}?${p}`, {
        fieldMask: "addressComponents",
      });
      return addressFromComponents(body.addressComponents);
    },
  };
}
