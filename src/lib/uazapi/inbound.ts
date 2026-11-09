import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import type { UazapiInboundMessage } from './parse'

// Persist one UAZAPI message: find-or-create the contact and its
// conversation (mirroring the Evolution ingest — no whatsapp_config row
// required, a UAZAPI-only account has none), then insert the message and
// bump the conversation. Service-role client (the webhook has no session).
//
// Unlike the Evolution path this also handles `fromMe` messages — the
// operator replying from their own phone — which land as `agent`
// messages so the thread stays whole. See parse.ts for why they arrive.
//
// Since D1 it also keeps media (copied to our storage through
// `resolveMedia`, see media.ts) and button/list taps, and reports what
// the engines need to react (`UazapiIngestResult`); the webhook route
// decides whether they do.

async function findOrCreateContact(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phoneDigits: string,
  name: string | null,
): Promise<{ id: string; created: boolean } | null> {
  const phone = `+${phoneDigits}`
  const existing = await findExistingContact(admin, accountId, phone)
  if (existing) {
    if (name && !existing.name) {
      await admin
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return { id: existing.id, created: false }
  }

  const { data, error } = await admin
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name || phone,
    })
    .select('id')
    .single()
  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(admin, accountId, phone)
      return raced ? { id: raced.id, created: false } : null
    }
    console.error('[uazapi inbound] contact create failed:', error.message)
    return null
  }
  return { id: data.id, created: true }
}

async function findOrCreateConversation(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (existing && existing.length > 0) return existing[0].id

  const { data, error } = await admin
    .from('conversations')
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select('id')
    .single()
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      return raced && raced.length > 0 ? raced[0].id : null
    }
    console.error('[uazapi inbound] conversation create failed:', error.message)
    return null
  }
  return data.id
}

/** What the engines need to react to a stored message. */
export interface UazapiIngestResult {
  contactId: string
  conversationId: string
  contactCreated: boolean
  /** The contact's first customer message in this thread. */
  isFirstInbound: boolean
  contentType: string
}

/** Shown when a media file couldn't be kept, so the thread still says something arrived. */
const MEDIA_LABEL: Record<string, string> = {
  image: '[foto]',
  video: '[vídeo]',
  audio: '[áudio]',
  document: '[documento]',
}

/**
 * Store one message. Returns null when nothing was stored (a contact or
 * thread that couldn't be opened, or a redelivery).
 *
 * `resolveMedia` copies a received file to our storage and returns its
 * URL (null on failure); it is called only after the redelivery check,
 * so a repeated webhook doesn't download the file twice.
 */
export async function ingestUazapiInbound(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  msg: UazapiInboundMessage,
  opts: { resolveMedia?: (externalId: string) => Promise<string | null> } = {},
): Promise<UazapiIngestResult | null> {
  const contact = await findOrCreateContact(
    admin,
    account.id,
    account.ownerUserId,
    msg.counterpartPhone,
    msg.name,
  )
  if (!contact) return null
  const contactId = contact.id

  const conversationId = await findOrCreateConversation(
    admin,
    account.id,
    account.ownerUserId,
    contactId,
  )
  if (!conversationId) return null

  // The gateway can redeliver; `message_id` carries the WhatsApp id, so
  // skip anything already stored for this conversation.
  if (msg.externalId) {
    const { data: dupe } = await admin
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_id', msg.externalId)
      .limit(1)
    if (dupe && dupe.length > 0) return null
  }

  let mediaUrl: string | null = null
  if (msg.mediaKind && msg.externalId && opts.resolveMedia) {
    mediaUrl = await opts.resolveMedia(msg.externalId)
  }
  // A file we couldn't keep is stored as text saying it arrived.
  const contentType = msg.interactiveReplyId
    ? 'interactive'
    : msg.mediaKind && mediaUrl
      ? msg.mediaKind
      : 'text'
  const contentText =
    msg.mediaKind && !mediaUrl
      ? [MEDIA_LABEL[msg.mediaKind], msg.text].filter(Boolean).join(' ')
      : msg.text || null

  // Counted before the insert, as the Meta webhook does.
  let isFirstInbound = false
  if (!msg.fromMe) {
    const { count } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
    isFirstInbound = (count ?? 0) === 0
  }

  const nowIso = new Date().toISOString()
  const { error: insertErr } = await admin.from('messages').insert({
    conversation_id: conversationId,
    sender_type: msg.fromMe ? 'agent' : 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: msg.externalId,
    status: 'delivered',
    ...(msg.interactiveReplyId ? { interactive_reply_id: msg.interactiveReplyId } : {}),
  })
  if (insertErr) {
    console.error('[uazapi inbound] message insert failed:', insertErr.message)
    return null
  }

  // A customer message counts as unread, like on the Meta path.
  let unread: number | undefined
  if (!msg.fromMe) {
    const { data: conv } = await admin
      .from('conversations')
      .select('unread_count')
      .eq('id', conversationId)
      .maybeSingle()
    unread = ((conv as { unread_count?: number } | null)?.unread_count ?? 0) + 1
  }

  await admin
    .from('conversations')
    .update({
      last_message_text: contentText || (msg.mediaKind ? `[${msg.mediaKind}]` : ''),
      last_message_at: nowIso,
      // An operator reply from the phone shouldn't reopen a closed thread.
      ...(msg.fromMe ? {} : { status: 'open', unread_count: unread }),
      updated_at: nowIso,
    })
    .eq('id', conversationId)

  return {
    contactId,
    conversationId,
    contactCreated: contact.created,
    isFirstInbound,
    contentType,
  }
}
