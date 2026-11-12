// ============================================================
// "Adicionar à agenda": a Google Agenda link that opens the person's
// own calendar with the event already filled in — they just save it
// (Fase 9 of docs/plano-extensao-chrome.md).
//
// No account access and nothing to set up: it is Google's public
// "create event" page, filled by the URL. The Chrome extension has a
// copy of this rule in extension/format.js; a test keeps the two
// building the same link.
// ============================================================

/** Minutes the event lasts: a task is a reminder, not a meeting. */
export const CALENDAR_EVENT_MINUTES = 30;

/** "20261112T120000Z": the date-time format the link takes, in UTC. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The link, or null without a title or a readable start. `details` is
 * the event's description (the contact, the way back to the CRM).
 */
export function googleCalendarUrl(input: {
  title: string | null | undefined;
  start: string | null | undefined;
  details?: string | null;
  minutes?: number;
}): string | null {
  const title = String(input.title ?? '').trim();
  const start = input.start ? new Date(input.start) : null;
  if (!title || !start || !Number.isFinite(start.getTime())) return null;
  const end = new Date(start.getTime() + (input.minutes ?? CALENDAR_EVENT_MINUTES) * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title.slice(0, 200),
    dates: `${stamp(start)}/${stamp(end)}`,
  });
  const details = String(input.details ?? '').trim();
  if (details) params.set('details', details.slice(0, 1000));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The event's description for a task about a contact. */
export function taskEventDetails(contact: {
  name?: string | null;
  phone?: string | null;
  url?: string | null;
}): string {
  const who = [contact.name, contact.phone].filter(Boolean).join(' · ');
  return [who ? `Contato: ${who}` : '', contact.url ? `No CRM: ${contact.url}` : '']
    .filter(Boolean)
    .join('\n');
}
