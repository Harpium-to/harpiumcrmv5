import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { getEvolutionConfig, isEvolutionReady } from './config'
import { sendEvolutionText } from './api'

/**
 * Send a text message to a conversation through the account's Evolution
 * channel and persist it as an outbound (agent) message. Runs under the
 * caller's client (RLS-scoped), same as the Meta send path.
 */
export async function sendEvolutionToConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  text: string,
): Promise<{ messageId: string; externalId: string | null }> {
  const cfg = await getEvolutionConfig(db, accountId)
  if (!cfg || !isEvolutionReady(cfg)) {
    throw new Error('Canal Evolution não configurado.')
  }

  const { data: conv, error } = await db
    .from('conversations')
    .select('id, contact:contacts(phone)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single()
  if (error || !conv) throw new Error('Conversa não encontrada.')

  const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
  const phone = contact?.phone as string | undefined
  if (!phone) throw new Error('Contato sem telefone.')

  const { externalId } = await sendEvolutionText(
    {
      baseUrl: cfg.base_url!,
      apiKey: decrypt(cfg.api_key!),
      instance: cfg.instance!,
    },
    normalizePhone(phone),
    text,
  )

  const nowIso = new Date().toISOString()
  const { data: msg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: text,
      message_id: externalId,
      status: 'sent',
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

  return { messageId: msg.id, externalId }
}
