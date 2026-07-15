import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { metaAppId } from '@/lib/leads/meta'

// Connected Meta Pages for the current account (native lead integration).
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('meta_lead_pages')
      .select('id, page_id, page_name, subscribed, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({
      configured: Boolean(metaAppId()),
      pages: data ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 })
    }
    const { error } = await supabaseAdmin()
      .from('meta_lead_pages')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
