import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { parseQuickReplyMedia } from '@/lib/quick-replies/media'

// Quick replies — reusable snippets (plain text, a saved interactive
// message, or a file with an optional caption) shared across the account. GET lists; POST creates. Mirrors
// the automations route: RLS-scoped read via the user client, service-
// role write after an explicit role check.

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    // RLS (quick_replies_select) scopes to the caller's account.
    const { data, error } = await supabase
      .from('quick_replies')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ quick_replies: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const kind =
    body.kind === 'interactive' ? 'interactive' : body.kind === 'media' ? 'media' : 'text'
  if (!title) {
    return NextResponse.json({ error: 'informe o título' }, { status: 400 })
  }

  let content_text: string | null = null
  let interactive_payload: unknown = null
  let media: Record<string, unknown> = {}

  if (kind === 'media') {
    const parsed = parseQuickReplyMedia(
      body,
      ctx.accountId,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    )
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { content_text: caption, ...file } = parsed.value
    content_text = caption
    media = file
  } else if (kind === 'interactive') {
    const result = validateInteractivePayload(body.interactive_payload)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    interactive_payload = body.interactive_payload
  } else {
    const text = typeof body.content_text === 'string' ? body.content_text : ''
    if (!text.trim()) {
      return NextResponse.json(
        { error: 'informe o texto da resposta rápida' },
        { status: 400 },
      )
    }
    content_text = text
  }

  const { data, error } = await supabaseAdmin()
    .from('quick_replies')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      title,
      kind,
      content_text,
      interactive_payload,
      ...media,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ quick_reply: data }, { status: 201 })
}
