import { AiError, type AiProvider, type AiUsage } from './types'
import { normalizeUsage, providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Tool calling, for both providers, in one shape.
//
// `generateReply` (generate.ts) only ever wanted text back. The CRM
// assistant (src/lib/assistente) needs the model to ask for tools —
// "search contacts", "propose an automation" — and to get their
// results back on the next turn. OpenAI and Anthropic spell that
// differently (tool_calls + role:"tool" vs tool_use + tool_result
// blocks), so the assistant speaks this neutral format and the two
// adapters below translate.
//
// One call = one model turn. The loop that runs tools and calls again
// lives in the assistant, one turn per HTTP request, so no request has
// to outlive the host's function time limit.
// ============================================================

/** A JSON Schema object, as both providers accept it. */
export type JsonSchema = Record<string, unknown>

export interface ToolSpec {
  name: string
  description: string
  parameters: JsonSchema
}

export type LlmBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }

export interface LlmToolResult {
  id: string
  name: string
  content: string
  isError?: boolean
}

export type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; blocks: LlmBlock[] }
  | { role: 'tool_results'; results: LlmToolResult[] }

export interface ToolChatArgs {
  provider: AiProvider
  apiKey: string
  model: string
  /** Same on every call: rules, tool guide. Cached where the provider can. */
  systemStable: string
  /** Changes per call: the CRM map, the page, the time. */
  systemDynamic: string
  messages: LlmMessage[]
  tools: ToolSpec[]
  maxTokens: number
  timeoutMs: number
  /** When set, the reply is streamed and each text piece is passed here. */
  onTextDelta?: (text: string) => void
}

export interface ToolChatResult {
  blocks: LlmBlock[]
  usage: AiUsage | null
  /** 'tool_use' / 'end_turn' / 'max_tokens' … normalized loosely. */
  stopReason: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

/** Key used when a tool call's arguments were not valid JSON. */
export const INVALID_ARGS_KEY = '__argumentos_invalidos'

export async function toolChat(args: ToolChatArgs): Promise<ToolChatResult> {
  const messages = repairTranscript(args.messages)
  switch (args.provider) {
    case 'anthropic':
      return callAnthropic({ ...args, messages })
    case 'openai':
      return callOpenAi({ ...args, messages })
    default:
      throw new AiError(`Provedor de IA não suportado: ${String(args.provider)}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}

// ------------------------------------------------------------
// Transcript hygiene
// ------------------------------------------------------------

/**
 * Make the history valid for both providers, whatever happened while
 * it was being written:
 *   - it starts on a user turn (leading assistant/tool turns dropped);
 *   - every tool call is answered by a result right after it (a crash
 *     between the call and its result would otherwise make every later
 *     request fail with a 400 forever);
 *   - results that answer no call are dropped.
 */
export function repairTranscript(input: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = []
  let started = false
  for (let i = 0; i < input.length; i++) {
    const m = input[i]
    if (!started) {
      if (m.role !== 'user') continue
      started = true
    }
    if (m.role === 'tool_results') {
      // Handled together with the assistant turn before it.
      continue
    }
    if (m.role === 'user') {
      out.push(m)
      continue
    }
    // assistant
    const calls = m.blocks.filter(
      (b): b is Extract<LlmBlock, { type: 'tool_call' }> => b.type === 'tool_call',
    )
    const blocks = m.blocks.filter((b) => b.type !== 'text' || b.text.trim() !== '')
    out.push({ role: 'assistant', blocks: blocks.length > 0 ? blocks : [{ type: 'text', text: '…' }] })
    if (calls.length === 0) continue

    const next = input[i + 1]
    const given = next && next.role === 'tool_results' ? next.results : []
    const results: LlmToolResult[] = calls.map((call) => {
      const found = given.find((r) => r.id === call.id)
      return (
        found ?? {
          id: call.id,
          name: call.name,
          content: 'Esta ferramenta não chegou a responder (interrompida).',
          isError: true,
        }
      )
    })
    out.push({ role: 'tool_results', results })
  }
  return out
}

// ------------------------------------------------------------
// Anthropic
// ------------------------------------------------------------

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContent[]
}

export function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  const push = (role: 'user' | 'assistant', content: AnthropicContent[]) => {
    const last = out[out.length - 1]
    if (last && last.role === role) {
      // A user turn may carry tool results and then text; results first.
      last.content = [...last.content, ...content]
    } else {
      out.push({ role, content })
    }
  }
  for (const m of messages) {
    if (m.role === 'user') {
      push('user', [{ type: 'text', text: m.text || '…' }])
    } else if (m.role === 'assistant') {
      push(
        'assistant',
        m.blocks.map((b) =>
          b.type === 'text'
            ? { type: 'text' as const, text: b.text }
            : { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input },
        ),
      )
    } else {
      push(
        'user',
        m.results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      )
    }
  }
  return out
}

interface AnthropicResponse {
  content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[]
  stop_reason?: string
  usage?: AnthropicUsage
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

function anthropicUsage(u: AnthropicUsage | undefined): AiUsage | null {
  if (!u) return null
  const prompt =
    (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return normalizeUsage({ prompt, completion: u.output_tokens })
}

export function parseAnthropicResponse(data: AnthropicResponse | null): ToolChatResult {
  const blocks: LlmBlock[] = []
  for (const b of data?.content ?? []) {
    if (b.type === 'text' && typeof b.text === 'string') {
      blocks.push({ type: 'text', text: b.text })
    } else if (b.type === 'tool_use' && b.id && b.name) {
      blocks.push({ type: 'tool_call', id: b.id, name: b.name, input: asObject(b.input) })
    }
  }
  return { blocks, usage: anthropicUsage(data?.usage), stopReason: data?.stop_reason ?? 'end_turn' }
}

async function callAnthropic(args: ToolChatArgs): Promise<ToolChatResult> {
  const streaming = typeof args.onTextDelta === 'function'
  const body = {
    model: args.model,
    max_tokens: args.maxTokens,
    system: [
      { type: 'text', text: args.systemStable, cache_control: { type: 'ephemeral' } },
      ...(args.systemDynamic ? [{ type: 'text', text: args.systemDynamic }] : []),
    ],
    tools: args.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
    messages: toAnthropicMessages(args.messages),
    ...(streaming ? { stream: true } : {}),
  }

  const res = await post(ANTHROPIC_URL, {
    'x-api-key': args.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  }, body, args.timeoutMs)
  if (!res.ok) throw await httpError('Anthropic', res)

  if (!streaming) {
    const data = (await res.json().catch(() => null)) as AnthropicResponse | null
    return parseAnthropicResponse(data)
  }

  const acc = new AnthropicStream(args.onTextDelta!)
  await readSse(res, (data) => acc.feed(data))
  return acc.result()
}

/** Accumulates Anthropic's stream events into the same result shape. */
export class AnthropicStream {
  private parts: { type: 'text' | 'tool_use'; text: string; id?: string; name?: string; json: string }[] = []
  private usage: AnthropicUsage = {}
  private stop = 'end_turn'

  constructor(private readonly onText: (t: string) => void) {}

  feed(raw: string): void {
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const type = ev.type
    if (type === 'message_start') {
      const msg = ev.message as { usage?: AnthropicUsage } | undefined
      this.usage = { ...this.usage, ...(msg?.usage ?? {}) }
    } else if (type === 'content_block_start') {
      const block = ev.content_block as { type?: string; text?: string; id?: string; name?: string }
      const index = Number(ev.index)
      this.parts[index] =
        block?.type === 'tool_use'
          ? { type: 'tool_use', text: '', id: block.id, name: block.name, json: '' }
          : { type: 'text', text: block?.text ?? '', json: '' }
    } else if (type === 'content_block_delta') {
      const index = Number(ev.index)
      const delta = ev.delta as { type?: string; text?: string; partial_json?: string }
      const part = this.parts[index]
      if (!part) return
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        part.text += delta.text
        this.onText(delta.text)
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        part.json += delta.partial_json
      }
    } else if (type === 'message_delta') {
      const delta = ev.delta as { stop_reason?: string } | undefined
      if (delta?.stop_reason) this.stop = delta.stop_reason
      const usage = ev.usage as AnthropicUsage | undefined
      if (usage?.output_tokens != null) this.usage.output_tokens = usage.output_tokens
    } else if (type === 'error') {
      const err = ev.error as { message?: string } | undefined
      throw new AiError(`Anthropic: ${err?.message ?? 'erro no meio da resposta'}`, {
        code: 'provider_error',
      })
    }
  }

  result(): ToolChatResult {
    const blocks: LlmBlock[] = []
    for (const p of this.parts) {
      if (!p) continue
      if (p.type === 'text') {
        if (p.text) blocks.push({ type: 'text', text: p.text })
      } else if (p.id && p.name) {
        blocks.push({ type: 'tool_call', id: p.id, name: p.name, input: parseArgs(p.json || '{}') })
      }
    }
    return { blocks, usage: anthropicUsage(this.usage), stopReason: this.stop }
  }
}

// ------------------------------------------------------------
// OpenAI (Chat Completions)
// ------------------------------------------------------------

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text || '…' })
    } else if (m.role === 'assistant') {
      const text = m.blocks
        .filter((b): b is Extract<LlmBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n')
      const calls = m.blocks.filter(
        (b): b is Extract<LlmBlock, { type: 'tool_call' }> => b.type === 'tool_call',
      )
      out.push({
        role: 'assistant',
        content: text || (calls.length > 0 ? null : '…'),
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      })
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERRO: ${r.content}` : r.content })
      }
    }
  }
  return out
}

interface OpenAiResponse {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
    }
    finish_reason?: string
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export function parseOpenAiResponse(data: OpenAiResponse | null): ToolChatResult {
  const choice = data?.choices?.[0]
  const blocks: LlmBlock[] = []
  const text = choice?.message?.content
  if (typeof text === 'string' && text.trim()) blocks.push({ type: 'text', text })
  for (const call of choice?.message?.tool_calls ?? []) {
    if (!call.id || !call.function?.name) continue
    blocks.push({
      type: 'tool_call',
      id: call.id,
      name: call.function.name,
      input: parseArgs(call.function.arguments ?? '{}'),
    })
  }
  return {
    blocks,
    usage: normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    }),
    stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : (choice?.finish_reason ?? 'stop'),
  }
}

async function callOpenAi(args: ToolChatArgs): Promise<ToolChatResult> {
  const streaming = typeof args.onTextDelta === 'function'
  const system = args.systemDynamic
    ? `${args.systemStable}\n\n${args.systemDynamic}`
    : args.systemStable
  const body = {
    model: args.model,
    messages: toOpenAiMessages(system, args.messages),
    tools: args.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    max_completion_tokens: args.maxTokens,
    ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
  }

  const res = await post(OPENAI_URL, { Authorization: `Bearer ${args.apiKey}` }, body, args.timeoutMs)
  if (!res.ok) throw await httpError('OpenAI', res)

  if (!streaming) {
    const data = (await res.json().catch(() => null)) as OpenAiResponse | null
    return parseOpenAiResponse(data)
  }

  const acc = new OpenAiStream(args.onTextDelta!)
  await readSse(res, (data) => acc.feed(data))
  return acc.result()
}

/** Accumulates OpenAI's stream chunks into the same result shape. */
export class OpenAiStream {
  private text = ''
  private calls: { id: string; name: string; args: string }[] = []
  private finish = 'stop'
  private usage: OpenAiResponse['usage'] = undefined

  constructor(private readonly onText: (t: string) => void) {}

  feed(raw: string): void {
    if (raw.trim() === '[DONE]') return
    let chunk: {
      choices?: {
        delta?: {
          content?: string | null
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
        finish_reason?: string | null
      }[]
      usage?: OpenAiResponse['usage']
      error?: { message?: string }
    }
    try {
      chunk = JSON.parse(raw)
    } catch {
      return
    }
    if (chunk.error) {
      throw new AiError(`OpenAI: ${chunk.error.message ?? 'erro no meio da resposta'}`, {
        code: 'provider_error',
      })
    }
    if (chunk.usage) this.usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta
    if (typeof delta?.content === 'string' && delta.content) {
      this.text += delta.content
      this.onText(delta.content)
    }
    for (const tc of delta?.tool_calls ?? []) {
      const index = tc.index ?? 0
      const slot = (this.calls[index] ??= { id: '', name: '', args: '' })
      if (tc.id) slot.id = tc.id
      if (tc.function?.name) slot.name += tc.function.name
      if (tc.function?.arguments) slot.args += tc.function.arguments
    }
    if (choice.finish_reason) this.finish = choice.finish_reason
  }

  result(): ToolChatResult {
    const blocks: LlmBlock[] = []
    if (this.text.trim()) blocks.push({ type: 'text', text: this.text })
    for (const c of this.calls) {
      if (!c || !c.id || !c.name) continue
      blocks.push({ type: 'tool_call', id: c.id, name: c.name, input: parseArgs(c.args || '{}') })
    }
    return {
      blocks,
      usage: normalizeUsage({
        prompt: this.usage?.prompt_tokens,
        completion: this.usage?.completion_tokens,
        total: this.usage?.total_tokens,
      }),
      stopReason: this.finish === 'tool_calls' ? 'tool_use' : this.finish,
    }
  }
}

// ------------------------------------------------------------
// Shared plumbing
// ------------------------------------------------------------

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
}

/** A 404 here is almost always a model the key cannot use. */
async function httpError(provider: string, res: Response): Promise<AiError> {
  if (res.status === 404) {
    return new AiError(`${provider}: o modelo escolhido não está disponível para esta chave.`, {
      code: 'model_not_found',
      status: 502,
    })
  }
  return providerHttpError(provider, res)
}

/** Read a `text/event-stream` body, handing each `data:` payload over. */
async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new AiError('O provedor não mandou a resposta.', { code: 'empty_response' })
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) onData(line.slice(5).trimStart())
      }
    }
    const rest = buffer.trim()
    if (rest.startsWith('data:')) onData(rest.slice(5).trimStart())
  } catch (err) {
    if (err instanceof AiError) throw err
    throw toNetworkError(err)
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Tool arguments arrive as JSON text; a broken one is flagged, not thrown. */
export function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return asObject(parsed)
  } catch {
    return { [INVALID_ARGS_KEY]: raw.slice(0, 200) }
  }
}
