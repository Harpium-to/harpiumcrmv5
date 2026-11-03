import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import type { InstagramInboundMessage } from './parse'

// ============================================================
// Persisting an inbound Instagram DM.
//
// Mirrors the Evolution/UAZAPI ingest, with one structural difference
// that runs through the whole file: the person has no phone number.
//
// So the de-dup key is `contacts.instagram_id` (the IGSID), and the
// contact is written with `phone = ''`. That empty string is load
// bearing: 022's uniqueness index on the normalised phone is partial
// (`WHERE phone_normalized <> ''`), so an empty phone keeps every
// Instagram contact out of the phone index instead of colliding with
// every other one. It also means the contact never looks dialable in
// a list or reachable by a WhatsApp broadcast, which is the truth.
//
// Service-role client: the webhook has no session.
// ============================================================

async function findOrCreateContact(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  msg: InstagramInboundMessage,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('instagram_id', msg.fromId)
    .maybeSingle()
  if (existing) return existing.id as string

  const { data, error } = await admin
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone: '',
      instagram_id: msg.fromId,
      // No display name yet: the webhook carries the IGSID and nothing
      // else. The profile lookup that fills this in needs its own
      // permission, so the contact starts named after the channel
      // rather than after an opaque id.
      name: 'Instagram',
      source: 'instagram',
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      // Two DMs in the same delivery from a new person: the second
      // insert loses the race and re-reads instead of failing.
      const { data: raced } = await admin
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('instagram_id', msg.fromId)
        .maybeSingle()
      return (raced?.id as string) ?? null
    }
    console.error('[instagram inbound] contact create failed:', error.message)
    return null
  }
  return data.id as string
}

async function findOrCreateConversation(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<string | null> {
  // Scoped to the Instagram channel. Someone who already exists as a
  // WhatsApp contact and then writes on Instagram gets a separate
  // thread, because the reply has to leave by the right door and a
  // merged thread would make that ambiguous per message.
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'instagram')
    .order('created_at', { ascending: true })
    .limit(1)
  if (existing && existing.length > 0) return existing[0].id as string

  const { data, error } = await admin
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      channel: 'instagram',
    })
    .select('id')
    .single()
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('channel', 'instagram')
        .order('created_at', { ascending: true })
        .limit(1)
      return raced && raced.length > 0 ? (raced[0].id as string) : null
    }
    console.error('[instagram inbound] conversation create failed:', error.message)
    return null
  }
  return data.id as string
}

/** True when this exact message id is already stored. */
async function alreadyStored(
  admin: SupabaseClient,
  externalId: string | null,
): Promise<boolean> {
  if (!externalId) return false
  const { data } = await admin
    .from('messages')
    .select('id')
    .eq('message_id', externalId)
    .limit(1)
  return Boolean(data && data.length > 0)
}

export async function ingestInstagramInbound(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  msg: InstagramInboundMessage,
): Promise<{ conversationId: string; contactId: string } | null> {
  // Meta retries a delivery it did not get a 200 for, and a retry that
  // duplicates the message would also re-trigger the auto-reply.
  if (await alreadyStored(admin, msg.externalId)) return null

  const contactId = await findOrCreateContact(
    admin,
    account.id,
    account.ownerUserId,
    msg,
  )
  if (!contactId) return null

  const conversationId = await findOrCreateConversation(
    admin,
    account.id,
    account.ownerUserId,
    contactId,
  )
  if (!conversationId) return null

  const nowIso = new Date().toISOString()
  const { error } = await admin.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: msg.text,
    message_id: msg.externalId,
    status: 'delivered',
  })
  if (error) {
    console.error('[instagram inbound] message insert failed:', error.message)
    return null
  }

  await admin
    .from('conversations')
    .update({
      last_message_text: msg.text,
      last_message_at: nowIso,
      status: 'open',
      updated_at: nowIso,
    })
    .eq('id', conversationId)

  return { conversationId, contactId }
}
