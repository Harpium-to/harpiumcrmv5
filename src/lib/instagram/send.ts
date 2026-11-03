import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstagramConfig, isInstagramReady } from './config'
import { InstagramApiError, sendInstagramText } from './api'

/**
 * Send a text DM to an Instagram conversation and persist it as an
 * outbound message.
 *
 * The recipient is the contact's `instagram_id` — the IGSID — and not
 * its handle. Meta addresses messages by that id, and a handle the
 * person changed last week would simply fail to deliver.
 *
 * The provider's own refusal text is passed through rather than
 * flattened: "fora da janela de 24 horas" and "token expirado" are the
 * two likeliest failures here and they need completely different
 * things from the operator.
 */
export interface InstagramSendOptions {
  /**
   * 'agent' for a person typing in the inbox, 'bot' for the auto-reply
   * and the task runner — the inbox renders the two differently, and
   * mislabelling a machine reply as a colleague's is the kind of thing
   * nobody notices until a customer quotes it back.
   */
  senderType?: 'agent' | 'bot'
  aiGenerated?: boolean
}

export async function sendInstagramToConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  text: string,
  options: InstagramSendOptions = {},
): Promise<{ messageId: string; externalId: string | null }> {
  const cfg = await getInstagramConfig(db, accountId)
  if (!cfg || !isInstagramReady(cfg)) {
    throw new Error('Canal Instagram não configurado.')
  }

  const { data: conv, error } = await db
    .from('conversations')
    .select('id, channel, contact:contacts(instagram_id)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single()
  if (error || !conv) throw new Error('Conversa não encontrada.')

  const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
  const recipientId = contact?.instagram_id as string | undefined
  if (!recipientId) {
    throw new Error('Esse contato não tem um Instagram vinculado.')
  }

  let externalId: string | null = null
  try {
    const result = await sendInstagramText(
      { igUserId: cfg.ig_user_id!, accessToken: decrypt(cfg.access_token!) },
      recipientId,
      text,
    )
    externalId = result.externalId
  } catch (err) {
    if (err instanceof InstagramApiError) {
      throw new Error(`Instagram recusou o envio: ${err.message}`)
    }
    throw err
  }

  const nowIso = new Date().toISOString()
  const { data: msg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: options.senderType ?? 'agent',
      content_type: 'text',
      content_text: text,
      message_id: externalId,
      status: 'sent',
      ai_generated: options.aiGenerated ?? false,
    })
    .select('id')
    .single()
  if (msgErr || !msg) throw new Error('Falha ao salvar a mensagem.')

  await db
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', conversationId)

  return { messageId: msg.id as string, externalId }
}
