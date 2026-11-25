// ============================================================
// "Nova conversa" — open a conversation with a number the inbox has
// never talked to (docs/plano-link-conexao-e-nova-conversa.md, Fase B).
//
// Reuses resolveConversationByPhone, the same find-or-create the
// public API and the Agenda use, so a contact opened here is the same
// row an inbound message from that number would have created.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveWhatsAppProvider, type WhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { checkUazapiNumber } from '@/lib/uazapi/api'
import { getUazapiConfig, isUazapiReady } from '@/lib/uazapi/config'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'

/** `contacts.source` of a contact the team reached out to first. */
export const TEAM_STARTED_SOURCE = 'Iniciado pela equipe'

/**
 * What someone types → digits with the country code, or null.
 *
 * A Brazilian number is usually typed without +55 ("63 99208-5436",
 * "(63) 9208-5436"): 10 or 11 digits get 55 in front. Anything typed
 * with a leading + is taken as already international, and so is a
 * number that already starts with 55 and has the length of one.
 */
export function normalizeTypedPhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let digits = trimmed.replace(/\D/g, '')
  if (!trimmed.startsWith('+')) {
    digits = digits.replace(/^0+/, '') // trunk 0 ("0 63 9...")
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  }
  if (digits.length < 10 || digits.length > 15) return null
  if (digits.startsWith('55') && digits.length !== 12 && digits.length !== 13) return null
  return digits
}

export class StartConversationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'bad_phone' | 'not_connected' | 'no_whatsapp' | 'failed',
  ) {
    super(message)
  }
}

export interface StartedConversation {
  conversationId: string
  contactId: string
  contactCreated: boolean
  provider: WhatsAppProvider
}

/**
 * Find or create the contact and conversation for `rawPhone`. `db` is
 * the service client: the route has already checked who is asking.
 */
export async function startConversation(
  db: SupabaseClient,
  input: { accountId: string; phone: string; name?: string | null },
): Promise<StartedConversation> {
  const phone = normalizeTypedPhone(input.phone)
  if (!phone) {
    throw new StartConversationError(
      'Confira o número: use DDD + número, ou + e o código do país.',
      400,
      'bad_phone',
    )
  }

  const provider = await resolveWhatsAppProvider(db, input.accountId)
  if (!provider) {
    throw new StartConversationError(
      'Conecte o WhatsApp em Configurações antes de começar uma conversa.',
      400,
      'not_connected',
    )
  }

  // On the QR-code path we can ask the phone whether the number has
  // WhatsApp before creating anything. The official API has no such
  // question; there a wrong number shows up as a failed message.
  if (provider === 'uazapi') {
    const cfg = await getUazapiConfig(db, input.accountId)
    if (cfg && isUazapiReady(cfg)) {
      const has = await checkUazapiNumber(
        { baseUrl: cfg.base_url!, token: decrypt(cfg.instance_token!) },
        phone,
      )
      if (has === false) {
        throw new StartConversationError(
          'Esse número não tem WhatsApp. Confira o DDD e os dígitos.',
          422,
          'no_whatsapp',
        )
      }
    }
  }

  const name = input.name?.trim() ? input.name.trim().slice(0, 120) : null
  let resolved
  try {
    resolved = await resolveConversationByPhone(db, input.accountId, `+${phone}`, name)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao abrir a conversa'
    throw new StartConversationError(message, 500, 'failed')
  }

  if (resolved.contactCreated) {
    await db
      .from('contacts')
      .update({ source: TEAM_STARTED_SOURCE })
      .eq('id', resolved.contactId)
      .is('source', null)
  }

  return { ...resolved, provider }
}
