import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  listSequences,
  SEQUENCE_DAILY_LIMIT,
  SequenceError,
  startSequence,
  stopSequence,
  summarizeSequence,
  type StartDeps,
} from './sequences';

// ---------------------------------------------------------------------
// A small in-memory stand-in for the Supabase query builder: tables of
// rows, filters by eq / in / gte, counts, and updates that return rows.
// ---------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let countOnly = false;
    let limit = Infinity;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const result = () => {
      if (patch) {
        const hit = rows();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      if (countOnly) return { data: null, count: rows().length, error: null };
      return { data: rows().slice(0, limit), error: null };
    };
    const q = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) countOnly = true;
        return q;
      },
      update: (values: Row) => {
        patch = values;
        return q;
      },
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
      gte: (col: string, v: string) => (filters.push((r) => String(r[col]) >= v), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const ACC = 'acc-1';
const SEQ = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-10T15:00:00Z');

function world(over: Partial<Record<string, Row[]>> = {}) {
  return {
    automations: [
      { id: SEQ, account_id: ACC, user_id: 'u1', name: 'Follow-up', description: 'Três toques', trigger_type: 'manual', trigger_config: { stop_on_reply: true }, is_active: true },
      { id: 'other', account_id: ACC, user_id: 'u1', name: 'Boas-vindas', trigger_type: 'first_inbound_message', is_active: true },
    ],
    automation_steps: [
      { automation_id: SEQ, step_type: 'send_message', step_config: { text: 'Oi' }, parent_step_id: null, position: 0 },
      { automation_id: SEQ, step_type: 'wait', step_config: { amount: 1, unit: 'days' }, parent_step_id: null, position: 1 },
      { automation_id: SEQ, step_type: 'send_message', step_config: { text: 'E aí?' }, parent_step_id: null, position: 2 },
      { automation_id: SEQ, step_type: 'add_tag', step_config: { tag_id: 't' }, parent_step_id: null, position: 3 },
    ],
    contacts: [{ id: CONTACT, account_id: ACC }],
    conversations: [{ id: 'conv-1', account_id: ACC, contact_id: CONTACT }],
    automation_pending_executions: [],
    automation_logs: [],
    ...over,
  } as Record<string, Row[]>;
}

const deps = (): StartDeps => ({ start: vi.fn(async () => 'log-1'), now: () => NOW });

const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof SequenceError ? `${err.status} ${err.code}` : String(err);
  }
};

describe('summarizeSequence', () => {
  it('counts the messages and adds up the waits', () => {
    expect(summarizeSequence(world().automation_steps as never)).toEqual({
      messages: 2,
      duration_minutes: 1440,
    });
  });
});

describe('listSequences', () => {
  it('lists only the active manual automations, and which run for the contact', async () => {
    const tables = world({
      automation_pending_executions: [
        { account_id: ACC, automation_id: SEQ, contact_id: CONTACT, status: 'pending' },
      ],
    });
    expect(await listSequences(fakeDb(tables), ACC, CONTACT)).toEqual([
      {
        id: SEQ,
        name: 'Follow-up',
        description: 'Três toques',
        messages: 2,
        duration_minutes: 1440,
        stop_on_reply: true,
        running: true,
      },
    ]);
    expect((await listSequences(fakeDb(tables), ACC, null))[0].running).toBe(false);
  });
});

describe('startSequence', () => {
  it('starts it on the contact, in its conversation', async () => {
    const d = deps();
    const tables = world();
    expect(await startSequence(fakeDb(tables), ACC, SEQ, CONTACT, d)).toEqual({ log_id: 'log-1' });
    expect(d.start).toHaveBeenCalledWith(expect.objectContaining({ id: SEQ }), {
      accountId: ACC,
      triggerType: 'manual',
      contactId: CONTACT,
      context: { conversation_id: 'conv-1' },
    });
  });

  it('refuses another account’s sequence, or an automation that is not one', async () => {
    expect(await fails(startSequence(fakeDb(world()), 'acc-2', SEQ, CONTACT, deps()))).toBe(
      '404 not_found',
    );
    expect(await fails(startSequence(fakeDb(world()), ACC, 'other', CONTACT, deps()))).toBe(
      '404 not_found',
    );
  });

  it('refuses a sequence that is switched off', async () => {
    const tables = world();
    tables.automations[0].is_active = false;
    expect(await fails(startSequence(fakeDb(tables), ACC, SEQ, CONTACT, deps()))).toBe(
      '409 inactive',
    );
  });

  it('refuses another account’s contact, or one without a conversation', async () => {
    const d = deps();
    expect(
      await fails(startSequence(fakeDb(world({ contacts: [{ id: CONTACT, account_id: 'acc-2' }] })), ACC, SEQ, CONTACT, d)),
    ).toBe('404 contact_not_found');
    expect(await fails(startSequence(fakeDb(world({ conversations: [] })), ACC, SEQ, CONTACT, d))).toBe(
      '409 no_conversation',
    );
    expect(d.start).not.toHaveBeenCalled();
  });

  it('refuses two messages in a row, even if the automation was saved before the rule', async () => {
    const tables = world();
    tables.automation_steps.splice(1, 1); // drop the wait
    expect(await fails(startSequence(fakeDb(tables), ACC, SEQ, CONTACT, deps()))).toBe(
      '422 invalid_sequence',
    );
  });

  it('runs once at a time per contact', async () => {
    const tables = world({
      automation_pending_executions: [
        { account_id: ACC, automation_id: SEQ, contact_id: CONTACT, status: 'pending' },
      ],
    });
    expect(await fails(startSequence(fakeDb(tables), ACC, SEQ, CONTACT, deps()))).toBe(
      '409 already_running',
    );
  });

  it('stops at the daily limit, counting only the last 24 hours', async () => {
    const recent = new Date(NOW - 60 * 60 * 1000).toISOString();
    const old = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    const logs = (n: number, at: string) =>
      Array.from({ length: n }, () => ({ account_id: ACC, trigger_event: 'manual', created_at: at }));

    const full = world({ automation_logs: logs(SEQUENCE_DAILY_LIMIT, recent) });
    expect(await fails(startSequence(fakeDb(full), ACC, SEQ, CONTACT, deps()))).toBe('429 daily_limit');

    const yesterday = world({
      automation_logs: [...logs(SEQUENCE_DAILY_LIMIT, old), ...logs(SEQUENCE_DAILY_LIMIT - 1, recent)],
    });
    expect(await startSequence(fakeDb(yesterday), ACC, SEQ, CONTACT, deps())).toEqual({ log_id: 'log-1' });
  });
});

describe('stopSequence', () => {
  it('drops what was waiting and notes it on the log', async () => {
    const tables = world({
      automation_pending_executions: [
        { account_id: ACC, automation_id: SEQ, contact_id: CONTACT, status: 'pending', log_id: 'log-9' },
        { account_id: ACC, automation_id: SEQ, contact_id: 'someone-else', status: 'pending', log_id: 'log-8' },
      ],
      automation_logs: [
        { id: 'log-9', error_message: null },
        { id: 'log-8', error_message: null },
      ],
    });
    expect(await stopSequence(fakeDb(tables), ACC, SEQ, CONTACT)).toEqual({ stopped: 1 });
    expect(tables.automation_pending_executions.map((r) => r.status)).toEqual(['done', 'pending']);
    expect(tables.automation_logs.map((r) => r.error_message)).toEqual([
      'Parada antes de terminar.',
      null,
    ]);
  });

  it('says 0 when it was not running', async () => {
    expect(await stopSequence(fakeDb(world()), ACC, SEQ, CONTACT)).toEqual({ stopped: 0 });
  });
});
