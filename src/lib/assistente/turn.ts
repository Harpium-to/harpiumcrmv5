import { loadView } from './actions'
import { runStep } from './loop'
import type { PageRef } from './page'
import type { Readiness } from './session'
import type { StepStatus, ToolContext, UiItem } from './types'

// ============================================================
// One step as a streamed response (NDJSON), so the answer appears in
// the panel while the model writes it:
//
//   {"t":"delta","text":"Vocês receberam "}
//   {"t":"delta","text":"**42 leads**…"}
//   {"t":"done","status":"continue","conversationId":"…","items":[…]}
//
// The last line always comes, with the whole conversation as it now
// stands, so the panel never has to reconcile partial text with what
// was saved.
// ============================================================

export interface DoneLine {
  t: 'done'
  status: StepStatus
  conversationId: string
  items: UiItem[]
  error?: string
}

export function streamStep(args: {
  ctx: ToolContext
  ready: Extract<Readiness, { ready: true }>
  conversationId: string
  page?: PageRef | null
}): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      let status: StepStatus = 'error'
      let error: string | undefined
      try {
        const result = await runStep({
          ctx: args.ctx,
          ai: args.ready.ai,
          model: args.ready.model,
          settings: args.ready.settings,
          conversationId: args.conversationId,
          page: args.page,
          onTextDelta: (text) => write({ t: 'delta', text }),
        })
        status = result.status
        error = result.error
      } catch (err) {
        console.error('[assistente] step failed:', err)
        error = 'Algo deu errado neste passo. Tente de novo.'
      }
      let items: UiItem[] = []
      try {
        items = await loadView(args.ctx, args.conversationId)
      } catch (err) {
        console.error('[assistente] view failed:', err)
      }
      const done: DoneLine = { t: 'done', status, conversationId: args.conversationId, items, ...(error ? { error } : {}) }
      write(done)
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** The page the panel says the person is on, checked. */
export function pageFrom(body: Record<string, unknown> | null): PageRef | null {
  const raw = body?.page as { path?: unknown; search?: unknown } | undefined
  if (!raw || typeof raw.path !== 'string' || !raw.path.startsWith('/')) return null
  return {
    path: raw.path.slice(0, 300),
    search: typeof raw.search === 'string' ? raw.search.replace(/^\?/, '').slice(0, 300) : undefined,
  }
}
