// ============================================================
// /api/agencia/modelos/[id] — edit or delete a template (super_admin).
//
// PATCH { name?, description?, niche?, suggestedAccess?, active?, content? }
//   content goes through parseTemplateContent: a template that would
//   arrive broken in a CRM is never stored.
// DELETE — custom templates only; built-in ones can be deactivated.
//   CRMs it was applied to keep everything (templates are copied, not
//   linked); their application history keeps the template's name.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { isAgencyAccessLevel, isCrmNiche } from '@/lib/agencia/crm'
import { getTemplate } from '@/lib/agencia/template-store'
import { parseTemplateContent } from '@/lib/agencia/templates'
import { toErrorResponse } from '@/lib/auth/account'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { admin } = await requireAgencia('super_admin')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })

    const update: Record<string, unknown> = {}
    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 })
      }
      update.name = body.name.trim()
    }
    if ('description' in body) {
      update.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null
    }
    if ('niche' in body) {
      if (body.niche !== null && body.niche !== '' && !isCrmNiche(body.niche)) {
        return NextResponse.json({ error: 'Nicho inválido.' }, { status: 400 })
      }
      update.niche = body.niche || null
    }
    if ('suggestedAccess' in body) {
      if (!isAgencyAccessLevel(body.suggestedAccess)) {
        return NextResponse.json({ error: 'Nível de acesso inválido.' }, { status: 400 })
      }
      update.suggested_access = body.suggestedAccess
    }
    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'active precisa ser true ou false.' }, { status: 400 })
      }
      update.active = body.active
    }
    if ('content' in body) {
      const parsed = parseTemplateContent(body.content)
      if (!parsed.ok) {
        return NextResponse.json(
          { error: 'O conteúdo tem problemas.', details: parsed.errors },
          { status: 400 },
        )
      }
      update.content = parsed.content
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nada para alterar.' }, { status: 400 })
    }

    const { error } = await admin.from('crm_templates').update(update).eq('id', id)
    if (error) {
      console.error('[PATCH /api/agencia/modelos/[id]] update error:', error)
      return NextResponse.json({ error: 'Falha ao salvar o modelo' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { admin } = await requireAgencia('super_admin')
    const { id } = await params
    const tpl = await getTemplate(admin, id)
    if (!tpl) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
    if (tpl.builtIn) {
      return NextResponse.json(
        { error: 'Modelos que vêm com o sistema não são excluídos; desative em vez disso.' },
        { status: 400 },
      )
    }
    const { error } = await admin.from('crm_templates').delete().eq('id', id)
    if (error) {
      console.error('[DELETE /api/agencia/modelos/[id]] delete error:', error)
      return NextResponse.json({ error: 'Falha ao excluir o modelo' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
