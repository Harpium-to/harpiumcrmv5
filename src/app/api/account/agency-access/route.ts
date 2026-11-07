// ============================================================
// /api/account/agency-access — the CRM owner's consent screen (Fase 3).
//
// GET  what the agency may see in the active CRM, the open request,
//      and — for owner and admins — the history of changes and what
//      the agency did here.
// PUT  the owner changes the level, or grants / ends a temporary one.
//      Body: { level, tempLevel?: 'read' | 'full' | null, tempHours? }
//
// Everything goes through the caller's own session: the tables'
// RLS (049/051) and set_agency_access() decide; this shapes the data.
// ============================================================

import { NextResponse } from 'next/server'

import {
  AGENCY_CONSENT_TERMS_VERSION,
  isAgencyAccessLevel,
} from '@/lib/agencia/crm'
import { loadPendingRequest } from '@/lib/agencia/consent'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { isMissingFunction, isMissingTable } from '@/lib/auth/account-context'
import { hasMinRole } from '@/lib/auth/roles'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const sb = ctx.supabase
    const canSeeLog = hasMinRole(ctx.role, 'admin')

    const accessRes = await sb
      .from('account_agency_access')
      .select('level, temp_level, temp_until, updated_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (accessRes.error) {
      if (isMissingTable(accessRes.error)) {
        return NextResponse.json({ available: false })
      }
      throw accessRes.error
    }

    const [effectiveRes, pending, historyRes, activityRes, nicheRes] = await Promise.all([
      sb.rpc('agency_access_level', { p_account_id: ctx.accountId }),
      loadPendingRequest(sb, ctx.accountId),
      canSeeLog
        ? sb
            .from('account_agency_access_log')
            .select('level, temp_level, temp_until, changed_by, created_at')
            .eq('account_id', ctx.accountId)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      canSeeLog
        ? sb.rpc('my_crm_agency_activity', { p_limit: 50 })
        : Promise.resolve({ data: [], error: null }),
      sb.from('accounts').select('niche').eq('id', ctx.accountId).maybeSingle(),
    ])

    // Names for the history: teammates are readable (049 profiles RLS);
    // anyone else who changed it was the agency (e.g. creating the CRM).
    const history = (historyRes.error ? [] : (historyRes.data ?? [])) as Array<{
      level: string
      temp_level: string | null
      temp_until: string | null
      changed_by: string | null
      created_at: string
    }>
    const ids = [...new Set(history.map((h) => h.changed_by).filter((v): v is string => !!v))]
    const nameById = new Map<string, string>()
    if (ids.length > 0) {
      const { data: people } = await sb
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', ids)
      for (const p of people ?? []) {
        nameById.set(p.user_id, p.full_name || p.email || 'Equipe')
      }
    }

    return NextResponse.json({
      available: true,
      level: accessRes.data?.level ?? 'metrics',
      tempLevel: accessRes.data?.temp_level ?? null,
      tempUntil: accessRes.data?.temp_until ?? null,
      effectiveLevel: isAgencyAccessLevel(effectiveRes.data)
        ? effectiveRes.data
        : (accessRes.data?.level ?? 'metrics'),
      pending,
      canDecide: ctx.role === 'owner' && !ctx.viaAgency,
      canSeeLog,
      niche: nicheRes.error ? null : (nicheRes.data?.niche ?? null),
      history: history.map((h) => ({
        level: h.level,
        tempLevel: h.temp_level,
        tempUntil: h.temp_until,
        by: h.changed_by ? (nameById.get(h.changed_by) ?? 'Agência') : 'Sistema',
        at: h.created_at,
      })),
      activity:
        activityRes.error && !isMissingFunction(activityRes.error)
          ? []
          : ((activityRes.data ?? []) as Array<{
              created_at: string
              action: string
              actor_name: string
            }>).map((a) => ({ at: a.created_at, action: a.action, by: a.actor_name })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    // Not requireRole('owner'): consent must stay changeable even while
    // the CRM is suspended. set_agency_access() checks ownership itself.
    const ctx = await getCurrentAccount()
    if (ctx.role !== 'owner' || ctx.viaAgency) {
      return NextResponse.json(
        { error: 'Só o dono do CRM decide o acesso da agência.' },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!isAgencyAccessLevel(body?.level)) {
      return NextResponse.json({ error: 'Nível de acesso inválido.' }, { status: 400 })
    }
    const tempLevel =
      body?.tempLevel === 'read' || body?.tempLevel === 'full' ? body.tempLevel : null
    const tempHours =
      typeof body?.tempHours === 'number' && Number.isInteger(body.tempHours)
        ? body.tempHours
        : null

    const { error } = await ctx.supabase.rpc('set_agency_access', {
      p_level: body.level,
      p_temp_level: tempLevel,
      p_temp_hours: tempLevel ? tempHours : null,
      p_terms_version: AGENCY_CONSENT_TERMS_VERSION,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao salvar o acesso da agência',
        migration: '049',
        log: 'PUT /api/account/agency-access',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
