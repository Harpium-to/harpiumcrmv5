import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { loadTaskSteps } from '@/lib/agents/tasks'

/**
 * GET /api/agents/tasks/:id
 *
 * One task with its execution trace — what the monitor's detail panel
 * opens. Steps are the point: they are why the panel can say "Etapa 3:
 * construindo abordagem" instead of a spinner.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Tarefa não encontrada' }, { status: 404 })
    }

    const steps = await loadTaskSteps(supabase, id)
    return NextResponse.json({ task: data, steps })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/agents/tasks/:id  (agent+)
 *
 * The two things a human does to a queued task: cancel it, or push it
 * to the front. Anything else about a task is the runner's business.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('agent')

    const body = await request.json().catch(() => null)
    const action =
      body && typeof body === 'object' && typeof body.action === 'string'
        ? body.action
        : ''

    const update =
      action === 'cancel'
        ? { status: 'cancelled', finished_at: new Date().toISOString() }
        : action === 'prioritize'
          ? { priority: 100, scheduled_for: new Date().toISOString() }
          : null

    if (!update) {
      return NextResponse.json(
        { error: 'a ação precisa ser "cancel" ou "prioritize"' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('agent_tasks')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      // A task already running or finished is not cancellable — the
      // work is either in flight at the provider or done, and flipping
      // the row would make the queue lie about what happened.
      .in('status', ['queued', 'blocked', 'waiting_approval'])
      .select('id, status')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: 'Tarefa não encontrada ou já em execução' },
        { status: 409 },
      )
    }

    return NextResponse.json({ task: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
