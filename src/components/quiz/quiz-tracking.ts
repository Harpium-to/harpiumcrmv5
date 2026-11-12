// ============================================================
// What the public quiz page keeps track of, in the browser:
//
//   - the UTMs the visit arrived with (kept for the tab's lifetime);
//   - an id for the visit, so every screen updates the same row;
//   - the Meta Pixel: PageView on load, and one event per result, each
//     with an event id the server repeats to the Conversions API so
//     Meta counts the lead once;
//   - `quiz_etapa` events in window.dataLayer (GTM / GA4), never sent
//     to the Pixel, so the campaign's optimisation signal stays clean;
//   - the visit's progress, posted to /api/public/quiz/<slug> at every
//     screen. A failed post is ignored: the quiz never stops because
//     the record did.
//
// Browser only.
// ============================================================

import { UTM_KEYS } from '@/lib/quiz/session'
import type { QuizAnswers, QuizResult } from '@/lib/quiz/types'

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue?: unknown[]
  loaded?: boolean
  version?: string
  push?: unknown
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
    dataLayer?: Record<string, unknown>[]
  }
}

function readStore(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStore(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* storage blocked: the visit still works, it just is not resumed */
  }
}

export function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/** UTMs from the address, added to the ones already seen in this tab. */
export function captureUtms(): Record<string, string> {
  const params = new URLSearchParams(window.location.search)
  let saved: Record<string, string> = {}
  try {
    saved = JSON.parse(readStore('hq_utms') || '{}') as Record<string, string>
  } catch {
    saved = {}
  }
  const utms = { ...saved }
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) utms[key] = value
  }
  writeStore('hq_utms', JSON.stringify(utms))
  return utms
}

function visitId(slug: string): string {
  const key = `hq_sid:${slug}`
  const saved = readStore(key)
  if (saved) return saved
  const sid = randomId()
  writeStore(key, sid)
  return sid
}

function cookie(name: string): string | undefined {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined
}

// ------------------------------------------------------------
// Meta Pixel
// ------------------------------------------------------------

/** Load the Pixel (the official snippet) and send PageView. */
export function startPixel(pixelId: string | undefined) {
  if (!pixelId || window.fbq) return
  const fbq: Fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args)
    else fbq.queue!.push(args)
  } as Fbq
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = '2.0'
  fbq.queue = []
  window.fbq = fbq
  window._fbq = fbq
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(script)
  fbq('init', pixelId)
  fbq('track', 'PageView')
}

export function trackResult(pixel: QuizResult['pixel'], slug: string, eventId: string) {
  if (pixel.kind === 'none' || !pixel.name) return
  window.fbq?.(
    pixel.kind === 'standard' ? 'track' : 'trackCustom',
    pixel.name,
    { content_name: slug },
    { eventID: eventId },
  )
}

/** A step event for GTM / GA4, to measure where people leave. */
export function pushStage(stage: string) {
  ;(window.dataLayer ||= []).push({ event: 'quiz_etapa', etapa: stage })
}

// ------------------------------------------------------------
// The visit's record
// ------------------------------------------------------------

export interface VisitState {
  answers?: QuizAnswers
  eventId?: string
  done?: boolean
  cta?: boolean
  consent?: boolean
  /** The hidden field's value; empty for a person. */
  website?: string
}

export interface VisitReporter {
  /** Record that a screen was seen, with whatever else changed. */
  report(screen: string | null, state?: VisitState): Promise<{ result?: string | null } | null>
}

/** The builder's test run: nothing leaves the browser. */
export const SILENT_REPORTER: VisitReporter = {
  report: () => Promise.resolve(null),
}

export function createReporter(slug: string, options: { embed: boolean }): VisitReporter {
  const sid = visitId(slug)
  const utms = captureUtms()
  const device = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
  const steps: string[] = []
  let answers: QuizAnswers = {}
  let eventId: string | undefined
  let consent = false
  let seq = 0

  return {
    async report(screen, state = {}) {
      if (screen && !steps.includes(screen)) steps.push(screen)
      if (state.answers) answers = state.answers
      if (state.eventId) eventId = state.eventId
      if (state.consent) consent = true
      seq += 1
      try {
        const res = await fetch(`/api/public/quiz/${encodeURIComponent(slug)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The last update of a page being closed still goes out.
          keepalive: true,
          body: JSON.stringify({
            sid,
            seq,
            steps,
            answers,
            utms,
            device,
            eventId,
            consent,
            done: state.done === true,
            cta: state.cta === true,
            website: state.website ?? '',
            meta: { fbp: cookie('_fbp'), fbc: cookie('_fbc'), embed: options.embed },
          }),
        })
        if (!res.ok) return null
        return (await res.json()) as { result?: string | null }
      } catch {
        return null
      }
    },
  }
}
