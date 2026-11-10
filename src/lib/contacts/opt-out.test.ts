import { describe, expect, it } from 'vitest';

import { isOptedOut } from './opt-out';

describe('isOptedOut', () => {
  it('is true only with a date', () => {
    expect(isOptedOut({ opted_out_at: '2026-11-10T15:00:00Z' })).toBe(true);
    expect(isOptedOut({ opted_out_at: null })).toBe(false);
    expect(isOptedOut({})).toBe(false); // before migration 066
    expect(isOptedOut(null)).toBe(false);
  });
});
