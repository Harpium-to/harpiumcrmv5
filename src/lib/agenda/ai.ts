// ============================================================
// The agenda, for the AI agent that answers customers (Fase 3).
//
// The auto-reply is one model call that returns text, with control
// markers for what text cannot say ([[HANDOFF]], see lib/ai). Booking
// follows the same shape, in three steps that each live here:
//
//   1. The agent is SHOWN the agenda: the free slots of the coming
//      days and what this customer already has booked, written into
//      the system prompt. It can only offer what is on that list.
//   2. It ASKS to book by ending its reply with
//      [[AGENDAR <agenda number> <YYYY-MM-DD> <HH:MM>]].
//   3. The server DECIDES: the marker is honoured only if it names a
//      slot that was on the list, and the database still has the last
//      word on two bookings in one slot.
//
// So the model never writes to the agenda. A customer who talks it
// into emitting the marker gets, at worst, a real free slot booked for
// themself — which a cap on upcoming appointments keeps from being a
// way to fill someone's week.
//
// Whether the agent may book at all, and whether a person has to
// approve it, is lib/agents/autonomy.ts's call (`schedule_meeting`,
// unlocked by the "Agenda" tool). When approval is needed the
// appointment is written as 'pending' — the slot is held — and a
// request goes to the approvals queue (migration 067).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/auth/account-context'

import { busyOf, freeSlots, type HoursRow, type Slot } from './slots'
import {
  dayKeyOf,
  formatDayShort,
  formatTime,
  minutesOfDay,
  parseClock,
  safeTimeZone,
  weekdayOf,
} from './time'

/** How far ahead the agent can see, today included. */
export const AI_AGENDA_DAYS = 10
/** Agendas shown to the agent; a CRM with more is shown the oldest ones. */
export const AI_MAX_CALENDARS = 6
/** Free slots listed per agenda and day — a whole empty day reads as "plenty". */
export const AI_MAX_SLOTS_PER_DAY = 12
/** An agent does not book for a customer who already has this many coming up. */
export const AI_MAX_UPCOMING_PER_CONTACT = 3

export interface AiCalendar {
  id: string
  name: string
  slotMinutes: number
  timezone: string
  /** The free slots the agent is shown, soonest first. */
  slots: Slot[]
}

export interface AiContactEvent {
  calendarName: string
  startsAt: string
  timezone: string
  status: string
}

export interface AgendaForAi {
  /** In prompt order: "Agenda 1" is calendars[0]. */
  calendars: AiCalendar[]
  /** What this customer has coming up, soonest first. */
  contactEvents: AiContactEvent[]
  now: Date
}

interface CalendarRow {
  id: string
  name: string
  slot_minutes: number
  timezone: string
}

/** Keep at most `perDay` slots of each day, spread across it. */
export function thinSlots(slots: Slot[], perDay: number): Slot[] {
  const byDay = new Map<string, Slot[]>()
  for (const slot of slots) {
    const day = byDay.get(slot.dayKey)
    if (day) day.push(slot)
    else byDay.set(slot.dayKey, [slot])
  }
  const out: Slot[] = []
  for (const day of byDay.values()) {
    if (day.length <= perDay) {
      out.push(...day)
      continue
    }
    // Evenly spaced picks, first and last included, so the agent can
    // still offer "first thing" and "end of the day".
    for (let i = 0; i < perDay; i++) {
      out.push(day[Math.round((i * (day.length - 1)) / (perDay - 1))])
    }
  }
  return out
}

/**
 * Read what the agent needs to talk about the agenda. Null when the
 * CRM has no active agenda, or before migration 067 — the agent then
 * simply is not told about scheduling.
 */
export async function loadAgendaForAi(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  now: Date,
): Promise<AgendaForAi | null> {
  const { data: calendarRows, error } = await db
    .from('calendars')
    .select('id, name, slot_minutes, timezone')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(AI_MAX_CALENDARS)
  if (error) {
    if (!isMissingTable(error)) console.error('[agenda ai] calendars read failed:', error)
    return null
  }
  const rows = (calendarRows ?? []) as CalendarRow[]
  if (rows.length === 0) return null

  // One window for every agenda, a day wider than the look-ahead so a
  // zone west of the server's is still covered.
  const until = new Date(now.getTime() + (AI_AGENDA_DAYS + 1) * 86_400_000)
  const [hoursResult, eventsResult, contactResult] = await Promise.all([
    db.from('calendar_hours').select('calendar_id, weekday, starts, ends').eq('account_id', accountId),
    db
      .from('calendar_events')
      .select('calendar_id, starts_at, ends_at, status')
      .eq('account_id', accountId)
      .lt('starts_at', until.toISOString())
      .gt('ends_at', now.toISOString()),
    db
      .from('calendar_events')
      .select('calendar_id, starts_at, ends_at, status')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .gt('ends_at', now.toISOString())
      .order('starts_at', { ascending: true }),
  ])
  if (hoursResult.error || eventsResult.error || contactResult.error) {
    console.error(
      '[agenda ai] agenda read failed:',
      hoursResult.error ?? eventsResult.error ?? contactResult.error,
    )
    return null
  }

  type EventRow = { calendar_id: string; starts_at: string; ends_at: string; status: string }
  const hours = (hoursResult.data ?? []) as (HoursRow & { calendar_id: string })[]
  const events = (eventsResult.data ?? []) as EventRow[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  return {
    now,
    calendars: rows.map((row) => {
      const timezone = safeTimeZone(row.timezone)
      return {
        id: row.id,
        name: row.name,
        slotMinutes: row.slot_minutes,
        timezone,
        slots: thinSlots(
          freeSlots({
            hours: hours.filter((h) => h.calendar_id === row.id),
            slotMinutes: row.slot_minutes,
            timezone,
            busy: busyOf(events.filter((e) => e.calendar_id === row.id)),
            fromDay: dayKeyOf(now, timezone),
            days: AI_AGENDA_DAYS,
            now,
          }),
          AI_MAX_SLOTS_PER_DAY,
        ),
      }
    }),
    contactEvents: ((contactResult.data ?? []) as EventRow[])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        calendarName: byId.get(e.calendar_id)?.name ?? 'agenda',
        startsAt: e.starts_at,
        timezone: safeTimeZone(byId.get(e.calendar_id)?.timezone),
        status: e.status,
      })),
  }
}

const WEEKDAY_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekdayEn = (dayKey: string) => WEEKDAY_EN[weekdayOf(dayKey) - 1]

const STATUS_EN: Record<string, string> = {
  pending: 'reserved, waiting for the team to confirm',
  scheduled: 'booked',
  confirmed: 'booked and confirmed',
}

/**
 * The scheduling section of the system prompt. Written in English like
 * the rest of the scaffold (lib/ai/defaults.ts); the agent still
 * replies in the customer's language.
 */
export function agendaPrompt(agenda: AgendaForAi, opts: { needsApproval: boolean }): string {
  const zone = agenda.calendars[0]?.timezone ?? 'America/Sao_Paulo'
  const today = dayKeyOf(agenda.now, zone)
  const lines: string[] = [
    "Scheduling — you can see the business's agenda and book an appointment for this customer.",
    `It is now ${weekdayEn(today)} ${today} ${formatTime(agenda.now, zone)} (${zone}). Every time below is in that time zone.`,
    '',
    'Free slots — the only times you may offer:',
  ]

  agenda.calendars.forEach((calendar, index) => {
    lines.push(`Agenda ${index + 1} — ${calendar.name} (${calendar.slotMinutes} min each)`)
    if (calendar.slots.length === 0) {
      lines.push(`  no free slots in the next ${AI_AGENDA_DAYS} days`)
      return
    }
    let day = ''
    let times: string[] = []
    const flush = () => {
      if (times.length > 0) lines.push(`  ${weekdayEn(day)} ${day}: ${times.join(', ')}`)
    }
    for (const slot of calendar.slots) {
      if (slot.dayKey !== day) {
        flush()
        day = slot.dayKey
        times = []
      }
      times.push(formatTime(slot.start, calendar.timezone))
    }
    flush()
  })

  lines.push(
    '',
    'Rules for scheduling:',
    '- Offer only times from the list above, at most three at a time. Never say a time is free if it is not listed. If the customer asks for a time that is not listed, say it is not available and offer the nearest listed ones.',
    ...(agenda.calendars.length > 1
      ? [
          '- There is more than one agenda. If the customer has not said which professional or service they want, ask before offering times.',
        ]
      : []),
    '- When the customer has clearly chosen one listed slot, confirm it in your reply and end the reply with [[AGENDAR <agenda number> <YYYY-MM-DD> <HH:MM>]], for example [[AGENDAR 1 2030-01-07 14:30]]. That marker is what books it, and it is removed before the customer sees your message. Write it only after the customer has chosen, only for a listed slot, and at most once per reply.',
    opts.needsApproval
      ? '- Your booking is a reservation that someone from the team still has to approve. Tell the customer the time is reserved and that the team will confirm it shortly; do not say it is confirmed.'
      : '- Booking takes effect at once: tell the customer the appointment is booked.',
    '- To move or cancel an appointment that already exists, hand the conversation off.',
    '',
    agenda.contactEvents.length === 0
      ? "This customer's upcoming appointments: none."
      : "This customer's upcoming appointments:",
    ...agenda.contactEvents.map((e) => {
      const start = new Date(e.startsAt)
      const dayKey = dayKeyOf(start, e.timezone)
      return `- ${weekdayEn(dayKey)} ${dayKey} ${formatTime(start, e.timezone)} with ${e.calendarName} (${STATUS_EN[e.status] ?? e.status})`
    }),
  )
  return lines.join('\n')
}

export interface BookingRequest {
  /** 1-based, as written in the prompt. */
  calendarNumber: number
  dayKey: string
  /** Minutes since midnight on the agenda's clock. */
  minute: number
}

const MARKER = /\[\[\s*AGENDAR\s+(\d{1,2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*\]\]/i
const ANY_MARKER = /\[\[\s*AGENDAR[^\]]*\]\]/gi

/**
 * Take the booking marker out of a reply. The text never reaches the
 * customer with a marker in it — well-formed or not — and only the
 * first well-formed one counts.
 */
export function parseBookingMarker(raw: string): { text: string; booking: BookingRequest | null } {
  const match = MARKER.exec(raw)
  const text = raw
    .replace(ANY_MARKER, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (!match) return { text, booking: null }
  return {
    text,
    booking: {
      calendarNumber: Number(match[1]),
      dayKey: match[2],
      minute: parseClock(match[3]),
    },
  }
}

/**
 * The slot a marker points at — only if it is one the agent was shown.
 * Anything else (an agenda that is not there, a time off the list) is
 * null: the model asked for something it was never offered.
 */
export function resolveBooking(
  agenda: AgendaForAi,
  request: BookingRequest,
): { calendar: AiCalendar; slot: Slot } | null {
  const calendar = agenda.calendars[request.calendarNumber - 1]
  if (!calendar) return null
  const slot = calendar.slots.find(
    (s) =>
      s.dayKey === request.dayKey &&
      minutesOfDay(s.start, calendar.timezone) === request.minute,
  )
  return slot ? { calendar, slot } : null
}

export type BookingOutcome =
  | { status: 'booked' | 'pending'; eventId: string }
  /** Someone took the slot between the agent seeing it and booking it. */
  | { status: 'taken' }
  /** The marker named something the agent was not offered. */
  | { status: 'invalid' }
  /** This customer already has as many coming up as an agent may book. */
  | { status: 'limit' }
  | { status: 'failed' }

/** What the customer is told instead of the agent's words when a booking does not happen. */
export const BOOKING_FALLBACK: Record<'taken' | 'invalid' | 'limit' | 'failed', string> = {
  taken: 'Esse horário acabou de ser ocupado. Quer que eu veja outro horário para você?',
  invalid:
    'Não consegui reservar esse horário. Pode me dizer de novo o dia e a hora que você prefere?',
  limit:
    'Você já tem horários marcados com a gente. Para marcar mais um, alguém da equipe vai te atender por aqui.',
  failed:
    'Não consegui marcar agora. Alguém da equipe vai te ajudar com o horário por aqui.',
}

/**
 * Book what a marker asked for. `db` is the service-role client — the
 * agent is not a signed-in person. Never throws.
 */
export async function bookForAi(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    agenda: AgendaForAi
    request: BookingRequest
    /** True when a person has to approve: the slot is held as 'pending'. */
    needsApproval: boolean
    agentName: string
  },
): Promise<BookingOutcome & { calendar?: AiCalendar; slot?: Slot }> {
  const { agenda, request } = args
  if (agenda.contactEvents.length >= AI_MAX_UPCOMING_PER_CONTACT) return { status: 'limit' }
  const target = resolveBooking(agenda, request)
  if (!target) return { status: 'invalid' }

  try {
    const { data, error } = await db
      .from('calendar_events')
      .insert({
        account_id: args.accountId,
        calendar_id: target.calendar.id,
        contact_id: args.contactId,
        kind: 'appointment',
        status: args.needsApproval ? 'pending' : 'scheduled',
        source: 'ai',
        starts_at: target.slot.start.toISOString(),
        ends_at: target.slot.end.toISOString(),
        notes: `Marcado pelo agente de IA ${args.agentName}.`,
        // The agent's own reply is the confirmation; the agenda's would
        // say the same thing twice. The reminder still goes. A pending
        // one is confirmed when a person approves it (067).
        confirmation_at: args.needsApproval ? null : new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) {
      if (error?.code === '23P01') return { status: 'taken' }
      console.error('[agenda ai] booking failed:', error)
      return { status: 'failed' }
    }
    return {
      status: args.needsApproval ? 'pending' : 'booked',
      eventId: (data as { id: string }).id,
      ...target,
    }
  } catch (err) {
    console.error('[agenda ai] booking threw:', err)
    return { status: 'failed' }
  }
}

/** "qui, 12 nov às 08:00" — a slot, for a line a person reads. */
export function describeSlot(calendar: AiCalendar, slot: Slot): string {
  return `${formatDayShort(dayKeyOf(slot.start, calendar.timezone))} às ${formatTime(slot.start, calendar.timezone)}`
}
