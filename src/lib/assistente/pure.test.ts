import { describe, expect, it } from 'vitest'

import { INVALID_ARGS_KEY } from '@/lib/ai/tool-chat'

import { parsePage } from './page'
import { decide, toolsFor } from './policy'
import { checkInput } from './schema'
import { stepsSinceUser, titleFrom, toLlmMessages } from './store'
import { addDays, dayStart, describeSchedule, nextRunAt, parseLocalDateTime, wallClock } from './time'
import { ALL_TOOLS } from './tools'
import { describeSteps, describeTrigger, stepsSendToCustomer } from './tools/descrever'
import { normalizeSteps } from './tools/automacoes'
import { buildItems, toUiAction, type ActionRow } from './view'
import type { StoredMessage } from './types'

const SP = 'America/Sao_Paulo'

describe('checkInput', () => {
  const schema = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      n: { type: 'integer', minimum: 1, maximum: 5 },
      t: { type: 'string', enum: ['a', 'b'] },
      list: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      cfg: { type: 'object', additionalProperties: true },
    },
    required: ['id'],
  }
  const id = '4b1c2d3e-1111-4222-8333-944455556666'

  it('cleans and keeps declared fields only', () => {
    const r = checkInput(schema, { id, n: '3', extra: 1, t: 'a', cfg: { x: 1 } })
    expect(r).toEqual({ ok: true, value: { id, n: 3, t: 'a', cfg: { x: 1 } } })
  })

  it('explains what is wrong in Portuguese', () => {
    expect(checkInput(schema, {})).toMatchObject({ ok: false, error: 'falta id' })
    expect(checkInput(schema, { id: 'abc' })).toMatchObject({ ok: false })
    expect(checkInput(schema, { id, n: 9 })).toMatchObject({ ok: false, error: 'n precisa ser ≤ 5' })
    expect(checkInput(schema, { id, t: 'c' })).toMatchObject({ ok: false })
    expect(checkInput(schema, { id, list: ['a', 'b', 'c'] })).toMatchObject({ ok: false })
  })

  it('treats a null optional as absent, and flags broken JSON', () => {
    expect(checkInput(schema, { id, n: null })).toEqual({ ok: true, value: { id } })
    expect(checkInput(schema, { [INVALID_ARGS_KEY]: '{' })).toMatchObject({ ok: false })
  })

  it('every tool schema is an object schema the validator accepts', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.parameters.type, tool.name).toBe('object')
      expect(tool.description.length, tool.name).toBeGreaterThan(10)
    }
    expect(new Set(ALL_TOOLS.map((t) => t.name)).size).toBe(ALL_TOOLS.length)
  })
})

describe('policy', () => {
  const tool = (minRole: 'viewer' | 'agent' | 'admin') => ({ name: 't', minRole, risk: 'pequena' as const })
  const base = { role: 'agent' as const, readOnly: false, smallChangesUnasked: false, unattended: false }

  it('reads run, changes ask', () => {
    expect(decide({ ...base, tool: tool('viewer'), risk: 'leitura' })).toEqual({ kind: 'run' })
    expect(decide({ ...base, tool: tool('agent'), risk: 'pequena' })).toEqual({ kind: 'confirm' })
  })

  it('only small changes may skip the card, never in a routine', () => {
    const p = { ...base, smallChangesUnasked: true }
    expect(decide({ ...p, tool: tool('agent'), risk: 'pequena' })).toEqual({ kind: 'auto' })
    expect(decide({ ...p, tool: tool('agent'), risk: 'maior' })).toEqual({ kind: 'confirm' })
    expect(decide({ ...p, tool: tool('agent'), risk: 'cliente' })).toEqual({ kind: 'confirm' })
    expect(decide({ ...p, unattended: true, tool: tool('agent'), risk: 'pequena' })).toEqual({ kind: 'confirm' })
  })

  it('denies below the role, and anything for read-only access', () => {
    expect(decide({ ...base, tool: tool('admin'), risk: 'maior' }).kind).toBe('deny')
    expect(decide({ ...base, readOnly: true, tool: tool('viewer'), risk: 'pequena' }).kind).toBe('deny')
  })

  it('a viewer is offered read tools only', () => {
    const offered = toolsFor(ALL_TOOLS, 'viewer', true)
    expect(offered.length).toBeGreaterThan(5)
    expect(offered.every((t) => t.risk === 'leitura')).toBe(true)
    const agent = toolsFor(ALL_TOOLS, 'agent', false).map((t) => t.name)
    expect(agent).toContain('criar_automacao')
    expect(agent).not.toContain('criar_disparo') // admin+
  })

  it('every write tool can build a card and run it', () => {
    for (const t of ALL_TOOLS) {
      if (t.risk === 'leitura') expect(t.run, t.name).toBeTypeOf('function')
      else {
        expect(t.prepare, t.name).toBeTypeOf('function')
        expect(t.execute, t.name).toBeTypeOf('function')
      }
    }
  })
})

describe('time', () => {
  it('reads the wall clock in a zone', () => {
    const w = wallClock(new Date('2026-11-19T13:05:00Z'), SP)
    expect(w).toMatchObject({ year: 2026, month: 11, day: 19, hour: 10, minute: 5, weekday: 4 })
  })

  it('local dates and times become the right instants', () => {
    expect(dayStart('2026-11-19', SP)?.toISOString()).toBe('2026-11-19T03:00:00.000Z')
    expect(parseLocalDateTime('2026-11-20T09:30', SP)?.toISOString()).toBe('2026-11-20T12:30:00.000Z')
    expect(parseLocalDateTime('2026-11-20T09:30:00Z', SP)?.toISOString()).toBe('2026-11-20T09:30:00.000Z')
    expect(parseLocalDateTime('amanhã', SP)).toBeNull()
    expect(addDays(dayStart('2026-11-30', SP)!, 1, SP).toISOString()).toBe('2026-12-01T03:00:00.000Z')
  })

  it('next run: same day later, or the next listed weekday', () => {
    const thursday10am = new Date('2026-11-19T13:00:00Z') // 10:00 in São Paulo
    expect(nextRunAt([4], '18:00', SP, thursday10am)?.toISOString()).toBe('2026-11-19T21:00:00.000Z')
    expect(nextRunAt([1], '08:00', SP, thursday10am)?.toISOString()).toBe('2026-11-23T11:00:00.000Z')
    expect(nextRunAt([4], '08:00', SP, thursday10am)?.toISOString()).toBe('2026-11-26T11:00:00.000Z')
    expect(nextRunAt([], '08:00', SP, thursday10am)).toBeNull()
  })

  it('describes a schedule in words', () => {
    expect(describeSchedule([1, 2, 3, 4, 5], '08:00')).toBe('de segunda a sexta às 08:00')
    expect(describeSchedule([1], '08:00')).toBe('toda segunda às 08:00')
    expect(describeSchedule([6], '09:00')).toBe('todo sábado às 09:00')
    expect(describeSchedule([1, 3, 5], '18:30')).toBe('segunda, quarta e sexta às 18:30')
  })
})

describe('page', () => {
  const id = '4b1c2d3e-1111-4222-8333-944455556666'
  it('names the screen and the record in the URL', () => {
    expect(parsePage({ path: `/automations/${id}/edit` })).toEqual({
      screen: 'Automações',
      target: { kind: 'automation', id },
    })
    expect(parsePage({ path: '/contacts', search: `contact=${id}` }).target).toEqual({ kind: 'contact', id })
    expect(parsePage({ path: '/inbox', search: `c=${id}` }).target).toEqual({ kind: 'conversation', id })
    expect(parsePage({ path: '/agents', search: 'tab=approvals' }).screen).toBe('Agentes de IA › aba approvals')
    expect(parsePage({ path: 'javascript:alert(1)' })).toEqual({ screen: null, target: null })
  })
})

describe('describing automations', () => {
  const names = {
    tags: new Map([['t1', 'Quente']]),
    stages: new Map([['s1', 'Novo (Vendas)']]),
    pipelines: new Map([['p1', 'Vendas']]),
  }

  it('turns the model format into the builder tree', () => {
    const steps = normalizeSteps([
      { tipo: 'send_message', config: { text: 'Oi' } },
      { tipo: 'condition', config: { subject: 'tag_presence', operand: 't1' }, sim: [{ tipo: 'close_conversation' }] },
    ])
    expect(steps[1].branches?.yes?.[0].step_type).toBe('close_conversation')
    expect(() => normalizeSteps([{ tipo: 'apagar_tudo' }])).toThrow(/não existe/)
  })

  it('says what each step does, with names instead of ids', () => {
    const lines = describeSteps(
      [
        { step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
        { step_type: 'add_tag', step_config: { tag_id: 't1' } },
        { step_type: 'create_deal', step_config: { stage_id: 's1', title: 'Negócio' } },
      ],
      names,
    )
    expect(lines).toEqual([
      '1. Esperar 1 dia',
      '2. Adicionar a etiqueta "Quente"',
      '3. Criar negócio "Negócio" em Novo (Vendas)',
    ])
    expect(describeTrigger('lead_received', { origens: ['Quiz planejados'] }, names)).toBe(
      'Quando chegar um lead com origem "Quiz planejados"',
    )
  })

  it('knows when an automation talks to customers, in any branch', () => {
    expect(stepsSendToCustomer([{ step_type: 'add_tag' }])).toBe(false)
    expect(
      stepsSendToCustomer([
        { step_type: 'condition', branches: { no: [{ step_type: 'send_message' }] } },
      ]),
    ).toBe(true)
  })
})

describe('store', () => {
  const msg = (seq: number, role: StoredMessage['role'], content: Record<string, unknown>): StoredMessage => ({
    id: `m${seq}`,
    seq,
    role,
    content,
    created_at: `2026-11-19T10:00:0${seq}Z`,
  })

  it('maps stored rows to the transcript and counts model turns', () => {
    const messages = [
      msg(1, 'user', { text: 'oi' }),
      msg(2, 'assistant', { blocks: [{ type: 'tool_call', id: 'c1', name: 'x', input: {} }] }),
      msg(3, 'tool', { results: [{ id: 'c1', name: 'x', content: 'ok' }] }),
      msg(4, 'assistant', { blocks: [{ type: 'text', text: 'pronto' }] }),
    ]
    expect(toLlmMessages(messages).map((m) => m.role)).toEqual(['user', 'assistant', 'tool_results', 'assistant'])
    expect(stepsSinceUser(messages)).toBe(2)
    expect(stepsSinceUser([...messages, msg(5, 'event', { text: 'confirmou' })])).toBe(0)
    expect(toLlmMessages([msg(5, 'event', { text: 'confirmou' })])[0]).toEqual({
      role: 'user',
      text: '[Sistema] confirmou',
    })
  })

  it('shortens old tool results, keeps the recent ones', () => {
    const big = 'x'.repeat(5000)
    const messages: StoredMessage[] = []
    for (let i = 0; i < 5; i++) {
      messages.push(msg(i * 2, 'assistant', { blocks: [{ type: 'tool_call', id: `c${i}`, name: 'x', input: {} }] }))
      messages.push(msg(i * 2 + 1, 'tool', { results: [{ id: `c${i}`, name: 'x', content: big }] }))
    }
    const out = toLlmMessages(messages).filter((m) => m.role === 'tool_results')
    const lengths = out.map((m) => (m.role === 'tool_results' ? m.results[0].content.length : 0))
    expect(lengths[0]).toBeLessThan(2000)
    expect(lengths[4]).toBe(5000)
  })

  it('makes a short title', () => {
    expect(titleFrom('  quantos   leads? ')).toBe('quantos leads?')
    expect(titleFrom('a'.repeat(100))).toHaveLength(60)
  })
})

describe('view', () => {
  const action = (over: Partial<ActionRow> = {}): ActionRow => ({
    id: 'a1',
    tool: 'adicionar_nota',
    tool_call_id: 'c1',
    risk: 'pequena',
    status: 'pending',
    preview: { title: 'Nota em Ana', lines: ['texto'] },
    result: null,
    undo: null,
    error: null,
    auto: false,
    expires_at: '2026-11-19T11:00:00Z',
    executed_at: null,
    created_at: '2026-11-19T10:00:00Z',
    ...over,
  })

  it('a pending card past its time shows as expired', () => {
    const ui = toUiAction(action(), new Date('2026-11-19T12:00:00Z'))
    expect(ui.status).toBe('expired')
  })

  it('undo is offered for a day after it ran', () => {
    const done = action({
      status: 'done',
      undo: { note_id: 'n1' },
      executed_at: '2026-11-19T10:00:00Z',
      result: { summary: 'Nota salva.', link: { href: '/contacts?contact=x', label: 'Abrir contato' } },
    })
    expect(toUiAction(done, new Date('2026-11-19T12:00:00Z'))).toMatchObject({
      canUndo: true,
      summary: 'Nota salva.',
      link: { href: '/contacts?contact=x', label: 'Abrir contato' },
    })
    expect(toUiAction(done, new Date('2026-11-21T12:00:00Z')).canUndo).toBe(false)
  })

  it('a write call shows as its card, a read call as an activity line', () => {
    const items = buildItems(
      [
        { id: 'm1', seq: 1, role: 'user', content: { text: 'nota' }, created_at: '2026-11-19T10:00:00Z' },
        {
          id: 'm2',
          seq: 2,
          role: 'assistant',
          content: {
            blocks: [
              { type: 'text', text: 'Vou anotar.' },
              { type: 'tool_call', id: 'c0', name: 'buscar_contatos', input: {} },
              { type: 'tool_call', id: 'c1', name: 'adicionar_nota', input: {} },
            ],
          },
          created_at: '2026-11-19T10:00:01Z',
        },
      ],
      [action()],
      new Date('2026-11-19T10:01:00Z'),
    )
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'activity', 'action'])
  })
})
