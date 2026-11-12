// ============================================================
// Where the agenda's data comes from and goes to.
//
// The screen talks to this interface, not to Supabase: every read and
// write the agenda does is listed here, in one place, and the screen
// can be exercised against an in-memory store. The real one below
// goes straight through RLS (migration 067) — the whole team reads,
// agents and above book, admins and above manage the agendas.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/auth/account-context'
import type { GoogleCalendarEntry } from '@/lib/google/calendar-api'
import type {
  AgendaCalendar,
  AgendaEvent,
  AgendaHours,
  GoogleBusyBlock,
  GoogleConnection,
} from '@/types'

import type { HoursRow } from './slots'

export type WriteError = { code?: string; message?: string } | null

/** The row an appointment or block is written as. */
export interface EventWrite {
  calendar_id: string
  kind: AgendaEvent['kind']
  contact_id: string | null
  title: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  status: AgendaEvent['status']
  /** Whether the customer is messaged about this appointment. */
  notify: boolean
}

export interface CalendarWrite {
  name: string
  color: string
  slot_minutes: number
  timezone: string
  confirm_enabled: boolean
  confirm_text: string | null
  confirm_template: string | null
  confirm_template_language: string | null
  reminder_enabled: boolean
  reminder_hours: number
  reminder_text: string | null
  reminder_template: string | null
  reminder_template_language: string | null
  public_enabled: boolean
  public_auto_confirm: boolean
  feed_enabled: boolean
}

/** An approved WhatsApp template an agenda's message can use. */
export interface TemplateOption {
  name: string
  language: string
  body_text: string
}

export type CalendarsResult =
  | { status: 'ready'; calendars: AgendaCalendar[]; hours: AgendaHours[] }
  /** Migration 067 has not been applied to this server yet. */
  | { status: 'unavailable' }
  | { status: 'error' }

export interface AgendaStore {
  loadCalendars(): Promise<CalendarsResult>
  /** Events that touch [from, to), every agenda; null if the read failed. */
  loadEvents(from: Date, to: Date): Promise<AgendaEvent[] | null>
  /** Appointments waiting for a person's OK, soonest first; null if the read failed. */
  loadPending(now: Date): Promise<AgendaEvent[] | null>
  /** One contact's appointments, soonest first; null if the read failed. */
  loadContactEvents(contactId: string): Promise<AgendaEvent[] | null>
  /**
   * Approved templates of a CRM on the official API. Empty anywhere
   * else — templates only exist there.
   */
  loadTemplates(): Promise<TemplateOption[]>
  saveEvent(event: EventWrite, id?: string): Promise<WriteError>
  deleteEvent(id: string): Promise<WriteError>
  /** Creates or updates an agenda and replaces its opening hours. */
  saveCalendar(calendar: CalendarWrite, hours: HoursRow[], id?: string): Promise<WriteError>
  setCalendarActive(id: string, active: boolean): Promise<WriteError>
  deleteCalendar(id: string): Promise<WriteError>
  /**
   * Google accounts connected to the CRM (069); null when this server
   * does not have the Google Agenda yet (migration not applied).
   */
  loadGoogleConnections(): Promise<GoogleConnection[] | null>
  /** The calendars a connected account owns, to choose where an agenda writes. */
  listGoogleCalendars(connectionId: string): Promise<GoogleResult<GoogleCalendarEntry[]>>
  /** Point an agenda at a Google calendar; connectionId null stops it writing there. */
  linkGoogle(calendarId: string, connectionId: string | null, googleCalendarId?: string): Promise<GoogleResult<true>>
  /** Disconnect an account; deleteRemote also removes upcoming events from Google. */
  disconnectGoogle(connectionId: string, deleteRemote: boolean): Promise<GoogleResult<{ removed: number }>>
  /** What is busy in Google, per agenda, touching [from, to) (071). Empty without it. */
  loadGoogleBusy(from: Date, to: Date): Promise<GoogleBusyBlock[]>
  /** Ask the server to read Google again now (throttled there). Resolves when done. */
  refreshGoogle(): Promise<void>
  /** "Mostrar os compromissos do Google nesta agenda" (071). */
  setGoogleShowBusy(calendarId: string, show: boolean): Promise<WriteError>
  /** A 7-day link a professional opens to connect their Google to this agenda (G3). */
  createGoogleConnectLink(calendarId: string): Promise<GoogleResult<{ url: string }>>
}

/** What a Google action answered: the data, or why not (and whether to reconnect). */
export type GoogleResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; reconnect: boolean }

async function callGoogleApi<T>(url: string, init?: RequestInit): Promise<GoogleResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      return {
        ok: false,
        error: typeof json.error === 'string' ? json.error : 'Não consegui falar com o Google agora.',
        reconnect: json.reconnect === true,
      }
    }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'Sem conexão com o servidor. Tente de novo.', reconnect: false }
  }
}

/** Ask the server to send this change to Google now (069). Fire and forget. */
function nudgeGoogle(eventId: string | null) {
  void fetch('/api/agenda/google/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventId ? { eventId } : {}),
  }).catch(() => {})
}

/** A column this server's database does not have yet (an unapplied migration). */
function isMissingColumn(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204')
}

const CALENDAR_COLUMNS =
  'id, account_id, name, color, slot_minutes, timezone, is_active, created_at, confirm_enabled, confirm_text, confirm_template, confirm_template_language, reminder_enabled, reminder_hours, reminder_text, reminder_template, reminder_template_language, public_enabled, public_auto_confirm, public_token, feed_enabled, feed_token'
const HOURS_COLUMNS = 'id, calendar_id, weekday, starts, ends'
const EVENT_COLUMNS =
  'id, calendar_id, kind, contact_id, title, notes, starts_at, ends_at, status, source, notify, confirmation_at, confirmation_error, reminder_at, reminder_error, created_at, contact:contacts(id, name, phone)'
// The same, plus Google Agenda: 071 first, then 069, then the plain
// list. A database without a migration answers "no such column" and
// the next list is used from then on.
const CALENDAR_COLUMN_SETS = [
  `${CALENDAR_COLUMNS}, google_connection_id, google_calendar_id, google_calendar_name, google_show_busy`,
  `${CALENDAR_COLUMNS}, google_connection_id, google_calendar_id, google_calendar_name`,
  CALENDAR_COLUMNS,
]
const EVENT_COLUMN_SETS = [
  EVENT_COLUMNS.replace(
    ', contact:contacts',
    ', google_sync_state, google_sync_error, google_remote_notice, contact:contacts',
  ),
  EVENT_COLUMNS.replace(', contact:contacts', ', google_sync_state, google_sync_error, contact:contacts'),
  EVENT_COLUMNS,
]

export function createSupabaseAgendaStore(
  supabase: SupabaseClient,
  accountId: string,
  userId: string | null,
): AgendaStore {
  // How far down the column lists this database turned out to be.
  let calendarLevel = 0
  let eventLevel = 0
  // False once the database turned out not to have 069 at all.
  let withGoogle = true

  /** Run an events read with the richest columns this database has. */
  async function readEvents(
    query: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
  ): Promise<AgendaEvent[] | null> {
    for (;;) {
      const { data, error } = await query(EVENT_COLUMN_SETS[eventLevel])
      if (isMissingColumn(error) && eventLevel < EVENT_COLUMN_SETS.length - 1) {
        eventLevel += 1
        if (eventLevel === EVENT_COLUMN_SETS.length - 1) withGoogle = false
        continue
      }
      return error ? null : ((data ?? []) as AgendaEvent[])
    }
  }

  return {
    async loadCalendars() {
      const readCalendars = (columns: string) =>
        supabase
          .from('calendars')
          .select(columns)
          .eq('account_id', accountId)
          .order('created_at', { ascending: true })
      const [firstRead, hours] = await Promise.all([
        readCalendars(CALENDAR_COLUMN_SETS[calendarLevel]),
        supabase.from('calendar_hours').select(HOURS_COLUMNS).eq('account_id', accountId),
      ])
      let calendars = firstRead
      while (isMissingColumn(calendars.error) && calendarLevel < CALENDAR_COLUMN_SETS.length - 1) {
        calendarLevel += 1
        if (calendarLevel === CALENDAR_COLUMN_SETS.length - 1) withGoogle = false
        calendars = await readCalendars(CALENDAR_COLUMN_SETS[calendarLevel])
      }
      const error = calendars.error ?? hours.error
      if (error) {
        return { status: isMissingTable(error) ? 'unavailable' : 'error' }
      }
      return {
        status: 'ready',
        calendars: (calendars.data ?? []) as unknown as AgendaCalendar[],
        hours: (hours.data ?? []) as AgendaHours[],
      }
    },

    loadEvents(from, to) {
      return readEvents((columns) =>
        supabase
          .from('calendar_events')
          .select(columns)
          .eq('account_id', accountId)
          // Touches the window: starts before it ends, ends after it starts.
          .lt('starts_at', to.toISOString())
          .gt('ends_at', from.toISOString())
          .order('starts_at', { ascending: true }),
      )
    },

    loadPending(now) {
      return readEvents((columns) =>
        supabase
          .from('calendar_events')
          .select(columns)
          .eq('account_id', accountId)
          .eq('status', 'pending')
          .gt('ends_at', now.toISOString())
          .order('starts_at', { ascending: true })
          .limit(50),
      )
    },

    loadContactEvents(contactId) {
      return readEvents((columns) =>
        supabase
          .from('calendar_events')
          .select(columns)
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
          .order('starts_at', { ascending: true })
          .limit(200),
      )
    },

    async loadTemplates() {
      const { data, error } = await supabase
        .from('message_templates')
        .select('name, language, body_text, status')
        .eq('account_id', accountId)
        .order('name', { ascending: true })
      if (error) return []
      return ((data ?? []) as (TemplateOption & { status?: string | null })[])
        .filter((t) => (t.status ?? '').toUpperCase() === 'APPROVED')
        .map((t) => ({ name: t.name, language: t.language || 'pt_BR', body_text: t.body_text ?? '' }))
    },

    async saveEvent(event, id) {
      let eventId = id
      if (eventId) {
        const { error } = await supabase.from('calendar_events').update(event).eq('id', eventId)
        if (error) return error
      } else {
        const { data, error } = await supabase
          .from('calendar_events')
          .insert({ ...event, account_id: accountId, created_by: userId })
          .select('id')
          .single()
        if (error || !data) return error ?? { message: 'insert returned nothing' }
        eventId = (data as { id: string }).id
      }
      // Ask for the customer's confirmation now rather than at the
      // scheduler's next run. Whether one is due is the database's
      // rule; if this request is lost, the scheduler still sends it.
      if (event.kind === 'appointment' && event.contact_id && event.notify) {
        void fetch('/api/agenda/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
        }).catch(() => {})
      }
      // Same for Google Agenda: the database already knows whether this
      // agenda writes there (069); this only makes it go now.
      if (withGoogle && eventId) nudgeGoogle(eventId)
      return null
    },

    async deleteEvent(id) {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id)
      // A deleted event that was in Google is queued for removal (069).
      if (!error && withGoogle) nudgeGoogle(null)
      return error
    },

    async saveCalendar(calendar, hours, id) {
      let calendarId = id
      if (calendarId) {
        const { error } = await supabase.from('calendars').update(calendar).eq('id', calendarId)
        if (error) return error
      } else {
        const { data, error } = await supabase
          .from('calendars')
          .insert({ ...calendar, account_id: accountId, created_by: userId })
          .select('id')
          .single()
        if (error || !data) return error ?? { message: 'insert returned nothing' }
        calendarId = (data as { id: string }).id
      }
      const { error } = await supabase.rpc('set_calendar_hours', {
        p_calendar_id: calendarId,
        p_hours: hours,
      })
      return error
    },

    async setCalendarActive(id, active) {
      const { error } = await supabase.from('calendars').update({ is_active: active }).eq('id', id)
      return error
    },

    async deleteCalendar(id) {
      const { error } = await supabase.from('calendars').delete().eq('id', id)
      if (!error && withGoogle) nudgeGoogle(null)
      return error
    },

    async loadGoogleConnections() {
      const { data, error } = await supabase
        .from('google_connections')
        .select('id, email, status, last_error')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
      if (error) return null
      return (data ?? []) as GoogleConnection[]
    },

    async listGoogleCalendars(connectionId) {
      const result = await callGoogleApi<{ calendars: GoogleCalendarEntry[] }>(
        `/api/agenda/google/calendars?connection=${encodeURIComponent(connectionId)}`,
      )
      return result.ok ? { ok: true, data: result.data.calendars } : result
    },

    async linkGoogle(calendarId, connectionId, googleCalendarId) {
      const result = await callGoogleApi('/api/agenda/google/link', {
        method: 'POST',
        body: JSON.stringify({ calendarId, connectionId, googleCalendarId }),
      })
      return result.ok ? { ok: true, data: true } : result
    },

    async disconnectGoogle(connectionId, deleteRemote) {
      const result = await callGoogleApi<{ removed?: number }>('/api/agenda/google/disconnect', {
        method: 'POST',
        body: JSON.stringify({ connectionId, deleteRemote }),
      })
      return result.ok ? { ok: true, data: { removed: result.data.removed ?? 0 } } : result
    },

    async loadGoogleBusy(from, to) {
      if (!withGoogle) return []
      const { data, error } = await supabase
        .from('calendar_google_busy')
        .select('calendar_id, starts_at, ends_at, all_day')
        .eq('account_id', accountId)
        .lt('starts_at', to.toISOString())
        .gt('ends_at', from.toISOString())
        .order('starts_at', { ascending: true })
      return error ? [] : ((data ?? []) as GoogleBusyBlock[])
    },

    async refreshGoogle() {
      if (!withGoogle) return
      try {
        await fetch('/api/agenda/google/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      } catch {
        // The scheduler reads Google too; the screen just waits for it.
      }
    },

    async setGoogleShowBusy(calendarId, show) {
      const { error } = await supabase
        .from('calendars')
        .update({ google_show_busy: show })
        .eq('id', calendarId)
      return error
    },

    async createGoogleConnectLink(calendarId) {
      const result = await callGoogleApi<{ url?: string }>('/api/agenda/google/connect-link', {
        method: 'POST',
        body: JSON.stringify({ calendarId }),
      })
      return result.ok ? { ok: true, data: { url: result.data.url ?? '' } } : result
    },
  }
}
