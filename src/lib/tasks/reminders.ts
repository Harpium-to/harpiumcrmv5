// ============================================================
// Reminders for tasks that came due (migration 060).
//
// The work is one database function, `emit_task_reminders()`: it picks
// the due tasks, stamps them and writes a notification for whoever
// each is for, in a single statement — so overlapping runs cannot
// remind twice. This is only the call.
//
// It runs from the automations scheduler (/api/automations/cron)
// rather than a route of its own: that scheduler is already set up
// wherever the CRM is hosted, and a reminder that needs a second job
// configured is a reminder nobody gets.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isMissingFunction } from '@/lib/auth/account-context';

/**
 * Send the reminders that are due. Returns how many notifications were
 * written, or `null` when it could not run — migration 060 not applied
 * yet, or an error (logged). It never throws: a reminder problem must
 * not stop the automations that share the schedule.
 */
export async function emitTaskReminders(db: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await db.rpc('emit_task_reminders');
    if (error) {
      if (!isMissingFunction(error)) {
        console.error('[tasks/reminders] emit_task_reminders error:', error);
      }
      return null;
    }
    return typeof data === 'number' ? data : Number(data) || 0;
  } catch (error) {
    console.error('[tasks/reminders] emit_task_reminders threw:', error);
    return null;
  }
}
