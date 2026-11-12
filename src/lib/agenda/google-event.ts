// ============================================================
// An agenda event as it goes into Google Agenda (G1 of
// docs/plano-google-agenda.md) — and what the sender has to do with it.
//
// Pure: a claimed row in, Google's event body (or a plan) out. The
// sender (google-sync.ts) only does the calls.
//
// What the professional sees in Google (decision 2 of the plan): the
// kind of appointment and who it is with in the title; the contact's
// WhatsApp, the notes and a link to their record in the description.
// The customer is never an attendee — Google would e-mail them an
// invitation — and nothing is sent to anyone (sendUpdates=none).
// ============================================================

/** One row of claim_google_event_sync() (migration 069). */
export interface ClaimedGoogleSync {
  event_id: string
  claimed_at: string
  account_id: string
  calendar_id: string
  kind: 'appointment' | 'block'
  status: string
  title: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  contact_id: string | null
  contact_name: string | null
  contact_phone: string | null
  /** Where the event is in Google now, if anywhere. */
  google_event_id: string | null
  google_calendar_id: string | null
  google_connection_id: string | null
  google_sync_attempts: number
  calendar_name: string
  timezone: string
  /** Where its agenda writes now, if anywhere. */
  target_connection_id: string | null
  target_calendar_id: string | null
  target_connection_status: string | null
}

/** 32-bit FNV-1a, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The id the event gets in Google: the CRM's own, so creating it twice
 * (a run that died after Google answered) is impossible. Google wants
 * 5–1024 characters of base32hex (0-9, a-v); hex digits are a subset.
 * The target calendar is part of it, so moving the event to another
 * Google calendar never collides with the copy deleted from the first.
 */
export function googleEventIdFor(eventId: string, googleCalendarId: string): string {
  return `hc${eventId.replace(/-/g, '').toLowerCase()}${fnv1a(googleCalendarId)}`
}

const STATUS_SUFFIX: Record<string, string> = {
  pending: ' (aguardando aprovação)',
  no_show: ' (faltou)',
}

/** The event's title in Google. */
export function googleEventTitle(row: Pick<ClaimedGoogleSync, 'kind' | 'status' | 'title' | 'contact_name' | 'contact_phone'>): string {
  const title = row.title?.trim() ?? ''
  if (row.kind === 'block') return title ? `Bloqueado: ${title}` : 'Bloqueado'
  const who = row.contact_name?.trim() || row.contact_phone?.trim() || ''
  const base = [title || 'Agendamento', who].filter(Boolean).join(' · ')
  return `${base}${STATUS_SUFFIX[row.status] ?? ''}`.slice(0, 1000)
}

/** The event's description in Google. */
export function googleEventDescription(row: ClaimedGoogleSync, crmUrl: string | null): string {
  const lines: string[] = []
  if (row.kind === 'appointment') {
    if (row.contact_name?.trim()) lines.push(`Contato: ${row.contact_name.trim()}`)
    if (row.contact_phone?.trim()) lines.push(`WhatsApp: ${row.contact_phone.trim()}`)
  }
  if (row.notes?.trim()) lines.push(`Observações: ${row.notes.trim()}`)
  if (row.kind === 'appointment' && row.contact_id && crmUrl) {
    lines.push(`Ficha no CRM: ${crmUrl}/contacts?contact=${row.contact_id}`)
  }
  lines.push('', `Agenda "${row.calendar_name}" do Harpium CRM. Para mudar, use o CRM.`)
  return lines.join('\n').trim()
}

/** The whole event body for events.insert / events.update. */
export function buildGoogleEvent(row: ClaimedGoogleSync, crmUrl: string | null): Record<string, unknown> {
  return {
    summary: googleEventTitle(row),
    description: googleEventDescription(row, crmUrl),
    start: { dateTime: new Date(row.starts_at).toISOString(), timeZone: row.timezone },
    end: { dateTime: new Date(row.ends_at).toISOString(), timeZone: row.timezone },
    // Waiting for a person's OK: shown, but as not yet certain.
    status: row.status === 'pending' ? 'tentative' : 'confirmed',
    transparency: 'opaque',
    reminders: { useDefault: true },
    extendedProperties: {
      // How the CRM recognises its own events in Google (and, in G2,
      // keeps them from being read back as "busy").
      private: { harpium_event_id: row.event_id, harpium_account_id: row.account_id },
    },
  }
}

export interface GoogleTarget {
  connectionId: string
  calendarId: string
}

export interface GooglePlan {
  /** The copy in Google to remove first: cancelled, or now somewhere else. */
  remove: (GoogleTarget & { eventId: string }) | null
  /** Where the event must be after the run, if anywhere. */
  put: (GoogleTarget & { eventId: string; exists: boolean }) | null
  /** Its agenda writes to Google, but that account needs signing in again. */
  blocked: boolean
}

/** What one claimed event needs done in Google. */
export function planGoogleSync(row: ClaimedGoogleSync): GooglePlan {
  const target: GoogleTarget | null =
    row.target_connection_id && row.target_calendar_id
      ? { connectionId: row.target_connection_id, calendarId: row.target_calendar_id }
      : null
  const current =
    row.google_event_id && row.google_connection_id && row.google_calendar_id
      ? {
          connectionId: row.google_connection_id,
          calendarId: row.google_calendar_id,
          eventId: row.google_event_id,
        }
      : null
  const wanted = target !== null && row.status !== 'cancelled'
  const sameSpot =
    current !== null &&
    target !== null &&
    current.connectionId === target.connectionId &&
    current.calendarId === target.calendarId

  return {
    remove: current && (!wanted || !sameSpot) ? current : null,
    put:
      wanted && target
        ? {
            ...target,
            eventId: sameSpot && current ? current.eventId : googleEventIdFor(row.event_id, target.calendarId),
            exists: sameSpot,
          }
        : null,
    blocked: wanted && row.target_connection_status !== 'connected',
  }
}
