import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from './phone-utils'
import type { StatusReason } from './status-reason'

// ============================================================
// Webhook events of a number in coexistence (W3).
//
//   smb_message_echoes  — a message the business sent from the
//                         WhatsApp Business app on the phone. Saved as
//                         sent by the team; the AI is paused on that
//                         conversation, since a person took it over.
//   history             — the chats that were already on the phone,
//                         in chunks, once, after connecting. Saved with
//                         their original times, without notifications,
//                         automations or AI, and without duplicates if
//                         Meta sends a chunk twice.
//   smb_app_state_sync  — the phone's contact names. Fills names the
//                         CRM doesn't have; never renames a contact the
//                         team already named, never deletes.
//   account_update      — Meta cutting (or restoring) the connection.
//                         Applies to every mode, not only coexistence.
//
// Parsing is kept pure (and tested); the handlers below only write.
// None of them sends anything to the customer.
// ============================================================

const FIELDS = new Set(['smb_message_echoes', 'history', 'smb_app_state_sync', 'account_update'])

export function isCoexistenceWebhookField(field: string): boolean {
  return FIELDS.has(field)
}

/** Meta's code when the business declined sharing its chat history. */
export const HISTORY_DECLINED_CODE = 2593109

// ---- message content ------------------------------------------------

/** A WhatsApp message as it appears in echoes and in history. */
export interface RawCoexMessage {
  id?: string
  from?: string
  to?: string
  timestamp?: string | number
  type?: string
  text?: { body?: string }
  image?: { id?: string; caption?: string }
  video?: { id?: string; caption?: string }
  document?: { id?: string; caption?: string; filename?: string }
  audio?: { id?: string }
  sticker?: { id?: string }
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  contacts?: unknown[]
  history_context?: { status?: string }
}

export interface MessageContent {
  /** Within the messages.content_type CHECK constraint. */
  contentType: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location'
  contentText: string | null
  mediaUrl: string | null
}

const MEDIA_LABEL: Record<string, string> = {
  image: '[imagem]',
  video: '[vídeo]',
  document: '[documento]',
  audio: '[áudio]',
  sticker: '[figurinha]',
}

/**
 * What to store for one message. Media goes through the same proxy as
 * inbound media (`/api/whatsapp/media/{id}`); Meta only keeps media for
 * a while, so an old image may no longer load, and the label says what
 * it was. Types the inbox can't show (polls, edits…) become a short
 * text instead of being dropped, so the thread keeps its shape.
 */
export function describeMessage(m: RawCoexMessage): MessageContent {
  const media = (id: string | undefined) => (id ? `/api/whatsapp/media/${id}` : null)
  switch (m.type) {
    case 'text':
      return { contentType: 'text', contentText: m.text?.body ?? null, mediaUrl: null }
    case 'image':
      return { contentType: 'image', contentText: m.image?.caption ?? null, mediaUrl: media(m.image?.id) }
    case 'sticker':
      return { contentType: 'image', contentText: null, mediaUrl: media(m.sticker?.id) }
    case 'video':
      return { contentType: 'video', contentText: m.video?.caption ?? null, mediaUrl: media(m.video?.id) }
    case 'document':
      return {
        contentType: 'document',
        contentText: m.document?.caption ?? m.document?.filename ?? null,
        mediaUrl: media(m.document?.id),
      }
    case 'audio':
      return { contentType: 'audio', contentText: null, mediaUrl: media(m.audio?.id) }
    case 'location': {
      const loc = m.location ?? {}
      const coords =
        loc.latitude != null && loc.longitude != null ? `${loc.latitude},${loc.longitude}` : null
      const text = [loc.name, loc.address, coords].filter(Boolean).join(' - ')
      return { contentType: 'location', contentText: text || '[localização]', mediaUrl: null }
    }
    case 'contacts':
      return { contentType: 'text', contentText: '[contato compartilhado]', mediaUrl: null }
    default:
      return { contentType: 'text', contentText: `[${m.type ?? 'mensagem'}]`, mediaUrl: null }
  }
}

/** Text for the conversation list preview. */
export function previewText(m: RawCoexMessage, content: MessageContent): string {
  return content.contentText || MEDIA_LABEL[m.type ?? ''] || `[${m.type ?? 'mensagem'}]`
}

export function messageTime(m: RawCoexMessage): string | null {
  const seconds = typeof m.timestamp === 'number' ? m.timestamp : parseInt(m.timestamp ?? '', 10)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null
}

/** Delivery state of a business-sent message, from history_context. */
export function historyStatus(raw: string | undefined, fromBusiness: boolean): string {
  if (!fromBusiness) return 'delivered'
  switch ((raw ?? '').toUpperCase()) {
    case 'READ':
    case 'PLAYED':
      return 'read'
    case 'DELIVERED':
      return 'delivered'
    case 'ERROR':
    case 'FAILED':
      return 'failed'
    default:
      return 'sent'
  }
}

// ---- parsing ----------------------------------------------------------

export interface ParsedEcho {
  /** Digits-only customer number. */
  customerPhone: string
  /** The customer's WhatsApp profile name, when Meta sent it. */
  customerName: string | null
  message: RawCoexMessage
}

export function parseEchoes(value: unknown): ParsedEcho[] {
  const v = (value ?? {}) as {
    message_echoes?: RawCoexMessage[]
    contacts?: { wa_id?: string; profile?: { name?: string } }[]
  }
  const names = new Map<string, string>()
  for (const c of v.contacts ?? []) {
    const phone = normalizePhone(c?.wa_id ?? '')
    if (phone && c?.profile?.name) names.set(phone, c.profile.name)
  }
  const out: ParsedEcho[] = []
  for (const m of v.message_echoes ?? []) {
    const customerPhone = normalizePhone(m?.to ?? '')
    if (!customerPhone || !m?.id) continue
    out.push({ customerPhone, customerName: names.get(customerPhone) ?? null, message: m })
  }
  return out
}

export interface ParsedHistoryThread {
  customerPhone: string
  messages: { message: RawCoexMessage; fromBusiness: boolean }[]
}

export interface ParsedHistoryChunk {
  /** 0–100; null when the chunk didn't say. */
  progress: number | null
  declined: boolean
  /** Any other error Meta reported for the import. */
  error: string | null
  threads: ParsedHistoryThread[]
}

export function parseHistory(value: unknown, businessPhone: string | null): ParsedHistoryChunk[] {
  const v = (value ?? {}) as {
    metadata?: { display_phone_number?: string }
    history?: {
      metadata?: { progress?: number | string }
      threads?: { id?: string; context?: { wa_id?: string }; messages?: RawCoexMessage[] }[]
      errors?: { code?: number; title?: string; message?: string }[]
    }[]
  }
  const business = normalizePhone(businessPhone ?? v.metadata?.display_phone_number ?? '')
  return (v.history ?? []).map((h) => {
    const rawProgress = Number(h?.metadata?.progress)
    const progress = Number.isFinite(rawProgress)
      ? Math.max(0, Math.min(100, Math.round(rawProgress)))
      : null
    const errors = h?.errors ?? []
    const declined = errors.some((e) => e?.code === HISTORY_DECLINED_CODE)
    const other = errors.find((e) => e?.code !== HISTORY_DECLINED_CODE)
    const threads: ParsedHistoryThread[] = []
    for (const t of h?.threads ?? []) {
      const customerPhone = normalizePhone(t?.context?.wa_id ?? t?.id ?? '')
      if (!customerPhone) continue
      const messages = (t?.messages ?? [])
        .filter((m) => m?.id)
        .map((m) => {
          const from = normalizePhone(m.from ?? '')
          // The thread is named after the customer, so anything not
          // from them was sent by the business (from the phone, or from
          // a linked device before coexistence). Without `from`, only a
          // message with a recipient can be the business's.
          const fromBusiness = from
            ? from !== customerPhone || (business !== '' && from === business)
            : Boolean(m.to)
          return { message: m, fromBusiness }
        })
      threads.push({ customerPhone, messages })
    }
    return {
      progress,
      declined,
      error: other ? other.message || other.title || `Erro ${other.code ?? ''}`.trim() : null,
      threads,
    }
  })
}

export interface ParsedContactSync {
  phone: string
  name: string | null
  action: 'add' | 'remove'
}

export function parseStateSync(value: unknown): ParsedContactSync[] {
  const v = (value ?? {}) as {
    state_sync?: {
      type?: string
      action?: string
      contact?: { full_name?: string; first_name?: string; phone_number?: string }
    }[]
  }
  const out: ParsedContactSync[] = []
  for (const item of v.state_sync ?? []) {
    if (item?.type !== 'contact') continue
    const phone = normalizePhone(item.contact?.phone_number ?? '')
    if (!phone) continue
    const name = (item.contact?.full_name || item.contact?.first_name || '').trim() || null
    out.push({ phone, name, action: item.action === 'remove' ? 'remove' : 'add' })
  }
  return out
}

export interface AccountUpdateEffect {
  wabaId: string
  status: 'connected' | 'disconnected'
  reason: StatusReason | null
  /** Only numbers in coexistence are affected (offboard / reconnect are
   *  about the WhatsApp Business app; removing our app cuts them all). */
  coexistenceOnly: boolean
}

/** What an account_update event does to the saved connection, if anything. */
export function parseAccountUpdate(entryId: string | undefined, value: unknown): AccountUpdateEffect | null {
  const v = (value ?? {}) as { event?: string; waba_info?: { waba_id?: string | number } }
  const wabaId = String(v.waba_info?.waba_id ?? entryId ?? '')
  if (!wabaId) return null
  switch (v.event) {
    case 'PARTNER_REMOVED':
      return { wabaId, status: 'disconnected', reason: 'partner_removed', coexistenceOnly: false }
    case 'ACCOUNT_OFFBOARDED':
      return { wabaId, status: 'disconnected', reason: 'account_offboarded', coexistenceOnly: true }
    case 'ACCOUNT_RECONNECTED':
      return { wabaId, status: 'connected', reason: null, coexistenceOnly: true }
    default:
      return null
  }
}

// ---- handlers -------------------------------------------------------

/** The whatsapp_config columns the handlers need. */
export interface CoexConfig {
  account_id: string
  user_id: string
}

export interface CoexChange {
  field: string
  value: unknown
  /** entry.id — the WhatsApp Business Account id. */
  entryId?: string
}

/**
 * Route one coexistence change. `loadConfig` resolves the number's
 * CRM the same way inbound messages do (null = unknown number, which
 * is logged and skipped). Never throws, so one bad event can't stop
 * the rest of the delivery.
 */
export async function handleCoexistenceChange(
  db: SupabaseClient,
  change: CoexChange,
  loadConfig: (phoneNumberId: string) => Promise<CoexConfig | null>,
): Promise<void> {
  try {
    if (change.field === 'account_update') {
      await applyAccountUpdate(db, parseAccountUpdate(change.entryId, change.value))
      return
    }
    const metadata = (change.value as { metadata?: { phone_number_id?: string; display_phone_number?: string } })
      ?.metadata
    const phoneNumberId = metadata?.phone_number_id
    if (!phoneNumberId) return
    const config = await loadConfig(phoneNumberId)
    if (!config) return

    if (change.field === 'smb_message_echoes') {
      for (const echo of parseEchoes(change.value)) await saveEcho(db, config, echo)
    } else if (change.field === 'history') {
      for (const chunk of parseHistory(change.value, metadata?.display_phone_number ?? null)) {
        await saveHistoryChunk(db, config, chunk)
      }
    } else if (change.field === 'smb_app_state_sync') {
      await saveContactNames(db, config, parseStateSync(change.value))
    }
  } catch (err) {
    console.error(`[coexistence-webhook] ${change.field} failed:`, err)
  }
}

async function applyAccountUpdate(db: SupabaseClient, effect: AccountUpdateEffect | null) {
  if (!effect) return
  const now = new Date().toISOString()
  const patch: Record<string, unknown> =
    effect.status === 'connected'
      ? { status: 'connected', status_reason: null, status_changed_at: now, updated_at: now }
      : {
          status: 'disconnected',
          status_reason: effect.reason,
          status_changed_at: now,
          connected_at: null,
          updated_at: now,
        }
  let query = db.from('whatsapp_config').update(patch).eq('waba_id', effect.wabaId)
  if (effect.coexistenceOnly) query = query.eq('connection_mode', 'coexistence')
  const { error } = await query
  if (error) console.error('[coexistence-webhook] account_update write failed:', error)
}

async function saveEcho(db: SupabaseClient, config: CoexConfig, echo: ParsedEcho) {
  const thread = await openThread(db, config, echo.customerPhone, echo.customerName)
  if (!thread) return
  const { message } = echo
  if (await alreadySaved(db, thread.conversationId, [message.id!])) return

  const content = describeMessage(message)
  const at = messageTime(message) ?? new Date().toISOString()
  const { error } = await db.from('messages').insert({
    conversation_id: thread.conversationId,
    sender_type: 'agent',
    content_type: content.contentType,
    content_text: content.contentText,
    media_url: content.mediaUrl,
    message_id: message.id,
    status: 'sent',
    created_at: at,
  })
  if (error) {
    console.error('[coexistence-webhook] echo insert failed:', error)
    return
  }

  // Someone answered from the phone: the conversation is read, and the
  // AI must not talk over a person (the same sticky switch a handoff
  // uses; the team turns it back on in the inbox).
  const patch: Record<string, unknown> = {
    unread_count: 0,
    ai_autoreply_disabled: true,
    updated_at: new Date().toISOString(),
  }
  if (isNewer(at, thread.lastMessageAt)) {
    patch.last_message_text = previewText(message, content)
    patch.last_message_at = at
  }
  const { error: convError } = await db
    .from('conversations')
    .update(patch)
    .eq('id', thread.conversationId)
  if (convError) console.error('[coexistence-webhook] echo conversation update failed:', convError)
}

async function saveHistoryChunk(db: SupabaseClient, config: CoexConfig, chunk: ParsedHistoryChunk) {
  // A few threads at a time: a chunk can carry dozens of chats, and the
  // whole delivery has to finish within the webhook's time limit.
  await forEachLimit(chunk.threads, PARALLEL, async (t) => {
    if (t.messages.length === 0) return
    const thread = await openThread(db, config, t.customerPhone, null)
    if (!thread) return

    const ids = t.messages.map((m) => m.message.id!)
    const existing = await savedIds(db, thread.conversationId, ids)
    const fresh = t.messages
      .filter((m) => !existing.has(m.message.id!))
      .map(({ message, fromBusiness }) => {
        const content = describeMessage(message)
        return {
          preview: previewText(message, content),
          row: {
            conversation_id: thread.conversationId,
            sender_type: fromBusiness ? 'agent' : 'customer',
            content_type: content.contentType,
            content_text: content.contentText,
            media_url: content.mediaUrl,
            message_id: message.id,
            status: historyStatus(message.history_context?.status, fromBusiness),
            created_at: messageTime(message) ?? new Date().toISOString(),
          },
        }
      })
    if (fresh.length === 0) return

    let saved = 0
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await db.from('messages').insert(fresh.slice(i, i + 500).map((f) => f.row))
      if (error) {
        console.error('[coexistence-webhook] history insert failed:', error)
        break
      }
      saved = Math.min(fresh.length, i + 500)
    }
    if (saved === 0) return

    // The list shows the newest message — but only if the import has
    // one newer than what the conversation already shows. Old chats
    // never bump the unread count.
    const newest = fresh
      .slice(0, saved)
      .reduce((a, b) => (a.row.created_at >= b.row.created_at ? a : b))
    if (isNewer(newest.row.created_at, thread.lastMessageAt)) {
      const { error } = await db
        .from('conversations')
        .update({
          last_message_text: newest.preview,
          last_message_at: newest.row.created_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.conversationId)
      if (error) console.error('[coexistence-webhook] history conversation update failed:', error)
    }
  })

  await recordHistoryProgress(db, config.account_id, chunk)
}

async function recordHistoryProgress(db: SupabaseClient, accountId: string, chunk: ParsedHistoryChunk) {
  const now = new Date().toISOString()
  if (chunk.declined) {
    await patchConfig(db, accountId, {
      history_sync_status: 'declined',
      history_sync_finished_at: now,
      history_sync_error: null,
    })
    return
  }
  if (chunk.error) {
    await patchConfig(db, accountId, {
      history_sync_status: 'failed',
      history_sync_error: chunk.error,
    })
    return
  }
  if (chunk.progress == null) return

  // Chunks can arrive out of order: progress only moves forward.
  const { data } = await db
    .from('whatsapp_config')
    .select('history_sync_progress, history_sync_status')
    .eq('account_id', accountId)
    .maybeSingle()
  const current = (data as { history_sync_progress?: number | null; history_sync_status?: string | null } | null)
  if (current?.history_sync_status === 'done' || current?.history_sync_status === 'declined') return
  const progress = Math.max(chunk.progress, current?.history_sync_progress ?? 0)
  await patchConfig(db, accountId, {
    history_sync_progress: progress,
    history_sync_status: progress >= 100 ? 'done' : 'importing',
    ...(progress >= 100 ? { history_sync_finished_at: now } : {}),
    history_sync_error: null,
  })
}

async function saveContactNames(db: SupabaseClient, config: CoexConfig, items: ParsedContactSync[]) {
  await forEachLimit(items, PARALLEL, async (item) => {
    // "remove" means the business deleted the contact on the phone; the
    // CRM keeps its own records.
    if (item.action !== 'add' || !item.name) return
    const existing = await findExistingContact(db, config.account_id, item.phone)
    if (existing) {
      if (!isPlaceholderName(existing.name, existing.phone)) return
      const { error } = await db
        .from('contacts')
        .update({ name: item.name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) console.error('[coexistence-webhook] contact rename failed:', error)
      return
    }
    const { error } = await db.from('contacts').insert({
      account_id: config.account_id,
      user_id: config.user_id,
      phone: item.phone,
      name: item.name,
    })
    if (error && !isUniqueViolation(error)) {
      console.error('[coexistence-webhook] contact create failed:', error)
    }
  })

  await patchConfig(db, config.account_id, { contacts_synced_at: new Date().toISOString() })
}

/** A name nobody chose: empty, or just the number itself. */
export function isPlaceholderName(name: string | null | undefined, phone: string): boolean {
  if (!name || !name.trim()) return true
  // Only digits and phone punctuation, and those digits are the number.
  return /^[\d\s()+.-]+$/.test(name) && normalizePhone(name) === normalizePhone(phone)
}

// ---- shared writes ---------------------------------------------------

/** How many contacts / chats are written at the same time. */
const PARALLEL = 6

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

interface Thread {
  conversationId: string
  lastMessageAt: string | null
}

/**
 * Find or create the contact and its one conversation, like the
 * inbound webhook does. An existing contact keeps its name; a new one
 * gets the WhatsApp name when known, else the number.
 */
async function openThread(
  db: SupabaseClient,
  config: CoexConfig,
  phone: string,
  name: string | null,
): Promise<Thread | null> {
  let contactId: string | null = null
  const existing = await findExistingContact(db, config.account_id, phone)
  if (existing) {
    contactId = existing.id
  } else {
    const { data, error } = await db
      .from('contacts')
      .insert({ account_id: config.account_id, user_id: config.user_id, phone, name: name || phone })
      .select('id')
      .single()
    if (error) {
      if (isUniqueViolation(error)) {
        contactId = (await findExistingContact(db, config.account_id, phone))?.id ?? null
      }
      if (!contactId) {
        console.error('[coexistence-webhook] contact create failed:', error)
        return null
      }
    } else {
      contactId = (data as { id: string }).id
    }
  }

  const find = async () => {
    const { data } = await db
      .from('conversations')
      .select('id, last_message_at')
      .eq('account_id', config.account_id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
    const row = (data ?? [])[0] as { id: string; last_message_at: string | null } | undefined
    return row ? { conversationId: row.id, lastMessageAt: row.last_message_at ?? null } : null
  }

  const found = await find()
  if (found) return found

  const { data: created, error } = await db
    .from('conversations')
    .insert({ account_id: config.account_id, user_id: config.user_id, contact_id: contactId })
    .select('id, last_message_at')
    .single()
  if (error) {
    if (isUniqueViolation(error)) return find()
    console.error('[coexistence-webhook] conversation create failed:', error)
    return null
  }
  const row = created as { id: string; last_message_at: string | null }
  return { conversationId: row.id, lastMessageAt: row.last_message_at ?? null }
}

/** Meta ids already saved in this conversation (ids aren't unique across them). */
async function savedIds(db: SupabaseClient, conversationId: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  // Small pages: the ids travel in the query string.
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversationId)
      .in('message_id', ids.slice(i, i + 100))
    if (error) {
      console.error('[coexistence-webhook] duplicate check failed:', error)
      // Safer to skip the page than to import it twice.
      ids.slice(i, i + 100).forEach((id) => found.add(id))
      continue
    }
    for (const row of (data ?? []) as { message_id: string }[]) found.add(row.message_id)
  }
  return found
}

async function alreadySaved(db: SupabaseClient, conversationId: string, ids: string[]) {
  return (await savedIds(db, conversationId, ids)).size > 0
}

function isNewer(at: string, current: string | null): boolean {
  return !current || new Date(at).getTime() > new Date(current).getTime()
}

async function patchConfig(db: SupabaseClient, accountId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('whatsapp_config').update(patch).eq('account_id', accountId)
  if (error) console.error('[coexistence-webhook] config write failed:', error)
}
