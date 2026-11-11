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
import type { AgendaCalendar, AgendaEvent, AgendaHours } from '@/types'

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
}

const CALENDAR_COLUMNS =
  'id, account_id, name, color, slot_minutes, timezone, is_active, created_at, confirm_enabled, confirm_text, confirm_template, confirm_template_language, reminder_enabled, reminder_hours, reminder_text, reminder_template, reminder_template_language, public_enabled, public_auto_confirm, public_token, feed_enabled, feed_token'
const HOURS_COLUMNS = 'id, calendar_id, weekday, starts, ends'
const EVENT_COLUMNS =
  'id, calendar_id, kind, contact_id, title, notes, starts_at, ends_at, status, source, notify, confirmation_at, confirmation_error, reminder_at, reminder_error, created_at, contact:contacts(id, name, phone)'

export function createSupabaseAgendaStore(
  supabase: SupabaseClient,
  accountId: string,
  userId: string | null,
): AgendaStore {
  return {
    async loadCalendars() {
      const [calendars, hours] = await Promise.all([
        supabase
          .from('calendars')
          .select(CALENDAR_COLUMNS)
          .eq('account_id', accountId)
          .order('created_at', { ascending: true }),
        supabase.from('calendar_hours').select(HOURS_COLUMNS).eq('account_id', accountId),
      ])
      const error = calendars.error ?? hours.error
      if (error) {
        return { status: isMissingTable(error) ? 'unavailable' : 'error' }
      }
      return {
        status: 'ready',
        calendars: (calendars.data ?? []) as AgendaCalendar[],
        hours: (hours.data ?? []) as AgendaHours[],
      }
    },

    async loadEvents(from, to) {
      const { data, error } = await supabase
        .from('calendar_events')
        .select(EVENT_COLUMNS)
        .eq('account_id', accountId)
        // Touches the window: starts before it ends, ends after it starts.
        .lt('starts_at', to.toISOString())
        .gt('ends_at', from.toISOString())
        .order('starts_at', { ascending: true })
      if (error) return null
      return (data ?? []) as unknown as AgendaEvent[]
    },

    async loadPending(now) {
      const { data, error } = await supabase
        .from('calendar_events')
        .select(EVENT_COLUMNS)
        .eq('account_id', accountId)
        .eq('status', 'pending')
        .gt('ends_at', now.toISOString())
        .order('starts_at', { ascending: true })
        .limit(50)
      if (error) return null
      return (data ?? []) as unknown as AgendaEvent[]
    },

    async loadContactEvents(contactId) {
      const { data, error } = await supabase
        .from('calendar_events')
        .select(EVENT_COLUMNS)
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('starts_at', { ascending: true })
        .limit(200)
      if (error) return null
      return (data ?? []) as unknown as AgendaEvent[]
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
      return null
    },

    async deleteEvent(id) {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id)
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
      return error
    },
  }
}
