import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  cancelScheduledMessage,
  createScheduledMessage,
  parseScheduleInput,
  processScheduledMessages,
  SCHEDULED_PER_CONTACT,
  ScheduleError,
  type ProcessDeps,
} from './messages';

// ---------------------------------------------------------------------
// A small in-memory stand-in for the Supabase client: tables of rows,
// filters, counts, inserts and updates that return rows, and an rpc
// that plays claim_scheduled_messages().
// ---------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, rpcError: { code: string } | null = null) {
  let seq = 0;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let insert: Row | null = null;
    let countOnly = false;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const result = () => {
      if (insert) {
        const row = { id: `new-${++seq}`, status: 'scheduled', created_at: '2026-11-10T12:00:00.000Z', ...insert };
        (tables[table] ??= []).push(row);
        return { data: row, error: null };
      }
      if (patch) {
        const hit = rows();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      if (countOnly) return { data: null, count: rows().length, error: null };
      return { data: rows(), error: null };
    };
    const q = {
      select: (_c?: string, opts?: { head?: boolean }) => ((countOnly = Boolean(opts?.head)), q),
      insert: (values: Row) => ((insert = values), q),
      update: (values: Row) => ((patch = values), q),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
      gt: (col: string, v: string) => (filters.push((r) => String(r[col]) > v), q),
      order: () => q,
      limit: () => q,
      single: async () => {
        const r = result();
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
      },
      maybeSingle: async () => {
        const r = result();
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return q;
  };
  const rpc = async () => {
    if (rpcError) return { data: null, error: rpcError };
    const due = (tables.scheduled_messages ?? []).filter(
      (r) => r.status === 'scheduled' && String(r.send_at) <= '2026-11-10T15:00:00.000Z',
    );
    for (const r of due) r.status = 'sending';
    return { data: due, error: null };
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const ACC = 'acc-1';
const CONTACT = 'c-1';
const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const QR = '33333333-3333-4333-8333-333333333333';

const fails = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'resolved';
  } catch (err) {
    return err instanceof ScheduleError ? `${err.status} ${err.code}` : String(err);
  }
};

describe('parseScheduleInput', () => {
  const ok = { text: 'Oi', send_at: '2026-11-11T09:00:00-03:00' };

  it('takes a text and a time ahead', () => {
    expect(parseScheduleInput({ ...ok, only_if_no_reply: true }, NOW)).toEqual({
      text: 'Oi',
      quickReplyId: null,
      sendAt: '2026-11-11T12:00:00.000Z',
      onlyIfNoReply: true,
    });
  });

  it('needs something to send', async () => {
    expect(await fails(() => parseScheduleInput({ send_at: ok.send_at }, NOW))).toBe('400 bad_request');
    expect(await fails(() => parseScheduleInput({ ...ok, text: '  ' }, NOW))).toBe('400 bad_request');
    expect(parseScheduleInput({ send_at: ok.send_at, quick_reply_id: QR }, NOW).quickReplyId).toBe(QR);
  });

  it('refuses a time in the past, too soon, too far, or none', async () => {
    expect(await fails(() => parseScheduleInput({ ...ok, send_at: '2026-11-10T11:00:00Z' }, NOW))).toBe(
      '400 bad_request',
    );
    expect(await fails(() => parseScheduleInput({ ...ok, send_at: '2026-11-10T12:00:30Z' }, NOW))).toBe(
      '400 bad_request',
    );
    expect(await fails(() => parseScheduleInput({ ...ok, send_at: '2027-03-01T12:00:00Z' }, NOW))).toBe(
      '400 bad_request',
    );
    expect(await fails(() => parseScheduleInput({ text: 'Oi', send_at: 'amanhã' }, NOW))).toBe(
      '400 bad_request',
    );
  });

  it('only counts true as true', () => {
    expect(parseScheduleInput({ ...ok, only_if_no_reply: 'sim' }, NOW).onlyIfNoReply).toBe(false);
  });
});

describe('createScheduledMessage', () => {
  const tables = () => ({
    contacts: [{ id: CONTACT, account_id: ACC }],
    quick_replies: [
      { id: QR, account_id: ACC, kind: 'media', media_kind: 'image', media_url: 'https://x/loja.jpg', media_filename: 'loja.jpg' },
    ],
    scheduled_messages: [] as Row[],
  });
  const input = (over = {}) => ({
    text: 'Oi',
    quickReplyId: null,
    sendAt: '2026-11-11T12:00:00.000Z',
    onlyIfNoReply: false,
    ...over,
  });

  it('schedules a text for the account’s contact', async () => {
    const t = tables();
    const out = await createScheduledMessage(fakeDb(t), ACC, CONTACT, 'u1', input({ onlyIfNoReply: true }));
    expect(out).toMatchObject({ text: 'Oi', media: null, only_if_no_reply: true, status: 'scheduled' });
    expect(t.scheduled_messages[0]).toMatchObject({ account_id: ACC, contact_id: CONTACT, created_by: 'u1' });
  });

  it('takes the file from a quick reply, with the caption sent', async () => {
    const t = tables();
    const out = await createScheduledMessage(fakeDb(t), ACC, CONTACT, 'u1', input({ quickReplyId: QR }));
    expect(out.media).toEqual({ kind: 'image', url: 'https://x/loja.jpg', filename: 'loja.jpg' });
    expect(out.text).toBe('Oi');
  });

  it('refuses another account’s contact or quick reply', async () => {
    expect(await fails(createScheduledMessage(fakeDb(tables()), 'acc-2', CONTACT, 'u1', input()))).toBe(
      '404 not_found',
    );
    const t = tables();
    t.quick_replies[0].account_id = 'acc-2';
    expect(await fails(createScheduledMessage(fakeDb(t), ACC, CONTACT, 'u1', input({ quickReplyId: QR })))).toBe(
      '404 not_found',
    );
  });

  it('keeps a contact to a few waiting messages', async () => {
    const t = tables();
    t.scheduled_messages = Array.from({ length: SCHEDULED_PER_CONTACT }, (_, i) => ({
      id: `s${i}`,
      account_id: ACC,
      contact_id: CONTACT,
      status: 'scheduled',
    }));
    expect(await fails(createScheduledMessage(fakeDb(t), ACC, CONTACT, 'u1', input()))).toBe('409 too_many');
  });
});

describe('cancelScheduledMessage', () => {
  it('cancels one that has not gone, and only that', async () => {
    const t = {
      scheduled_messages: [
        { id: 'a', account_id: ACC, status: 'scheduled', content_text: 'x', send_at: '', only_if_no_reply: false, created_at: '' },
        { id: 'b', account_id: ACC, status: 'sent', content_text: 'y', send_at: '', only_if_no_reply: false, created_at: '' },
      ] as Row[],
    };
    expect((await cancelScheduledMessage(fakeDb(t), ACC, 'a')).status).toBe('cancelled');
    expect(await fails(cancelScheduledMessage(fakeDb(t), ACC, 'b'))).toBe('409 not_scheduled');
    expect(await fails(cancelScheduledMessage(fakeDb(t), 'acc-2', 'a'))).toBe('409 not_scheduled');
  });
});

describe('processScheduledMessages', () => {
  const row = (over: Row = {}) => ({
    id: 'm1',
    account_id: ACC,
    contact_id: CONTACT,
    content_text: 'Oi, conseguiu ver?',
    media_kind: null,
    media_url: null,
    media_filename: null,
    send_at: '2026-11-10T14:00:00.000Z',
    only_if_no_reply: false,
    status: 'scheduled',
    created_at: '2026-11-09T10:00:00.000Z',
    ...over,
  });
  const world = (rows: Row[], messages: Row[] = []) => ({
    scheduled_messages: rows,
    conversations: [{ id: 'conv-1', account_id: ACC, contact_id: CONTACT }],
    messages,
  });
  const deps = (): ProcessDeps => ({
    send: vi.fn(async () => ({ messageId: 'msg-1', whatsappMessageId: 'wamid' })),
  });

  it('sends what is due through the send core and records it', async () => {
    const t = world([row(), row({ id: 'later', send_at: '2026-11-12T00:00:00.000Z' })]);
    const d = deps();
    expect(await processScheduledMessages(fakeDb(t), d)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(d.send).toHaveBeenCalledWith(expect.anything(), ACC, {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: 'Oi, conseguiu ver?',
      mediaUrl: null,
      filename: null,
    });
    expect(t.scheduled_messages.map((r) => [r.id, r.status, r.sent_message_id ?? null])).toEqual([
      ['m1', 'sent', 'msg-1'],
      ['later', 'scheduled', null],
    ]);
  });

  it('skips a follow-up when the customer wrote since it was scheduled', async () => {
    const t = world(
      [row({ only_if_no_reply: true })],
      [{ conversation_id: 'conv-1', sender_type: 'customer', created_at: '2026-11-10T08:00:00.000Z' }],
    );
    const d = deps();
    expect(await processScheduledMessages(fakeDb(t), d)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(d.send).not.toHaveBeenCalled();
    expect(t.scheduled_messages[0]).toMatchObject({ status: 'skipped' });
  });

  it('still sends a follow-up when only we wrote, or the customer wrote before', async () => {
    const t = world(
      [row({ only_if_no_reply: true })],
      [
        { conversation_id: 'conv-1', sender_type: 'agent', created_at: '2026-11-10T08:00:00.000Z' },
        { conversation_id: 'conv-1', sender_type: 'customer', created_at: '2026-11-08T08:00:00.000Z' },
      ],
    );
    expect(await processScheduledMessages(fakeDb(t), deps())).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });

  it('sends a file with its caption, an audio without, a document with its name', async () => {
    const t = world([
      row({ id: 'img', media_kind: 'image', media_url: 'https://x/a.jpg', content_text: 'Foto' }),
      row({ id: 'aud', media_kind: 'audio', media_url: 'https://x/a.ogg', content_text: null }),
      row({ id: 'doc', media_kind: 'document', media_url: 'https://x/a.pdf', media_filename: 'a.pdf', content_text: null }),
    ]);
    const d = deps();
    await processScheduledMessages(fakeDb(t), d);
    const calls = (d.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(calls).toEqual([
      { conversationId: 'conv-1', messageType: 'image', contentText: 'Foto', mediaUrl: 'https://x/a.jpg', filename: null },
      { conversationId: 'conv-1', messageType: 'audio', contentText: null, mediaUrl: 'https://x/a.ogg', filename: null },
      { conversationId: 'conv-1', messageType: 'document', contentText: 'a.pdf', mediaUrl: 'https://x/a.pdf', filename: 'a.pdf' },
    ]);
  });

  it('records a failure with the reason, and goes on', async () => {
    const t = world([row(), row({ id: 'm2' })]);
    const d: ProcessDeps = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('Fora da janela de 24 horas'))
        .mockResolvedValueOnce({ messageId: 'msg-2', whatsappMessageId: 'w' }),
    };
    expect(await processScheduledMessages(fakeDb(t), d)).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(t.scheduled_messages[0]).toMatchObject({ status: 'failed', outcome: 'Fora da janela de 24 horas' });
  });

  it('fails when the contact has no conversation', async () => {
    const t = { ...world([row()]), conversations: [] };
    expect(await processScheduledMessages(fakeDb(t), deps())).toEqual({ sent: 0, skipped: 0, failed: 1 });
  });

  it('does nothing, quietly, before migration 064', async () => {
    expect(await processScheduledMessages(fakeDb({}, { code: 'PGRST202' }), deps())).toBeNull();
  });
});
