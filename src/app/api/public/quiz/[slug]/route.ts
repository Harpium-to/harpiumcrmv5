// ============================================================
// GET  /api/public/quiz/{slug} — a published quiz, for its public page
// POST /api/public/quiz/{slug} — one visit reporting its progress
//
// Behind /q/{slug} (migration 072). No login: the address is public on
// purpose, it goes in ads. What a visitor can read is decided in
// lib/quiz/public.ts and what a visit may write in lib/quiz/session.ts;
// this file is the HTTP around them — limits per address, a body size
// cap, and answers that never say whether a quiz exists but is paused
// (both are 404).
// ============================================================

import { after, NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/leads/admin-client'
import { sendConversion } from '@/lib/quiz/capi'
import { publicDefinition, type PublicQuiz } from '@/lib/quiz/public'
import { MAX_SESSION_BODY_BYTES, parseSessionUpdate } from '@/lib/quiz/session'
import { loadPublishedQuiz } from '@/lib/quiz/store'
import { recordVisit } from '@/lib/quiz/submit'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

// A fresh response each time: a Response's body can be sent only once.
const notFound = () =>
  NextResponse.json({ error: 'Este link não está disponível.' }, { status: 404 })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limit = checkRateLimit(`quiz-read:${clientIp(request)}`, RATE_LIMITS.publicQuizRead)
  if (!limit.success) return rateLimitResponse(limit)

  const { slug } = await params
  const admin = supabaseAdmin()
  const quiz = await loadPublishedQuiz(admin, slug)
  if (!quiz) return notFound()

  const { data: account } = await admin
    .from('accounts')
    .select('name')
    .eq('id', quiz.accountId)
    .maybeSingle()

  const body: PublicQuiz = {
    slug: quiz.slug,
    business: (account as { name?: string } | null)?.name ?? '',
    definition: publicDefinition(quiz.definition),
  }
  // An edit just published must show at once.
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = clientIp(request)
  const all = checkRateLimit(`quiz-write:${ip}`, RATE_LIMITS.publicQuizWrite)
  if (!all.success) return rateLimitResponse(all)

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_SESSION_BODY_BYTES) {
    return NextResponse.json({ error: 'Grande demais' }, { status: 413 })
  }
  const text = await request.text().catch(() => '')
  if (text.length > MAX_SESSION_BODY_BYTES) {
    return NextResponse.json({ error: 'Grande demais' }, { status: 413 })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 400 })
  }

  const { slug } = await params
  const admin = supabaseAdmin()
  const quiz = await loadPublishedQuiz(admin, slug)
  if (!quiz) return notFound()

  const update = parseSessionUpdate(quiz.definition, body)
  if (!update) return NextResponse.json({ error: 'Formato inválido' }, { status: 400 })

  const visit = checkRateLimit(`quiz-visit:${ip}:${update.sid}`, RATE_LIMITS.publicQuizVisit)
  if (!visit.success) return rateLimitResponse(visit)

  try {
    const outcome = await recordVisit(
      admin,
      quiz,
      update,
      {
        ip: ip === 'unknown' ? null : ip,
        userAgent: request.headers.get('user-agent'),
        pageUrl: request.headers.get('referer'),
      },
      { afterLead: (args) => sendConversion(admin, args) },
    )
    // "Lead recebido" (automations, webhook, Agent SDR) and the
    // Conversions API run after the visitor has the answer.
    const followUp = outcome.followUp
    if (followUp) after(() => followUp())
    return NextResponse.json({ ok: true, done: outcome.done, result: outcome.resultId })
  } catch (err) {
    console.error('[quiz] visit failed:', err)
    return NextResponse.json({ error: 'Não consegui registrar agora.' }, { status: 500 })
  }
}
