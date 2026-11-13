import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { isValidSlug, quizHostUrl } from '@/lib/quiz/slug'

/**
 * The public quiz (/q/<slug>, migration 072) is the landing page of an
 * ad: it has no session to refresh, and the round trip to Supabase
 * that every other route pays here would only make it open slower. So
 * it is answered before any of that.
 *
 * When the deployment keeps a domain just for quizzes
 * (NEXT_PUBLIC_QUIZ_URL), a quiz also answers there at the short
 * address /<slug>. Only an address that could be a quiz is rewritten —
 * the app's own routes are reserved words (lib/quiz/slug.ts) — so
 * pointing that variable at the CRM's own host by mistake breaks
 * nothing.
 */
function publicQuizResponse(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  const quizHost = quizHostUrl()
  if (quizHost) {
    const asked = (
      request.headers.get('x-forwarded-host') ??
      request.headers.get('host') ??
      request.nextUrl.host
    ).toLowerCase()
    const short = /^\/([a-z0-9-]+)\/?$/.exec(pathname)
    if (asked === new URL(quizHost).host.toLowerCase() && short && isValidSlug(short[1])) {
      const url = request.nextUrl.clone()
      url.pathname = `/q/${short[1]}`
      return NextResponse.rewrite(url)
    }
  }
  if (pathname.startsWith('/q/') || pathname.startsWith('/api/public/quiz/')) {
    return NextResponse.next()
  }
  return null
}

export async function proxy(request: NextRequest) {
  const quiz = publicQuizResponse(request)
  if (quiz) return quiz

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/leads', '/canais', '/pipelines', '/agenda', '/broadcasts', '/automations', '/flows', '/agents', '/relatorios', '/ferramentas', '/notifications', '/settings', '/agencia', '/aguardando', '/ajuda']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
