// ============================================================
// Audit of what the agency read through the platform API.
//
// Same table as the console (agencia_auditoria, 038), with
// origem = 'agency_os' (075), so the CRM owner sees it in Settings ›
// Acesso da agência. Like the console, only AGENCY access is logged:
// a member reading their own CRM is not.
//
// The summary is opened often, so a person + CRM + action is written
// at most once every 30 minutes. Never throws: a failed audit write
// must not break the read it describes.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CrmAccess } from './access';
import type { PlatformPerson } from './auth';

export type PlatformAuditAction =
  | 'api_view_summary'
  | 'api_view_funnel'
  | 'api_list_leads'
  | 'api_list_contacts'
  | 'api_list_deals'
  | 'api_list_conversations'
  | 'api_view_conversation'
  | 'api_list_tasks'
  | 'api_list_agenda'
  | 'api_view_news'
  | 'api_register_webhook';

export const AUDIT_THROTTLE_MS = 30 * 60_000;

/** Actions logged once per window rather than on every call. */
const THROTTLED: ReadonlySet<PlatformAuditAction> = new Set([
  'api_view_summary',
  'api_view_funnel',
  'api_view_news',
]);

export async function logPlatformAccess(
  admin: SupabaseClient,
  entry: {
    person: PlatformPerson;
    access: CrmAccess;
    action: PlatformAuditAction;
    detalhe?: string | null;
    conversationId?: string | null;
  },
  now: number = Date.now(),
): Promise<void> {
  if (entry.access.via !== 'agency') return;
  try {
    if (THROTTLED.has(entry.action)) {
      const { data } = await admin
        .from('agencia_auditoria')
        .select('created_at')
        .eq('actor_user_id', entry.person.userId)
        .eq('account_id', entry.access.accountId)
        .eq('action', entry.action)
        .order('created_at', { ascending: false })
        .limit(1);
      const last = (data as Array<{ created_at: string }> | null)?.[0]?.created_at;
      if (last && now - new Date(last).getTime() < AUDIT_THROTTLE_MS) return;
    }
    const { error } = await admin.from('agencia_auditoria').insert({
      actor_user_id: entry.person.userId,
      account_id: entry.access.accountId,
      conversation_id: entry.conversationId ?? null,
      action: entry.action,
      origem: 'agency_os',
      detalhe: entry.detalhe ?? null,
    });
    if (error) console.warn('[plataforma/audit] insert failed:', error.message);
  } catch (err) {
    console.warn('[plataforma/audit] failed:', err);
  }
}
