import type { PersonName } from "../normalize";

/** Genormaliseerde invoer voor een nieuwe lead/klant, ongeacht de bron. */
export interface LeadInput {
  name: string | null;
  person: PersonName;
  emails: string[];
  phones: string[];
  rawEmail?: string | null;
  rawPhone?: string | null;
  street: string | null;
  houseNumber: number | null;
  addition: string | null;
  postcode: string | null;
  city: string | null;
  referral?: string | null;
  message?: string | null;
  sourcePage?: string | null;
}
