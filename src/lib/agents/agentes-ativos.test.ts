import { describe, expect, it } from 'vitest'

import { outsideServiceWindow, proactiveLimitReached, tokenCapReached } from './limites'
import { extractMemoryMarkers, memoryPromptBlock } from './memory-marker'
import { RONDA_PRESETS, rondaParam } from './rondas-catalogo'
import { parseRondaPayload } from './rondas-payload'
import { coolDownBucket, nextFixedRun, nextRondaRun } from './rondas-tempo'
import { briefOf, policyFor, LOOP_KINDS } from './loop'
import { AGENT_TOOLS } from './ferramentas'
import { decide } from './autonomy'
import type { Agent, AgentTask } from './types'

const NOW = new Date('2026-11-27T15:00:00Z') // Friday, 12:00 in São Paulo
const h = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString()

describe('proactive limits', () => {
  it('allows the first message, then one a day and three a week', () => {
    expect(proactiveLimitReached([], NOW)).toBeNull()
    expect(proactiveLimitReached([h(2)], NOW)).toBe('dia')
    expect(proactiveLimitReached([h(25)], NOW)).toBeNull()
    expect(proactiveLimitReached([h(30), h(60), h(100)], NOW)).toBe('semana')
    expect(proactiveLimitReached([h(30), h(60), h(24 * 8)], NOW)).toBeNull()
  })
})

describe('the 24-hour window', () => {
  it('is closed without a customer message or after a day', () => {
    expect(outsideServiceWindow(null, NOW)).toBe(true)
    expect(outsideServiceWindow(h(23), NOW)).toBe(false)
    expect(outsideServiceWindow(h(24), NOW)).toBe(true)
  })
})

describe('token cap', () => {
  it('uses the default when the agent has none', () => {
    expect(tokenCapReached(299_999, null)).toBe(false)
    expect(tokenCapReached(300_000, null)).toBe(true)
    expect(tokenCapReached(50_000, 40_000)).toBe(true)
  })
})

describe('memory markers', () => {
  it('cuts markers out and keeps at most two facts', () => {
    const r = extractMemoryMarkers(
      'Perfeito, te mando o orçamento amanhã!\n[[LEMBRAR: decide junto com a esposa]]\n[[lembrar: prefere áudio]]\n[[LEMBRAR: terceiro]]',
    )
    expect(r.text).toBe('Perfeito, te mando o orçamento amanhã!')
    expect(r.facts).toEqual(['decide junto com a esposa', 'prefere áudio'])
  })

  it('never leaves a half-written marker for the customer', () => {
    expect(extractMemoryMarkers('Combinado.\n[[LEMBRAR: quer entrega em jan').text).toBe('Combinado.')
    expect(extractMemoryMarkers('Sem nada para lembrar.')).toEqual({ text: 'Sem nada para lembrar.', facts: [] })
  })

  it('renders memories as reference, or nothing', () => {
    expect(memoryPromptBlock([])).toBeNull()
    expect(memoryPromptBlock(['prefere áudio'])).toContain('[1] prefere áudio')
  })
})

describe('round schedule', () => {
  const SP = 'America/Sao_Paulo'

  it('finds the next daily run in the agent time zone', () => {
    // 12:00 local on a Friday: 10:00 already passed → Monday 10:00 (13:00 UTC).
    expect(nextFixedRun('10:00', [1, 2, 3, 4, 5], SP, NOW)?.toISOString()).toBe('2026-11-30T13:00:00.000Z')
    // 14:00 is still ahead today.
    expect(nextFixedRun('14:00', [5], SP, NOW)?.toISOString()).toBe('2026-11-27T17:00:00.000Z')
    expect(nextFixedRun('10:00', [], SP, NOW)).toBeNull()
    expect(nextFixedRun('25:00', [1], SP, NOW)).toBeNull()
  })

  it('runs "every N minutes" from now, and never spins on a broken schedule', () => {
    expect(nextRondaRun({ everyMinutes: 30, runAt: null, runDays: [] }, SP, NOW).toISOString()).toBe(
      '2026-11-27T15:30:00.000Z',
    )
    expect(nextRondaRun({ everyMinutes: null, runAt: null, runDays: [] }, SP, NOW).getTime()).toBe(
      NOW.getTime() + 86_400_000,
    )
  })

  it('puts the same contact in the same cool-down slot for its days', () => {
    expect(coolDownBucket(NOW, 3)).toBe(coolDownBucket(new Date(NOW.getTime() + 3_600_000), 3))
    expect(coolDownBucket(NOW, 1)).not.toBe(coolDownBucket(new Date(NOW.getTime() + 86_400_000), 1))
  })
})

describe('round catalogue and payload', () => {
  it('has a schedule and an instruction for every kind', () => {
    for (const p of RONDA_PRESETS) {
      expect(p.everyMinutes || p.runAt, p.kind).toBeTruthy()
      expect(p.instruction.length, p.kind).toBeGreaterThan(20)
    }
  })

  it('clamps the knob to its range', () => {
    expect(rondaParam('orcamento_parado', { dias: 999 })).toBe(60)
    expect(rondaParam('orcamento_parado', {})).toBe(3)
    expect(rondaParam('falta_na_agenda', { dias: 3 })).toBeNull()
  })

  it('validates a new round', () => {
    const ok = parseRondaPayload(
      { agentId: 'a1', checkKind: 'lead_sem_contato', name: 'Lead novo', everyMinutes: 15, param: 20 },
      { partial: false },
    )
    expect(ok).toEqual({
      values: {
        agent_id: 'a1',
        check_kind: 'lead_sem_contato',
        name: 'Lead novo',
        params: { minutos: 20 },
        every_minutes: 15,
        run_at: null,
      },
    })
    expect(parseRondaPayload({ agentId: 'a1', checkKind: 'x', name: 'n', everyMinutes: 15 }, { partial: false })).toHaveProperty('error')
    expect(parseRondaPayload({ agentId: 'a1', checkKind: 'pos_venda', name: 'n', everyMinutes: 5 }, { partial: false })).toHaveProperty('error')
    expect(parseRondaPayload({ agentId: 'a1', checkKind: 'pos_venda', name: 'n' }, { partial: false })).toHaveProperty('error')
    expect(parseRondaPayload({ isActive: false }, { partial: true })).toEqual({ values: { is_active: false } })
  })
})

const agent = {
  id: 'ag',
  name: 'Fê',
  role: 'followup',
  autonomy: 3,
  tools: ['crm', 'pipeline', 'messaging'],
  requireApprovalFor: [],
} as unknown as Agent

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 't',
    accountId: 'acc',
    agentId: 'ag',
    kind: 'followup',
    title: 'Retomar Ana',
    input: {},
    contactId: 'c',
    conversationId: null,
    dealId: null,
    ...over,
  } as AgentTask
}

describe('agent loop policy', () => {
  it("lets an autonomy-3 agent send, unless the round still asks for an OK", () => {
    expect(decide(policyFor(agent, task()), 'send_message')).toEqual({ allowed: true, needsApproval: false })
    const fromRound = task({ kind: 'ronda', input: { ronda_id: 'r', envio_precisa_ok: true } })
    expect(decide(policyFor(agent, fromRound), 'send_message')).toMatchObject({ needsApproval: true, reason: 'pinned_by_operator' })
  })

  it('keeps internal keys out of the brief', () => {
    const brief = briefOf(task({ input: { ronda_id: 'r', envio_precisa_ok: true, situacao: 'parado há 3 dias' } }))
    expect(brief).toContain('situacao: parado há 3 dias')
    expect(brief).not.toContain('ronda_id')
    expect(brief).not.toContain('envio_precisa_ok')
  })

  it('runs rounds and message tasks through the loop', () => {
    expect(LOOP_KINDS.has('ronda')).toBe(true)
    expect(LOOP_KINDS.has('outreach')).toBe(true)
    expect(LOOP_KINDS.has('research')).toBe(false)
  })

  it('gates every tool that changes something, and nothing else', () => {
    const gated = AGENT_TOOLS.filter((t) => t.action).map((t) => t.name).sort()
    expect(gated).toEqual(['agendar_retorno', 'anotar', 'atualizar_cliente', 'criar_tarefa', 'enviar_mensagem', 'mover_negocio'])
    for (const t of AGENT_TOOLS.filter((x) => x.action)) expect(t.preview, t.name).toBeTypeOf('function')
  })
})
