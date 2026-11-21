import { googleFetch } from "./google-oauth";

export interface CalendarEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  colorId?: string;
  location?: string;
  etag?: string;
  attendees?: { email?: string; self?: boolean }[];
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export interface CalendarPage {
  events: CalendarEvent[];
  nextSyncToken: string | null;
}

export interface CalendarClient {
  account: string | null;
  /** Wijzigingen sinds syncToken; zonder token vanaf timeMin. Gooit {status: 410} als het token verlopen is. */
  changes(opts: { syncToken?: string | null; timeMin?: string }): Promise<CalendarPage>;
}

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export function liveCalendar(token: string, account: string | null): CalendarClient {
  return {
    account,
    async changes({ syncToken, timeMin }) {
      const events: CalendarEvent[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;
      do {
        const p = new URLSearchParams({ maxResults: "250", singleEvents: "true", showDeleted: "true" });
        if (syncToken) p.set("syncToken", syncToken);
        else if (timeMin) p.set("timeMin", timeMin);
        if (pageToken) p.set("pageToken", pageToken);
        const r = await googleFetch<{ items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }>(token, `${BASE}?${p}`);
        events.push(...(r.items ?? []));
        pageToken = r.nextPageToken;
        nextSyncToken = r.nextSyncToken ?? nextSyncToken;
      } while (pageToken);
      return { events, nextSyncToken };
    },
  };
}
