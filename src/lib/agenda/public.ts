// ============================================================
// The public booking link (migration 067, Fase 4).
//
// /marcar/<token> lets a customer pick one of an agenda's free slots
// and leave a name and a WhatsApp number — no login. Everything they
// can reach is here, and it is deliberately little:
//
//   - they see the agenda's name and its FREE slots, never who has
//     the taken ones;
//   - they can book one slot at a time, only a slot that is free right
//     now and inside the opening hours (no encaixe from outside);
//   - a number with several appointments coming up cannot add more.
//
// The token is the only credential, so every read goes through
// `loadPublicCalendar`, which also checks the door is open: the link
// stops working the moment an admin turns it off or archives the
// agenda. Runs with the service-role client — there is no session.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

import { busyOf, freeSlots, type HoursRow, type Slot } from './slots'
import { dayKeyOf, safeTimeZone } from './time'

/** How far ahead the public page offers slots, today included. */
export const PUBLIC_BOOKING_DAYS = 30
/** A number with this many appointments coming up cannot book another. */
export const PUBLIC_MAX_UPCOMING = 3

const TOKEN = /^[0-9a-f]{64}$/

export interface PublicCalendar {
  id: string
  accountId: string
  accountName: string
  /** Who system-created contacts are attributed to (contacts.user_id). */
  ownerUserId: string
  name: string
  slotMinutes: number
  timezone: string
  autoConfirm: boolean
}

/** The agenda behind a public token — only while its link is on. */
export async function loadPublicCalendar(
  admin: SupabaseClient,
  token: string,
): Promise<PublicCalendar | null> {
  if (!TOKEN.test(token)) return null
  const { data, error } = await admin
    .from('calendars')
    .select(
      'id, account_id, name, slot_minutes, timezone, public_auto_confirm, account:accounts(name, owner_user_id)',
    )
    .eq('public_token', token)
    .eq('public_enabled', true)
    .eq('is_active', true)
    .maybeSingle()
  if (error || !data) return null
  const row = data as unknown as {
    id: string
    account_id: string
    name: string
    slot_minutes: number
    timezone: string
    public_auto_confirm: boolean
    account: { name: string | null; owner_user_id: string | null } | null
  }
  if (!row.account?.owner_user_id) return null
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account.name ?? '',
    ownerUserId: row.account.owner_user_id,
    name: row.name,
    slotMinutes: row.slot_minutes,
    timezone: safeTimeZone(row.timezone),
    autoConfirm: row.public_auto_confirm,
  }
}

/** The slots the public page may offer right now; null if the read failed. */
export async function publicSlots(
  admin: SupabaseClient,
  calendar: PublicCalendar,
  now: Date,
): Promise<Slot[] | null> {
  const until = new Date(now.getTime() + (PUBLIC_BOOKING_DAYS + 1) * 86_400_000)
  const [hours, events] = await Promise.all([
    admin.from('calendar_hours').select('weekday, starts, ends').eq('calendar_id', calendar.id),
    admin
      .from('calendar_events')
      .select('starts_at, ends_at, status')
      .eq('calendar_id', calendar.id)
      .lt('starts_at', until.toISOString())
      .gt('ends_at', now.toISOString()),
  ])
  if (hours.error || events.error) return null
  return freeSlots({
    hours: (hours.data ?? []) as HoursRow[],
    slotMinutes: calendar.slotMinutes,
    timezone: calendar.timezone,
    busy: busyOf(
      (events.data ?? []) as { starts_at: string; ends_at: string; status: string }[],
    ),
    fromDay: dayKeyOf(now, calendar.timezone),
    days: PUBLIC_BOOKING_DAYS,
    now,
  })
}

export interface PublicBookingInput {
  start: Date
  name: string
  /** Digits only. */
  phone: string
}

/**
 * Check what a visitor sent. Pure. A Brazilian number typed without
 * the country code (10 or 11 digits) gets 55 in front, since that is
 * how WhatsApp — and so the CRM's contacts — writes it.
 */
export function parsePublicBooking(
  body: unknown,
): { ok: true; input: PublicBookingInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : ''
  if (name.length < 2) return { ok: false, error: 'Informe o seu nome.' }
  if (name.length > 80) return { ok: false, error: 'O nome é longo demais.' }

  let phone = normalizePhone(typeof b.phone === 'string' ? b.phone : '')
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`
  if (phone.length < 12 || phone.length > 15) {
    return { ok: false, error: 'Informe o seu WhatsApp com DDD.' }
  }

  const at = typeof b.start === 'string' ? Date.parse(b.start) : NaN
  if (!Number.isFinite(at)) return { ok: false, error: 'Escolha um horário.' }

  return { ok: true, input: { start: new Date(at), name, phone } }
}

export type PublicBookingOutcome =
  | { status: 'booked' | 'pending'; eventId: string; start: Date }
  /** Not one of the free slots — taken a moment ago, or never offered. */
  | { status: 'unavailable' }
  /** This number already has as many coming up as the link allows. */
  | { status: 'limit' }
  | { status: 'failed' }

async function findOrCreateContact(
  admin: SupabaseClient,
  calendar: PublicCalendar,
  input: PublicBookingInput,
): Promise<string | null> {
  const existing = await findExistingContact(admin, calendar.accountId, input.phone)
  if (existing) {
    // Fill a missing name; never overwrite what the team wrote.
    if (!existing.name || existing.name === existing.phone) {
      await admin
        .from('contacts')
        .update({ name: input.name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
  }
  const { data, error } = await admin
    .from('contacts')
    .insert({
      account_id: calendar.accountId,
      // NOT NULL audit column: system-created contacts belong to the
      // CRM's owner, as with leads and the WhatsApp webhook.
      user_id: calendar.ownerUserId,
      phone: input.phone,
      name: input.name,
    })
    .select('id')
    .single()
  if (!error && data) return (data as { id: string }).id
  // Lost a race against another insert of the same number.
  if (error && isUniqueViolation(error)) {
    return (await findExistingContact(admin, calendar.accountId, input.phone))?.id ?? null
  }
  return null
}

/** Book a slot from the public link. Never throws. */
export async function bookPublic(
  admin: SupabaseClient,
  calendar: PublicCalendar,
  input: PublicBookingInput,
  now: Date,
): Promise<PublicBookingOutcome> {
  try {
    // Only what the page would offer at this instant can be booked.
    const slots = await publicSlots(admin, calendar, now)
    if (slots === null) return { status: 'failed' }
    const slot = slots.find((s) => s.start.getTime() === input.start.getTime())
    if (!slot) return { status: 'unavailable' }

    const contactId = await findOrCreateContact(admin, calendar, input)
    if (!contactId) return { status: 'failed' }

    const { count } = await admin
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', calendar.accountId)
      .eq('contact_id', contactId)
      .neq('status', 'cancelled')
      .gt('ends_at', now.toISOString())
    if ((count ?? 0) >= PUBLIC_MAX_UPCOMING) return { status: 'limit' }

    const status = calendar.autoConfirm ? 'scheduled' : 'pending'
    const { data, error } = await admin
      .from('calendar_events')
      .insert({
        account_id: calendar.accountId,
        calendar_id: calendar.id,
        contact_id: contactId,
        kind: 'appointment',
        status,
        source: 'public',
        starts_at: slot.start.toISOString(),
        ends_at: slot.end.toISOString(),
        notes: 'Marcado pelo link público.',
      })
      .select('id')
      .single()
    if (error || !data) {
      // The exclusion constraint: someone took it between the two reads.
      if (error?.code === '23P01') return { status: 'unavailable' }
      console.error('[agenda public] booking failed:', error)
      return { status: 'failed' }
    }
    return {
      status: calendar.autoConfirm ? 'booked' : 'pending',
      eventId: (data as { id: string }).id,
      start: slot.start,
    }
  } catch (err) {
    console.error('[agenda public] booking threw:', err)
    return { status: 'failed' }
  }
}
