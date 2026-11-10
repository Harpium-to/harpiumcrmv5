import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { NO_QUICK_REPLY_MEDIA, parseQuickReplyMedia } from '@/lib/quick-replies/media'

// Update / delete a single quick reply. Quick replies are account-
// shared, so every mutation is scoped by `account_id` (the service-role
// client bypasses the agent-gated RLS, so both the role check and the
// account scope are enforced here).
//
// The file of a media reply stays in storage when the reply changes or
// is deleted: messages already sent with it point to the same URL, and
// the inbox would show them broken.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  // Leaving the media kind clears the file columns (the CHECK of 063
  // wants them empty). Only then: before 063 those columns don't exist,
  // and naming them would break every edit.
  const wasMedia = async () => {
    const { data } = await supabaseAdmin()
      .from('quick_replies')
      .select('kind')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    return (data as { kind?: string } | null)?.kind === 'media'
  }

  const update: Record<string, unknown> = {}
  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'o título não pode ficar vazio' }, { status: 400 })
    update.title = title
  }

  // When `kind` is supplied (e.g. the editor flips Text ↔ Interactive), it
  // drives which content column is authoritative and the other is cleared —
  // otherwise a switched row keeps a stale payload the picker mis-routes on.
  if ('kind' in body) {
    if (body.kind !== 'text' && body.kind !== 'interactive' && body.kind !== 'media') {
      return NextResponse.json(
        { error: 'o tipo precisa ser "text", "interactive" ou "media"' },
        { status: 400 },
      )
    }
    update.kind = body.kind
    if (body.kind === 'media') {
      const parsed = parseQuickReplyMedia(
        body,
        ctx.accountId,
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      )
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      Object.assign(update, parsed.value)
      update.interactive_payload = null
    } else if (body.kind === 'interactive') {
      const result = validateInteractivePayload(body.interactive_payload)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      update.interactive_payload = body.interactive_payload
      update.content_text = null
      if (await wasMedia()) Object.assign(update, NO_QUICK_REPLY_MEDIA)
    } else {
      const text = typeof body.content_text === 'string' ? body.content_text : ''
      if (!text.trim()) {
        return NextResponse.json(
          { error: 'informe o texto da resposta rápida' },
          { status: 400 },
        )
      }
      update.content_text = text
      update.interactive_payload = null
      if (await wasMedia()) Object.assign(update, NO_QUICK_REPLY_MEDIA)
    }
  } else {
    // No kind change — allow partial edits of whichever field the row uses.
    if ('content_text' in body) update.content_text = body.content_text ?? null
    if ('interactive_payload' in body) {
      if (body.interactive_payload != null) {
        const result = validateInteractivePayload(body.interactive_payload)
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
      }
      update.interactive_payload = body.interactive_payload ?? null
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabaseAdmin()
    .from('quick_replies')
    .update(update)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { error } = await supabaseAdmin()
    .from('quick_replies')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
