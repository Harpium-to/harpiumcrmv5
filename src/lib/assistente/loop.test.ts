import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'
import type { ToolDef } from './types'

// ============================================================
// The step loop, with the model, the database and the tools faked.
// What it must guarantee: a write never runs without a card (unless
// the CRM allows small changes unasked), a read runs at once, a
// read-only person cannot even be offered writes, and a model the key
// cannot use falls back to the CRM's own.
// ============================================================

const state = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  appended: [] as { role: string; content: Record<string, unknown> }[],
  pending: 0,
  created: [] as Record<string, unknown>[],
  executed: [] as string[],
  replies: [] as unknown[],
  calls: [] as { model: string; tools: string[] }[],
}))

vi.mock('@/lib/ai/tool-chat', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/tool-chat')>()),
  toolChat: vi.fn(async (args: { model: string; tools: { name: string }[] }) => {
    state.calls.push({ model: args.model, tools: args.tools.map((t) => t.name) })
    const next = state.replies.shift()
    if (next instanceof Error) throw next
    return next
  }),
}))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}) }))
vi.mock('./overview', () => ({ buildOverview: vi.fn(async () => 'mapa') }))
vi.mock('./page', () => ({ describePage: vi.fn(async () => 'Tela atual: Painel.') }))
vi.mock('./store', async (orig) => {
  const real = await orig<typeof import('./store')>()
  return {
    ...real,
    loadMessages: vi.fn(async () => state.messages),
    appendMessage: vi.fn(async (_db: unknown, args: { role: string; content: Record<string, unknown> }) => {
      state.appended.push({ role: args.role, content: args.content })
    }),
  }
})
vi.mock('./actions', () => ({
  pendingCount: vi.fn(async () => state.pending),
  createAction: vi.fn(async (_ctx: unknown, args: Record<string, unknown>) => {
    state.created.push(args)
    return `act-${state.created.length}`
  }),
  executeAndRecord: vi.fn(async (_ctx: unknown, _id: string, tool: string) => {
    state.executed.push(tool)
    return { ok: true, executed: { summary: 'feito' } }
  }),
}))

const readTool: ToolDef = {
  name: 'ler',
  label: 'Leu',
  description: 'lê algo do CRM',
  risk: 'leitura',
  minRole: 'viewer',
  parameters: { type: 'object', properties: {} },
  run: vi.fn(async () => ({ total: 3 })),
}
const smallWrite: ToolDef = {
  name: 'anotar',
  label: 'Anotou',
  description: 'escreve uma nota',
  risk: 'pequena',
  minRole: 'agent',
  parameters: { type: 'object', properties: { texto: { type: 'string', minLength: 1 } }, required: ['texto'] },
  prepare: vi.fn(async (_ctx, input) => ({ preview: { title: 'Nota', lines: [] }, input })),
  execute: vi.fn(async () => ({ summary: 'feito' })),
}
const customerWrite: ToolDef = {
  ...smallWrite,
  name: 'mandar',
  risk: 'cliente',
  prepare: vi.fn(async (_ctx, input) => ({ preview: { title: 'Mensagem', lines: [] }, input })),
}

vi.mock('./tools', () => {
  const tools = () => [readTool, smallWrite, customerWrite]
  return {
    get ALL_TOOLS() {
      return tools()
    },
    toolByName: (name: string) => tools().find((t) => t.name === name),
    toSpec: (t: ToolDef) => ({ name: t.name, description: t.description, parameters: t.parameters }),
  }
})

const { runStep } = await import('./loop')

const fakeDb = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    db: fakeDb,
    admin: fakeDb,
    accountId: 'acc',
    userId: 'u1',
    userName: 'Ana',
    role: 'agent',
    viaAgency: false,
    readOnly: false,
    timezone: 'America/Sao_Paulo',
    now: new Date('2026-11-19T13:00:00Z'),
    ...over,
  }) as never

const ai = { provider: 'anthropic', model: 'claude-haiku', apiKey: 'k' } as never
const settings = (smallChanges = false) => ({ enabled: true, model: null, smallChanges })

function reply(...blocks: unknown[]) {
  return { blocks, usage: null, stopReason: 'end_turn' }
}

beforeEach(() => {
  state.messages = [{ id: 'm1', seq: 1, role: 'user', content: { text: 'oi' }, created_at: '' }]
  state.appended = []
  state.pending = 0
  state.created = []
  state.executed = []
  state.replies = []
  state.calls = []
})

describe('runStep', () => {
  it('a plain answer ends the turn', async () => {
    state.replies.push(reply({ type: 'text', text: 'Olá!' }))
    const r = await runStep({ ctx: ctx(), ai, model: 'claude-sonnet', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('done')
    expect(state.appended.map((m) => m.role)).toEqual(['assistant'])
  })

  it('a read runs now and asks for another turn', async () => {
    state.replies.push(reply({ type: 'tool_call', id: 't1', name: 'ler', input: {} }))
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('continue')
    expect(readTool.run).toHaveBeenCalled()
    const results = state.appended[1].content.results as { content: string }[]
    expect(results[0].content).toBe('{"total":3}')
  })

  it('a change becomes a card and is NOT executed', async () => {
    state.replies.push(reply({ type: 'tool_call', id: 't1', name: 'anotar', input: { texto: 'ligar amanhã' } }))
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('needs_confirmation')
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toMatchObject({ tool: 'anotar', toolCallId: 't1', risk: 'pequena' })
    expect(state.created[0].status).toBeUndefined()
    expect(state.executed).toEqual([])
    const results = state.appended[1].content.results as { content: string }[]
    expect(results[0].content).toContain('aguardando_confirmacao')
  })

  it('with small changes allowed, a small one runs at once — a customer-facing one still asks', async () => {
    state.replies.push(
      reply(
        { type: 'tool_call', id: 't1', name: 'anotar', input: { texto: 'x' } },
        { type: 'tool_call', id: 't2', name: 'mandar', input: { texto: 'y' } },
      ),
    )
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(true), conversationId: 'c' })
    expect(state.executed).toEqual(['anotar'])
    expect(state.created.map((c) => c.status)).toEqual(['running', undefined])
    expect(r.status).toBe('needs_confirmation')
  })

  it('a routine never runs a change by itself', async () => {
    state.replies.push(reply({ type: 'tool_call', id: 't1', name: 'anotar', input: { texto: 'x' } }))
    await runStep({
      ctx: ctx(),
      ai,
      model: 'm',
      settings: settings(true),
      conversationId: 'c',
      routine: { id: 'r1', name: 'Resumo' },
    })
    expect(state.executed).toEqual([])
    expect(state.created[0].ttlMs).toBeGreaterThan(60 * 60_000)
  })

  it('a read-only person is not offered writes, and a forced call is refused', async () => {
    state.replies.push(reply({ type: 'tool_call', id: 't1', name: 'anotar', input: { texto: 'x' } }))
    await runStep({ ctx: ctx({ role: 'viewer', readOnly: true }), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(state.calls[0].tools).toEqual(['ler'])
    expect(state.created).toEqual([])
    const results = state.appended[1].content.results as { isError?: boolean }[]
    expect(results[0].isError).toBe(true)
  })

  it('bad input goes back to the model as an error, nothing is created', async () => {
    state.replies.push(reply({ type: 'tool_call', id: 't1', name: 'anotar', input: {} }))
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('continue')
    expect(state.created).toEqual([])
  })

  it('does not call the model while a card waits', async () => {
    state.messages.push({ id: 'm2', seq: 2, role: 'tool', content: { results: [] }, created_at: '' })
    state.pending = 1
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('needs_confirmation')
    expect(state.calls).toEqual([])
  })

  it('stops after too many turns in a row', async () => {
    for (let i = 0; i < 8; i++) {
      state.messages.push({ id: `a${i}`, seq: 10 + i, role: 'assistant', content: { blocks: [{ type: 'tool_call', id: `x${i}`, name: 'ler', input: {} }] }, created_at: '' })
      state.messages.push({ id: `r${i}`, seq: 30 + i, role: 'tool', content: { results: [] }, created_at: '' })
    }
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('limit')
    expect(state.calls).toEqual([])
  })

  it('falls back to the CRM model when the key cannot use the stronger one', async () => {
    state.replies.push(new AiError('sem modelo', { code: 'model_not_found' }), reply({ type: 'text', text: 'ok' }))
    const r = await runStep({ ctx: ctx(), ai, model: 'claude-sonnet', settings: settings(), conversationId: 'c' })
    expect(r.status).toBe('done')
    expect(state.calls.map((c) => c.model)).toEqual(['claude-sonnet', 'claude-haiku'])
  })

  it('a provider failure is reported, not thrown', async () => {
    state.replies.push(new AiError('lento', { code: 'timeout', status: 504 }))
    const r = await runStep({ ctx: ctx(), ai, model: 'm', settings: settings(), conversationId: 'c' })
    expect(r).toMatchObject({ status: 'error', code: 'timeout' })
  })
})
