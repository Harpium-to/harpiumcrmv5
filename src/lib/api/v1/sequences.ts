import type { SupabaseClient } from '@supabase/supabase-js';

import { startAutomationRun } from '@/lib/automations/engine';
import {
  SEND_STEP_TYPES,
  validateSequenceSteps,
  waitMinutes,
} from '@/lib/automations/validate';
import type { Automation } from '@/types';

// ============================================================
// Sequences: a run of messages with waits between them, started by a
// person on one contact with one click (Fase 4B, step 5, of
// docs/plano-extensao-chrome.md).
//
// A sequence is an automation with the `manual` trigger, built in the
// CRM's automation builder. Starting one runs it on the spot until its
// first wait; the scheduler that already runs the automations
// (/api/automations/cron) carries on from there.
//
// Limits, because automatic sending is what gets a QR-code number
// banned:
//   - between two messages, a wait of at least a minute (enforced
//     when the automation is saved, and again here);
//   - the same sequence runs once at a time per contact;
//   - at most SEQUENCE_DAILY_LIMIT starts per CRM in 24 hours.
// ============================================================

export const SEQUENCE_DAILY_LIMIT = 100;

export class SequenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SequenceStepRow {
  automation_id?: string;
  step_type: string;
  step_config: Record<string, unknown> | null;
  parent_step_id?: string | null;
  position?: number;
}

/** How many messages a sequence sends and how long it takes, in minutes. */
export function summarizeSequence(steps: SequenceStepRow[]): {
  messages: number;
  duration_minutes: number;
} {
  let messages = 0;
  let duration = 0;
  for (const step of steps) {
    if (step.parent_step_id) continue;
    if (SEND_STEP_TYPES.includes(step.step_type)) messages += 1;
    else if (step.step_type === 'wait') duration += waitMinutes(step.step_config);
  }
  return { messages, duration_minutes: duration };
}

export interface PublicSequence {
  id: string;
  name: string;
  description: string | null;
  messages: number;
  duration_minutes: number;
  /** Stops by itself once the customer replies (Fase 5). */
  stop_on_reply: boolean;
  /** Running for the contact asked about; false when none was. */
  running: boolean;
}

/** Runs of these sequences still waiting to continue for this contact. */
async function runningFor(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  sequenceIds: string[],
): Promise<Set<string>> {
  if (sequenceIds.length === 0) return new Set();
  const { data } = await db
    .from('automation_pending_executions')
    .select('automation_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .in('status', ['pending', 'running'])
    .in('automation_id', sequenceIds);
  return new Set(((data ?? []) as { automation_id: string }[]).map((r) => r.automation_id));
}

/** The CRM's active sequences, and which are running for `contactId`. */
export async function listSequences(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null,
): Promise<PublicSequence[]> {
  const { data: rows, error } = await db
    .from('automations')
    .select('id, name, description, trigger_config')
    .eq('account_id', accountId)
    .eq('trigger_type', 'manual')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new SequenceError('internal', 'Falha ao listar as sequências', 500);
  const sequences = (rows ?? []) as {
    id: string;
    name: string;
    description: string | null;
    trigger_config?: { stop_on_reply?: unknown } | null;
  }[];
  if (sequences.length === 0) return [];

  const ids = sequences.map((s) => s.id);
  const { data: stepRows } = await db
    .from('automation_steps')
    .select('automation_id, step_type, step_config, parent_step_id')
    .in('automation_id', ids);
  const running = contactId ? await runningFor(db, accountId, contactId, ids) : new Set<string>();

  return sequences.map((s) => {
    const steps = ((stepRows ?? []) as SequenceStepRow[]).filter((st) => st.automation_id === s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      ...summarizeSequence(steps),
      stop_on_reply: s.trigger_config?.stop_on_reply === true,
      running: running.has(s.id),
    };
  });
}

export interface StartDeps {
  start: typeof startAutomationRun;
  now: () => number;
}

const defaultDeps: StartDeps = { start: startAutomationRun, now: () => Date.now() };

/**
 * Start sequence `sequenceId` on `contactId`, after every check. Throws
 * a SequenceError with a message for the person when one fails.
 */
export async function startSequence(
  db: SupabaseClient,
  accountId: string,
  sequenceId: string,
  contactId: string,
  deps: StartDeps = defaultDeps,
): Promise<{ log_id: string }> {
  const { data: found } = await db
    .from('automations')
    .select('*')
    .eq('id', sequenceId)
    .eq('account_id', accountId)
    .maybeSingle();
  const automation = found as Automation | null;
  if (!automation || automation.trigger_type !== 'manual') {
    throw new SequenceError('not_found', 'Sequência não encontrada.', 404);
  }
  if (!automation.is_active) {
    throw new SequenceError('inactive', 'Esta sequência está desligada no CRM.', 409);
  }

  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!contact) throw new SequenceError('contact_not_found', 'Contato não encontrado.', 404);

  const { data: conversations } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .limit(1);
  const conversationId = ((conversations ?? []) as { id: string }[])[0]?.id;
  if (!conversationId) {
    throw new SequenceError(
      'no_conversation',
      'Este contato ainda não tem conversa no CRM: a sequência não teria para onde enviar.',
      409,
    );
  }

  const { data: stepRows } = await db
    .from('automation_steps')
    .select('step_type, step_config, parent_step_id, position')
    .eq('automation_id', automation.id)
    .order('position', { ascending: true });
  const topLevel = ((stepRows ?? []) as SequenceStepRow[])
    .filter((s) => !s.parent_step_id)
    .map((s) => ({ step_type: s.step_type, step_config: s.step_config ?? {} }));
  const issues = validateSequenceSteps(topLevel);
  if (issues.length > 0) {
    throw new SequenceError(
      'invalid_sequence',
      `Esta sequência precisa de ajuste no CRM: ${issues[0].message}.`,
      422,
    );
  }

  const running = await runningFor(db, accountId, contactId, [automation.id]);
  if (running.size > 0) {
    throw new SequenceError(
      'already_running',
      'Esta sequência já está em andamento para este contato.',
      409,
    );
  }

  const since = new Date(deps.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('automation_logs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('trigger_event', 'manual')
    .gte('created_at', since);
  if ((count ?? 0) >= SEQUENCE_DAILY_LIMIT) {
    throw new SequenceError(
      'daily_limit',
      `O CRM já iniciou ${SEQUENCE_DAILY_LIMIT} sequências nas últimas 24 horas, o limite. Envio automático em volume é o que mais leva o WhatsApp a bloquear um número.`,
      429,
    );
  }

  const logId = await deps.start(automation, {
    accountId,
    triggerType: 'manual',
    contactId,
    context: { conversation_id: conversationId },
  });
  if (!logId) throw new SequenceError('internal', 'Não consegui iniciar a sequência.', 500);
  return { log_id: logId };
}

/**
 * Stop what is left of sequence `sequenceId` for `contactId`: the runs
 * waiting to continue are dropped. What already went, went. Returns
 * how many waiting runs were dropped (0: it wasn't running).
 */
export async function stopSequence(
  db: SupabaseClient,
  accountId: string,
  sequenceId: string,
  contactId: string,
): Promise<{ stopped: number }> {
  const { data, error } = await db
    .from('automation_pending_executions')
    .update({ status: 'done' })
    .eq('account_id', accountId)
    .eq('automation_id', sequenceId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .select('log_id');
  if (error) throw new SequenceError('internal', 'Não consegui parar a sequência.', 500);
  const rows = (data ?? []) as { log_id: string | null }[];
  const logIds = rows.map((r) => r.log_id).filter((id): id is string => Boolean(id));
  if (logIds.length > 0) {
    await db
      .from('automation_logs')
      .update({ error_message: 'Parada antes de terminar.' })
      .in('id', logIds);
  }
  return { stopped: rows.length };
}
