import { describe, expect, it } from 'vitest';

import {
  BULK_DAILY_LIMIT,
  BULK_GAP_MAX_S,
  BULK_GAP_MIN_S,
  checkDailyLimit,
  dayKey,
  drawGapMs,
  planSendTimes,
} from './plan';

describe('drawGapMs', () => {
  it('stays between 30 and 90 seconds', () => {
    expect(drawGapMs(() => 0)).toBe(BULK_GAP_MIN_S * 1000);
    expect(drawGapMs(() => 1)).toBe(BULK_GAP_MAX_S * 1000);
    expect(drawGapMs(() => 0.5)).toBe(60_000);
    // A broken random can't push it out of range.
    expect(drawGapMs(() => 7)).toBe(BULK_GAP_MAX_S * 1000);
  });
});

describe('planSendTimes', () => {
  it('spaces each send one gap after the previous', () => {
    const start = Date.parse('2026-11-10T13:00:00Z');
    const times = planSendTimes(3, start, () => 0.5);
    expect(times).toEqual([start + 60_000, start + 120_000, start + 180_000]);
  });

  it('never sends two closer than the minimum gap', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const times = planSendTimes(200, 0, random);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(BULK_GAP_MIN_S * 1000);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(BULK_GAP_MAX_S * 1000);
    }
  });
});

describe('dayKey', () => {
  it('is the day in Brasília', () => {
    expect(dayKey(Date.parse('2026-11-10T13:00:00Z'))).toBe('2026-11-10');
    // 01:00 UTC on the 11th is still the 10th in Brasília.
    expect(dayKey(Date.parse('2026-11-11T01:00:00Z'))).toBe('2026-11-10');
  });
});

describe('checkDailyLimit', () => {
  const at = (iso: string, n: number) => Array.from({ length: n }, () => Date.parse(iso));

  it('lets a send through while the day has room', () => {
    expect(checkDailyLimit(at('2026-11-10T13:00:00Z', 50), { '2026-11-10': 150 })).toEqual({ ok: true });
  });

  it('says how many more fit when the day would overflow', () => {
    expect(checkDailyLimit(at('2026-11-10T13:00:00Z', 60), { '2026-11-10': 150 })).toEqual({
      ok: false,
      day: '2026-11-10',
      room: 50,
    });
  });

  it('counts each day on its own', () => {
    const planned = [...at('2026-11-10T13:00:00Z', 100), ...at('2026-11-11T13:00:00Z', 100)];
    expect(checkDailyLimit(planned, { '2026-11-10': 100, '2026-11-11': 0 })).toEqual({ ok: true });
    expect(checkDailyLimit(at('2026-11-11T13:00:00Z', BULK_DAILY_LIMIT + 1), {})).toMatchObject({
      ok: false,
      room: BULK_DAILY_LIMIT,
    });
  });
});
