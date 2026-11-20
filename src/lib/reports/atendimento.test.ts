import { describe, expect, it } from 'vitest'

import { buildAtendimento, type TransferRow } from './atendimento'

const row = (r: Partial<TransferRow>): TransferRow => ({
  conversation_id: 'c1',
  created_at: '2026-11-20T10:00:00Z',
  from_user_id: null,
  to_user_id: null,
  from_team_id: null,
  to_team_id: null,
  actor_user_id: null,
  source: 'manual',
  ...r,
})

describe('buildAtendimento', () => {
  it('counts who received and who passed on', () => {
    const r = buildAtendimento({
      transfers: [
        row({ to_user_id: 'carla', source: 'ia' }),
        row({ from_user_id: 'carla', to_user_id: 'ana', actor_user_id: 'carla', created_at: '2026-11-20T10:05:00Z' }),
        row({ conversation_id: 'c2', to_user_id: 'carla', source: 'rodizio' }),
      ],
      openByUser: new Map([['ana', 3]]),
      people: [
        { userId: 'carla', name: 'Carla' },
        { userId: 'ana', name: 'Ana' },
        { userId: 'quiet', name: 'Sem movimento' },
      ],
      teams: [],
    })
    expect(r.people).toEqual([
      { userId: 'carla', name: 'Carla', received: 2, passedOn: 1, openNow: 0 },
      { userId: 'ana', name: 'Ana', received: 1, passedOn: 0, openNow: 3 },
    ])
  })

  it('measures the setor queue and the deadline moves', () => {
    const r = buildAtendimento({
      transfers: [
        row({ to_team_id: 'fin', source: 'ia', created_at: '2026-11-20T10:00:00Z' }),
        row({ to_team_id: 'fin', from_team_id: 'fin', to_user_id: 'carla', source: 'rodizio', created_at: '2026-11-20T10:10:00Z' }),
        row({ conversation_id: 'c2', to_team_id: 'fin', to_user_id: 'bia', source: 'ia' }),
        row({ conversation_id: 'c2', from_team_id: 'fin', to_team_id: 'fin', from_user_id: 'bia', to_user_id: 'carla', source: 'prazo', created_at: '2026-11-20T10:30:00Z' }),
      ],
      openByUser: new Map(),
      people: [],
      teams: [{ id: 'fin', name: 'Financeiro', color: '#0ea5e9' }],
    })
    expect(r.teams).toEqual([
      { teamId: 'fin', name: 'Financeiro', color: '#0ea5e9', entries: 2, medianQueueMinutes: 10, overdueMoves: 1 },
    ])
  })
})
