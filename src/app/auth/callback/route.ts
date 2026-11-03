import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

// Redirect target for Supabase auth email links (password recovery,
// email-change confirmation). The link lands here carrying a PKCE `code`
// which we exchange for a session cookie, then forward to `next`
// (e.g. /reset-password). Without this route the recovery link dead-ended
// on a 404 — the bug that made "forgot password" unusable.
//
// The code_verifier half of the PKCE pair was written as a cookie by the
// browser client when it called resetPasswordForEmail, so the exchange
// works even though a different device/tab may open the link.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Only follow same-site relative paths — never an attacker-supplied
  // absolute URL (open-redirect guard).
  const nextParam = searchParams.get('next') ?? '/dashboard'
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//')
      ? nextParam
      : '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/callback] code exchange failed:', error.message)
  }

  // No code, or exchange failed (expired/used link) — bounce to login
  // with a flag the page can surface.
  return NextResponse.redirect(`${origin}/login?error=auth_link_invalid`)
}
