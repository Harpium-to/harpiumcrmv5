import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { GoogleListedEvent } from '@/lib/google/calendar-api'
import { GoogleAuthError } from '@/lib/google/oauth'

import {
  googleBusyByCalendar,
  googleReadWindow,
  readGoogleEvents,
  refreshGoogleBusy,
  type GoogleBusyDeps,
} from './google-busy'

const SP = 'America/Sao_Paulo'
const NOW = new Date('2030-01-07T10:00:00Z')

const ev = (patch: Partial<GoogleListedEvent> & { id: string }): GoogleListedEvent => ({
  status: 'confirmed',
  start: { dateTime: '2030-01-08T12:00:00-03:00' },
  end: { dateTime: '2030-01-08T13:00:00-03:00' },
  transparency: null,
  declined: false,
  harpiumEventId: null,
  ...patch,
})

describe('readGoogleEvents', () => {
  it('keeps what blocks the agenda, start and end only', () => {
    const { busy, own } = readGoogleEvents([ev({ id: 'g1' })], SP)
    expect(busy).toEqual([
      {
        google_event_id: 'g1',
        starts_at: '2030-01-08T15:00:00.000Z',
        ends_at: '2030-01-08T16:00:00.000Z',
        all_day: false,
      },
    ])
    expect(own).toEqual([])
  })

  it('leaves out cancelled, "Disponível" and declined events', () => {
    const { busy } = readGoogleEvents(
      [
        ev({ id: 'cancelled', status: 'cancelled' }),
        ev({ id: 'free', transparency: 'transparent' }),
        ev({ id: 'declined', declined: true }),
      ],
      SP,
    )
    expect(busy).toEqual([])
  })

  it('an all-day busy event blocks the whole day on the calendar’s clock', () => {
    const { busy } = readGoogleEvents(
      [ev({ id: 'ferias', start: { date: '2030-01-09' }, end: { date: '2030-01-10' } })],
      SP,
    )
    expect(busy).toEqual([
      {
        google_event_id: 'ferias',
        starts_at: '2030-01-09T03:00:00.000Z',
        ends_at: '2030-01-10T03:00:00.000Z',
        all_day: true,
      },
    ])
  })

  it('the CRM’s own events are not busy: they are checked for changes instead', () => {
    const { busy, own } = readGoogleEvents([ev({ id: 'hc1', harpiumEventId: 'crm-1' })], SP)
    expect(busy).toEqual([])
    expect(own).toEqual([
      { google_event_id: 'hc1', starts_at: '2030-01-08T15:00:00.000Z', ends_at: '2030-01-08T16:00:00.000Z' },
    ])
  })
})

describe('googleReadWindow', () => {
  it('yesterday to 90 days ahead', () => {
    const { timeMin, timeMax } = googleReadWindow(NOW)
    expect(timeMin.toISOString()).toBe('2030-01-06T10:00:00.000Z')
    expect(timeMax.toISOString()).toBe('2030-04-07T10:00:00.000Z')
  })
})

/** The calendars, reads and RPCs refreshGoogleBusy touches. */
function fakeDb(world: {
  agendas: Record<string, unknown>[]
  reads?: { connection_id: string; google_calendar_id: string; read_at: string }[]
  agendaError?: { code: string }
}) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = []
  const upserts: Record<string, unknown>[] = []
  const filters: Record<string, unknown> = {}
  const from = (table: string) => {
    if (table === 'calendars') {
      const chain = {
        select: () => chain,
        not: () => chain,
        eq: (col: string, value: unknown) => {
          filters[col] = value
          return chain
        },
        in: (col: string, value: unknown) => {
          filters[col] = value
          return chain
        },
        then: (resolve: (v: unknown) => void) =>
          resolve(
            world.agendaError
              ? { data: null, error: world.agendaError }
              : { data: world.agendas, error: null },
          ),
      }
      return chain
    }
    if (table === 'google_calendar_reads') {
      return {
        select: () => ({ in: () => Promise.resolve({ data: world.reads ?? [], error: null }) }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row)
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args })
    return { data: name === 'note_google_remote_changes' ? 1 : 3, error: null }
  }
  return { db: { from, rpc } as unknown as SupabaseClient, rpcs, upserts, filters }
}

const agenda = (patch: Record<string, unknown> = {}) => ({
  id: 'cal-1',
  account_id: 'acc',
  timezone: SP,
  google_connection_id: 'conn',
  google_calendar_id: 'dr@clinica.com',
  google_busy_calendar_ids: ['dr@clinica.com'],
  ...patch,
})

function deps(patch: Partial<GoogleBusyDeps> = {}) {
  return {
    config: () => ({ clientId: 'cid', clientSecret: 'secret' }),
    token: vi.fn(async () => 'tok'),
    list: vi.fn(async () => ({
      events: [ev({ id: 'g1' }), ev({ id: 'hc1', harpiumEventId: 'crm-1' })],
      timeZone: SP,
      complete: true,
    })),
    now: () => NOW,
    ...patch,
  } as GoogleBusyDeps & { list: ReturnType<typeof vi.fn>; token: ReturnType<typeof vi.fn> }
}

describe('refreshGoogleBusy', () => {
  it('without Google credentials, or before 071, does nothing', async () => {
    expect(await refreshGoogleBusy(fakeDb({ agendas: [agenda()] }).db, {}, deps({ config: () => null }))).toBeNull()
    expect(
      await refreshGoogleBusy(fakeDb({ agendas: [], agendaError: { code: '42703' } }).db, {}, deps()),
    ).toBeNull()
  })

  it('reads each Google calendar once, stores the busy times and checks the CRM’s own events', async () => {
    const world = fakeDb({
      agendas: [agenda(), agenda({ id: 'cal-2' })], // two agendas, same Google calendar
    })
    const d = deps()
    expect(await refreshGoogleBusy(world.db, {}, d)).toEqual({ read: 1, failed: 0, notices: 1 })
    expect(d.list).toHaveBeenCalledTimes(1)
    const replace = world.rpcs.find((r) => r.name === 'replace_google_busy')
    expect(replace?.args).toMatchObject({
      p_account_id: 'acc',
      p_connection_id: 'conn',
      p_calendar_id: 'dr@clinica.com',
    })
    expect((replace?.args.p_rows as { google_event_id: string }[]).map((r) => r.google_event_id)).toEqual(['g1'])
    const note = world.rpcs.find((r) => r.name === 'note_google_remote_changes')
    expect((note?.args.p_own as { google_event_id: string }[]).map((r) => r.google_event_id)).toEqual(['hc1'])
  })

  it('a calendar read recently is left alone', async () => {
    const world = fakeDb({
      agendas: [agenda()],
      reads: [{ connection_id: 'conn', google_calendar_id: 'dr@clinica.com', read_at: '2030-01-07T09:59:30Z' }],
    })
    const d = deps()
    expect(await refreshGoogleBusy(world.db, {}, d)).toEqual({ read: 0, failed: 0, notices: 0 })
    expect(d.list).not.toHaveBeenCalled()
    await refreshGoogleBusy(world.db, { maxAgeMs: 0 }, d)
    expect(d.list).toHaveBeenCalledTimes(1)
  })

  it('an incomplete read stores what came but says nothing about missing events', async () => {
    const world = fakeDb({ agendas: [agenda()] })
    const d = deps({
      list: vi.fn(async () => ({ events: [ev({ id: 'g1' })], timeZone: SP, complete: false })),
    })
    await refreshGoogleBusy(world.db, {}, d)
    expect(world.rpcs.map((r) => r.name)).toEqual(['replace_google_busy'])
  })

  it('a lost access is recorded as the read, so it is not retried every second', async () => {
    const world = fakeDb({ agendas: [agenda()] })
    const d = deps({
      token: vi.fn(async () => {
        throw new GoogleAuthError('no', 'invalid_grant', true)
      }) as never,
    })
    expect(await refreshGoogleBusy(world.db, {}, d)).toEqual({ read: 0, failed: 1, notices: 0 })
    expect(world.upserts[0]).toMatchObject({
      connection_id: 'conn',
      google_calendar_id: 'dr@clinica.com',
      last_error: 'A conta Google precisa ser conectada de novo.',
    })
  })

  it('narrows to the agendas asked for', async () => {
    const world = fakeDb({ agendas: [agenda()] })
    await refreshGoogleBusy(world.db, { calendarIds: ['cal-1'], accountId: 'acc' }, deps())
    expect(world.filters).toMatchObject({ id: ['cal-1'], account_id: 'acc', google_show_busy: true })
    expect(await refreshGoogleBusy(world.db, { calendarIds: [] }, deps())).toEqual({
      read: 0,
      failed: 0,
      notices: 0,
    })
  })
})

describe('googleBusyByCalendar', () => {
  it('groups the busy times per agenda', async () => {
    const chain = {
      select: () => chain,
      in: () => chain,
      lt: () => chain,
      gt: () =>
        Promise.resolve({
          data: [
            { calendar_id: 'a', starts_at: '2030-01-08T15:00:00Z', ends_at: '2030-01-08T16:00:00Z' },
            { calendar_id: 'a', starts_at: '2030-01-09T15:00:00Z', ends_at: '2030-01-09T16:00:00Z' },
            { calendar_id: 'b', starts_at: '2030-01-08T15:00:00Z', ends_at: '2030-01-08T16:00:00Z' },
          ],
          error: null,
        }),
    }
    const db = { from: () => chain } as unknown as SupabaseClient
    const map = await googleBusyByCalendar(db, ['a', 'b'], NOW, new Date('2030-02-01'))
    expect(map.get('a')).toHaveLength(2)
    expect(map.get('b')?.[0].start.toISOString()).toBe('2030-01-08T15:00:00.000Z')
  })

  it('anything wrong (no 071, a test double without the view) is just nothing from Google', async () => {
    const broken = {
      from: () => {
        throw new Error('no view')
      },
    } as unknown as SupabaseClient
    expect((await googleBusyByCalendar(broken, ['a'], NOW, NOW)).size).toBe(0)
    expect((await googleBusyByCalendar(broken, [], NOW, NOW)).size).toBe(0)
  })
})
