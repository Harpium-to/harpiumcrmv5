import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  sendUnofficialToConversation,
  type UnofficialContent,
} from './unofficial-send'
import { NOT_CONNECTED_UNOFFICIAL, resolveWhatsAppProvider } from './whatsapp-route'

// ============================================================
// The engines' (flows, automations, agents, AI) door to the
// unofficial path (D1).
//
// Each Meta engine sender calls this first. On the Meta path it
// returns null and the sender carries on with its own Meta plumbing,
// unchanged; on the unofficial path it sends and returns the result
// in the shape the engines already expect.
// ============================================================

export async function sendEngineUnofficial(args: {
  accountId: string
  conversationId: string
  content: UnofficialContent
  aiGenerated?: boolean
}): Promise<{ whatsapp_message_id: string } | null> {
  const db = supabaseAdmin()
  const provider = await resolveWhatsAppProvider(db, args.accountId)
  if (provider === 'meta') return null
  // On the unofficial path with nothing connected: refuse. Falling back
  // to Meta would answer the customer from a different number.
  if (provider === null) throw new Error(NOT_CONNECTED_UNOFFICIAL)
  const r = await sendUnofficialToConversation(db, {
    provider,
    accountId: args.accountId,
    conversationId: args.conversationId,
    content: args.content,
    senderType: 'bot',
    aiGenerated: args.aiGenerated,
  })
  return { whatsapp_message_id: r.externalId ?? '' }
}
