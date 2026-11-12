import type { SupabaseClient } from '@supabase/supabase-js'

import { sendEvolutionText } from '@/lib/evolution/api'
import { getEvolutionConfig, isEvolutionReady } from '@/lib/evolution/config'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  sendUazapiMedia,
  sendUazapiMenu,
  sendUazapiText,
  type UazapiMediaKind,
} from '@/lib/uazapi/api'
import { getUazapiConfig, isUazapiReady } from '@/lib/uazapi/config'
import { menuFromInteractive } from '@/lib/uazapi/menu'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { NOT_CONNECTED_UNOFFICIAL } from './whatsapp-route'

// ============================================================
// One outbound message on the unofficial path (D1).
//
// The Meta senders each own their lookups, phone-variant retries and
// persistence; this is the same job for UAZAPI (and, text only, for a
// CRM that still runs Evolution). Every caller — the inbox and public
// API through `sendMessageToConversation`, and the flows, automations,
// agents and AI through the engine senders — ends up here once
// `resolveWhatsAppProvider` says the CRM is on the unofficial path.
//
// Runs under whatever client the caller holds: the user's (RLS) for
// the inbox, the service role for the engines. Both can read the
// channel config of their own CRM.
// ============================================================

export type UnofficialProvider = 'uazapi' | 'evolution'

export type UnofficialContent =
  | { kind: 'text'; text: string }
  | {
      kind: 'media'
      mediaKind: UazapiMediaKind
      url: string
      caption?: string | null
      filename?: string | null
    }
  | { kind: 'interactive'; payload: InteractiveMessagePayload }

export interface UnofficialSendArgs {
  provider: UnofficialProvider
  accountId: string
  conversationId: string
  content: UnofficialContent
  /** 'agent' = a person in the inbox/API; 'bot' = flows, automations, AI. */
  senderType: 'agent' | 'bot'
  /** Marks an AI reply so the inbox badges it. */
  aiGenerated?: boolean
  /** Internal id of the message being quoted. */
  replyToMessageId?: string | null
}

/** A refusal the caller should show as-is (bad input, not connected). */
export class UnofficialSendError extends Error {
  constructor(
    message: string,
    readonly code: 'not_connected' | 'unsupported' | 'bad_request' | 'not_found' | 'db_error',
    readonly status: number,
  ) {
    super(message)
    this.name = 'UnofficialSendError'
  }
}

export async function sendUnofficialToConversation(
  db: SupabaseClient,
  args: UnofficialSendArgs,
): Promise<{ messageId: string; externalId: string | null }> {
  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('id, contact:contacts(id, phone)')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (convErr || !conv) {
    throw new UnofficialSendError('Conversa não encontrada.', 'not_found', 404)
  }
  const rawContact = (conv as { contact?: unknown }).contact
  const contact = (Array.isArray(rawContact) ? rawContact[0] : rawContact) as
    | { id: string; phone: string | null }
    | null
    | undefined
  const phone = contact?.phone ? normalizePhone(contact.phone) : ''
  if (!phone) {
    throw new UnofficialSendError('Contato sem telefone.', 'bad_request', 400)
  }

  // The quoted message must be in this same thread — otherwise a caller
  // could quote messages they can't see by guessing ids.
  let replyExternalId: string | null = null
  if (args.replyToMessageId) {
    const { data: parent } = await db
      .from('messages')
      .select('message_id')
      .eq('id', args.replyToMessageId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle()
    if (!parent) {
      throw new UnofficialSendError(
        'A mensagem respondida não está nesta conversa.',
        'bad_request',
        400,
      )
    }
    replyExternalId = (parent as { message_id: string | null }).message_id
  }

  const { externalId } =
    args.provider === 'uazapi'
      ? await sendViaUazapi(db, args.accountId, phone, args.content, replyExternalId)
      : await sendViaEvolution(db, args.accountId, phone, args.content)

  const c = args.content
  const row = {
    conversation_id: args.conversationId,
    sender_type: args.senderType,
    content_type: c.kind === 'text' ? 'text' : c.kind === 'media' ? c.mediaKind : 'interactive',
    content_text:
      c.kind === 'text' ? c.text : c.kind === 'media' ? c.caption || null : c.payload.body,
    media_url: c.kind === 'media' ? c.url : null,
    interactive_payload: c.kind === 'interactive' ? c.payload : null,
    message_id: externalId,
    status: 'sent',
    reply_to_message_id: args.replyToMessageId ?? null,
    ai_generated: args.aiGenerated ?? false,
  }
  const { data: msg, error: msgErr } = await db
    .from('messages')
    .insert(row)
    .select('id')
    .single()
  if (msgErr || !msg) {
    throw new UnofficialSendError(
      `Mensagem enviada, mas falhou ao salvar: ${msgErr?.message ?? 'sem retorno'}`,
      'db_error',
      500,
    )
  }

  const nowIso = new Date().toISOString()
  await db
    .from('conversations')
    .update({
      last_message_text:
        c.kind === 'text'
          ? c.text
          : c.kind === 'media'
            ? c.caption || `[${c.mediaKind}]`
            : interactivePayloadPreviewText(c.payload),
      last_message_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', args.conversationId)

  // A person answering is the "human is here" signal: the bot yields,
  // exactly as on the Meta path (send-message.ts). Best-effort.
  if (args.senderType === 'agent' && contact?.id) {
    try {
      const { error } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: nowIso,
          end_reason: 'agent_replied',
        })
        .eq('account_id', args.accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active')
      if (error) console.error('[flows] pause-on-agent-send failed:', error.message)
    } catch (err) {
      console.error('[flows] pause-on-agent-send threw:', err instanceof Error ? err.message : err)
    }
  }

  return { messageId: (msg as { id: string }).id, externalId }
}

async function sendViaUazapi(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  c: UnofficialContent,
  replyId: string | null,
): Promise<{ externalId: string | null }> {
  const cfg = await getUazapiConfig(db, accountId)
  if (!cfg || !isUazapiReady(cfg)) {
    throw new UnofficialSendError(NOT_CONNECTED_UNOFFICIAL, 'not_connected', 400)
  }
  const srv = { baseUrl: cfg.base_url!, token: decrypt(cfg.instance_token!) }
  if (c.kind === 'text') return sendUazapiText(srv, phone, c.text, { replyId })
  if (c.kind === 'media') {
    return sendUazapiMedia(srv, phone, {
      kind: c.mediaKind,
      url: c.url,
      caption: c.caption,
      filename: c.filename,
      replyId,
    })
  }
  let menu
  try {
    menu = menuFromInteractive(c.payload)
  } catch (err) {
    throw new UnofficialSendError(
      err instanceof Error ? err.message : 'Menu inválido.',
      'bad_request',
      400,
    )
  }
  return sendUazapiMenu(srv, phone, menu, { replyId })
}

async function sendViaEvolution(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  c: UnofficialContent,
): Promise<{ externalId: string | null }> {
  if (c.kind !== 'text') {
    throw new UnofficialSendError(
      'O canal Evolution envia só texto. Para mídia e botões, conecte pelo QR code em Configurações › WhatsApp.',
      'unsupported',
      400,
    )
  }
  const cfg = await getEvolutionConfig(db, accountId)
  if (!cfg || !isEvolutionReady(cfg)) {
    throw new UnofficialSendError(NOT_CONNECTED_UNOFFICIAL, 'not_connected', 400)
  }
  return sendEvolutionText(
    { baseUrl: cfg.base_url!, apiKey: decrypt(cfg.api_key!), instance: cfg.instance! },
    phone,
    c.text,
  )
}
