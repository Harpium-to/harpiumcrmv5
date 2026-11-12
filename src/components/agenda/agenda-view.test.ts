import { describe, expect, it } from 'vitest';

import type { AgendaCalendar, AgendaEvent } from '@/types';

import { defaultStart, gridRange } from './agenda-view';
import { splitContactEvents } from './contact-appointments';
import { cleanSearchTerm, contactLine } from './contact-picker';
import { eventLabel, eventTime, placeEvents, type GridColumn } from './time-grid';

const SP = 'America/Sao_Paulo';
const MONDAY = '2030-01-07';

const calendar: AgendaCalendar = {
  id: 'c1',
  account_id: 'a',
  name: 'Dr. João',
  color: '#3b82f6',
  slot_minutes: 30,
  timezone: SP,
  is_active: true,
  confirm_enabled: false,
  confirm_text: null,
  confirm_template: null,
  confirm_template_language: null,
  reminder_enabled: false,
  reminder_hours: 24,
  reminder_text: null,
  reminder_template: null,
  reminder_template_language: null,
  public_enabled: false,
  public_auto_confirm: true,
  public_token: 'p'.repeat(64),
  feed_enabled: false,
  feed_token: 'f'.repeat(64),
  created_at: '',
};

const WEEK = [
  { weekday: 1, starts: '08:00:00', ends: '12:00:00' },
  { weekday: 1, starts: '14:00:00', ends: '18:00:00' },
];

const column: GridColumn = {
  key: MONDAY,
  calendar,
  dayKey: MONDAY,
  hours: WEEK,
  title: 'seg, 7 jan',
  isToday: false,
};

const event = (start: string, end: string, extra: Partial<AgendaEvent> = {}): AgendaEvent => ({
  id: `${start}-${end}`,
  calendar_id: 'c1',
  kind: 'appointment',
  contact_id: null,
  title: null,
  notes: null,
  // São Paulo wall-clock times, to keep the cases readable.
  starts_at: new Date(`${start}:00-03:00`).toISOString(),
  ends_at: new Date(`${end}:00-03:00`).toISOString(),
  status: 'scheduled',
  source: 'team',
  notify: true,
  confirmation_at: null,
  confirmation_error: null,
  reminder_at: null,
  reminder_error: null,
  created_at: '',
  ...extra,
});

describe('placeEvents', () => {
  const range: [number, number] = [8 * 60, 18 * 60];

  it('puts an event where its time is, an hour being 56px', () => {
    const [placed] = placeEvents(column, [event(`${MONDAY}T09:00`, `${MONDAY}T10:00`)], range);
    expect(placed.top).toBe(56);
    expect(placed.height).toBe(56);
  });

  it('keeps a very short event tall enough to click', () => {
    const [placed] = placeEvents(column, [event(`${MONDAY}T09:00`, `${MONDAY}T09:05`)], range);
    expect(placed.height).toBe(22);
  });

  it('cuts a block that runs for days to the part inside this day', () => {
    const block = event('2030-01-05T00:00', '2030-01-12T00:00', { kind: 'block' });
    const [placed] = placeEvents(column, [block], range);
    expect(placed.top).toBe(0);
    expect(placed.height).toBe(10 * 56);
  });

  it('leaves out other days and other agendas', () => {
    expect(
      placeEvents(
        column,
        [
          event('2030-01-08T09:00', '2030-01-08T10:00'),
          event(`${MONDAY}T09:00`, `${MONDAY}T10:00`, { calendar_id: 'c2' }),
          event(`${MONDAY}T06:00`, `${MONDAY}T07:00`), // before the grid starts
        ],
        range,
      ),
    ).toEqual([]);
  });
});

describe('eventTime / eventLabel', () => {
  it('shows the clock on the agenda’s zone', () => {
    expect(eventTime(event(`${MONDAY}T09:00`, `${MONDAY}T09:30`), column)).toBe('09:00 – 09:30');
  });

  it('says "Dia inteiro" when the event covers the whole day', () => {
    expect(eventTime(event('2030-01-05T00:00', '2030-01-12T00:00'), column)).toBe('Dia inteiro');
    expect(eventTime(event(`${MONDAY}T00:00`, '2030-01-08T00:00'), column)).toBe('Dia inteiro');
  });

  it('names an appointment by contact, then phone, then title', () => {
    const base = event(`${MONDAY}T09:00`, `${MONDAY}T09:30`, { title: 'Retorno' });
    expect(eventLabel({ ...base, contact: { id: 'k', name: 'Ana', phone: '55119' } })).toBe('Ana');
    expect(eventLabel({ ...base, contact: { id: 'k', name: null, phone: '55119' } })).toBe('55119');
    expect(eventLabel(base)).toBe('Retorno');
    expect(eventLabel({ ...base, title: null })).toBe('Sem contato');
  });

  it('names a block by its reason', () => {
    const block = event(`${MONDAY}T12:00`, `${MONDAY}T14:00`, { kind: 'block' });
    expect(eventLabel(block)).toBe('Bloqueado');
    expect(eventLabel({ ...block, title: 'Férias' })).toBe('Férias');
  });
});

describe('gridRange', () => {
  it('is the opening hours when everything fits inside them', () => {
    expect(gridRange([column], [event(`${MONDAY}T09:00`, `${MONDAY}T09:30`)])).toEqual([480, 1080]);
  });

  it('stretches to show an encaixe outside them', () => {
    expect(
      gridRange(
        [column],
        [event(`${MONDAY}T06:30`, `${MONDAY}T07:00`), event(`${MONDAY}T19:00`, `${MONDAY}T19:30`)],
      ),
    ).toEqual([360, 1200]);
  });

  it('is not stretched by a block or by another day', () => {
    expect(
      gridRange(
        [column],
        [
          event('2030-01-05T00:00', '2030-01-12T00:00', { kind: 'block' }),
          event('2030-01-08T21:00', '2030-01-08T22:00'),
        ],
      ),
    ).toEqual([480, 1080]);
  });
});

describe('defaultStart', () => {
  const at = (time: string) => new Date(`${MONDAY}T${time}:00-03:00`);

  it('today: the next slot from now', () => {
    expect(defaultStart(calendar, WEEK, MONDAY, at('09:10')).toISOString()).toBe(
      at('09:30').toISOString(),
    );
    // Exactly on a boundary still moves on: that slot has already begun.
    expect(defaultStart(calendar, WEEK, MONDAY, at('09:30')).toISOString()).toBe(
      at('10:00').toISOString(),
    );
  });

  it('another day: when the agenda opens', () => {
    expect(defaultStart(calendar, WEEK, '2030-01-14', at('09:10')).toISOString()).toBe(
      new Date('2030-01-14T08:00:00-03:00').toISOString(),
    );
  });

  it('a day the agenda is closed: 08:00', () => {
    expect(defaultStart(calendar, WEEK, '2030-01-08', at('09:10')).toISOString()).toBe(
      new Date('2030-01-08T08:00:00-03:00').toISOString(),
    );
  });
});

describe('contact search', () => {
  it('drops what would rewrite the filter', () => {
    expect(cleanSearchTerm('  ana,phone.eq.(1)%  ')).toBe('ana phone.eq. 1');
    expect(cleanSearchTerm('Ana   Souza')).toBe('Ana Souza');
  });

  it('shows a contact as name and phone', () => {
    expect(contactLine({ id: 'k', name: 'Ana', phone: '55119' })).toBe('Ana · 55119');
    expect(contactLine({ id: 'k', name: null, phone: '55119' })).toBe('55119');
    expect(contactLine({ id: 'k', name: ' ', phone: null })).toBe('Contato sem nome');
  });
});

describe('splitContactEvents', () => {
  const now = new Date(`${MONDAY}T12:00:00-03:00`);

  it('lists what is coming soonest first, and the recent past newest first', () => {
    const events = [
      event('2030-01-20T09:00', '2030-01-20T09:30'),
      event('2030-01-08T09:00', '2030-01-08T09:30'),
      event('2030-01-02T09:00', '2030-01-02T09:30', { status: 'done' }),
      event('2030-01-05T09:00', '2030-01-05T09:30', { status: 'no_show' }),
    ];
    const { upcoming, past } = splitContactEvents(events, now);
    expect(upcoming.map((e) => e.starts_at.slice(0, 10))).toEqual(['2030-01-08', '2030-01-20']);
    expect(past.map((e) => e.starts_at.slice(0, 10))).toEqual(['2030-01-05', '2030-01-02']);
  });

  it('one that is happening right now is still coming', () => {
    const { upcoming } = splitContactEvents([event(`${MONDAY}T11:45`, `${MONDAY}T12:15`)], now);
    expect(upcoming).toHaveLength(1);
  });

  it('a cancelled future one is history, and history keeps only the last three', () => {
    const { upcoming, past } = splitContactEvents(
      [
        event('2030-01-20T09:00', '2030-01-20T09:30', { status: 'cancelled' }),
        event('2030-01-01T09:00', '2030-01-01T09:30'),
        event('2030-01-02T09:00', '2030-01-02T09:30'),
        event('2030-01-03T09:00', '2030-01-03T09:30'),
      ],
      now,
    );
    expect(upcoming).toEqual([]);
    expect(past.map((e) => e.starts_at.slice(0, 10))).toEqual([
      '2030-01-20',
      '2030-01-03',
      '2030-01-02',
    ]);
  });
});
