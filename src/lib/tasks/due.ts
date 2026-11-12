// ============================================================
// When a task is due, said the way a person would: "hoje às 14:00",
// "amanhã às 09:00", "atrasada · ontem às 16:30".
//
// Pure, in the viewer's own time zone. The Chrome extension shows the
// same tasks and has a copy of this rule in extension/format.js; a test
// keeps the two saying the same thing.
// ============================================================

export type DueTone = 'overdue' | 'today' | 'later';

export interface DueLabel {
  label: string;
  tone: DueTone;
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Describe `dueAt` (an ISO date-time) as seen at `now`. `null` for a
 * task with no date, or a date that cannot be read.
 */
export function describeDue(dueAt: string | null | undefined, now: Date = new Date()): DueLabel | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) return null;

  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Calendar days apart, not 24-hour spans: 23:00 today to 01:00
  // tomorrow is "amanhã". Rounded because a DST change makes a day 23
  // or 25 hours long.
  const days = Math.round((dayOf(due) - dayOf(now)) / 86_400_000);

  const time = `${two(due.getHours())}:${two(due.getMinutes())}`;
  const date =
    `${two(due.getDate())}/${two(due.getMonth() + 1)}` +
    (due.getFullYear() === now.getFullYear() ? '' : `/${due.getFullYear()}`);
  const day = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : days === -1 ? 'ontem' : date;
  const when = `${day} às ${time}`;

  if (due.getTime() < now.getTime()) return { label: `atrasada · ${when}`, tone: 'overdue' };
  return { label: when, tone: days === 0 ? 'today' : 'later' };
}

/**
 * How many of `tasks` want attention now: open, and due today or
 * already late. What the reminder badge counts.
 */
export function countDueNow(
  tasks: ReadonlyArray<{ due_at?: string | null; done_at?: string | null }>,
  now: Date = new Date()
): number {
  return tasks.filter((task) => {
    if (task.done_at) return false;
    const due = describeDue(task.due_at, now);
    return due !== null && due.tone !== 'later';
  }).length;
}
