import { describe, expect, it } from 'vitest';

import type { ContactTask } from '@/types';

import { sortTasks } from './contact-tasks';

const task = (id: string, extra: Partial<ContactTask> = {}): ContactTask => ({
  id,
  contact_id: 'c1',
  title: id,
  due_at: null,
  done_at: null,
  assigned_to: 'u1',
  created_at: '2026-11-01T10:00:00Z',
  ...extra,
});

describe('sortTasks', () => {
  it('puts open tasks first, soonest first, with undated ones after the dated', () => {
    const sorted = sortTasks([
      task('sem data'),
      task('depois', { due_at: '2026-11-20T10:00:00Z' }),
      task('feita', { done_at: '2026-11-05T10:00:00Z', due_at: '2026-11-01T10:00:00Z' }),
      task('antes', { due_at: '2026-11-12T10:00:00Z' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['antes', 'depois', 'sem data', 'feita']);
  });

  it('orders undated tasks by when they were written, and done ones newest first', () => {
    const sorted = sortTasks([
      task('nova', { created_at: '2026-11-09T10:00:00Z' }),
      task('velha', { created_at: '2026-11-02T10:00:00Z' }),
      task('feita antes', { done_at: '2026-11-03T10:00:00Z' }),
      task('feita agora', { done_at: '2026-11-10T10:00:00Z' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['velha', 'nova', 'feita agora', 'feita antes']);
  });

  it('does not change the list it was given', () => {
    const tasks = [task('b', { due_at: '2026-11-20T10:00:00Z' }), task('a', { due_at: '2026-11-12T10:00:00Z' })];
    sortTasks(tasks);
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});
