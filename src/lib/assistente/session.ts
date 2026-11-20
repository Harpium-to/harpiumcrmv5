import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from '@/lib/ai/config'
import type { AiConfig, AiProvider } from '@/lib/ai/types'
import type { AccountContext } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'

import { safeZone } from './format'
import { isMissingTable } from './store'
import type { ToolContext } from './types'

// ============================================================
// Who is asking, and with which key and model.
// ============================================================

export interface AssistantSettings {
  enabled: boolean
  /** null → defaultAssistantModel(). */
  model: string | null
  /** Small, reversible changes run without a card (with Undo). */
  smallChanges: boolean
}

export const DEFAULT_SETTINGS: AssistantSettings = { enabled: true, model: null, smallChanges: false }

/**
 * The assistant plans multi-step changes (an automation with branches),
 * which the small models of auto-reply get wrong more often. Default
 * to the stronger sibling of what the CRM already pays for; the CRM
 * can pick another in Configurações › Harpi.
 */
export const ANTHROPIC_ASSISTANT_MODEL = 'claude-sonnet-5-5'

export function defaultAssistantModel(provider: AiProvider, replyModel: string): string {
  if (provider === 'anthropic') return ANTHROPIC_ASSISTANT_MODEL
  // gpt-5.4-mini → gpt-5.4; a model without a size suffix stays as is.
  return replyModel.replace(/-(mini|nano)(?=$|-)/, '') || replyModel
}

export async function loadAssistantSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<AssistantSettings> {
  const { data, error } = await db
    .from('ai_configs')
    .select('assistant_enabled, assistant_model, assistant_small_changes')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return DEFAULT_SETTINGS
  const row = data as Record<string, unknown>
  return {
    enabled: row.assistant_enabled !== false,
    model: typeof row.assistant_model === 'string' && row.assistant_model.trim() ? row.assistant_model.trim() : null,
    smallChanges: row.assistant_small_changes === true,
  }
}

export type Readiness =
  | { ready: true; ai: AiConfig; settings: AssistantSettings; model: string }
  | { ready: false; reason: 'not_installed' | 'no_key' | 'disabled'; message: string }

/** Is the assistant usable in this CRM right now? */
export async function checkReadiness(db: SupabaseClient, accountId: string): Promise<Readiness> {
  const probe = await db.from('assistant_conversations').select('id').limit(1)
  if (probe.error && isMissingTable(probe.error)) {
    return { ready: false, reason: 'not_installed', message: 'O Harpi ainda não foi instalado neste CRM.' }
  }
  const ai = await loadAiConfig(db, accountId, { requireActive: false }).catch(() => null)
  if (!ai) {
    return {
      ready: false,
      reason: 'no_key',
      message: 'Para o Harpi funcionar, cole a chave da OpenAI ou da Anthropic em Agentes › Chave e modelo.',
    }
  }
  const settings = await loadAssistantSettings(db, accountId)
  if (!settings.enabled) {
    return { ready: false, reason: 'disabled', message: 'O Harpi está desligado neste CRM (Configurações › Harpi).' }
  }
  return {
    ready: true,
    ai,
    settings,
    model: settings.model ?? defaultAssistantModel(ai.provider, ai.model),
  }
}

/** The tool context for a person in the panel. */
export async function contextFor(
  account: AccountContext,
  timezone: string | null | undefined,
  now = new Date(),
): Promise<ToolContext> {
  const admin = supabaseAdmin()
  const { data } = await admin.from('profiles').select('full_name').eq('user_id', account.userId).maybeSingle()
  return {
    db: account.supabase,
    admin,
    accountId: account.accountId,
    userId: account.userId,
    userName: ((data as { full_name?: string } | null)?.full_name ?? '').trim(),
    role: account.role,
    viaAgency: account.viaAgency,
    readOnly: account.role === 'viewer' || account.status === 'suspended',
    timezone: safeZone(timezone),
    now,
  }
}
