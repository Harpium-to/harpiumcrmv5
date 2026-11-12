import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { openFirstContactDeal } from '@/lib/deals/first-contact'
import type { EvolutionInboundMessage } from './parse'

// Persist one inbound Evolution message: find-or-create the contact and
// its conversation (mirroring the Meta webhook / resolve-conversation
// conventions, but WITHOUT requiring a whatsapp_config row — an
// Evolution-only account has none), then insert the message and bump the
// conversation. Service-role client (the webhook has no session).

async function findOrCreateContact(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phoneDigits: string,
  name: string | null,
): Promise<string | null> {
  const phone = `+${phoneDigits}`
  const existing = await findExistingContact(admin, accountId, phone)
  if (existing) {
    if (name && !existing.name) {
      await admin
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
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
      return raced?.id ?? null
    }
    console.error('[evolution inbound] contact create failed:', error.message)
    return null
  }
  return data.id
}

async function findOrCreateConversation(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (existing && existing.length > 0) return { id: existing[0].id, created: false }

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
      return raced && raced.length > 0 ? { id: raced[0].id, created: false } : null
    }
    console.error('[evolution inbound] conversation create failed:', error.message)
    return null
  }
  return { id: data.id, created: true }
}

export async function ingestEvolutionInbound(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  msg: EvolutionInboundMessage,
): Promise<void> {
  const contactId = await findOrCreateContact(
    admin,
    account.id,
    account.ownerUserId,
    msg.fromPhone,
    msg.name,
  )
  if (!contactId) return

  const conversation = await findOrCreateConversation(
    admin,
    account.id,
    account.ownerUserId,
    contactId,
  )
  if (!conversation) return
  const conversationId = conversation.id

  // First message from this person opened the thread → card in the
  // funnel. See lib/deals/first-contact.ts. Never throws.
  if (conversation.created) {
    await openFirstContactDeal(admin, {
      accountId: account.id,
      ownerUserId: account.ownerUserId,
      contactId,
      conversationId,
    })
  }

  const nowIso = new Date().toISOString()
  await admin.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: msg.text,
    message_id: msg.externalId,
    status: 'delivered',
  })
  await admin
    .from('conversations')
    .update({
      last_message_text: msg.text,
      last_message_at: nowIso,
      status: 'open',
      updated_at: nowIso,
    })
    .eq('id', conversationId)
}
