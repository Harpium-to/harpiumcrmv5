import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { FLOW_DAILY_LIMIT, FlowStartError, listManualFlows, startFlow, type FlowStartDeps } from './flows';

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
const FLOW = '44444444-4444-4444-8444-444444444444';
const CONTACT = '55555555-5555-4555-8555-555555555555';
const NOW = Date.parse('2026-11-10T15:00:00Z');

function world(over: Partial<Record<string, Row[]>> = {}) {
  return {
    flows: [
      { id: FLOW, account_id: ACC, user_id: 'u1', name: 'Triagem', description: 'Pergunta o interesse', trigger_type: 'manual', status: 'active', entry_node_id: 'n1' },
      { id: 'kw', account_id: ACC, user_id: 'u1', name: 'Palavra', trigger_type: 'keyword', status: 'active', entry_node_id: 'n1' },
      { id: 'draft', account_id: ACC, user_id: 'u1', name: 'Rascunho', trigger_type: 'manual', status: 'draft', entry_node_id: null },
    ],
    contacts: [{ id: CONTACT, account_id: ACC }],
    conversations: [{ id: 'conv-1', account_id: ACC, contact_id: CONTACT }],
    flow_runs: [],
    ...over,
  } as Record<string, Row[]>;
}

const deps = (result: Awaited<ReturnType<FlowStartDeps['start']>> = { started: true, run_id: 'run-1' }): FlowStartDeps => ({
  start: vi.fn(async () => result),
  now: () => NOW,
});

const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof FlowStartError ? `${err.status} ${err.code}` : String(err);
  }
};

describe('listManualFlows', () => {
  it('lists only the active manual flows', async () => {
    expect(await listManualFlows(fakeDb(world()), ACC)).toEqual([
      { id: FLOW, name: 'Triagem', description: 'Pergunta o interesse' },
    ]);
  });
});

describe('startFlow', () => {
  it('starts it on the contact, in its conversation', async () => {
    const d = deps();
    expect(await startFlow(fakeDb(world()), ACC, FLOW, CONTACT, d)).toEqual({ run_id: 'run-1' });
    expect(d.start).toHaveBeenCalledWith(expect.objectContaining({ id: FLOW }), {
      contactId: CONTACT,
      conversationId: 'conv-1',
    });
  });

  it('refuses a flow of another account, or one that is not manual', async () => {
    expect(await fails(startFlow(fakeDb(world()), 'acc-2', FLOW, CONTACT, deps()))).toBe('404 not_found');
    expect(await fails(startFlow(fakeDb(world()), ACC, 'kw', CONTACT, deps()))).toBe('404 not_found');
  });

  it('refuses a contact who opted out', async () => {
    const t = world({ contacts: [{ id: CONTACT, account_id: ACC, opted_out_at: '2026-11-09T10:00:00Z' }] });
    expect(await fails(startFlow(fakeDb(t), ACC, FLOW, CONTACT, deps()))).toBe('409 opted_out');
  });

  it('refuses a flow that is not active', async () => {
    expect(await fails(startFlow(fakeDb(world()), ACC, 'draft', CONTACT, deps()))).toBe('409 inactive');
  });

  it('refuses another account’s contact, or one without a conversation', async () => {
    expect(
      await fails(startFlow(fakeDb(world({ contacts: [{ id: CONTACT, account_id: 'acc-2' }] })), ACC, FLOW, CONTACT, deps())),
    ).toBe('404 contact_not_found');
    expect(await fails(startFlow(fakeDb(world({ conversations: [] })), ACC, FLOW, CONTACT, deps()))).toBe(
      '409 no_conversation',
    );
  });

  it('says so when a flow is already running, or the flow has no entry', async () => {
    expect(
      await fails(startFlow(fakeDb(world()), ACC, FLOW, CONTACT, deps({ started: false, reason: 'already_running' }))),
    ).toBe('409 already_running');
    expect(
      await fails(startFlow(fakeDb(world()), ACC, FLOW, CONTACT, deps({ started: false, reason: 'no_entry' }))),
    ).toBe('422 invalid_flow');
  });

  it('stops at the daily limit of manual starts, counting the last 24 hours', async () => {
    const recent = new Date(NOW - 60 * 60 * 1000).toISOString();
    const old = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    const runs = (n: number, at: string, flow = FLOW) =>
      Array.from({ length: n }, () => ({ account_id: ACC, flow_id: flow, started_at: at }));
    expect(
      await fails(startFlow(fakeDb(world({ flow_runs: runs(FLOW_DAILY_LIMIT, recent) })), ACC, FLOW, CONTACT, deps())),
    ).toBe('429 daily_limit');
    // Runs of flows that start by themselves don't count.
    const mixed = world({ flow_runs: [...runs(FLOW_DAILY_LIMIT, recent, 'kw'), ...runs(FLOW_DAILY_LIMIT, old)] });
    expect(await startFlow(fakeDb(mixed), ACC, FLOW, CONTACT, deps())).toEqual({ run_id: 'run-1' });
  });
});
