// ============================================================
// Telling the customer about their appointment (migration 067, Fase 2).
//
// Two messages, each turned on per agenda by an admin: a confirmation
// when an appointment is booked or moved, and a reminder some hours
// before it. Which ones are due is the database's call
// (claim_calendar_notifications); this module words them and sends
// them through the same send core as the inbox, so they leave by
// whichever WhatsApp the CRM uses.
//
// On the official API a plain text only goes inside the 24-hour
// window — which a reminder a day ahead has usually left. So an agenda
// can name an approved template for each message; when it does, and
// the CRM is on the official API, the template goes instead of the
// text. Its body takes, in order: first name, date, time, agenda.
//
// Runs from the scheduler that already runs the automations, and from
// /api/agenda/notify right after a booking so the confirmation does
// not wait for the next tick.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingFunction } from '@/lib/auth/account-context'
import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'

import { dayKeyOf, formatDayAndMonth, formatTime, safeTimeZone, weekdayLong, weekdayOf } from './time'

export const DEFAULT_CONFIRM_TEXT =
  'Olá, {nome}! Seu horário com {agenda} está marcado para {dia}, {data}, às {hora}.'

export const DEFAULT_REMINDER_TEXT =
  'Olá, {nome}! Passando para lembrar do seu horário com {agenda}: {dia}, {data}, às {hora}. Se não puder vir, é só avisar por aqui.'

/** What a message's text may use, in the order the form lists them. */
export const MESSAGE_VARIABLES = ['nome', 'agenda', 'dia', 'data', 'hora'] as const

export type MessageVars = Record<(typeof MESSAGE_VARIABLES)[number], string>

/** The words an appointment is described with, on the agenda's own clock. */
export function messageVars(input: {
  contactName: string | null | undefined
  calendarName: string
  startsAt: string
  timezone: string
}): MessageVars {
  const zone = safeTimeZone(input.timezone)
  const start = new Date(input.startsAt)
  const dayKey = dayKeyOf(start, zone)
  return {
    // First name only: "Olá, Ana Paula Souza Lima!" reads like a form.
    nome: (input.contactName ?? '').trim().split(/\s+/)[0] ?? '',
    agenda: input.calendarName,
    dia: weekdayLong(weekdayOf(dayKey)),
    data: formatDayAndMonth(dayKey),
    hora: formatTime(start, zone),
  }
}

/**
 * Fill a message's `{variables}`. A contact saved without a name must
 * not get "Olá, !", so the gap an empty variable leaves is closed up.
 * Anything in braces that is not a variable is left as written.
 */
export function renderMessage(text: string, vars: MessageVars): string {
  const filled = text
    .replace(/\{(\w+)\}/g, (whole, key: string) =>
      key in vars ? vars[key as keyof MessageVars] : whole,
    )
    .replace(/,\s*([!.?])/g, '$1')
    .replace(/\s+([!.?,])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  // "{nome}, seu horário…" with no name would open on a comma.
  const opened = filled.replace(/^[\s,]+/, '')
  return opened === filled ? filled : opened.charAt(0).toUpperCase() + opened.slice(1)
}

/** How many `{{n}}` a template's body has — Meta refuses a wrong count. */
export function countTemplateVariables(body: string | null | undefined): number {
  const found = new Set<string>()
  for (const match of (body ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(match[1])
  return found.size
}

/** A template's body parameters: first name, date, time, agenda. */
export function templateParams(vars: MessageVars, count: number): string[] {
  // A template variable cannot be empty.
  return [vars.nome || 'cliente', vars.data, vars.hora, vars.agenda].slice(0, Math.max(0, count))
}

/** One row of claim_calendar_notifications(). */
export interface ClaimedNotification {
  event_id: string
  notification: 'confirmation' | 'reminder'
  account_id: string
  contact_id: string
  starts_at: string
  calendar_name: string
  timezone: string
  message_text: string | null
  template_name: string | null
  template_language: string | null
}

export interface NotifyDeps {
  send: typeof sendMessageToConversation
  /** Opens a conversation for a contact who never had one. */
  openConversation: (db: SupabaseClient, accountId: string, phone: string) => Promise<string>
  /** 'meta' for the official API; anything else has no templates. */
  resolveProvider: (db: SupabaseClient, accountId: string) => Promise<string | null>
}

const defaultDeps: NotifyDeps = {
  send: sendMessageToConversation,
  openConversation: async (db, accountId, phone) =>
    (await resolveConversationByPhone(db, accountId, phone)).conversationId,
  resolveProvider: resolveWhatsAppProvider,
}

async function fail(db: SupabaseClient, row: ClaimedNotification, reason: string) {
  const column = row.notification === 'confirmation' ? 'confirmation_error' : 'reminder_error'
  await db
    .from('calendar_events')
    .update({ [column]: reason.slice(0, 500) })
    .eq('id', row.event_id)
}

/** Send one claimed message. Never throws. */
async function processOne(
  db: SupabaseClient,
  row: ClaimedNotification,
  deps: NotifyDeps,
): Promise<'sent' | 'failed'> {
  try {
    const { data: contactRow } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', row.contact_id)
      .eq('account_id', row.account_id)
      .maybeSingle()
    const contact = contactRow as { name?: string | null; phone?: string | null } | null
    if (!contact?.phone) {
      await fail(db, row, 'O contato não tem telefone no CRM.')
      return 'failed'
    }

    const { data: convs } = await db
      .from('conversations')
      .select('id, last_message_at')
      .eq('account_id', row.account_id)
      .eq('contact_id', row.contact_id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
    const conversationId =
      ((convs ?? []) as { id: string }[])[0]?.id ??
      (await deps.openConversation(db, row.account_id, contact.phone))

    const vars = messageVars({
      contactName: contact.name,
      calendarName: row.calendar_name,
      startsAt: row.starts_at,
      timezone: row.timezone,
    })

    const useTemplate =
      !!row.template_name && (await deps.resolveProvider(db, row.account_id)) === 'meta'

    if (useTemplate) {
      const language = row.template_language || 'pt_BR'
      const { data: template } = await db
        .from('message_templates')
        .select('body_text')
        .eq('account_id', row.account_id)
        .eq('name', row.template_name)
        .eq('language', language)
        .maybeSingle()
      if (!template) {
        await fail(db, row, `O modelo "${row.template_name}" não existe mais neste CRM.`)
        return 'failed'
      }
      await deps.send(db, row.account_id, {
        conversationId,
        messageType: 'template',
        templateName: row.template_name,
        templateLanguage: language,
        templateParams: templateParams(
          vars,
          countTemplateVariables((template as { body_text?: string | null }).body_text),
        ),
      })
    } else {
      const fallback =
        row.notification === 'confirmation' ? DEFAULT_CONFIRM_TEXT : DEFAULT_REMINDER_TEXT
      await deps.send(db, row.account_id, {
        conversationId,
        messageType: 'text',
        contentText: renderMessage(row.message_text?.trim() || fallback, vars),
      })
    }
    return 'sent'
  } catch (err) {
    await fail(db, row, err instanceof Error ? err.message : String(err))
    return 'failed'
  }
}

/**
 * Send the confirmations and reminders that are due — or, with
 * `eventId`, only that appointment's. Returns how many went and
 * failed, or null when it could not run (migration 067 not applied, or
 * an error, logged). Never throws: a problem here must not stop the
 * automations that share the schedule.
 *
 * `db` must be the service-role client: claiming is not something a
 * signed-in person can do.
 */
export async function processCalendarNotifications(
  db: SupabaseClient,
  eventId: string | null = null,
  deps: NotifyDeps = defaultDeps,
): Promise<{ sent: number; failed: number } | null> {
  try {
    const { data, error } = await db.rpc('claim_calendar_notifications', {
      p_limit: 50,
      p_event_id: eventId,
    })
    if (error) {
      if (!isMissingFunction(error)) {
        console.error('[agenda] claim_calendar_notifications error:', error)
      }
      return null
    }
    const counts = { sent: 0, failed: 0 }
    for (const row of (data ?? []) as ClaimedNotification[]) {
      counts[await processOne(db, row, deps)] += 1
    }
    return counts
  } catch (error) {
    console.error('[agenda] processCalendarNotifications threw:', error)
    return null
  }
}
