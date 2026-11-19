import { describe, expect, it, vi } from 'vitest'

import {
  AnthropicStream,
  INVALID_ARGS_KEY,
  OpenAiStream,
  parseAnthropicResponse,
  parseArgs,
  parseOpenAiResponse,
  repairTranscript,
  toAnthropicMessages,
  toOpenAiMessages,
  type LlmMessage,
} from './tool-chat'

const call = (id: string, name = 'buscar_contatos') => ({
  type: 'tool_call' as const,
  id,
  name,
  input: { texto: 'ana' },
})

describe('repairTranscript', () => {
  it('starts on a user turn', () => {
    const out = repairTranscript([
      { role: 'assistant', blocks: [{ type: 'text', text: 'oi' }] },
      { role: 'user', text: 'quantos leads?' },
    ])
    expect(out[0]).toEqual({ role: 'user', text: 'quantos leads?' })
    expect(out).toHaveLength(1)
  })

  it('answers a tool call that never got its result', () => {
    const out = repairTranscript([
      { role: 'user', text: 'a' },
      { role: 'assistant', blocks: [call('c1')] },
      { role: 'user', text: 'b' },
    ])
    expect(out[2]).toMatchObject({ role: 'tool_results', results: [{ id: 'c1', isError: true }] })
    expect(out[3]).toEqual({ role: 'user', text: 'b' })
  })

  it('keeps matching results and drops orphans', () => {
    const out = repairTranscript([
      { role: 'user', text: 'a' },
      { role: 'assistant', blocks: [call('c1')] },
      {
        role: 'tool_results',
        results: [
          { id: 'c1', name: 'buscar_contatos', content: '{"total":1}' },
          { id: 'zz', name: 'x', content: 'orphan' },
        ],
      },
    ])
    expect(out[2]).toEqual({
      role: 'tool_results',
      results: [{ id: 'c1', name: 'buscar_contatos', content: '{"total":1}' }],
    })
  })

  it('never sends an empty assistant turn', () => {
    const out = repairTranscript([
      { role: 'user', text: 'a' },
      { role: 'assistant', blocks: [{ type: 'text', text: '   ' }] },
    ])
    expect(out[1]).toEqual({ role: 'assistant', blocks: [{ type: 'text', text: '…' }] })
  })
})

describe('provider formats', () => {
  const transcript: LlmMessage[] = [
    { role: 'user', text: 'quantos?' },
    { role: 'assistant', blocks: [{ type: 'text', text: 'Vou ver.' }, call('c1')] },
    { role: 'tool_results', results: [{ id: 'c1', name: 'buscar_contatos', content: 'X', isError: true }] },
    { role: 'user', text: '[Sistema] confirmou' },
  ]

  it('Anthropic: tool_use, then tool_result and text in one user turn', () => {
    const out = toAnthropicMessages(transcript)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out[1].content[1]).toEqual({ type: 'tool_use', id: 'c1', name: 'buscar_contatos', input: { texto: 'ana' } })
    expect(out[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'c1', content: 'X', is_error: true })
    expect(out[2].content[1]).toEqual({ type: 'text', text: '[Sistema] confirmou' })
  })

  it('OpenAI: system first, tool_calls with JSON arguments, role tool', () => {
    const out = toOpenAiMessages('regras', transcript)
    expect(out[0]).toEqual({ role: 'system', content: 'regras' })
    expect(out[2]).toMatchObject({
      role: 'assistant',
      content: 'Vou ver.',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'buscar_contatos', arguments: '{"texto":"ana"}' } }],
    })
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'ERRO: X' })
    expect(out[4]).toEqual({ role: 'user', content: '[Sistema] confirmou' })
  })
})

describe('responses', () => {
  it('Anthropic: text and tool_use, usage including cache', () => {
    const r = parseAnthropicResponse({
      content: [
        { type: 'text', text: 'Vou buscar.' },
        { type: 'tool_use', id: 'toolu_1', name: 'buscar_contatos', input: { texto: 'a' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 },
    })
    expect(r.blocks).toHaveLength(2)
    expect(r.stopReason).toBe('tool_use')
    expect(r.usage).toEqual({ promptTokens: 100, completionTokens: 5, totalTokens: 105 })
  })

  it('OpenAI: tool_calls become tool_call blocks, finish reason normalized', () => {
    const r = parseOpenAiResponse({
      choices: [
        {
          message: { content: null, tool_calls: [{ id: 'call_1', function: { name: 'x', arguments: '{"a":1}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    })
    expect(r.blocks).toEqual([{ type: 'tool_call', id: 'call_1', name: 'x', input: { a: 1 } }])
    expect(r.stopReason).toBe('tool_use')
  })

  it('broken arguments are flagged, not thrown', () => {
    expect(parseArgs('{oops')).toHaveProperty(INVALID_ARGS_KEY)
    expect(parseArgs('[1,2]')).toEqual({})
  })
})

describe('streams', () => {
  it('Anthropic events accumulate text and tool input', () => {
    const onText = vi.fn()
    const s = new AnthropicStream(onText)
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'mundo' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'ver' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':2}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    ]
    for (const e of events) s.feed(JSON.stringify(e))
    const r = s.result()
    expect(onText).toHaveBeenCalledTimes(2)
    expect(r.blocks).toEqual([
      { type: 'text', text: 'Olá mundo' },
      { type: 'tool_call', id: 't1', name: 'ver', input: { a: 2 } },
    ])
    expect(r.usage).toEqual({ promptTokens: 7, completionTokens: 9, totalTokens: 16 })
  })

  it('an Anthropic error event throws', () => {
    const s = new AnthropicStream(() => {})
    expect(() => s.feed(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }))).toThrow(/overloaded/)
  })

  it('OpenAI chunks accumulate text and split tool-call arguments', () => {
    const onText = vi.fn()
    const s = new OpenAiStream(onText)
    const chunks = [
      { choices: [{ delta: { content: 'Oi' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'ver', arguments: '{"x"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } },
    ]
    for (const c of chunks) s.feed(JSON.stringify(c))
    s.feed('[DONE]')
    const r = s.result()
    expect(onText).toHaveBeenCalledWith('Oi')
    expect(r.blocks).toEqual([
      { type: 'text', text: 'Oi' },
      { type: 'tool_call', id: 'call_9', name: 'ver', input: { x: 1 } },
    ])
    expect(r.stopReason).toBe('tool_use')
    expect(r.usage?.totalTokens).toBe(10)
  })
})
