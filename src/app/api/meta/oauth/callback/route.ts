import { NextResponse } from 'next/server'

import { getCurrentAccount } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import {
  exchangeCodeForToken,
  fetchPages,
  metaAppId,
  subscribePageLeadgen,
} from '@/lib/leads/meta'

// OAuth return. Verifies the CSRF state, exchanges the code, lists the
// user's Pages, stores each Page token (encrypted) against the account,
// and subscribes each Page to our app's leadgen webhook.
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/leads?meta_error=${reason}`)

  // Must be signed in to attribute the pages to an account.
  let accountId: string
  try {
    accountId = (await getCurrentAccount()).accountId
  } catch {
    return NextResponse.redirect(`${origin}/login`)
  }

  if (searchParams.get('error')) return fail('denied')

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const cookieState = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('meta_oauth_state='))
    ?.split('=')[1]
  if (!code || !state || !cookieState || state !== cookieState) {
    return fail('state')
  }

  const appId = metaAppId()
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return fail('config')

  const redirectUri = `${origin}/api/meta/oauth/callback`

  try {
    const userToken = await exchangeCodeForToken({
      appId,
      appSecret,
      redirectUri,
      code,
    })
    const pages = await fetchPages(userToken)
    if (pages.length === 0) return fail('no_pages')

    const admin = supabaseAdmin()
    let connected = 0
    for (const page of pages) {
      const subscribed = await subscribePageLeadgen(page.id, page.accessToken)
      const { error } = await admin.from('meta_lead_pages').upsert(
        {
          account_id: accountId,
          page_id: page.id,
          page_name: page.name,
          access_token: encrypt(page.accessToken),
          subscribed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'page_id' },
      )
      if (!error) connected++
      else console.error('[meta oauth] store page failed:', error.message)
    }

    const res = NextResponse.redirect(`${origin}/leads?meta_connected=${connected}`)
    res.cookies.delete('meta_oauth_state')
    return res
  } catch (err) {
    console.error('[meta oauth] callback failed:', err)
    return fail('exchange')
  }
}
