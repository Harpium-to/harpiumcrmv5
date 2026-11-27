import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { rememberFact, type MemoryKind } from '@/lib/agents/memory'

// ============================================================
// /api/agents/memory — what the agents learned (agent_memory, 045),
// for the Memória tab (docs/plano-agentes-ativos.md, Fase 0).
//
// GET  any member: the latest memories, filtered by scope/agent/text.
// POST admin+: a memory a person teaches ("nunca prometa entrega em
//      menos de 30 dias"). Written with the service role: the table has
//      no insert policy, because agents write it from the runner.
// ============================================================

const SCOPES = ['agent', 'team', 'contact'] as const
const KINDS: MemoryKind[] = ['fact', 'objection', 'preference', 'outcome', 'instruction']

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams
    let query = supabase
      .from('agent_memory')
      .select('id, agent_id, contact_id, scope, kind, content, created_at, contact:contacts(name)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(params.get('limit')) || 100, 1), 300))
    const scope = params.get('scope')
    if (scope && (SCOPES as readonly string[]).includes(scope)) query = query.eq('scope', scope)
    const agentId = params.get('agentId')
    if (agentId) query = query.eq('agent_id', agentId)
    const contactId = params.get('contactId')
    if (contactId) query = query.eq('contact_id', contactId)
    const q = (params.get('q') ?? '').trim()
    if (q) query = query.ilike('content', `%${q.replace(/[%_]/g, '')}%`)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({
      memories: (data ?? []).map((row) => {
        const r = row as Record<string, unknown>
        return {
          id: r.id,
          agentId: r.agent_id,
          contactId: r.contact_id,
          contactName: (r.contact as { name?: string } | null)?.name ?? null,
          scope: r.scope,
          kind: r.kind,
          content: r.content,
          createdAt: r.created_at,
        }
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content || content.length > 2000) {
      return NextResponse.json({ error: 'Escreva o que os agentes devem lembrar (até 2000 caracteres).' }, { status: 400 })
    }
    const agentId = typeof body.agentId === 'string' && body.agentId ? body.agentId : null
    const admin = supabaseAdmin()
    if (agentId) {
      const { data } = await admin.from('agents').select('id').eq('id', agentId).eq('account_id', accountId).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Agente não encontrado.' }, { status: 404 })
    }
    const kind = KINDS.includes(body.kind as MemoryKind) ? (body.kind as MemoryKind) : 'instruction'
    // A team memory still names an agent in the row (the column the
    // retrieval reads for 'agent' scope); for 'team' it is ignored.
    const { data: anyAgent } = await admin.from('agents').select('id').eq('account_id', accountId).limit(1).maybeSingle()
    const owner = agentId ?? (anyAgent as { id: string } | null)?.id
    if (!owner) return NextResponse.json({ error: 'Crie um agente antes.' }, { status: 400 })
    await rememberFact(admin, {
      accountId,
      agentId: owner,
      contactId: null,
      scope: agentId ? 'agent' : 'team',
      kind,
      content,
    })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
