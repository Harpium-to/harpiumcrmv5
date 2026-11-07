import { NextResponse } from 'next/server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { requireAgencia } from '@/lib/agencia/guard'
import { isAgenciaRole, type AgenciaRole } from '@/lib/agencia/roles'
import { toErrorResponse } from '@/lib/auth/account'

// Manage who the agency operators are. Any agency member can list;
// only a super_admin can add, change or remove (migration 049 roles —
// before 049 every member counts as super_admin). All writes go
// through the service-role client because agencia_membros has no
// client-facing write policy (migration 037).

/** Postgres / PostgREST "column does not exist" — 049 not applied. */
function isMissingColumn(err: { code?: string }): boolean {
  return err.code === '42703' || err.code === 'PGRST204'
}

async function loadMembers(admin: SupabaseClient) {
  const withRole = await admin
    .from('agencia_membros')
    .select('user_id, label, role, created_at')
    .order('created_at', { ascending: true })
  if (!withRole.error) return withRole
  if (!isMissingColumn(withRole.error)) return withRole
  const legacy = await admin
    .from('agencia_membros')
    .select('user_id, label, created_at')
    .order('created_at', { ascending: true })
  return {
    data: (legacy.data ?? []).map((m) => ({ ...m, role: 'super_admin' })),
    error: legacy.error,
  }
}

export async function GET() {
  try {
    const { admin, userId, role: myRole } = await requireAgencia()

    const { data: members, error } = await loadMembers(admin)
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
        role: isAgenciaRole(m.role) ? m.role : 'support',
        createdAt: m.created_at,
        isSelf: m.user_id === userId,
      })),
      canManage: myRole === 'super_admin',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireAgencia('super_admin')

    const body = await request.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()
    const label = body?.label ? String(body.label).trim() : null
    // Least privilege unless the super_admin picks otherwise.
    const role: AgenciaRole = isAgenciaRole(body?.role) ? body.role : 'support'

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

    let { error: insErr } = await admin
      .from('agencia_membros')
      .upsert({ user_id: prof.user_id, label, role }, { onConflict: 'user_id' })
    if (insErr && isMissingColumn(insErr)) {
      // Pre-049: no roles yet.
      ;({ error: insErr } = await admin
        .from('agencia_membros')
        .upsert({ user_id: prof.user_id, label }, { onConflict: 'user_id' }))
    }
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { admin, userId } = await requireAgencia('super_admin')

    const body = await request.json().catch(() => ({}))
    const target = String(body?.userId ?? '')
    if (!target || !isAgenciaRole(body?.role)) {
      return NextResponse.json(
        { error: 'Informe userId e um papel válido.' },
        { status: 400 },
      )
    }
    // Same self-lockout guard as DELETE: a super_admin demoting
    // themselves could leave the team with nobody able to manage it.
    if (target === userId) {
      return NextResponse.json(
        { error: 'Você não pode mudar o seu próprio papel.' },
        { status: 400 },
      )
    }

    const { error } = await admin
      .from('agencia_membros')
      .update({ role: body.role })
      .eq('user_id', target)
    if (error) {
      return NextResponse.json(
        {
          error: isMissingColumn(error)
            ? 'Papéis da agência exigem a migration 049.'
            : error.message,
        },
        { status: isMissingColumn(error) ? 409 : 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const { admin, userId } = await requireAgencia('super_admin')

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
