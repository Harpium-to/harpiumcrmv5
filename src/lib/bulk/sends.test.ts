import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ provider: 'uazapi' as string | null }));
vi.mock('@/lib/channels/whatsapp-route', () => ({
  resolveWhatsAppProvider: vi.fn(async () => route.provider),
}));

import { BULK_DAILY_LIMIT } from './plan';
import {
  BulkError,
  createBulkSend,
  listBulkSends,
  parseBulkInput,
  resolveAudience,
  stopBulkSend,
  type BulkInput,
} from './sends';

// ---------------------------------------------------------------------
// A small in-memory stand-in for the Supabase query builder.
// ---------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let insert: Row[] | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const result = () => {
      if (insert) {
        const made = insert.map((r) => ({ id: `${table}-${++seq}`, status: 'scheduled', ...r }));
        (tables[table] ??= []).push(...made);
        return { data: made, error: null };
      }
      if (patch) {
        const hit = rows();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      let out = rows();
      if (order) {
        const { col, asc } = order;
        out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
      }
      return { data: out.slice(0, limit), error: null };
    };
    const q = {
      select: () => q,
      insert: (v: Row | Row[]) => ((insert = Array.isArray(v) ? v : [v]), q),
      update: (v: Row) => ((patch = v), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limit = n), q),
      single: async () => ({ data: result().data?.[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: result().data?.[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const ACC = 'acc-1';
const TAG = '11111111-1111-4111-8111-111111111111';
const QR = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-10T13:00:00Z'); // 10:00 in Brasília

function world(over: Partial<Record<string, Row[]>> = {}) {
  return {
    contacts: [
      { id: 'c1', account_id: ACC, name: 'Ana Lima', company: 'Clínica Sol', phone: '+5531999998888', phone_normalized: '5531999998888' },
      { id: 'c2', account_id: ACC, name: 'João', company: null, phone: '+5511987654321', phone_normalized: '5511987654321' },
      { id: 'c3', account_id: ACC, name: 'Sem telefone', company: null, phone: null, phone_normalized: null },
      { id: 'x1', account_id: 'acc-2', name: 'De outra conta', company: null, phone: '+5521911112222', phone_normalized: '5521911112222' },
    ],
    contact_tags: [
      { contact_id: 'c1', tag_id: TAG },
      { contact_id: 'c2', tag_id: TAG },
      { contact_id: 'c3', tag_id: TAG },
      { contact_id: 'x1', tag_id: TAG },
    ],
    quick_replies: [
      { id: QR, account_id: ACC, kind: 'media', content_text: 'Olha a loja, {{primeiro_nome}}!', media_kind: 'image', media_url: 'https://x/loja.jpg', media_filename: 'loja.jpg' },
    ],
    bulk_sends: [],
    scheduled_messages: [],
    ...over,
  } as Record<string, Row[]>;
}

const input = (over: Partial<BulkInput> = {}): BulkInput => ({
  name: 'Novidade de novembro',
  text: 'Oi, {{primeiro_nome}}! Temos novidade.',
  quickReplyId: null,
  audience: { tagId: TAG },
  riskAccepted: true,
  ...over,
});

const deps = { now: () => NOW, random: () => 0.5 };

const fails = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'resolved';
  } catch (err) {
    return err instanceof BulkError ? `${err.status} ${err.code}` : String(err);
  }
};

beforeEach(() => {
  route.provider = 'uazapi';
});

describe('parseBulkInput', () => {
  it('takes a tag or a pasted list, cleaned and once each', () => {
    expect(parseBulkInput({ name: ' X ', text: 'Oi', tag_id: TAG }).audience).toEqual({ tagId: TAG });
    expect(
      parseBulkInput({ name: 'X', text: 'Oi', phones: '+55 (31) 99999-8888\n5531999998888; 123' }).audience,
    ).toEqual({ phones: ['5531999998888'] });
  });

  it('needs a name, something to send and someone to send it to', async () => {
    expect(await fails(() => parseBulkInput({ text: 'Oi', tag_id: TAG }))).toBe('400 bad_request');
    expect(await fails(() => parseBulkInput({ name: 'X', tag_id: TAG }))).toBe('400 bad_request');
    expect(await fails(() => parseBulkInput({ name: 'X', text: 'Oi' }))).toBe('400 bad_request');
  });

  it('only counts an explicit true as the risk accepted', () => {
    expect(parseBulkInput({ name: 'X', text: 'Oi', tag_id: TAG, risk_accepted: 'sim' }).riskAccepted).toBe(false);
  });
});

describe('resolveAudience', () => {
  it('takes the tag’s contacts of this account that have a number', async () => {
    const { contacts } = await resolveAudience(fakeDb(world()), ACC, { tagId: TAG });
    expect(contacts.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('matches pasted numbers to contacts, ninth digit and all, and counts the rest', async () => {
    const out = await resolveAudience(fakeDb(world()), ACC, {
      phones: ['553199998888', '5511987654321', '5521911112222', '5541900000000'],
    });
    expect(out.contacts.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(out.notFound).toBe(2);
  });
});

describe('createBulkSend', () => {
  it('previews without writing anything', async () => {
    const t = world();
    const out = await createBulkSend(fakeDb(t), fakeDb(t), ACC, 'u1', input(), { dryRun: true }, deps);
    expect(out).toMatchObject({ id: null, total: 2, not_found: 0, used_today: 0 });
    // A minute's delay, then a 60 s gap each (random 0.5).
    expect(out.first_at).toBe(new Date(NOW + 120_000).toISOString());
    expect(t.bulk_sends).toHaveLength(0);
    expect(t.scheduled_messages).toHaveLength(0);
  });

  it('schedules one message per contact, spaced, with each name filled in', async () => {
    const t = world();
    const out = await createBulkSend(fakeDb(t), fakeDb(t), ACC, 'u1', input(), { dryRun: false }, deps);
    expect(out.id).toBe(t.bulk_sends[0].id);
    expect(t.bulk_sends[0]).toMatchObject({ name: 'Novidade de novembro', total: 2, audience: { tag_id: TAG } });
    const msgs = t.scheduled_messages;
    expect(msgs.map((m) => m.content_text).sort()).toEqual([
      'Oi, Ana! Temos novidade.',
      'Oi, João! Temos novidade.',
    ]);
    expect(msgs.every((m) => m.bulk_send_id === out.id)).toBe(true);
    const times = msgs.map((m) => Date.parse(String(m.send_at))).sort();
    expect(times[1] - times[0]).toBe(60_000);
  });

  it('carries a quick reply’s file, and its caption when nothing is typed', async () => {
    const t = world();
    await createBulkSend(fakeDb(t), fakeDb(t), ACC, 'u1', input({ text: null, quickReplyId: QR }), { dryRun: false }, deps);
    expect(t.scheduled_messages[0]).toMatchObject({
      media_kind: 'image',
      media_url: 'https://x/loja.jpg',
      content_text: 'Olha a loja, Ana!',
    });
  });

  it('starts after the bulk send still running, never alongside it', async () => {
    const later = NOW + 30 * 60_000;
    const t = world({
      scheduled_messages: [
        { account_id: ACC, bulk_send_id: 'old', status: 'scheduled', send_at: new Date(later).toISOString() },
      ],
    });
    const out = await createBulkSend(fakeDb(t), fakeDb(t), ACC, 'u1', input(), { dryRun: true }, deps);
    expect(Date.parse(out.first_at!)).toBe(later + 60_000);
  });

  it('refuses past the day’s limit, saying how many still fit', async () => {
    const today = new Date(NOW - 60 * 60_000).toISOString();
    const t = world({
      scheduled_messages: Array.from({ length: BULK_DAILY_LIMIT - 1 }, () => ({
        account_id: ACC,
        bulk_send_id: 'old',
        status: 'sent',
        send_at: today,
      })),
    });
    const err = await createBulkSend(fakeDb(t), fakeDb(t), ACC, 'u1', input(), { dryRun: true }, deps).catch((e) => e);
    expect(err).toBeInstanceOf(BulkError);
    expect(err.code).toBe('daily_limit');
    expect(err.message).toMatch(/Hoje ainda cabem 1 envios/);
  });

  it('is for the QR-code number only', async () => {
    route.provider = 'meta';
    expect(await fails(createBulkSend(fakeDb(world()), fakeDb(world()), ACC, 'u1', input(), { dryRun: true }, deps))).toBe(
      '409 unavailable',
    );
    route.provider = null;
    expect(await fails(createBulkSend(fakeDb(world()), fakeDb(world()), ACC, 'u1', input(), { dryRun: true }, deps))).toBe(
      '409 unavailable',
    );
  });

  it('needs the risk accepted to go, not to preview', async () => {
    const t = world();
    expect(await fails(createBulkSend(fakeDb(t), fakeDb(t), ACC, 'u1', input({ riskAccepted: false }), { dryRun: false }, deps))).toBe(
      '400 risk_not_accepted',
    );
    expect(t.bulk_sends).toHaveLength(0);
  });

  it('refuses when nobody of this CRM is in the audience', async () => {
    expect(
      await fails(
        createBulkSend(fakeDb(world()), fakeDb(world()), ACC, 'u1', input({ audience: { phones: ['5541900000000'] } }), { dryRun: true }, deps),
      ),
    ).toBe('400 empty');
  });
});

describe('listBulkSends and stopBulkSend', () => {
  it('shows how far each got, and stopping cancels only what is waiting', async () => {
    const t = world({
      bulk_sends: [{ id: 'b1', account_id: ACC, name: 'Novembro', total: 3, created_at: '2026-11-10T13:00:00Z', stopped_at: null }],
      scheduled_messages: [
        { id: 'm1', account_id: ACC, bulk_send_id: 'b1', status: 'sent' },
        { id: 'm2', account_id: ACC, bulk_send_id: 'b1', status: 'scheduled' },
        { id: 'm3', account_id: ACC, bulk_send_id: 'b1', status: 'scheduled' },
      ],
    });
    expect((await listBulkSends(fakeDb(t), ACC))[0].counts).toMatchObject({ sent: 1, scheduled: 2 });
    expect(await stopBulkSend(fakeDb(t), ACC, 'b1')).toEqual({ stopped: 2 });
    expect(t.scheduled_messages.map((m) => m.status)).toEqual(['sent', 'cancelled', 'cancelled']);
    expect(t.bulk_sends[0].stopped_at).toBeTruthy();
  });
});
