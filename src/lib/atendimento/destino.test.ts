import { describe, expect, it } from 'vitest'

import {
  effectiveHandoff,
  resolveHandoffTarget,
  slugifyTeamCode,
  teamFromCode,
  teamsPrompt,
  type HandoffSettings,
  type TeamForAi,
} from './destino'
import { assignTarget } from '@/lib/automations/engine'

const TEAMS: TeamForAi[] = [
  { id: 't-rec', code: 'recepcao', name: 'Recepção', description: 'dúvidas gerais, horários', isEntry: true },
  { id: 't-fin', code: 'financeiro', name: 'Financeiro', description: 'boletos, parcelamento', isEntry: false },
  { id: 't-ana', code: 'dra-ana', name: 'Dra. Ana', description: 'pacientes da Dra. Ana', isEntry: false },
]
const IDS = TEAMS.map((t) => t.id)
const none: HandoffSettings = { mode: null, teamId: null, userId: null }

describe('effectiveHandoff', () => {
  it("uses the agent's own settings, else the account's", () => {
    expect(effectiveHandoff({ mode: 'setor', teamId: 't-fin', userId: null }, { ...none, mode: 'fila' }, true).mode).toBe('setor')
    expect(effectiveHandoff(none, { ...none, mode: 'fila' }, true).mode).toBe('fila')
  })

  it('reads the old "Passar para" person as mode pessoa', () => {
    expect(effectiveHandoff({ ...none, userId: 'u-maria' }, none, true)).toMatchObject({ mode: 'pessoa', userId: 'u-maria' })
    expect(effectiveHandoff(null, { ...none, userId: 'u-joao' }, false)).toMatchObject({ mode: 'pessoa', userId: 'u-joao' })
  })

  it('with nothing set: the AI chooses when there are setores, else the shared queue', () => {
    expect(effectiveHandoff(null, none, true).mode).toBe('ia_escolhe')
    expect(effectiveHandoff(null, none, false).mode).toBe('fila')
  })
})

describe('resolveHandoffTarget', () => {
  const resolve = (settings: Parameters<typeof resolveHandoffTarget>[0]['settings'], chosen: string | null = null) =>
    resolveHandoffTarget({ settings, chosenTeamId: chosen, entryTeamId: 't-rec', activeTeamIds: IDS })

  it('the AI choice, else the entry setor', () => {
    expect(resolve({ ...none, mode: 'ia_escolhe' }, 't-fin')).toEqual({ kind: 'setor', teamId: 't-fin' })
    expect(resolve({ ...none, mode: 'ia_escolhe' })).toEqual({ kind: 'setor', teamId: 't-rec' })
    // A setor that was deleted meanwhile is not a choice.
    expect(resolve({ ...none, mode: 'ia_escolhe' }, 't-gone')).toEqual({ kind: 'setor', teamId: 't-rec' })
  })

  it('a fixed setor or person; "fila" never falls through to a setor', () => {
    expect(resolve({ ...none, mode: 'setor', teamId: 't-ana' }, 't-fin')).toEqual({ kind: 'setor', teamId: 't-ana' })
    expect(resolve({ ...none, mode: 'pessoa', userId: 'u-maria' }, 't-fin')).toEqual({ kind: 'pessoa', userId: 'u-maria' })
    expect(resolve({ ...none, mode: 'fila' }, 't-fin')).toBeNull()
  })
})

describe('teamFromCode', () => {
  it('matches the code or the name, ignoring case and accents', () => {
    expect(teamFromCode('financeiro', TEAMS)?.id).toBe('t-fin')
    expect(teamFromCode('FINANCEIRO', TEAMS)?.id).toBe('t-fin')
    expect(teamFromCode('Dra. Ana', TEAMS)?.id).toBe('t-ana')
    expect(teamFromCode('recepção', TEAMS)?.id).toBe('t-rec')
    expect(teamFromCode('comercial', TEAMS)).toBeNull()
    expect(teamFromCode(null, TEAMS)).toBeNull()
  })
})

describe('slugifyTeamCode', () => {
  it('makes a short code the AI can write', () => {
    expect(slugifyTeamCode('Financeiro')).toBe('financeiro')
    expect(slugifyTeamCode('Dra. Ana')).toBe('dra-ana')
    expect(slugifyTeamCode('Pós-venda & Garantia')).toBe('pos-venda-garantia')
    expect(slugifyTeamCode('!!!')).toBe('setor')
  })
})

describe('teamsPrompt', () => {
  it('lists each setor with what it handles and the marker to write', () => {
    const prompt = teamsPrompt(TEAMS)!
    expect(prompt).toContain('- financeiro: Financeiro — boletos, parcelamento')
    expect(prompt).toContain('[[HANDOFF <code>]]')
    expect(prompt).toContain('[[HANDOFF]] alone')
    expect(teamsPrompt([])).toBeNull()
  })
})

describe('assignTarget (automation step)', () => {
  it('maps each mode; a step missing what it needs assigns nobody', () => {
    expect(assignTarget({ mode: 'round_robin' })).toEqual({ kind: 'rodizio' })
    expect(assignTarget(undefined)).toEqual({ kind: 'rodizio' })
    expect(assignTarget({ mode: 'specific', agent_id: 'u1' })).toEqual({ kind: 'pessoa', userId: 'u1' })
    expect(assignTarget({ mode: 'specific' })).toBeNull()
    expect(assignTarget({ mode: 'team', team_id: 't1' })).toEqual({ kind: 'setor', teamId: 't1' })
    expect(assignTarget({ mode: 'team' })).toBeNull()
  })
})
