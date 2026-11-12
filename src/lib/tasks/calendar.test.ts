import { describe, expect, it } from 'vitest';

import { googleCalendarUrl, taskEventDetails } from './calendar';

describe('googleCalendarUrl', () => {
  it('fills in the title, a 30-minute slot in UTC and the details', () => {
    const url = new URL(
      googleCalendarUrl({
        title: 'Ligar para a Ana',
        start: '2026-11-12T09:00:00-03:00',
        details: 'Contato: Ana · +5511999998888',
      })!,
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Ligar para a Ana');
    expect(url.searchParams.get('dates')).toBe('20261112T120000Z/20261112T123000Z');
    expect(url.searchParams.get('details')).toBe('Contato: Ana · +5511999998888');
  });

  it('leaves the details out when there are none', () => {
    const url = new URL(googleCalendarUrl({ title: 'x', start: '2026-11-12T12:00:00Z' })!);
    expect(url.searchParams.has('details')).toBe(false);
  });

  it('is null without a title or a date', () => {
    expect(googleCalendarUrl({ title: ' ', start: '2026-11-12T12:00:00Z' })).toBeNull();
    expect(googleCalendarUrl({ title: 'x', start: null })).toBeNull();
    expect(googleCalendarUrl({ title: 'x', start: 'amanhã' })).toBeNull();
  });
});

describe('taskEventDetails', () => {
  it('names the contact and the way back to the CRM', () => {
    expect(
      taskEventDetails({ name: 'Ana', phone: '+5511999998888', url: 'https://crm/contacts?contact=1' }),
    ).toBe('Contato: Ana · +5511999998888\nNo CRM: https://crm/contacts?contact=1');
    expect(taskEventDetails({})).toBe('');
  });
});
