import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

// ============================================================
// The WhatsApp connection of a client CRM, as the agency console
// shows it (W2).
//
// The status itself (connected / needs attention / not connected) is
// operational, not personal, so it is shown at every consent level.
// The number, the WhatsApp display name, the quality rating and the
// time of the last customer message only show when the owner granted
// at least read access — the same line the rest of the console draws.
// ============================================================

export type WhatsAppState = 'connected' | 'attention' | 'none'

export interface WhatsAppStatus {
  state: WhatsAppState
  /** Plain-language reason, for the operator. null when connected. */
  reason: string | null
}

/** The columns of `whatsapp_config` the summary needs. */
export interface WhatsAppConfigRow {
  account_id: string
  phone_number_id: string | null
  status: string | null
  registered_at: string | null
  last_registration_error: string | null
}

const STATUS_COLUMNS = 'account_id, phone_number_id, status, registered_at, last_registration_error'

/**
 * Read a saved config without calling Meta. The order of the checks
 * is the order an operator would fix things in: a refused registration
 * first (it says exactly what Meta objected to), then a connection
 * marked down, then a number saved but never registered for webhooks.
 */
export function summarizeWhatsApp(row: WhatsAppConfigRow | null | undefined): WhatsAppStatus {
  if (!row || !row.phone_number_id) {
    return { state: 'none', reason: 'O WhatsApp ainda não foi conectado neste CRM.' }
  }
  if (row.last_registration_error) {
    return {
      state: 'attention',
      reason: `A Meta recusou o registro do número: ${row.last_registration_error}`,
    }
  }
  if (row.status !== 'connected') {
    return { state: 'attention', reason: 'A conexão está marcada como desconectada.' }
  }
  if (!row.registered_at) {
    return {
      state: 'attention',
      reason: 'O número está ligado, mas ainda não foi registrado para receber mensagens.',
    }
  }
  return { state: 'connected', reason: null }
}

/**
 * Status of every CRM's WhatsApp, for the list. One query, no Meta
 * calls — the list must stay fast with many CRMs. null when the read
 * fails, so the table can fall back to the generic channel signal.
 */
export async function loadWhatsAppStatuses(
  admin: SupabaseClient,
): Promise<Map<string, WhatsAppStatus> | null> {
  const { data, error } = await admin.from('whatsapp_config').select(STATUS_COLUMNS)
  if (error) {
    console.error('[agencia/whatsapp] status list failed:', error)
    return null
  }
  const map = new Map<string, WhatsAppStatus>()
  for (const row of (data ?? []) as WhatsAppConfigRow[]) {
    map.set(row.account_id, summarizeWhatsApp(row))
  }
  return map
}

export interface WhatsAppPhone {
  displayPhoneNumber: string
  verifiedName: string | null
  qualityRating: string | null
}

export interface WhatsAppDetail extends WhatsAppStatus {
  /** null without read consent, or when Meta couldn't be reached. */
  phone: WhatsAppPhone | null
  /** Last message a customer sent on WhatsApp. null without read consent. */
  lastInboundAt: string | null
  /** False when consent hides the details — the card says why. */
  detailsAllowed: boolean
}

/**
 * Status plus details for one CRM. Asks Meta about the number, so a
 * revoked token or a deleted number shows up here even though the
 * saved row still says "connected".
 */
export async function loadWhatsAppDetail(
  admin: SupabaseClient,
  accountId: string,
  opts: { personal: boolean },
): Promise<WhatsAppDetail> {
  const { personal } = opts
  const { data, error } = await admin
    .from('whatsapp_config')
    .select(`${STATUS_COLUMNS}, access_token`)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[agencia/whatsapp] detail failed:', error)
    return {
      state: 'attention',
      reason: 'Não foi possível ler a configuração do WhatsApp deste CRM.',
      phone: null,
      lastInboundAt: null,
      detailsAllowed: personal,
    }
  }

  const row = data as (WhatsAppConfigRow & { access_token: string | null }) | null
  let status = summarizeWhatsApp(row)
  if (status.state === 'none' || !row) {
    return { ...status, phone: null, lastInboundAt: null, detailsAllowed: personal }
  }

  let phone: WhatsAppPhone | null = null
  let accessToken: string | null = null
  try {
    accessToken = row.access_token ? decrypt(row.access_token) : null
  } catch {
    status = {
      state: 'attention',
      reason:
        'O token guardado não pode ser lido (a chave de criptografia do servidor mudou). Conecte o WhatsApp de novo.',
    }
  }

  if (accessToken && row.phone_number_id) {
    try {
      const info = await verifyPhoneNumber({
        phoneNumberId: row.phone_number_id,
        accessToken,
      })
      phone = {
        displayPhoneNumber: info.display_phone_number,
        verifiedName: info.verified_name ?? null,
        qualityRating: info.quality_rating ?? null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro desconhecido'
      status = { state: 'attention', reason: `A Meta recusou as credenciais: ${message}` }
    }
  }

  return {
    ...status,
    phone: personal ? phone : null,
    lastInboundAt: personal ? await loadLastInbound(admin, accountId) : null,
    detailsAllowed: personal,
  }
}

/** When a customer last wrote to this CRM on WhatsApp. */
async function loadLastInbound(
  admin: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('messages')
    .select('created_at, conversations!inner(account_id, channel)')
    .eq('conversations.account_id', accountId)
    .eq('conversations.channel', 'whatsapp')
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) {
    console.error('[agencia/whatsapp] last inbound failed:', error)
    return null
  }
  const first = (data ?? [])[0] as { created_at?: string } | undefined
  return first?.created_at ?? null
}
