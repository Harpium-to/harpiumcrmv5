import { describe, expect, it } from 'vitest';

import { orderScheduled } from './contact-scheduled';

const item = (id: string, status: string, send_at: string) => ({
  id,
  status,
  send_at,
  content_text: id,
  media_kind: null,
  media_filename: null,
  only_if_no_reply: false,
  outcome: null,
});

describe('orderScheduled', () => {
  it('puts what is waiting first, soonest first, then the last few done', () => {
    const out = orderScheduled([
      item('enviada-velha', 'sent', '2026-11-01T10:00:00Z'),
      item('depois', 'scheduled', '2026-11-20T10:00:00Z'),
      item('cancelada', 'cancelled', '2026-11-08T10:00:00Z'),
      item('logo', 'scheduled', '2026-11-11T10:00:00Z'),
      item('enviando', 'sending', '2026-11-10T10:00:00Z'),
    ]);
    expect(out.map((m) => m.id)).toEqual(['enviando', 'logo', 'depois', 'cancelada', 'enviada-velha']);
  });

  it('keeps only the 5 latest done', () => {
    const done = Array.from({ length: 8 }, (_, i) =>
      item(`d${i}`, 'sent', `2026-11-0${i + 1}T10:00:00Z`),
    );
    expect(orderScheduled(done).map((m) => m.id)).toEqual(['d7', 'd6', 'd5', 'd4', 'd3']);
  });
});
