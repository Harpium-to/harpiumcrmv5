import type { SupabaseClient } from '@supabase/supabase-js';

import { startManualFlowRun } from '@/lib/flows/engine';
import type { FlowRow } from '@/lib/flows/types';
import { isOptedOut, OPTED_OUT_MESSAGE } from '@/lib/contacts/opt-out';

// ============================================================
// Chatbot flows started by hand on one contact (Fase 7 of
// docs/plano-extensao-chrome.md): the flows with the `manual` trigger,
// which until now nothing could start.
//
//   GET  /api/v1/flows               the active manual flows
//   POST /api/v1/flows/{id}/start    start one on a contact
//
// One flow at a time per contact (the flows engine's own rule), and at
// most FLOW_DAILY_LIMIT manual starts per CRM in 24 hours — the same
// bound as the sequences, for the same reason.
// ============================================================

export const FLOW_DAILY_LIMIT = 100;

export class FlowStartError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PublicFlow {
  id: string;
  name: string;
  description: string | null;
}

export async function listManualFlows(db: SupabaseClient, accountId: string): Promise<PublicFlow[]> {
  const { data, error } = await db
    .from('flows')
    .select('id, name, description')
    .eq('account_id', accountId)
    .eq('trigger_type', 'manual')
    .eq('status', 'active')
    .order('name', { ascending: true });
  if (error) throw new FlowStartError('internal', 'Falha ao listar os fluxos', 500);
  return ((data ?? []) as PublicFlow[]).map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description ?? null,
  }));
}

export interface FlowStartDeps {
  start: typeof startManualFlowRun;
  now: () => number;
}

const defaultDeps: FlowStartDeps = { start: startManualFlowRun, now: () => Date.now() };

export async function startFlow(
  db: SupabaseClient,
  accountId: string,
  flowId: string,
  contactId: string,
  deps: FlowStartDeps = defaultDeps,
): Promise<{ run_id: string | null }> {
  const { data: found } = await db
    .from('flows')
    .select('*')
    .eq('id', flowId)
    .eq('account_id', accountId)
    .maybeSingle();
  const flow = found as FlowRow | null;
  if (!flow || flow.trigger_type !== 'manual') {
    throw new FlowStartError('not_found', 'Fluxo não encontrado.', 404);
  }
  if (flow.status !== 'active') {
    throw new FlowStartError('inactive', 'Este fluxo não está ativo no CRM.', 409);
  }

  // `*` so opted_out_at (066) is read once it exists.
  const { data: contact } = await db
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!contact) throw new FlowStartError('contact_not_found', 'Contato não encontrado.', 404);
  if (isOptedOut(contact as { opted_out_at?: unknown })) {
    throw new FlowStartError('opted_out', OPTED_OUT_MESSAGE, 409);
  }

  const { data: conversations } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);
  const conversationId = ((conversations ?? []) as { id: string }[])[0]?.id;
  if (!conversationId) {
    throw new FlowStartError(
      'no_conversation',
      'Este contato ainda não tem conversa no CRM: o fluxo não teria para onde enviar.',
      409,
    );
  }

  const { data: manual } = await db
    .from('flows')
    .select('id')
    .eq('account_id', accountId)
    .eq('trigger_type', 'manual');
  const manualIds = ((manual ?? []) as { id: string }[]).map((f) => f.id);
  const since = new Date(deps.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('flow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('flow_id', manualIds.length ? manualIds : [flow.id])
    .gte('started_at', since);
  if ((count ?? 0) >= FLOW_DAILY_LIMIT) {
    throw new FlowStartError(
      'daily_limit',
      `O CRM já iniciou ${FLOW_DAILY_LIMIT} fluxos à mão nas últimas 24 horas, o limite.`,
      429,
    );
  }

  const result = await deps.start(flow, { contactId, conversationId });
  if (!result.started) {
    throw result.reason === 'already_running'
      ? new FlowStartError(
          'already_running',
          'Já há um fluxo rodando com este contato. Pause-o antes de iniciar outro.',
          409,
        )
      : new FlowStartError('invalid_flow', 'Este fluxo não tem por onde começar: ajuste-o no CRM.', 422);
  }
  return { run_id: result.run_id };
}
