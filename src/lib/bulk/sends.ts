import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route';
import { isQuickReplyMediaKind } from '@/lib/quick-replies/media';
import { fillQuickReply } from '@/lib/quick-replies/variables';
import { equivalentPhoneKeys } from '@/lib/whatsapp/phone-utils';
import { isOptedOut } from '@/lib/contacts/opt-out';

import {
  BULK_DAILY_LIMIT,
  BULK_MAX_RECIPIENTS,
  BULK_START_DELAY_S,
  checkDailyLimit,
  dayKey,
  planSendTimes,
} from './plan';

// ============================================================
// Bulk sends through the QR-code number (migration 065; Fase 8 of
// docs/plano-extensao-chrome.md).
//
// A bulk send is a row in bulk_sends plus one scheduled message (064)
// per recipient, spaced by plan.ts and sent by the scheduler that
// already runs the automations. So it is followed, and stopped, like
// any scheduled message — and nothing new runs in the background.
//
// Only for the QR-code number: on the official API, bulk sends are the
// approved-template broadcasts the CRM already has.
// ============================================================

export class BulkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Audience = { tagId: string } | { phones: string[] };

export interface BulkInput {
  name: string;
  text: string | null;
  quickReplyId: string | null;
  audience: Audience;
  riskAccepted: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHONES = 1000;
const CHUNK = 500;

/** Check what the screen sent. Pure. */
export function parseBulkInput(body: unknown): BulkInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 120) {
    throw new BulkError('bad_request', 'Dê um nome ao disparo (até 120 caracteres).', 400);
  }
  const text = typeof b.text === 'string' && b.text.trim() ? b.text : null;
  const quickReplyId = typeof b.quick_reply_id === 'string' && UUID.test(b.quick_reply_id) ? b.quick_reply_id : null;
  if (!text && !quickReplyId) {
    throw new BulkError('bad_request', 'Escreva a mensagem ou escolha uma resposta rápida.', 400);
  }
  if (text && text.length > 4096) {
    throw new BulkError('bad_request', 'A mensagem passa de 4096 caracteres.', 400);
  }

  let audience: Audience;
  if (typeof b.tag_id === 'string' && UUID.test(b.tag_id)) {
    audience = { tagId: b.tag_id };
  } else if (Array.isArray(b.phones) || typeof b.phones === 'string') {
    const raw = Array.isArray(b.phones) ? b.phones.join('\n') : String(b.phones);
    const phones = [...new Set(raw.split(/[\n,;]+/).map((p) => p.replace(/\D/g, '')).filter((p) => p.length >= 8))];
    if (phones.length === 0) throw new BulkError('bad_request', 'Cole pelo menos um número.', 400);
    if (phones.length > MAX_PHONES) {
      throw new BulkError('bad_request', `Até ${MAX_PHONES} números por lista.`, 400);
    }
    audience = { phones };
  } else {
    throw new BulkError('bad_request', 'Escolha uma etiqueta ou cole uma lista de números.', 400);
  }

  return { name, text, quickReplyId, audience, riskAccepted: b.risk_accepted === true };
}

/** Whether this CRM can bulk-send through the QR code, and why not. */
export async function bulkAvailability(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ available: true } | { available: false; reason: string }> {
  const provider = await resolveWhatsAppProvider(admin, accountId);
  if (provider === 'uazapi' || provider === 'evolution') return { available: true };
  if (provider === 'meta') {
    return {
      available: false,
      reason: 'Este CRM envia pela API oficial: lá, os disparos usam modelos aprovados (o botão acima).',
    };
  }
  return { available: false, reason: 'Conecte o WhatsApp pelo QR code para disparar por ele.' };
}

interface Recipient {
  id: string;
  name: string | null;
  company: string | null;
}

/**
 * The CRM contacts the audience names, once each; the numbers it didn't
 * find; and how many were left out because they opted out (066).
 */
export async function resolveAudience(
  db: SupabaseClient,
  accountId: string,
  audience: Audience,
): Promise<{ contacts: Recipient[]; notFound: number; optedOut: number }> {
  const found = new Map<string, Recipient>();
  const optedOutIds = new Set<string>();
  if ('tagId' in audience) {
    const { data: links } = await db.from('contact_tags').select('contact_id').eq('tag_id', audience.tagId);
    const ids = [...new Set(((links ?? []) as { contact_id: string }[]).map((l) => l.contact_id))];
    for (let i = 0; i < ids.length; i += CHUNK) {
      // `*` so opted_out_at (066) is read once it exists.
      const { data } = await db
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .in('id', ids.slice(i, i + CHUNK));
      for (const c of (data ?? []) as (Recipient & { phone: string | null; opted_out_at?: unknown })[]) {
        if (!c.phone) continue;
        if (isOptedOut(c)) optedOutIds.add(c.id);
        else found.set(c.id, { id: c.id, name: c.name, company: c.company });
      }
    }
    return { contacts: [...found.values()], notFound: 0, optedOut: optedOutIds.size };
  }

  let notFound = 0;
  const keyToPhone = new Map<string, string>();
  for (const phone of audience.phones) {
    for (const key of equivalentPhoneKeys(phone)) keyToPhone.set(key, phone);
  }
  const keys = [...keyToPhone.keys()];
  const matched = new Set<string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .in('phone_normalized', keys.slice(i, i + CHUNK));
    for (const c of (data ?? []) as (Recipient & { phone_normalized: string; opted_out_at?: unknown })[]) {
      const phone = keyToPhone.get(c.phone_normalized);
      if (phone) matched.add(phone);
      if (isOptedOut(c)) optedOutIds.add(c.id);
      else found.set(c.id, { id: c.id, name: c.name, company: c.company });
    }
  }
  notFound = audience.phones.filter((p) => !matched.has(p)).length;
  return { contacts: [...found.values()], notFound, optedOut: optedOutIds.size };
}

export interface BulkPlanSummary {
  total: number;
  not_found: number;
  /** Left out because they asked not to receive (066). */
  opted_out: number;
  first_at: string | null;
  last_at: string | null;
  used_today: number;
}

export interface BulkDeps {
  now: () => number;
  random: () => number;
}

const defaultDeps: BulkDeps = { now: () => Date.now(), random: Math.random };

/** Sends already on the calendar, per Brasília day, from `fromMs` on. */
async function bulkCountsByDay(
  db: SupabaseClient,
  accountId: string,
  fromMs: number,
): Promise<Record<string, number>> {
  const startOfDay = Date.parse(`${dayKey(fromMs)}T00:00:00-03:00`);
  const { data } = await db
    .from('scheduled_messages')
    .select('send_at')
    .eq('account_id', accountId)
    .not('bulk_send_id', 'is', null)
    .in('status', ['scheduled', 'sending', 'sent'])
    .gte('send_at', new Date(startOfDay).toISOString());
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { send_at: string }[]) {
    const day = dayKey(Date.parse(r.send_at));
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

/** After the last send still waiting in this CRM: one bulk at a time. */
async function lastPendingBulkSend(db: SupabaseClient, accountId: string): Promise<number | null> {
  const { data } = await db
    .from('scheduled_messages')
    .select('send_at')
    .eq('account_id', accountId)
    .not('bulk_send_id', 'is', null)
    .eq('status', 'scheduled')
    .order('send_at', { ascending: false })
    .limit(1);
  const last = ((data ?? []) as { send_at: string }[])[0]?.send_at;
  return last ? Date.parse(last) : null;
}

/**
 * Plan a bulk send and, unless `dryRun`, create it. `db` is the
 * person's own session (RLS); `admin` reads the WhatsApp path.
 */
export async function createBulkSend(
  db: SupabaseClient,
  admin: SupabaseClient,
  accountId: string,
  createdBy: string | null,
  input: BulkInput,
  options: { dryRun: boolean },
  deps: BulkDeps = defaultDeps,
): Promise<BulkPlanSummary & { id: string | null }> {
  const availability = await bulkAvailability(admin, accountId);
  if (!availability.available) throw new BulkError('unavailable', availability.reason, 409);

  let media: { kind: string; url: string; filename: string | null } | null = null;
  let text = input.text;
  if (input.quickReplyId) {
    const { data } = await db
      .from('quick_replies')
      .select('kind, content_text, media_kind, media_url, media_filename')
      .eq('id', input.quickReplyId)
      .eq('account_id', accountId)
      .maybeSingle();
    const reply = data as {
      kind?: string;
      content_text?: string | null;
      media_kind?: string | null;
      media_url?: string | null;
      media_filename?: string | null;
    } | null;
    if (!reply) throw new BulkError('not_found', 'Resposta rápida não encontrada.', 404);
    if (reply.kind === 'media' && isQuickReplyMediaKind(reply.media_kind) && reply.media_url) {
      media = { kind: reply.media_kind, url: reply.media_url, filename: reply.media_filename ?? null };
    }
    // Typed text wins; otherwise the reply's own text or caption.
    if (!text) text = reply.content_text?.trim() ? reply.content_text : null;
    if (!text && !media) throw new BulkError('bad_request', 'Essa resposta rápida não tem texto.', 400);
  }

  const { contacts, notFound, optedOut } = await resolveAudience(db, accountId, input.audience);
  if (contacts.length === 0) {
    throw new BulkError(
      'empty',
      optedOut
        ? 'Nenhum contato para disparar: os desta lista pediram para não receber, e números fora do CRM ficam de fora.'
        : 'Nenhum contato do CRM para disparar. Números fora do CRM ficam de fora.',
      400,
    );
  }
  if (contacts.length > BULK_MAX_RECIPIENTS) {
    throw new BulkError(
      'too_many',
      `São ${contacts.length} contatos: um disparo vai até ${BULK_MAX_RECIPIENTS}, o limite do dia.`,
      400,
    );
  }

  const now = deps.now();
  const after = Math.max(now + BULK_START_DELAY_S * 1000, (await lastPendingBulkSend(db, accountId)) ?? 0);
  const times = planSendTimes(contacts.length, after, deps.random);
  const counts = await bulkCountsByDay(db, accountId, now);
  const fits = checkDailyLimit(times, counts, BULK_DAILY_LIMIT);
  const summary: BulkPlanSummary = {
    total: contacts.length,
    not_found: notFound,
    opted_out: optedOut,
    first_at: new Date(times[0]).toISOString(),
    last_at: new Date(times[times.length - 1]).toISOString(),
    used_today: counts[dayKey(now)] ?? 0,
  };
  if (!fits.ok) {
    throw new BulkError(
      'daily_limit',
      fits.day === dayKey(now)
        ? `Hoje ainda cabem ${fits.room} envios (o limite é ${BULK_DAILY_LIMIT} por dia). Diminua a lista ou dispare amanhã.`
        : `O disparo passaria de ${BULK_DAILY_LIMIT} envios no dia ${fits.day.split('-').reverse().join('/')}. Diminua a lista.`,
      409,
    );
  }
  if (options.dryRun) return { id: null, ...summary };

  if (!input.riskAccepted) {
    throw new BulkError('risk_not_accepted', 'Confirme que entende o risco de bloqueio do número.', 400);
  }

  const { data: bulk, error } = await db
    .from('bulk_sends')
    .insert({
      account_id: accountId,
      created_by: createdBy,
      name: input.name,
      content_text: media?.kind === 'audio' ? null : text,
      media_kind: media?.kind ?? null,
      media_url: media?.url ?? null,
      media_filename: media?.filename ?? null,
      audience: 'tagId' in input.audience
        ? { tag_id: input.audience.tagId }
        : { phones: input.audience.phones.length },
      total: contacts.length,
      risk_accepted_at: new Date(now).toISOString(),
    })
    .select('id')
    .single();
  if (error || !bulk) {
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      throw new BulkError('unavailable', 'Disparos pelo QR code precisam da atualização 065 do CRM.', 503);
    }
    throw new BulkError('internal', 'Não consegui criar o disparo.', 500);
  }
  const bulkId = (bulk as { id: string }).id;

  const rows = contacts.map((c, i) => ({
    account_id: accountId,
    contact_id: c.id,
    created_by: createdBy,
    // Each one with its own name filled in.
    content_text:
      media?.kind === 'audio' ? null : text ? fillQuickReply(text, { name: c.name, company: c.company }).text : null,
    media_kind: media?.kind ?? null,
    media_url: media?.url ?? null,
    media_filename: media?.filename ?? null,
    send_at: new Date(times[i]).toISOString(),
    only_if_no_reply: false,
    bulk_send_id: bulkId,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insertError } = await db.from('scheduled_messages').insert(rows.slice(i, i + CHUNK));
    if (insertError) {
      // What went in is stopped: a half-planned bulk must not go out.
      await stopBulkSend(db, accountId, bulkId);
      throw new BulkError('internal', 'Não consegui agendar todas as mensagens do disparo.', 500);
    }
  }
  return { id: bulkId, ...summary };
}

export interface BulkSendView {
  id: string;
  name: string;
  total: number;
  created_at: string;
  stopped_at: string | null;
  counts: Record<'scheduled' | 'sending' | 'sent' | 'skipped' | 'cancelled' | 'failed', number>;
}

/** The latest bulk sends with how far each got. */
export async function listBulkSends(db: SupabaseClient, accountId: string): Promise<BulkSendView[]> {
  const { data, error } = await db
    .from('bulk_sends')
    .select('id, name, total, created_at, stopped_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      throw new BulkError('unavailable', 'Disparos pelo QR code precisam da atualização 065 do CRM.', 503);
    }
    throw new BulkError('internal', 'Falha ao listar os disparos.', 500);
  }
  const bulks = (data ?? []) as Omit<BulkSendView, 'counts'>[];
  if (bulks.length === 0) return [];
  const { data: rows } = await db
    .from('scheduled_messages')
    .select('bulk_send_id, status')
    .in('bulk_send_id', bulks.map((b) => b.id));
  const empty = () => ({ scheduled: 0, sending: 0, sent: 0, skipped: 0, cancelled: 0, failed: 0 });
  const counts = new Map<string, BulkSendView['counts']>();
  for (const r of (rows ?? []) as { bulk_send_id: string; status: keyof BulkSendView['counts'] }[]) {
    const c = counts.get(r.bulk_send_id) ?? empty();
    if (r.status in c) c[r.status] += 1;
    counts.set(r.bulk_send_id, c);
  }
  return bulks.map((b) => ({ ...b, counts: counts.get(b.id) ?? empty() }));
}

/** Stop what is left of a bulk send. Returns how many messages were cancelled. */
export async function stopBulkSend(
  db: SupabaseClient,
  accountId: string,
  bulkId: string,
): Promise<{ stopped: number }> {
  const { data, error } = await db
    .from('scheduled_messages')
    .update({ status: 'cancelled', processed_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('bulk_send_id', bulkId)
    .eq('status', 'scheduled')
    .select('id');
  if (error) throw new BulkError('internal', 'Não consegui parar o disparo.', 500);
  await db
    .from('bulk_sends')
    .update({ stopped_at: new Date().toISOString() })
    .eq('id', bulkId)
    .eq('account_id', accountId)
    .is('stopped_at', null);
  return { stopped: (data ?? []).length };
}
