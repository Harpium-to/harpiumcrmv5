import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { enqueueTask, loadTasks } from '@/lib/agents/tasks'
import { bad } from '@/lib/agents/payload'
import type { AgentTaskStatus } from '@/lib/agents/types'

const STATUSES: AgentTaskStatus[] = [
  'queued',
  'blocked',
  'running',
  'waiting_approval',
  'done',
  'failed',
  'cancelled',
]

/**
 * GET /api/agents/tasks?status=running,queued&limit=50
 *
 * The queue, newest first. Any member reads — the operation board is
 * for whoever is on shift.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams

    const statusParam = params.get('status')
    const status = statusParam
      ? statusParam
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is AgentTaskStatus =>
            (STATUSES as string[]).includes(s),
          )
      : undefined

    const limitRaw = Number(params.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50

    const tasks = await loadTasks(supabase, accountId, { status, limit })
    return NextResponse.json({ tasks })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/agents/tasks  (agent+)
 *
 * Put work in the queue by hand — "pesquise esta empresa", "retome
 * este lead". The same door the orchestrator uses, so a human-created
 * task is indistinguishable downstream from a delegated one.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`agent-tasks:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Corpo inválido')

    const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!kind) return bad('kind é obrigatório')
    if (!title) return bad('title é obrigatório')

    const agentId = typeof body.agent_id === 'string' ? body.agent_id : null
    const targetRole =
      typeof body.target_role === 'string' ? body.target_role.trim() : null
    if (!agentId && !targetRole) {
      return bad('Informe agent_id ou target_role')
    }

    const task = await enqueueTask(supabase, {
      accountId,
      agentId,
      targetRole,
      createdBy: userId,
      kind,
      title: title.slice(0, 200),
      input:
        body.input && typeof body.input === 'object' && !Array.isArray(body.input)
          ? (body.input as Record<string, unknown>)
          : {},
      contactId: typeof body.contact_id === 'string' ? body.contact_id : null,
      dealId: typeof body.deal_id === 'string' ? body.deal_id : null,
      conversationId:
        typeof body.conversation_id === 'string' ? body.conversation_id : null,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0,
      dedupeKey:
        typeof body.dedupe_key === 'string' && body.dedupe_key.trim()
          ? body.dedupe_key.trim()
          : null,
    })

    // null means the dedupe key matched an existing task. That is a
    // success — the work is queued, just not by this request.
    if (!task) {
      return NextResponse.json({ task: null, deduplicated: true }, { status: 200 })
    }
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
