import { describe, expect, it } from 'vitest'

import { describeTransfer, type TransferEvent } from './historico'

const NAMES: Record<string, string> = { carla: 'Carla', ana: 'Dra. Ana', maria: 'Maria' }
const TEAMS: Record<string, string> = { fin: 'Financeiro' }
const describe_ = (e: Partial<TransferEvent>) =>
  describeTransfer(
    { id: '1', created_at: '', from_user_id: null, to_user_id: null, actor_user_id: null, source: 'manual', note: null, ...e },
    (u) => NAMES[u] ?? null,
    (t) => TEAMS[t] ?? null,
  )

describe('describeTransfer', () => {
  it('a person passing it on, with the note', () => {
    expect(describe_({ actor_user_id: 'carla', to_user_id: 'ana', note: 'quer avaliar antes de fechar' })).toBe(
      'Carla passou para Dra. Ana · quer avaliar antes de fechar',
    )
  })

  it('taking it yourself', () => {
    expect(describe_({ actor_user_id: 'maria', to_user_id: 'maria' })).toBe('Maria assumiu a conversa')
  })

  it('the AI, the rotation, a setor queue', () => {
    expect(describe_({ source: 'ia', to_user_id: 'carla', to_team_id: 'fin', note: '“dá pra parcelar?”' })).toBe(
      'A IA passou para Carla · Financeiro · “dá pra parcelar?”',
    )
    expect(describe_({ source: 'rodizio', to_user_id: 'maria' })).toBe('Rodízio: ficou com Maria')
    expect(describe_({ source: 'ia', to_team_id: 'fin' })).toBe('A IA passou para a fila de Financeiro')
    expect(describe_({ actor_user_id: 'carla', from_user_id: 'carla' })).toBe('Carla devolveu para a fila')
  })

  it('deadline and return', () => {
    expect(describe_({ source: 'prazo', to_user_id: 'ana', note: 'Sem resposta em 15 min' })).toBe(
      'Passou do prazo: foi para Dra. Ana · Sem resposta em 15 min',
    )
    expect(describe_({ source: 'retorno', to_user_id: 'maria' })).toBe('Voltou a falar: ficou com Maria')
  })
})
