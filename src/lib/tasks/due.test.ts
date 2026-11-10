import { describe, expect, it } from 'vitest';

import { countDueNow, describeDue } from './due';

// Built from local parts, so the test says the same in any time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts: Parameters<typeof at>) => at(...parts).toISOString();
const now = at(2026, 11, 10, 12, 0);

describe('describeDue', () => {
  it('says today, tomorrow, and a date after that', () => {
    expect(describeDue(iso(2026, 11, 10, 14, 0), now)).toEqual({ label: 'hoje às 14:00', tone: 'today' });
    expect(describeDue(iso(2026, 11, 11, 9, 5), now)).toEqual({ label: 'amanhã às 09:05', tone: 'later' });
    expect(describeDue(iso(2026, 11, 20, 16, 30), now)).toEqual({ label: '20/11 às 16:30', tone: 'later' });
  });

  it('adds the year only when it is another year', () => {
    expect(describeDue(iso(2027, 1, 5, 10, 0), now)?.label).toBe('05/01/2027 às 10:00');
  });

  it('marks what is already late', () => {
    expect(describeDue(iso(2026, 11, 10, 9, 0), now)).toEqual({
      label: 'atrasada · hoje às 09:00',
      tone: 'overdue',
    });
    expect(describeDue(iso(2026, 11, 9, 16, 30), now)?.label).toBe('atrasada · ontem às 16:30');
    expect(describeDue(iso(2026, 11, 3, 8, 0), now)?.label).toBe('atrasada · 03/11 às 08:00');
  });

  it('counts calendar days, not 24-hour spans', () => {
    const lateEvening = at(2026, 11, 10, 23, 30);
    expect(describeDue(iso(2026, 11, 11, 0, 30), lateEvening)?.label).toBe('amanhã às 00:30');
  });

  it('has nothing to say about no date, or one it cannot read', () => {
    expect(describeDue(null, now)).toBeNull();
    expect(describeDue(undefined, now)).toBeNull();
    expect(describeDue('', now)).toBeNull();
    expect(describeDue('não é data', now)).toBeNull();
  });
});

describe('countDueNow', () => {
  it('counts the open tasks that are late or for today', () => {
    expect(
      countDueNow(
        [
          { due_at: iso(2026, 11, 9, 10, 0) }, // late
          { due_at: iso(2026, 11, 10, 18, 0) }, // today
          { due_at: iso(2026, 11, 12, 10, 0) }, // later
          { due_at: null }, // no date
          { due_at: iso(2026, 11, 9, 10, 0), done_at: iso(2026, 11, 9, 11, 0) }, // done
        ],
        now
      )
    ).toBe(2);
    expect(countDueNow([], now)).toBe(0);
  });
});
