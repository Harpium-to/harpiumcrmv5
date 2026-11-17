import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { checkUazapiNumbers, type UazapiServer } from '@/lib/uazapi/api'
import { getUazapiConfig, isUazapiReady } from '@/lib/uazapi/config'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// ============================================================
// "Does this number have WhatsApp?" — asked of the number connected by
// QR code (UAZAPI, POST /chat/check), before anything is sent. A send
// to a number that does not exist is one of the signals that gets a
// number banned.
//
// Only the QR-code path can ask: the official API has no such call.
// ============================================================

/** Numbers checked per call of the screen. */
export const CHECK_BATCH = 50

export type CheckAvailability = { available: true; server: UazapiServer } | { available: false; reason: string }

export async function whatsappCheckAvailability(
  admin: SupabaseClient,
  accountId: string,
): Promise<CheckAvailability> {
  const provider = await resolveWhatsAppProvider(admin, accountId)
  if (provider !== 'uazapi') {
    return {
      available: false,
      reason:
        provider === 'meta'
          ? 'Este CRM usa a API oficial, que não confere números. A conferência precisa do WhatsApp conectado por QR code.'
          : 'Conecte o WhatsApp pelo QR code para conferir os números.',
    }
  }
  const cfg = await getUazapiConfig(admin, accountId)
  if (!cfg || !isUazapiReady(cfg) || !cfg.base_url || !cfg.instance_token) {
    return { available: false, reason: 'Conecte o WhatsApp pelo QR code para conferir os números.' }
  }
  try {
    return { available: true, server: { baseUrl: cfg.base_url, token: decrypt(cfg.instance_token) } }
  } catch {
    return { available: false, reason: 'Não consegui ler a conexão do WhatsApp deste CRM.' }
  }
}

export interface CheckDeps {
  check: typeof checkUazapiNumbers
}

/**
 * Check the next unchecked numbers of an extraction. Returns how many
 * were checked, how many have WhatsApp, and how many are still to go.
 */
export async function checkNextNumbers(
  admin: SupabaseClient,
  accountId: string,
  extractionId: string,
  server: UazapiServer,
  deps: CheckDeps = { check: checkUazapiNumbers },
): Promise<{ checked: number; withWhatsapp: number; remaining: number }> {
  const pending = () =>
    admin
      .from('lead_extraction_results')
      .select('id, phone', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('extraction_id', extractionId)
      .not('phone', 'is', null)
      .is('whatsapp_checked_at', null)
      .order('created_at', { ascending: true })
      .limit(CHECK_BATCH)

  const { data, error, count } = await pending()
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { id: string; phone: string }[]
  if (rows.length === 0) return { checked: 0, withWhatsapp: 0, remaining: 0 }

  const answers = await deps.check(
    server,
    rows.map((r) => normalizePhone(r.phone)),
  )
  const at = new Date().toISOString()
  let withWhatsapp = 0
  let checked = 0
  for (const row of rows) {
    const answer = answers.get(normalizePhone(row.phone))
    // No answer for this one: leave it unchecked, but do not ask again
    // in this same pass.
    if (answer === undefined) continue
    checked += 1
    if (answer) withWhatsapp += 1
    await admin
      .from('lead_extraction_results')
      .update({ has_whatsapp: answer, whatsapp_checked_at: at })
      .eq('id', row.id)
  }
  // Nothing answered: stop, or the screen would loop on the same rows.
  const remaining = checked === 0 ? 0 : Math.max(0, (count ?? rows.length) - checked)
  return { checked, withWhatsapp, remaining }
}
