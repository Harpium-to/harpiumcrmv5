// ============================================================
// POST /api/plataforma/v1/crms/{id}/aviso-agency-os — turn on the
// "lead novo" alert of the agency's internal system for one CRM.
//
// Registers (or re-activates, rotating the secret) a webhook endpoint
// IN THAT CRM for `lead.received`, the same kind of endpoint
// POST /api/v1/webhooks creates. The URL never comes from the request:
// it is this deployment's AGENCY_OS_WEBHOOK_URL, so a leaked platform
// key cannot point a CRM's leads at another address.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { encrypt } from '@/lib/whatsapp/encryption'
import {
  generateWebhookSecret,
  normalizeWebhookUrl,
  WEBHOOK_PUBLIC_COLUMNS,
} from '@/lib/webhooks/endpoints'

import { platformErrors } from './errors'

export const AGENCY_OS_EVENTS = ['lead.received'] as const

export function agencyOsWebhookUrl(): string {
  const url = normalizeWebhookUrl(process.env.AGENCY_OS_WEBHOOK_URL ?? '')
  if (!url) {
    throw platformErrors.unavailable(
      'Falta configurar AGENCY_OS_WEBHOOK_URL (https) no servidor do CRM',
    )
  }
  return url
}

export async function registerAgencyOsWebhook(
  admin: SupabaseClient,
  accountId: string,
  createdBy: string,
): Promise<{ id: string; url: string; events: string[]; secret: string; reused: boolean }> {
  const url = agencyOsWebhookUrl()
  const secret = generateWebhookSecret()

  const { data: existing, error: findErr } = await admin
    .from('webhook_endpoints')
    .select('id')
    .eq('account_id', accountId)
    .eq('url', url)
    .limit(1)
  if (findErr) throw findErr
  const found = (existing as Array<{ id: string }> | null)?.[0]

  if (found) {
    const { data, error } = await admin
      .from('webhook_endpoints')
      .update({
        secret: encrypt(secret),
        events: [...AGENCY_OS_EVENTS],
        is_active: true,
        failure_count: 0,
      })
      .eq('id', found.id)
      .eq('account_id', accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single()
    if (error || !data) throw error ?? new Error('Falha ao reativar o aviso')
    return { id: found.id, url, events: [...AGENCY_OS_EVENTS], secret, reused: true }
  }

  const { data, error } = await admin
    .from('webhook_endpoints')
    .insert({
      account_id: accountId,
      created_by: createdBy,
      url,
      secret: encrypt(secret),
      events: [...AGENCY_OS_EVENTS],
    })
    .select(WEBHOOK_PUBLIC_COLUMNS)
    .single()
  if (error || !data) throw error ?? new Error('Falha ao criar o aviso')
  return {
    id: String((data as { id: string }).id),
    url,
    events: [...AGENCY_OS_EVENTS],
    secret,
    reused: false,
  }
}
