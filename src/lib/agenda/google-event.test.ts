import { describe, expect, it } from 'vitest'

import {
  buildGoogleEvent,
  googleEventDescription,
  googleEventIdFor,
  googleEventTitle,
  planGoogleSync,
  type ClaimedGoogleSync,
} from './google-event'

const EVENT = '3f2b9c1e-0a4d-4e8f-9b7a-1c2d3e4f5a6b'

function row(patch: Partial<ClaimedGoogleSync> = {}): ClaimedGoogleSync {
  return {
    event_id: EVENT,
    claimed_at: '2030-01-07T10:00:00.000000+00:00',
    account_id: 'acc',
    calendar_id: 'cal',
    kind: 'appointment',
    status: 'scheduled',
    title: 'Consulta',
    notes: null,
    starts_at: '2030-01-08T12:00:00+00:00',
    ends_at: '2030-01-08T12:30:00+00:00',
    contact_id: 'ct1',
    contact_name: 'Maria Silva',
    contact_phone: '+5563999990000',
    google_event_id: null,
    google_calendar_id: null,
    google_connection_id: null,
    google_sync_attempts: 0,
    calendar_name: 'Dr. João',
    timezone: 'America/Sao_Paulo',
    target_connection_id: 'conn',
    target_calendar_id: 'dr@clinica.com',
    target_connection_status: 'connected',
    ...patch,
  }
}

describe('googleEventIdFor', () => {
  it('is what Google accepts: base32hex, 5–1024 chars', () => {
    const id = googleEventIdFor(EVENT, 'dr@clinica.com')
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/)
    expect(id.startsWith('hc3f2b9c1e')).toBe(true)
  })

  it('is the same every time, and differs per Google calendar', () => {
    expect(googleEventIdFor(EVENT, 'a')).toBe(googleEventIdFor(EVENT, 'a'))
    expect(googleEventIdFor(EVENT, 'a')).not.toBe(googleEventIdFor(EVENT, 'b'))
  })
})

describe('what the professional reads in Google', () => {
  it('title: the kind of appointment and who it is with', () => {
    expect(googleEventTitle(row())).toBe('Consulta · Maria Silva')
    expect(googleEventTitle(row({ title: null }))).toBe('Agendamento · Maria Silva')
    expect(googleEventTitle(row({ contact_name: '  ', title: null }))).toBe('Agendamento · +5563999990000')
    expect(googleEventTitle(row({ status: 'pending' }))).toBe('Consulta · Maria Silva (aguardando aprovação)')
    expect(googleEventTitle(row({ status: 'no_show' }))).toBe('Consulta · Maria Silva (faltou)')
  })

  it('a block says it is a block, and why', () => {
    expect(googleEventTitle(row({ kind: 'block', title: 'Férias', contact_name: null }))).toBe('Bloqueado: Férias')
    expect(googleEventTitle(row({ kind: 'block', title: null }))).toBe('Bloqueado')
  })

  it('description: WhatsApp, notes and the link to the record', () => {
    const text = googleEventDescription(row({ notes: 'Primeira vez' }), 'https://crm.test')
    expect(text).toContain('Contato: Maria Silva')
    expect(text).toContain('WhatsApp: +5563999990000')
    expect(text).toContain('Observações: Primeira vez')
    expect(text).toContain('Ficha no CRM: https://crm.test/contacts?contact=ct1')
    expect(text).toContain('Dr. João')
    expect(googleEventDescription(row(), null)).not.toContain('Ficha no CRM')
  })

  it('body: times with the agenda’s zone, marked as the CRM’s, nobody invited', () => {
    const body = buildGoogleEvent(row({ status: 'pending' }), null)
    expect(body.start).toEqual({ dateTime: '2030-01-08T12:00:00.000Z', timeZone: 'America/Sao_Paulo' })
    expect(body.end).toEqual({ dateTime: '2030-01-08T12:30:00.000Z', timeZone: 'America/Sao_Paulo' })
    expect(body.status).toBe('tentative')
    expect(body).not.toHaveProperty('attendees')
    expect(body.extendedProperties).toEqual({
      private: { harpium_event_id: EVENT, harpium_account_id: 'acc' },
    })
    expect(buildGoogleEvent(row(), null).status).toBe('confirmed')
  })
})

describe('planGoogleSync', () => {
  const at = { google_event_id: 'hcold', google_calendar_id: 'dr@clinica.com', google_connection_id: 'conn' }

  it('new on a linked agenda: create it there', () => {
    expect(planGoogleSync(row())).toEqual({
      remove: null,
      put: {
        connectionId: 'conn',
        calendarId: 'dr@clinica.com',
        eventId: googleEventIdFor(EVENT, 'dr@clinica.com'),
        exists: false,
      },
      blocked: false,
    })
  })

  it('already there: update the same event', () => {
    expect(planGoogleSync(row(at))).toEqual({
      remove: null,
      put: { connectionId: 'conn', calendarId: 'dr@clinica.com', eventId: 'hcold', exists: true },
      blocked: false,
    })
  })

  it('cancelled: remove it from Google, put nothing', () => {
    expect(planGoogleSync(row({ ...at, status: 'cancelled' }))).toEqual({
      remove: { connectionId: 'conn', calendarId: 'dr@clinica.com', eventId: 'hcold' },
      put: null,
      blocked: false,
    })
  })

  it('cancelled and never sent: nothing to do', () => {
    expect(planGoogleSync(row({ status: 'cancelled' }))).toEqual({ remove: null, put: null, blocked: false })
  })

  it('moved to an agenda that writes elsewhere: remove there, create here', () => {
    const plan = planGoogleSync(row({ ...at, target_calendar_id: 'retornos@group' }))
    expect(plan.remove).toEqual({ connectionId: 'conn', calendarId: 'dr@clinica.com', eventId: 'hcold' })
    expect(plan.put).toMatchObject({ calendarId: 'retornos@group', exists: false })
  })

  it('its agenda stopped writing to Google: remove it there', () => {
    const plan = planGoogleSync(row({ ...at, target_connection_id: null, target_calendar_id: null }))
    expect(plan).toEqual({
      remove: { connectionId: 'conn', calendarId: 'dr@clinica.com', eventId: 'hcold' },
      put: null,
      blocked: false,
    })
  })

  it('the account needs signing in again: blocked', () => {
    expect(planGoogleSync(row({ target_connection_status: 'needs_reconnect' })).blocked).toBe(true)
  })
})
