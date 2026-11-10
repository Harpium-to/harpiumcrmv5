// ============================================================
// Where a contact's conversation stands in the CRM, for the public API:
//   GET  /api/v1/contacts/{id}/conversation
//   POST /api/v1/conversations/{id}/takeover
//
// The question an attendant has in front of a chat: is the bot
// answering this, is somebody waiting for me, did I already take it?
// And one action: take it over — the same write the inbox's "Assumir"
// makes (`/api/ai/autoreply/{id}` with `assign_to_me`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `answering` — the bot replies to this conversation
 * `paused`    — the account has the bot on, but not here: someone took
 *               it over, or it handed off
 * `off`       — the account has no auto-reply at all
 */
export type AiState = 'answering' | 'paused' | 'off';

/**
 * The same gate the auto-reply itself applies (src/lib/ai/auto-reply.ts):
 * it stands down when the conversation is paused or a person owns it.
 */
export function aiStateOf(
  conversation: { ai_autoreply_disabled?: boolean | null; assigned_agent_id?: string | null },
  botOn: boolean
): AiState {
  if (!botOn) return 'off';
  if (conversation.ai_autoreply_disabled || conversation.assigned_agent_id) return 'paused';
  return 'answering';
}

export interface ApiConversationState {
  id: string;
  status: string;
  channel: string;
  ai: AiState;
  /** What the bot wrote when it passed the conversation to the team. */
  handoff_summary: string | null;
  /**
   * Since when the customer waits for a person after a handoff; `null`
   * when nobody is waiting, or before migration 058.
   */
  waiting_since: string | null;
  assigned_to: { id: string; name: string | null } | null;
  /** True when the person this key belongs to owns the conversation. */
  assigned_to_me: boolean;
  last_message_at: string | null;
}

/** Project a `conversations` row into the public shape. */
export function serializeConversationState(
  row: Record<string, unknown>,
  options: { botOn: boolean; personId: string | null; assigneeName: string | null }
): ApiConversationState {
  const assignee = (row.assigned_agent_id as string | null) ?? null;
  return {
    id: row.id as string,
    status: (row.status as string | null) ?? 'open',
    channel: (row.channel as string | null) ?? 'whatsapp',
    ai: aiStateOf(row, options.botOn),
    handoff_summary: (row.ai_handoff_summary as string | null) ?? null,
    waiting_since: (row.needs_human_since as string | null) ?? null,
    assigned_to: assignee ? { id: assignee, name: options.assigneeName } : null,
    assigned_to_me: Boolean(assignee && options.personId && assignee === options.personId),
    last_message_at: (row.last_message_at as string | null) ?? null,
  };
}

/** Whether the account's bot answers customers at all. */
async function isBotOn(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data } = await db
    .from('ai_configs')
    .select('is_active, auto_reply_enabled')
    .eq('account_id', accountId)
    .maybeSingle();
  return Boolean(data?.is_active && data?.auto_reply_enabled);
}

async function project(
  db: SupabaseClient,
  accountId: string,
  row: Record<string, unknown>,
  personId: string | null
): Promise<ApiConversationState> {
  const assignee = (row.assigned_agent_id as string | null) ?? null;
  let assigneeName: string | null = null;
  if (assignee) {
    const { data } = await db
      .from('profiles')
      .select('full_name')
      .eq('user_id', assignee)
      .maybeSingle();
    assigneeName = (data?.full_name as string | undefined) ?? null;
  }
  return serializeConversationState(row, {
    botOn: await isBotOn(db, accountId),
    personId,
    assigneeName,
  });
}

/**
 * The contact's WhatsApp conversation — the most recently active one —
 * or null when the CRM has none (the number is not connected, or they
 * never wrote).
 */
export async function getContactConversationState(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  personId: string | null
): Promise<ApiConversationState | null> {
  const { data, error } = await db
    .from('conversations')
    // `*` so `needs_human_since` (migration 058) appears once applied.
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .neq('channel', 'instagram')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return project(db, accountId, data as Record<string, unknown>, personId);
}

/**
 * Take a conversation over: pause the bot on it and, when the key
 * belongs to a person, make them its owner. `null` when the account
 * has no such conversation.
 *
 * Assigning through the service role makes the assignment trigger (027)
 * notify the new owner that "someone" gave them the conversation. Here
 * that someone is themselves, so the notification is marked read on
 * the spot rather than left as noise in their bell.
 */
export async function takeOverConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  personId: string | null
): Promise<ApiConversationState | null> {
  const startedAt = new Date().toISOString();
  const { data, error } = await db
    .from('conversations')
    .update({
      ai_autoreply_disabled: true,
      ...(personId ? { assigned_agent_id: personId } : {}),
    })
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .select('*')
    .maybeSingle();
  if (error) {
    // A malformed id is simply a conversation that does not exist.
    if (error.code === '22P02') return null;
    throw error;
  }
  if (!data) return null;

  if (personId) {
    await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', personId)
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_assigned')
      .is('read_at', null)
      .gte('created_at', startedAt);
  }
  return project(db, accountId, data as Record<string, unknown>, personId);
}
