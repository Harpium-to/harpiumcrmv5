// ============================================================
// An agenda as an iCalendar feed (migration 067, Fase 4).
//
// Google Agenda, Apple Calendar and Outlook can all follow a calendar
// "by URL": they fetch an .ics file every few hours and show its
// events next to the person's own. That gives a professional their
// CRM agenda on their phone with no login to Google and nothing to
// authorise — at the price of being read-only and not instant.
//
// Pure: events in, text out (RFC 5545). The route that serves it
// (/api/agenda/feed/<token>) only loads the rows.
// ============================================================

import { EVENT_STATUS_LABEL } from './status'

export interface IcsEvent {
  id: string
  kind: 'appointment' | 'block'
  title: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  status: keyof typeof EVENT_STATUS_LABEL
  updated_at?: string | null
  contact?: { name: string | null; phone: string | null } | null
}

/** "20300107T113000Z" — a UTC instant in iCalendar's basic format. */
function stamp(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** Escape a TEXT value: backslash, semicolon, comma, and line breaks. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Fold a content line at 75 octets, as the format requires: a line
 * break followed by one space continues the line. Counted in bytes,
 * and never splitting a multi-byte character — "ção" cut in half shows
 * up as garbage in every calendar app.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    // Continuation lines start with a space, which counts.
    const limit = parts.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

function summaryOf(event: IcsEvent): string {
  if (event.kind === 'block') return event.title?.trim() || 'Bloqueado'
  const who = event.contact?.name?.trim() || event.contact?.phone || null
  const what = event.title?.trim() || null
  return [who, what].filter(Boolean).join(' — ') || 'Agendamento'
}

function descriptionOf(event: IcsEvent): string {
  return [
    event.kind === 'appointment' ? `Situação: ${EVENT_STATUS_LABEL[event.status]}` : null,
    event.contact?.phone ? `WhatsApp: ${event.contact.phone}` : null,
    event.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The feed for one agenda. Cancelled events are left out — a calendar
 * that follows the feed drops them on its next refresh, which is what
 * cancelling should look like. A 'pending' one is marked tentative.
 */
export function buildIcs(input: {
  calendar: { id: string; name: string; timezone: string }
  events: IcsEvent[]
  now: Date
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harpium CRM//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(input.calendar.name)}`,
    `X-WR-TIMEZONE:${icsText(input.calendar.timezone)}`,
    // A hint; each app decides how often it really comes back.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  for (const event of input.events) {
    if (event.status === 'cancelled') continue
    const description = descriptionOf(event)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@agenda.harpium`,
      `DTSTAMP:${stamp(event.updated_at ?? input.now)}`,
      `DTSTART:${stamp(event.starts_at)}`,
      `DTEND:${stamp(event.ends_at)}`,
      `SUMMARY:${icsText(summaryOf(event))}`,
      ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
      `STATUS:${event.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`,
      // A block is time off: it should not make the person look busy
      // twice in an app that already shows their own events.
      `TRANSP:${event.kind === 'block' ? 'TRANSPARENT' : 'OPAQUE'}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
