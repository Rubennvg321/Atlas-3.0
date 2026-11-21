import { addDays } from "./montage-days";

/**
 * Reviewverzoek: 2 dagen na de laatste montagedag. Herinnering: 7 dagen na het
 * verzoek als er nog geen review is. Datums als "YYYY-MM-DD" (Nederlandse tijd).
 */
export const REVIEW_DAYS_AFTER_MONTAGE = 2;
export const REMINDER_DAYS_AFTER_REQUEST = 7;

export function reviewRequestDue(lastMontageDay: string | null, today: string): boolean {
  if (!lastMontageDay) return false;
  return today >= addDays(lastMontageDay, REVIEW_DAYS_AFTER_MONTAGE);
}

export function reviewReminderDue(requestedDay: string | null, reminderSent: boolean, reviewReceived: boolean, today: string): boolean {
  if (!requestedDay || reminderSent || reviewReceived) return false;
  return today >= addDays(requestedDay, REMINDER_DAYS_AFTER_REQUEST);
}

/** Is vandaag een montagedag of ligt vandaag tussen de eerste en laatste montagedag? */
export function montageInProgress(days: string[], today: string): boolean {
  if (!days.length) return false;
  return today >= days[0] && today <= days[days.length - 1];
}
