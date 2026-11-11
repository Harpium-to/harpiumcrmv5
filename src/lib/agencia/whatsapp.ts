import type { SupabaseClient } from '@supabase/supabase-js'

import { effectivePath, isWhatsAppPath, type WhatsAppPath } from '@/lib/channels/whatsapp-route'
import { getUazapiStatus } from '@/lib/uazapi/api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { statusReasonMessage } from '@/lib/whatsapp/status-reason'

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
  /** W3 (migration 057). Optional so older callers and fixtures still fit. */
  connection_mode?: string | null
  status_reason?: string | null
}

const STATUS_COLUMNS =
  'account_id, phone_number_id, status, registered_at, last_registration_error, connection_mode, status_reason'

/**
 * Read a saved config without calling Meta. The order of the checks
 * is the order an operator would fix things in: Meta cutting the
 * connection (it says why), then a refused registration (it says
 * exactly what Meta objected to), then a connection marked down, then
 * a number saved but never registered for webhooks.
 */
export function summarizeWhatsApp(row: WhatsAppConfigRow | null | undefined): WhatsAppStatus {
  if (!row || !row.phone_number_id) {
    return { state: 'none', reason: 'O WhatsApp ainda não foi conectado neste CRM.' }
  }
  const cut = row.status !== 'connected' ? statusReasonMessage(row.status_reason) : null
  if (cut) {
    return { state: 'attention', reason: cut }
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
  const [meta, paths, uaz] = await Promise.all([
    admin.from('whatsapp_config').select(STATUS_COLUMNS),
    // D1. Both reads fail before 061 / 043: the CRMs then read as
    // official, which is what they were.
    admin.from('accounts').select('id, whatsapp_path'),
    admin.from('uazapi_config').select(UAZAPI_COLUMNS),
  ])
  if (meta.error) {
    console.error('[agencia/whatsapp] status list failed:', meta.error)
    return null
  }
  const map = new Map<string, WhatsAppStatus>()
  for (const row of (meta.data ?? []) as WhatsAppConfigRow[]) {
    map.set(row.account_id, summarizeWhatsApp(row))
  }

  // CRMs on the unofficial path show the QR-code connection instead.
  const stored = new Map<string, WhatsAppPath>()
  for (const r of (paths.error ? [] : (paths.data ?? [])) as { id?: string; whatsapp_path?: unknown }[]) {
    if (r.id && isWhatsAppPath(r.whatsapp_path)) stored.set(r.id, r.whatsapp_path)
  }
  const uazByAccount = new Map<string, UazapiStatusRow>()
  for (const r of (uaz.error ? [] : (uaz.data ?? [])) as UazapiStatusRow[]) {
    if (r.account_id) uazByAccount.set(r.account_id, r)
  }
  for (const id of new Set([...stored.keys(), ...uazByAccount.keys()])) {
    const row = uazByAccount.get(id) ?? null
    const path = effectivePath({
      path: stored.get(id) ?? null,
      uazapiReady: isUazapiRowReady(row),
      evolutionReady: false,
      metaConfigured: map.get(id)?.state !== undefined && map.get(id)?.state !== 'none',
    })
    if (path === 'nao_oficial') map.set(id, summarizeUnofficial(row))
  }
  return map
}

// ------------------------------------------------------------
// The unofficial path (D1): a QR-code connection through UAZAPI.
// ------------------------------------------------------------

/** The columns of `uazapi_config` the console needs (never the tokens' values). */
export interface UazapiStatusRow {
  account_id: string
  base_url: string | null
  instance_token: string | null
  enabled: boolean | null
  /** Cached gateway state: connected | connecting | disconnected | hibernated. */
  status: string | null
  paired_phone?: string | null
}

const UAZAPI_COLUMNS = 'account_id, base_url, instance_token, enabled, status, paired_phone'

function isUazapiRowReady(row: UazapiStatusRow | null): boolean {
  return Boolean(row?.enabled && row.base_url && row.instance_token)
}

/**
 * The QR-code connection's state, in the order an operator would act:
 * never paired, switched off, then whatever the phone last reported.
 * The phone dropping is the common failure (offline for days, logged
 * out on the phone, or a ban) and the fix is always the client reading
 * the QR again.
 */
export function summarizeUnofficial(row: UazapiStatusRow | null | undefined): WhatsAppStatus {
  if (!row?.base_url || !row.instance_token) {
    return { state: 'none', reason: 'O WhatsApp por QR code ainda não foi conectado neste CRM.' }
  }
  if (!row.enabled) {
    return { state: 'attention', reason: 'A conexão por QR code está desligada neste CRM.' }
  }
  switch (row.status) {
    case 'connected':
      return { state: 'connected', reason: null }
    case 'connecting':
      return { state: 'attention', reason: 'O QR code foi gerado, mas ainda não foi lido no celular.' }
    case 'hibernated':
      return {
        state: 'attention',
        reason: 'A conexão por QR code está pausada. O cliente precisa ler o QR code de novo.',
      }
    default:
      return {
        state: 'attention',
        reason:
          'O celular desconectou. O cliente precisa ler o QR code de novo em Configurações › WhatsApp.',
      }
  }
}

/** Which path one CRM is on, for the detail card. null = official or unknown. */
async function loadDetailPath(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ path: WhatsAppPath | null; uazapi: UazapiStatusRow | null }> {
  const [acc, uaz] = await Promise.all([
    admin.from('accounts').select('whatsapp_path').eq('id', accountId).maybeSingle(),
    admin.from('uazapi_config').select(UAZAPI_COLUMNS).eq('account_id', accountId).maybeSingle(),
  ])
  const raw = acc.error ? null : (acc.data as { whatsapp_path?: unknown } | null)?.whatsapp_path
  const uazapi = uaz.error ? null : ((uaz.data as UazapiStatusRow | null) ?? null)
  const path = effectivePath({
    path: isWhatsAppPath(raw) ? raw : null,
    uazapiReady: isUazapiRowReady(uazapi),
    evolutionReady: false,
    // Unknown here; only the unofficial answer changes what is loaded.
    metaConfigured: true,
  })
  return { path, uazapi }
}

async function loadUnofficialDetail(
  admin: SupabaseClient,
  accountId: string,
  row: UazapiStatusRow | null,
  personal: boolean,
): Promise<WhatsAppDetail> {
  let status = summarizeUnofficial(row)
  let phone: WhatsAppPhone | null = null
  // Ask the gateway, like the official card asks Meta: the cached state
  // can be hours old when no connection event reached us.
  if (row?.base_url && row.instance_token && status.state !== 'none') {
    try {
      const live = await getUazapiStatus({
        baseUrl: row.base_url,
        token: decrypt(row.instance_token),
      })
      status = summarizeUnofficial({ ...row, status: live.connected ? 'connected' : live.status })
      if (live.phone) {
        phone = {
          displayPhoneNumber: `+${live.phone}`,
          verifiedName: live.profileName,
          qualityRating: null,
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro desconhecido'
      status = {
        state: 'attention',
        reason: `Não foi possível consultar a conexão por QR code: ${message}`,
      }
    }
  }
  return {
    ...status,
    phone: personal ? phone : null,
    lastInboundAt: personal && status.state !== 'none' ? await loadLastInbound(admin, accountId) : null,
    detailsAllowed: personal,
    coexistence: false,
    path: 'nao_oficial',
  }
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
  /** The number is shared with the WhatsApp Business app on the phone. */
  coexistence: boolean
  /** D1: the path the CRM is on. Absent/null reads as official. */
  path?: WhatsAppPath | null
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

  const route = await loadDetailPath(admin, accountId)
  if (route.path === 'nao_oficial') {
    return loadUnofficialDetail(admin, accountId, route.uazapi, personal)
  }

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
      coexistence: false,
    }
  }

  const row = data as (WhatsAppConfigRow & { access_token: string | null }) | null
  let status = summarizeWhatsApp(row)
  if (status.state === 'none' || !row) {
    return { ...status, phone: null, lastInboundAt: null, detailsAllowed: personal, coexistence: false }
  }
  const coexistence = row.connection_mode === 'coexistence'

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
    coexistence,
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
