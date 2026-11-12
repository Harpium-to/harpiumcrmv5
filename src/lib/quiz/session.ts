// ============================================================
// A visit to a quiz, as the browser reports it.
//
// At every screen the public page sends the whole state of the visit:
// the screens seen, the answers so far and, at the end, that it is
// done. Nothing in it is trusted: screens and options are checked
// against the quiz, text is cut to size, and the result is never read
// from the browser — the server works it out (engine.ts).
//
// Pure — no I/O. The route that stores the visit is submit.ts.
// ============================================================

import { funnelScreens, normalizeFieldValue } from './engine'
import {
  RESULT_STEP,
  type QuizAnswer,
  type QuizAnswers,
  type QuizDefinition,
} from './types'

/** The largest body the public route reads. */
export const MAX_SESSION_BODY_BYTES = 20_000

const SID = /^[a-zA-Z0-9-]{8,64}$/
const EVENT_ID = /^[a-zA-Z0-9._-]{8,64}$/
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
] as const

export interface SessionUpdate {
  sid: string
  /** The browser's counter; a late, older update is ignored. */
  seq: number
  steps: string[]
  answers: QuizAnswers
  utms: Record<string, string>
  device: 'mobile' | 'desktop' | null
  eventId: string | null
  /** The visit reached the result screen. */
  done: boolean
  /** A click on the result screen's button. */
  cta: boolean
  /** The consent line was shown and accepted. */
  consent: boolean
  meta: { fbp?: string; fbc?: string; embed?: boolean }
  /** The hidden field only a robot fills. */
  trap: boolean
}

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().slice(0, max)
  return s || undefined
}

function readAnswers(def: QuizDefinition, raw: unknown): QuizAnswers {
  const out: QuizAnswers = {}
  if (!isDict(raw)) return out
  for (const step of def.steps) {
    if (step.type === 'choice') {
      const value = raw[step.id]
      const valid = new Set(step.options.map((o) => o.id))
      if (step.multiple) {
        const ids = (Array.isArray(value) ? value : [value]).filter(
          (id): id is string => typeof id === 'string' && valid.has(id),
        )
        if (ids.length) out[step.id] = [...new Set(ids)]
      } else if (typeof value === 'string' && valid.has(value)) {
        out[step.id] = value
      }
    } else if (step.type === 'fields') {
      for (const field of step.fields) {
        const value = raw[field.id]
        if (typeof value !== 'string') continue
        const clean = normalizeFieldValue(field, value)
        if (clean) out[field.id] = clean
      }
    }
  }
  return out
}

/** Read one update. null = not something this quiz's page would send. */
export function parseSessionUpdate(def: QuizDefinition, body: unknown): SessionUpdate | null {
  if (!isDict(body)) return null
  if (typeof body.sid !== 'string' || !SID.test(body.sid)) return null

  const known = funnelScreens(def)
  const sent = Array.isArray(body.steps) ? body.steps : []
  const steps = known.filter((id) => sent.includes(id))

  const utms: Record<string, string> = {}
  if (isDict(body.utms)) {
    for (const key of UTM_KEYS) {
      const value = clip(body.utms[key], 200)
      if (value) utms[key] = value
    }
  }

  const meta: SessionUpdate['meta'] = {}
  if (isDict(body.meta)) {
    const fbp = clip(body.meta.fbp, 200)
    const fbc = clip(body.meta.fbc, 300)
    if (fbp) meta.fbp = fbp
    if (fbc) meta.fbc = fbc
    if (body.meta.embed === true) meta.embed = true
  }

  const seq = Number(body.seq)
  const eventId = typeof body.eventId === 'string' && EVENT_ID.test(body.eventId) ? body.eventId : null

  return {
    sid: body.sid,
    seq: Number.isInteger(seq) && seq >= 0 && seq < 100_000 ? seq : 0,
    steps,
    answers: readAnswers(def, body.answers),
    utms,
    device: body.device === 'mobile' || body.device === 'desktop' ? body.device : null,
    eventId,
    done: body.done === true && steps.includes(RESULT_STEP),
    cta: body.cta === true,
    consent: body.consent === true,
    meta,
    trap: typeof body.website === 'string' && body.website.trim() !== '',
  }
}

/** Screens seen, never losing one already recorded, in the quiz's order. */
export function mergeSteps(def: QuizDefinition, previous: string[], next: string[]): string[] {
  const all = new Set([...previous, ...next])
  return funnelScreens(def).filter((id) => all.has(id))
}

/** The furthest screen reached that is not the result. */
export function lastStep(steps: string[]): string | null {
  const before = steps.filter((id) => id !== RESULT_STEP)
  return before.length ? before[before.length - 1] : null
}

export function answerText(answer: QuizAnswer | undefined): string {
  if (answer === undefined) return ''
  return Array.isArray(answer) ? answer.join(', ') : answer
}
