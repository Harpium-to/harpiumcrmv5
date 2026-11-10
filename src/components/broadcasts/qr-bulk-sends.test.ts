import { describe, expect, it } from 'vitest';

import { describeBulkProgress } from './qr-bulk-sends';

const counts = (over: Partial<Record<string, number>> = {}) => ({
  scheduled: 0,
  sending: 0,
  sent: 0,
  skipped: 0,
  cancelled: 0,
  failed: 0,
  ...over,
});

describe('describeBulkProgress', () => {
  it('says how far it got while running', () => {
    expect(describeBulkProgress({ total: 40, stopped_at: null, counts: counts({ sent: 12, scheduled: 27, failed: 1 }) })).toBe(
      'enviadas 12 de 40 · 1 falhou · 27 na fila',
    );
  });

  it('says when it is done, or was stopped', () => {
    expect(describeBulkProgress({ total: 2, stopped_at: null, counts: counts({ sent: 2 }) })).toBe(
      'enviadas 2 de 2 · concluído',
    );
    expect(
      describeBulkProgress({ total: 10, stopped_at: '2026-11-10T15:00:00Z', counts: counts({ sent: 3, cancelled: 7 }) }),
    ).toBe('enviadas 3 de 10 · 7 canceladas · parado');
  });
});
