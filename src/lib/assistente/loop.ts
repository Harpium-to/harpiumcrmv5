import { AiError, type AiConfig } from '@/lib/ai/types'
import { toolChat, type LlmBlock, type ToolChatResult } from '@/lib/ai/tool-chat'
import { logAiUsage } from '@/lib/ai/usage'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'

import { createAction, executeAndRecord, pendingCount } from './actions'
import { clip, toolJson } from './format'
import { buildOverview } from './overview'
import { describePage, type PageRef } from './page'
import { decide, toolsFor } from './policy'
import { STABLE_PROMPT, buildDynamicPrompt } from './prompt'
import { checkInput } from './schema'
import { appendMessage, loadMessages, stepsSinceUser, toLlmMessages } from './store'
import { ALL_TOOLS, toSpec, toolByName } from './tools'
import { ToolError, type StepStatus, type StoredToolResult, type ToolContext } from './types'
import type { AssistantSettings } from './session'

// ============================================================
// One model turn of a conversation — the unit of work of one request.
//
//   1. read the conversation from the database;
//   2. call the model once, with the tools this person may use;
//   3. run what it asked: reads answer now; writes become cards
//      (or run at once, when the CRM allows small changes unasked);
//   4. save everything and say whether another turn is needed.
//
// The panel calls again while the answer is 'continue'. State lives
// in the database, so a closed tab or a timeout loses nothing, and no
// request needs more than one model call's worth of time.
// ============================================================

/** Model turns per thing the person asked, before stopping to check in. */
export const MAX_STEPS = 8
export const MAX_STEPS_ROUTINE = 6
const MAX_OUTPUT_TOKENS = 4_096
export const ROUTINE_CARD_TTL_MS = 24 * 3_600_000

export interface StepArgs {
  ctx: ToolContext
  ai: AiConfig
  model: string
  settings: AssistantSettings
  conversationId: string
  page?: PageRef | null
  routine?: { id: string; name: string } | null
  onTextDelta?: (text: string) => void
  /** Cap on the provider call, so the caller can stay inside its budget. */
  timeoutMs?: number
}

export interface StepResult {
  status: StepStatus
  error?: string
  /** AiError code when status is 'error' (e.g. 'timeout'). */
  code?: string
}

export async function runStep(args: StepArgs): Promise<StepResult> {
  const { ctx, conversationId } = args
  const messages = await loadMessages(ctx.db, conversationId)
  const last = messages[messages.length - 1]
  if (!last) return { status: 'done' }

  // Nothing to answer: the last turn was the model's, with no tool calls.
  if (last.role === 'assistant') {
    const blocks = (last.content?.blocks ?? []) as LlmBlock[]
    if (!blocks.some((b) => b.type === 'tool_call')) return { status: 'done' }
  }
  // Cards still waiting: the model would only say "waiting".
  if (last.role === 'tool' && (await pendingCount(ctx.admin, conversationId)) > 0) {
    return { status: 'needs_confirmation' }
  }

  const max = args.routine ? MAX_STEPS_ROUTINE : MAX_STEPS
  if (stepsSinceUser(messages) >= max) {
    await appendMessage(ctx.db, {
      conversationId,
      accountId: ctx.accountId,
      role: 'assistant',
      content: {
        blocks: [
          {
            type: 'text',
            text: 'Parei aqui: esse pedido já usou muitos passos de uma vez. Me diga se quer que eu continue de onde parei.',
          },
        ],
      },
    })
    return { status: 'limit' }
  }

  const tools = toolsFor(ALL_TOOLS, ctx.role, ctx.readOnly)
  const [overview, page, memory] = await Promise.all([
    buildOverview(ctx),
    args.routine ? Promise.resolve('Tela atual: nenhuma (rotina rodando sozinha).') : describePage(ctx, args.page),
    loadMemory(ctx),
  ])

  const call = (model: string) =>
    toolChat({
      provider: args.ai.provider,
      apiKey: args.ai.apiKey,
      model,
      systemStable: STABLE_PROMPT,
      systemDynamic: buildDynamicPrompt({ ctx, overview, page, memory, routine: args.routine }),
      messages: toLlmMessages(messages),
      tools: tools.map(toSpec),
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: args.timeoutMs ?? Math.max(aiRequestTimeoutMs(), 45_000),
      onTextDelta: args.onTextDelta,
    })

  let reply: ToolChatResult
  let model = args.model
  try {
    try {
      reply = await call(model)
    } catch (err) {
      // The stronger model may not be enabled for this key: fall back
      // to the one the CRM already uses for replies.
      if (err instanceof AiError && err.code === 'model_not_found' && model !== args.ai.model) {
        model = args.ai.model
        reply = await call(model)
      } else {
        throw err
      }
    }
  } catch (err) {
    const message = err instanceof AiError ? err.message : 'Não consegui falar com a IA agora.'
    if (!(err instanceof AiError)) console.error('[assistente] provider call failed:', err)
    return { status: 'error', error: message, code: err instanceof AiError ? err.code : 'unknown' }
  }

  await logAiUsage(ctx.admin, {
    accountId: ctx.accountId,
    conversationId: null,
    mode: 'assistant',
    provider: args.ai.provider,
    model,
    usage: reply.usage,
  })

  const blocks = reply.blocks.length > 0 ? reply.blocks : [{ type: 'text' as const, text: '…' }]
  await appendMessage(ctx.db, {
    conversationId,
    accountId: ctx.accountId,
    role: 'assistant',
    content: { blocks },
    promptTokens: reply.usage?.promptTokens ?? null,
    completionTokens: reply.usage?.completionTokens ?? null,
  })

  const calls = blocks.filter((b): b is Extract<LlmBlock, { type: 'tool_call' }> => b.type === 'tool_call')
  if (calls.length === 0) return { status: 'done' }

  const offered = new Set(tools.map((t) => t.name))
  let waiting = false
  const results: StoredToolResult[] = await Promise.all(
    calls.map(async (call): Promise<StoredToolResult> => {
      const base = { id: call.id, name: call.name }
      const tool = offered.has(call.name) ? toolByName(call.name) : undefined
      if (!tool) {
        return { ...base, isError: true, content: `A ferramenta "${call.name}" não existe para esta pessoa.` }
      }
      const checked = checkInput(tool.parameters, call.input)
      if (!checked.ok) return { ...base, isError: true, content: `Entrada inválida: ${checked.error}.` }
      try {
        if (tool.risk === 'leitura' && tool.run) {
          return { ...base, content: toolJson(await tool.run(ctx, checked.value)) }
        }
        if (!tool.prepare) return { ...base, isError: true, content: 'Ferramenta sem preparo.' }
        const prepared = await tool.prepare(ctx, checked.value)
        if ('error' in prepared) return { ...base, isError: true, content: `Não deu para preparar: ${prepared.error}.` }
        const risk = prepared.risk ?? (tool.risk === 'leitura' ? 'maior' : tool.risk)
        const decision = decide({
          tool,
          risk,
          role: ctx.role,
          readOnly: ctx.readOnly,
          smallChangesUnasked: args.settings.smallChanges,
          unattended: !!args.routine,
        })
        if (decision.kind === 'deny') return { ...base, isError: true, content: `Não permitido: ${decision.reason}.` }

        if (decision.kind === 'auto') {
          const actionId = await createAction(ctx, {
            conversationId,
            routineId: args.routine?.id,
            tool: tool.name,
            toolCallId: call.id,
            input: prepared.input,
            preview: prepared.preview,
            risk,
            status: 'running',
            auto: true,
          })
          const done = await executeAndRecord(ctx, actionId, tool.name, prepared.input)
          return done.ok
            ? {
                ...base,
                actionId,
                content: toolJson({
                  feito: done.executed.summary,
                  observacao: 'Alteração pequena feita direto (o CRM permite). A pessoa pode desfazer no cartão.',
                  ...(done.executed.result ?? {}),
                }),
              }
            : { ...base, actionId, isError: true, content: `Tentei fazer e deu erro: ${done.error}` }
        }

        const actionId = await createAction(ctx, {
          conversationId,
          routineId: args.routine?.id,
          tool: tool.name,
          toolCallId: call.id,
          input: prepared.input,
          preview: prepared.preview,
          risk,
          // Nobody is at the panel during a routine: its cards wait a day.
          ttlMs: args.routine ? ROUTINE_CARD_TTL_MS : undefined,
        })
        waiting = true
        return {
          ...base,
          actionId,
          content: toolJson({
            status: 'aguardando_confirmacao',
            cartao: prepared.preview.title,
            instrucao:
              'NADA foi feito ainda. O cartão está no painel esperando o OK da pessoa. Diga isso em uma frase; não repita a proposta.',
          }),
        }
      } catch (err) {
        if (err instanceof ToolError) return { ...base, isError: true, content: err.message }
        console.error(`[assistente] tool ${call.name} failed:`, err)
        return {
          ...base,
          isError: true,
          content: `Erro ao usar ${call.name}: ${clip(err instanceof Error ? err.message : String(err), 200)}`,
        }
      }
    }),
  )

  await appendMessage(ctx.db, {
    conversationId,
    accountId: ctx.accountId,
    role: 'tool',
    content: { results },
  })

  return { status: waiting ? 'needs_confirmation' : 'continue' }
}

async function loadMemory(ctx: ToolContext): Promise<{ id: string; content: string }[]> {
  try {
    const { data } = await ctx.db
      .from('assistant_memory')
      .select('id, content')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(40)
    return (data ?? []) as { id: string; content: string }[]
  } catch {
    // Without its memory the bot still answers.
    return []
  }
}
