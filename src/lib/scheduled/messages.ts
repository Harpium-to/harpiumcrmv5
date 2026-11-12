import type { SupabaseClient } from '@supabase/supabase-js';

import { isMissingFunction, isMissingTable } from '@/lib/auth/account-context';
import { isQuickReplyMediaKind, type QuickReplyMediaKind } from '@/lib/quick-replies/media';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { contactOptedOut } from '@/lib/contacts/opt-out';

// ============================================================
// Messages scheduled for a contact (migration 064; Fase 5 of
// docs/plano-extensao-chrome.md).
//
// One message — a text, or a quick reply's file with its caption — to
// one contact at a set time. With `only_if_no_reply` it is a follow-up:
// when the time comes it is skipped if the customer wrote in the
// meantime.
//
// Sent by the scheduler that already runs the automations
// (/api/automations/cron), through the same send core as the inbox, so
// it leaves by whichever WhatsApp the CRM uses.
// ============================================================

/** At least this far ahead, so it is a schedule and not a send. */
export const SCHEDULE_MIN_AHEAD_MS = 60_000;
/** At most this far ahead. */
export const SCHEDULE_MAX_AHEAD_DAYS = 90;
/** Messages waiting for one contact at once. */
export const SCHEDULED_PER_CONTACT = 20;
export const SCHEDULED_TEXT_MAX = 4096;

export class ScheduleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ScheduleInput {
  text: string | null;
  quickReplyId: string | null;
  sendAt: string;
  onlyIfNoReply: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check what a caller asked to schedule. Pure. */
export function parseScheduleInput(body: unknown, now: number): ScheduleInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = typeof b.text === 'string' && b.text.trim() ? b.text : null;
  const quickReplyId = typeof b.quick_reply_id === 'string' ? b.quick_reply_id : null;
  if (quickReplyId !== null && !UUID.test(quickReplyId)) {
    throw new ScheduleError('bad_request', "'quick_reply_id' inválido", 400);
  }
  if (!text && !quickReplyId) {
    throw new ScheduleError('bad_request', 'Escreva a mensagem ou escolha uma resposta rápida.', 400);
  }
  if (text && text.length > SCHEDULED_TEXT_MAX) {
    throw new ScheduleError('bad_request', `A mensagem passa de ${SCHEDULED_TEXT_MAX} caracteres.`, 400);
  }

  const at = typeof b.send_at === 'string' ? Date.parse(b.send_at) : NaN;
  if (!Number.isFinite(at)) {
    throw new ScheduleError('bad_request', 'Escolha o dia e a hora do envio.', 400);
  }
  if (at < now + SCHEDULE_MIN_AHEAD_MS) {
    throw new ScheduleError('bad_request', 'Escolha um horário daqui a pelo menos 1 minuto.', 400);
  }
  if (at > now + SCHEDULE_MAX_AHEAD_DAYS * 86_400_000) {
    throw new ScheduleError(
      'bad_request',
      `Dá para agendar até ${SCHEDULE_MAX_AHEAD_DAYS} dias à frente.`,
      400,
    );
  }

  return {
    text,
    quickReplyId,
    sendAt: new Date(at).toISOString(),
    onlyIfNoReply: b.only_if_no_reply === true,
  };
}

export interface ScheduledRow {
  id: string;
  account_id?: string;
  contact_id: string;
  created_by?: string | null;
  content_text: string | null;
  media_kind: string | null;
  media_url: string | null;
  media_filename: string | null;
  send_at: string;
  only_if_no_reply: boolean;
  status: string;
  outcome: string | null;
  processed_at?: string | null;
  created_at: string;
  /** Set for a recipient of a bulk send (065). */
  bulk_send_id?: string | null;
}

export interface PublicScheduledMessage {
  id: string;
  text: string;
  media: { kind: QuickReplyMediaKind; url: string; filename: string | null } | null;
  send_at: string;
  only_if_no_reply: boolean;
  status: string;
  outcome: string | null;
  created_at: string;
}

export function serializeScheduled(row: ScheduledRow): PublicScheduledMessage {
  return {
    id: row.id,
    text: row.content_text ?? '',
    media:
      isQuickReplyMediaKind(row.media_kind) && row.media_url
        ? { kind: row.media_kind, url: row.media_url, filename: row.media_filename ?? null }
        : null,
    send_at: row.send_at,
    only_if_no_reply: row.only_if_no_reply,
    status: row.status,
    outcome: row.outcome ?? null,
    created_at: row.created_at,
  };
}

const COLUMNS =
  'id, contact_id, content_text, media_kind, media_url, media_filename, send_at, only_if_no_reply, status, outcome, created_at';

function unavailable(error: { code?: string } | null): boolean {
  return isMissingTable(error);
}

async function ownContact(db: SupabaseClient, accountId: string, contactId: string) {
  const { data } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) throw new ScheduleError('not_found', 'Contato não encontrado.', 404);
}

/** What is waiting for a contact, soonest first, then the last few done. */
export async function listScheduledMessages(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<PublicScheduledMessage[]> {
  await ownContact(db, accountId, contactId);
  const { data, error } = await db
    .from('scheduled_messages')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('send_at', { ascending: true })
    .limit(100);
  if (unavailable(error)) {
    throw new ScheduleError('unavailable', 'Agendar mensagens precisa da atualização 064 do CRM.', 503);
  }
  if (error) throw new ScheduleError('internal', 'Falha ao listar as mensagens agendadas.', 500);
  const rows = (data ?? []) as ScheduledRow[];
  const waiting = rows.filter((r) => r.status === 'scheduled' || r.status === 'sending');
  const done = rows
    .filter((r) => r.status !== 'scheduled' && r.status !== 'sending')
    .sort((a, b) => b.send_at.localeCompare(a.send_at))
    .slice(0, 5);
  return [...waiting, ...done].map(serializeScheduled);
}

/** Schedule a message for a contact. `createdBy` is the person. */
export async function createScheduledMessage(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  createdBy: string | null,
  input: ScheduleInput,
): Promise<PublicScheduledMessage> {
  await ownContact(db, accountId, contactId);

  let media: { media_kind: string; media_url: string; media_filename: string | null } | null = null;
  if (input.quickReplyId) {
    const { data } = await db
      .from('quick_replies')
      .select('kind, content_text, media_kind, media_url, media_filename')
      .eq('id', input.quickReplyId)
      .eq('account_id', accountId)
      .maybeSingle();
    const reply = data as {
      kind?: string;
      media_kind?: string | null;
      media_url?: string | null;
      media_filename?: string | null;
    } | null;
    if (!reply) throw new ScheduleError('not_found', 'Resposta rápida não encontrada.', 404);
    if (reply.kind === 'media' && isQuickReplyMediaKind(reply.media_kind) && reply.media_url) {
      media = {
        media_kind: reply.media_kind,
        media_url: reply.media_url,
        media_filename: reply.media_filename ?? null,
      };
    } else if (!input.text) {
      // A text reply: the caller sends the text, filled in for this contact.
      throw new ScheduleError('bad_request', 'Escreva a mensagem.', 400);
    }
  }

  const { count, error: countError } = await db
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'scheduled');
  if (unavailable(countError)) {
    throw new ScheduleError('unavailable', 'Agendar mensagens precisa da atualização 064 do CRM.', 503);
  }
  if ((count ?? 0) >= SCHEDULED_PER_CONTACT) {
    throw new ScheduleError(
      'too_many',
      `Este contato já tem ${SCHEDULED_PER_CONTACT} mensagens agendadas. Cancele alguma antes.`,
      409,
    );
  }

  const { data, error } = await db
    .from('scheduled_messages')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      created_by: createdBy,
      // The audio of a quick reply goes without a caption.
      content_text: media?.media_kind === 'audio' ? null : input.text,
      media_kind: media?.media_kind ?? null,
      media_url: media?.media_url ?? null,
      media_filename: media?.media_filename ?? null,
      send_at: input.sendAt,
      only_if_no_reply: input.onlyIfNoReply,
    })
    .select(COLUMNS)
    .single();
  if (unavailable(error)) {
    throw new ScheduleError('unavailable', 'Agendar mensagens precisa da atualização 064 do CRM.', 503);
  }
  if (error || !data) throw new ScheduleError('internal', 'Não consegui agendar a mensagem.', 500);
  return serializeScheduled(data as ScheduledRow);
}

/** Cancel a message that has not gone yet. */
export async function cancelScheduledMessage(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<PublicScheduledMessage> {
  const { data, error } = await db
    .from('scheduled_messages')
    .update({ status: 'cancelled', processed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('status', 'scheduled')
    .select(COLUMNS)
    .maybeSingle();
  if (unavailable(error)) {
    throw new ScheduleError('unavailable', 'Agendar mensagens precisa da atualização 064 do CRM.', 503);
  }
  if (error) throw new ScheduleError('internal', 'Não consegui cancelar.', 500);
  if (!data) {
    throw new ScheduleError('not_scheduled', 'Esta mensagem já saiu, foi cancelada ou não existe.', 409);
  }
  return serializeScheduled(data as ScheduledRow);
}

// ------------------------------------------------------------
// The scheduler's side
// ------------------------------------------------------------

export interface ProcessDeps {
  send: typeof sendMessageToConversation;
  /** Opens a conversation for a contact who never had one. */
  openConversation: (db: SupabaseClient, accountId: string, phone: string) => Promise<string>;
}

const defaultProcessDeps: ProcessDeps = {
  send: sendMessageToConversation,
  openConversation: async (db, accountId, phone) =>
    (await resolveConversationByPhone(db, accountId, phone)).conversationId,
};

async function finish(
  db: SupabaseClient,
  id: string,
  status: 'sent' | 'skipped' | 'failed',
  outcome: string | null,
  sentMessageId: string | null = null,
) {
  await db
    .from('scheduled_messages')
    .update({
      status,
      outcome,
      sent_message_id: sentMessageId,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Did the customer write since `since`, in any of these conversations?
 * Messages carry no account: the conversations (already the account's)
 * scope the look.
 */
async function customerWroteSince(
  db: SupabaseClient,
  conversationIds: string[],
  since: string,
): Promise<boolean> {
  if (conversationIds.length === 0) return false;
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', conversationIds)
    .eq('sender_type', 'customer')
    .gt('created_at', since);
  return (count ?? 0) > 0;
}

/** Send one claimed message. Never throws. */
async function processOne(db: SupabaseClient, row: ScheduledRow, deps: ProcessDeps) {
  const accountId = row.account_id as string;
  try {
    const { data: convs } = await db
      .from('conversations')
      .select('id, last_message_at')
      .eq('account_id', accountId)
      .eq('contact_id', row.contact_id)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    const conversations = (convs ?? []) as { id: string }[];
    if (conversations.length === 0) {
      // A contact who never wrote — a bulk send's recipient, say: open
      // the conversation the way the public API does, by their number.
      const { data: contact } = await db
        .from('contacts')
        .select('phone')
        .eq('id', row.contact_id)
        .eq('account_id', accountId)
        .maybeSingle();
      const phone = (contact as { phone?: string | null } | null)?.phone;
      if (!phone) {
        await finish(db, row.id, 'failed', 'O contato não tem telefone no CRM.');
        return 'failed';
      }
      conversations.push({ id: await deps.openConversation(db, accountId, phone) });
    }

    if (
      row.only_if_no_reply &&
      (await customerWroteSince(
        db,
        conversations.map((c) => c.id),
        row.created_at,
      ))
    ) {
      await finish(db, row.id, 'skipped', 'O cliente respondeu antes, então não foi enviada.');
      return 'skipped';
    }

    // A bulk send leaves out whoever opted out since it was planned (066).
    if (row.bulk_send_id && (await contactOptedOut(db, accountId, row.contact_id))) {
      await finish(db, row.id, 'skipped', 'O contato pediu para não receber disparos.');
      return 'skipped';
    }

    const kind = isQuickReplyMediaKind(row.media_kind) ? row.media_kind : 'text';
    const caption = row.content_text?.trim() ? row.content_text : null;
    const result = await deps.send(db, accountId, {
      conversationId: conversations[0].id,
      messageType: kind,
      contentText:
        kind === 'text'
          ? row.content_text
          : kind === 'audio'
            ? null
            : kind === 'document'
              ? caption ?? row.media_filename ?? 'Documento'
              : caption,
      mediaUrl: kind === 'text' ? null : row.media_url,
      filename: kind === 'document' ? row.media_filename : null,
    });
    await finish(db, row.id, 'sent', null, result.messageId);
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(db, row.id, 'failed', message.slice(0, 500));
    return 'failed';
  }
}

/**
 * Send the scheduled messages that are due. Returns how many went,
 * were skipped and failed — or null when it could not run (migration
 * 064 not applied, or an error, logged). Never throws: a problem here
 * must not stop the automations that share the schedule.
 */
export async function processScheduledMessages(
  db: SupabaseClient,
  deps: ProcessDeps = defaultProcessDeps,
): Promise<{ sent: number; skipped: number; failed: number } | null> {
  try {
    const { data, error } = await db.rpc('claim_scheduled_messages', { p_limit: 50 });
    if (error) {
      if (!isMissingFunction(error)) {
        console.error('[scheduled] claim_scheduled_messages error:', error);
      }
      return null;
    }
    const counts = { sent: 0, skipped: 0, failed: 0 };
    for (const row of (data ?? []) as ScheduledRow[]) {
      counts[await processOne(db, row, deps)] += 1;
    }
    return counts;
  } catch (error) {
    console.error('[scheduled] processScheduledMessages threw:', error);
    return null;
  }
}
