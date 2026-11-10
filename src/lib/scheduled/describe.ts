import { describeDue } from '@/lib/tasks/due';

// ============================================================
// One line about a scheduled message (migration 064), the way a person
// would say it: "amanhã às 09:00 · se não responder", "enviada · hoje
// às 14:00", "não enviada: o cliente respondeu antes…".
//
// The Chrome extension lists the same messages and has a copy of this
// rule in extension/format.js (`describeScheduled`); a test keeps the
// two saying the same thing.
// ============================================================

export interface ScheduledLike {
  status?: string | null;
  send_at?: string | null;
  only_if_no_reply?: boolean | null;
  outcome?: string | null;
}

export function describeScheduled(item: ScheduledLike, now: Date = new Date()): string {
  const due = describeDue(item?.send_at, now);
  const when = due ? due.label.replace(/^atrasada · /, '') : '';
  switch (item?.status) {
    case 'scheduled': {
      const base = due && due.tone === 'overdue' ? 'sai em instantes' : when;
      return item.only_if_no_reply ? `${base} · se não responder` : base;
    }
    case 'sending':
      return 'enviando';
    case 'sent':
      return when ? `enviada · ${when}` : 'enviada';
    case 'skipped':
      return `não enviada: ${item.outcome || 'o cliente respondeu antes'}`;
    case 'cancelled':
      return 'cancelada';
    case 'failed':
      return `não saiu: ${item.outcome || 'erro no envio'}`;
    default:
      return when;
  }
}
