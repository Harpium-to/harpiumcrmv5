// ============================================================
// POST /api/agencia/modelos — create a niche template (super_admin).
//
// Body, one of:
//   { fromAccountId, name, niche?, description? }  copy a CRM's structure
//                                                  (agencia_template_from_account,
//                                                  migration 053: consent-checked)
//   { duplicateOf, name? }                         copy another template
//   { name, niche? }                               start empty
// ============================================================

import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { isCrmNiche } from '@/lib/agencia/crm'
import { getTemplate, templateSlug } from '@/lib/agencia/template-store'
import { toErrorResponse } from '@/lib/auth/account'
import { isMissingTable } from '@/lib/auth/account-context'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { admin, userId } = await requireAgencia('super_admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const niche = isCrmNiche(body?.niche) ? body.niche : null
    const description = typeof body?.description === 'string' ? body.description.trim() : ''

    if (typeof body?.fromAccountId === 'string') {
      if (!name) {
        return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 })
      }
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('agencia_template_from_account', {
        p_account_id: body.fromAccountId,
        p_name: name,
        p_niche: niche,
        p_description: description || null,
      })
      if (error) {
        return rpcErrorToResponse(error, {
          fallback: 'Falha ao salvar o modelo',
          migration: '053',
          log: 'POST /api/agencia/modelos',
        })
      }
      return NextResponse.json({ id: data }, { status: 201 })
    }

    let base: { name: string; niche: string | null; description: string | null; content: unknown; suggestedAccess: string } = {
      name,
      niche,
      description: description || null,
      content: { pipelines: [], tags: [], custom_fields: [], quick_replies: [], automations: [] },
      suggestedAccess: 'metrics',
    }
    if (typeof body?.duplicateOf === 'string') {
      const source = await getTemplate(admin, body.duplicateOf)
      if (!source) {
        return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
      }
      base = {
        name: name || `${source.name} (cópia)`,
        niche: source.niche,
        description: source.description,
        content: source.content,
        suggestedAccess: source.suggestedAccess,
      }
    }
    if (!base.name) {
      return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('crm_templates')
      .insert({
        slug: templateSlug(base.name, randomBytes(3).toString('hex')),
        name: base.name,
        niche: base.niche,
        description: base.description,
        content: base.content,
        suggested_access: base.suggestedAccess,
        created_by: userId,
      })
      .select('id')
      .single()
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          { error: 'Isto exige a migration 053 aplicada no Supabase.' },
          { status: 409 },
        )
      }
      console.error('[POST /api/agencia/modelos] insert error:', error)
      return NextResponse.json({ error: 'Falha ao criar o modelo' }, { status: 500 })
    }
    return NextResponse.json({ id: data.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
