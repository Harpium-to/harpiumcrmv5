import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { emitTaskReminders } from './reminders';

const dbAnswering = (answer: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(answer) }) as unknown as SupabaseClient;

describe('emitTaskReminders', () => {
  it('returns how many reminders went out', async () => {
    const db = dbAnswering({ data: 3, error: null });
    expect(await emitTaskReminders(db)).toBe(3);
    expect(db.rpc).toHaveBeenCalledWith('emit_task_reminders');
    expect(await emitTaskReminders(dbAnswering({ data: '2', error: null }))).toBe(2);
    expect(await emitTaskReminders(dbAnswering({ data: null, error: null }))).toBe(0);
  });

  it('returns null, quietly, on a database without migration 060', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = dbAnswering({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    expect(await emitTaskReminders(db)).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('returns null and logs on any other failure, without throwing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await emitTaskReminders(dbAnswering({ data: null, error: { code: '57014', message: 'timeout' } }))
    ).toBeNull();
    const throwing = { rpc: vi.fn().mockRejectedValue(new Error('rede')) } as unknown as SupabaseClient;
    expect(await emitTaskReminders(throwing)).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
