import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'

// Manage who the agency operators are. Every handler is gated by
// requireAgencia() — only an existing agency member can list, add, or
// remove members. All writes go through the service-role client because
// agencia_membros has no client-facing write policy (migration 037).

export async function GET() {
  try {
    const { admin, userId } = await requireAgencia()

    const { data: members, error } = await admin
      .from('agencia_membros')
      .select('user_id, label, created_at')
      .order('created_at', { ascending: true })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Resolve emails/names from profiles (no FK to embed, so map by id).
    const ids = (members ?? []).map((m) => m.user_id)
    const metaById = new Map<string, { email: string | null; name: string | null }>()
    if (ids.length > 0) {
      const { data: profs, error: profErr } = await admin
        .from('profiles')
        .select('user_id, email, full_name')
        .in('user_id', ids)
      if (profErr) {
        return NextResponse.json({ error: profErr.message }, { status: 500 })
      }
      for (const p of profs ?? []) {
        metaById.set(p.user_id, { email: p.email ?? null, name: p.full_name ?? null })
      }
    }

    return NextResponse.json({
      members: (members ?? []).map((m) => ({
        userId: m.user_id,
        email: metaById.get(m.user_id)?.email ?? null,
        name: metaById.get(m.user_id)?.name ?? null,
        label: m.label ?? null,
        createdAt: m.created_at,
        isSelf: m.user_id === userId,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireAgencia()

    const body = await request.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()
    const label = body?.label ? String(body.label).trim() : null

    if (!email) {
      return NextResponse.json({ error: 'Email é obrigatório.' }, { status: 400 })
    }

    // The invitee must already have an account (a profile). We look them
    // up by email rather than creating anyone — agency access is granted,
    // not provisioned.
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('user_id, email')
      .ilike('email', email)
      .maybeSingle()
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 })
    }
    if (!prof) {
      return NextResponse.json(
        {
          error:
            'Nenhum usuário com esse email. A pessoa precisa ter uma conta antes de virar membro da agência.',
        },
        { status: 404 },
      )
    }

    const { error: insErr } = await admin
      .from('agencia_membros')
      .upsert({ user_id: prof.user_id, label }, { onConflict: 'user_id' })
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const { admin, userId } = await requireAgencia()

    const target = new URL(request.url).searchParams.get('userId')
    if (!target) {
      return NextResponse.json({ error: 'userId é obrigatório.' }, { status: 400 })
    }
    // Guard against self-lockout — removing your own membership via the UI
    // would leave you unable to re-add anyone without SQL.
    if (target === userId) {
      return NextResponse.json(
        { error: 'Você não pode remover a si mesmo.' },
        { status: 400 },
      )
    }

    const { error } = await admin
      .from('agencia_membros')
      .delete()
      .eq('user_id', target)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
