import { describe, expect, it } from 'vitest';

import {
  TASK_TITLE_MAX,
  isMissingTasksTable,
  parseTaskCreate,
  parseTaskPatch,
  parseTaskStatus,
  serializeTask,
} from './tasks';

describe('parseTaskCreate', () => {
  it('takes a title, trimmed, with no date by default', () => {
    expect(parseTaskCreate({ title: '  Ligar na quinta ' })).toEqual({
      ok: true,
      values: { title: 'Ligar na quinta', due_at: null },
    });
  });

  it('stores the date in UTC whatever offset it came with', () => {
    expect(parseTaskCreate({ title: 'Ligar', due_at: '2026-11-12T14:00:00-03:00' })).toEqual({
      ok: true,
      values: { title: 'Ligar', due_at: '2026-11-12T17:00:00.000Z' },
    });
    expect(parseTaskCreate({ title: 'Ligar', due_at: '2026-11-12T17:00Z' })).toMatchObject({
      values: { due_at: '2026-11-12T17:00:00.000Z' },
    });
    expect(parseTaskCreate({ title: 'Ligar', due_at: null })).toMatchObject({
      values: { due_at: null },
    });
  });

  it('refuses a missing, empty or too long title', () => {
    for (const body of [null, 'x', [], {}, { title: '' }, { title: '   ' }, { title: 7 }]) {
      expect(parseTaskCreate(body).ok).toBe(false);
    }
    expect(parseTaskCreate({ title: 'a'.repeat(TASK_TITLE_MAX) }).ok).toBe(true);
    expect(parseTaskCreate({ title: 'a'.repeat(TASK_TITLE_MAX + 1) }).ok).toBe(false);
  });

  it('refuses a date with no time or no offset, instead of guessing the hour', () => {
    for (const due_at of ['2026-11-12', '2026-11-12T14:00:00', '12/11/2026 14:00', 'amanhã', 1731420000, '2026-13-45T10:00:00Z']) {
      expect(parseTaskCreate({ title: 'Ligar', due_at }).ok, String(due_at)).toBe(false);
    }
  });
});

describe('parseTaskPatch', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');

  it('writes only the keys present', () => {
    expect(parseTaskPatch({}, now)).toEqual({ ok: true, values: {} });
    expect(parseTaskPatch({ title: ' Retornar ' }, now)).toEqual({
      ok: true,
      values: { title: 'Retornar' },
    });
    expect(parseTaskPatch({ due_at: null, ignored: 1 }, now)).toEqual({
      ok: true,
      values: { due_at: null },
    });
  });

  it('turns done into a timestamp, and back into none', () => {
    expect(parseTaskPatch({ done: true }, now)).toEqual({
      ok: true,
      values: { done_at: '2026-11-10T12:00:00.000Z' },
    });
    expect(parseTaskPatch({ done: false }, now)).toEqual({ ok: true, values: { done_at: null } });
  });

  it('refuses the wrong types', () => {
    expect(parseTaskPatch({ done: 'sim' }, now).ok).toBe(false);
    expect(parseTaskPatch({ title: '' }, now).ok).toBe(false);
    expect(parseTaskPatch({ due_at: '2026-11-12' }, now).ok).toBe(false);
    expect(parseTaskPatch(null, now).ok).toBe(false);
  });
});

describe('parseTaskStatus', () => {
  it('defaults to open', () => {
    expect(parseTaskStatus(null)).toBe('open');
    expect(parseTaskStatus('qualquer')).toBe('open');
    expect(parseTaskStatus('done')).toBe('done');
    expect(parseTaskStatus('all')).toBe('all');
  });
});

describe('serializeTask', () => {
  const row = {
    id: 't1',
    title: 'Ligar na quinta',
    due_at: '2026-11-12T17:00:00+00:00',
    done_at: null,
    contact_id: 'c1',
    assigned_to: 'u1',
    created_by: 'u1',
    account_id: 'acc', // internal — must not leak
    reminded_at: null,
    created_at: '2026-11-10T12:00:00+00:00',
    contact: { id: 'c1', name: 'Maria Souza', phone: '+5531999998888', email: 'm@x.y' },
  };

  it('projects the public shape, with who it is for and whose it is about', () => {
    expect(serializeTask(row, new Map([['u1', 'Ana Lima']]))).toEqual({
      id: 't1',
      title: 'Ligar na quinta',
      due_at: '2026-11-12T17:00:00+00:00',
      done_at: null,
      contact_id: 'c1',
      contact: { id: 'c1', name: 'Maria Souza', phone: '+5531999998888' },
      assigned_to: { id: 'u1', name: 'Ana Lima' },
      created_at: '2026-11-10T12:00:00+00:00',
    });
  });

  it('copes with nobody assigned and no contact embed', () => {
    const out = serializeTask({ ...row, assigned_to: null, contact: null }, new Map());
    expect(out.assigned_to).toBeNull();
    expect(out.contact).toBeNull();
  });
});

describe('isMissingTasksTable', () => {
  it('recognises a database without migration 060', () => {
    expect(isMissingTasksTable({ code: '42P01' })).toBe(true);
    expect(isMissingTasksTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTasksTable({ code: '23514' })).toBe(false);
    expect(isMissingTasksTable(null)).toBe(false);
  });
});
