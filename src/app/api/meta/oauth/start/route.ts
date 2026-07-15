import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { buildOAuthUrl, metaAppId } from '@/lib/leads/meta'

// Kicks off the "Connect Facebook" flow. Admin-only. Redirects the
// browser to Facebook Login; a random state is stored in an httpOnly
// cookie and echoed back on the callback to defeat CSRF.
export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  try {
    await requireRole('admin')
  } catch {
    return NextResponse.redirect(`${origin}/leads?meta_error=forbidden`)
  }

  const appId = metaAppId()
  if (!appId) {
    return NextResponse.redirect(`${origin}/leads?meta_error=config`)
  }

  const state = randomBytes(16).toString('hex')
  const redirectUri = `${origin}/api/meta/oauth/callback`
  const url = buildOAuthUrl({ appId, redirectUri, state })

  const res = NextResponse.redirect(url)
  res.cookies.set('meta_oauth_state', state, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
