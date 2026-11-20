// ============================================================
// The pace of a PROSPECTING send through the QR-code number: messages
// to people who never talked to the company (the lead extractor's
// lists). Pure, so it is tested.
//
// Decided in docs/plano-extrator-leads.md ("Risco de bloqueio"):
//   - one every 60–180 s, drawn at random;
//   - Monday to Friday, 9h to 18h Brasília time, never on a national
//     holiday;
//   - a ceiling per day that grows with the weeks since this CRM's
//     first prospecting send: 20, 40, 60, then 80;
//   - and the CRM's overall ceiling (plan.ts, 200 a day) still holds,
//     prospecting and ordinary sends together.
// A send that does not fit today moves to the next working morning.
// ============================================================

import { BULK_DAILY_LIMIT, dayKey } from './plan'

export const PROSPECT_GAP_MIN_S = 60
export const PROSPECT_GAP_MAX_S = 180
export const PROSPECT_DAY_START_H = 9
export const PROSPECT_DAY_END_H = 18
/** Per-day ceiling in weeks 1, 2, 3 and from week 4 on. */
export const PROSPECT_RAMP = [20, 40, 60, 80] as const
/** The most one prospecting send may carry: about a week at full pace. */
export const PROSPECT_MAX_RECIPIENTS = 500
/** Each send draws one of at least this many texts. */
export const PROSPECT_MIN_VARIATIONS = 3

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Brasília has had no daylight saving since 2019: always UTC-3. */
const OFFSET = 3 * HOUR

/** Easter Sunday of a year (Gregorian), as "YYYY-MM-DD". */
export function easter(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)

const holidayCache = new Map<number, Set<string>>()

/** National holidays, plus Carnival and Corpus Christi (most shops close). */
export function holidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(
    (md) => `${year}-${md}`,
  )
  const e = easter(year)
  const set = new Set([...fixed, shift(e, -48), shift(e, -47), shift(e, -2), shift(e, 60)])
  holidayCache.set(year, set)
  return set
}

/** A working day in Brasília: Monday to Friday, not a holiday. */
export function isWorkingDay(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !holidays(Number(day.slice(0, 4))).has(day)
}

/** Brasília wall-clock hour (0–23) of an instant. */
function localHour(ms: number): number {
  return new Date(ms - OFFSET).getUTCHours()
}

/** 9h of a day, in Brasília, as epoch ms. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T${String(PROSPECT_DAY_START_H).padStart(2, '0')}:00:00-03:00`)
}

/** The next working day after `day`. */
export function nextWorkingDay(day: string): string {
  let next = shift(day, 1)
  while (!isWorkingDay(next)) next = shift(next, 1)
  return next
}

/** Within working hours: a working day, from 9h to before 18h. */
export function isOpen(ms: number): boolean {
  if (!isWorkingDay(dayKey(ms))) return false
  const hour = localHour(ms)
  return hour >= PROSPECT_DAY_START_H && hour < PROSPECT_DAY_END_H
}

/** The ceiling of a day, from the week since the first prospecting send. */
export function rampLimit(day: string, firstDay: string): number {
  const days = Math.max(0, Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${firstDay}T12:00:00Z`)) / DAY))
  return PROSPECT_RAMP[Math.min(Math.floor(days / 7), PROSPECT_RAMP.length - 1)]
}

export function drawProspectGapMs(random: () => number = Math.random): number {
  const r = Math.min(Math.max(random(), 0), 1)
  return Math.round((PROSPECT_GAP_MIN_S + r * (PROSPECT_GAP_MAX_S - PROSPECT_GAP_MIN_S)) * 1000)
}

export interface ProspectPlanInput {
  /** How many messages. */
  n: number
  /** No send before this (ms). */
  afterMs: number
  /** The day of this CRM's first prospecting send ("YYYY-MM-DD"); today if none. */
  firstDay: string
  /** Prospecting sends already on each day. */
  prospectByDay: Record<string, number>
  /** Every bulk send already on each day (prospecting included). */
  allByDay: Record<string, number>
  random?: () => number
}

/**
 * When each message goes (ms), within working hours and every
 * ceiling. Days fill up in order; nothing is ever dropped — a send
 * that does not fit moves to the next working morning.
 */
export function planProspectTimes(input: ProspectPlanInput): number[] {
  const random = input.random ?? Math.random
  const prospect = { ...input.prospectByDay }
  const all = { ...input.allByDay }
  const times: number[] = []
  let t = input.afterMs

  const fits = (ms: number) => {
    const day = dayKey(ms)
    return (
      isOpen(ms) &&
      (prospect[day] ?? 0) < rampLimit(day, input.firstDay) &&
      (all[day] ?? 0) < BULK_DAILY_LIMIT
    )
  }

  for (let i = 0; i < input.n; i += 1) {
    t += drawProspectGapMs(random)
    // At most a year of searching: a ceiling of 0 would loop forever.
    for (let guard = 0; !fits(t) && guard < 400; guard += 1) {
      const day = dayKey(t)
      const before = isWorkingDay(day) && localHour(t) < PROSPECT_DAY_START_H
      const target = before ? day : nextWorkingDay(day)
      // A few minutes after 9h, so mornings do not all start alike.
      t = dayStart(target) + Math.round(random() * 15 * 60_000)
    }
    const day = dayKey(t)
    prospect[day] = (prospect[day] ?? 0) + 1
    all[day] = (all[day] ?? 0) + 1
    times.push(t)
  }
  return times
}

// ------------------------------------------------------------
// The texts
// ------------------------------------------------------------

export class VariationError extends Error {}

/** The words that let a person leave: every text must offer one. */
const LEAVE = /\bSAIR\b/i
const LINK = /(https?:\/\/|www\.|wa\.me\/|bit\.ly\/)/i

/**
 * The texts of a prospecting send: at least three, different, short,
 * each saying how to leave and none with a link (a first message with a
 * link from an unknown number is what reads as spam). Pure.
 */
export function parseVariations(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text) continue
    const key = text.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    if (text.length > 700) throw new VariationError('Cada texto da prospecção vai até 700 caracteres: a primeira mensagem é curta.')
    if (LINK.test(text)) throw new VariationError('Tire os links dos textos: na primeira mensagem para quem não conhece a empresa, link é o que mais parece spam.')
    if (!LEAVE.test(text)) throw new VariationError('Cada texto precisa dizer como sair, por exemplo: "Se não quiser receber, responda SAIR".')
    out.push(text)
    if (out.length >= 10) break
  }
  if (out.length < PROSPECT_MIN_VARIATIONS) {
    throw new VariationError(`Escreva pelo menos ${PROSPECT_MIN_VARIATIONS} textos diferentes: cada contato recebe um deles, sorteado.`)
  }
  return out
}

/** The texts the screen starts from. */
export const PROSPECT_EXAMPLES = [
  'Oi, {{primeiro_nome}}! Aqui é [seu nome], da [sua empresa]. Vi a {{empresa}} e queria te mostrar como ajudamos negócios como o seu a [resultado]. Posso te contar em 2 minutos? Se não quiser receber, responda SAIR.',
  'Olá! Sou [seu nome], da [sua empresa]. Trabalhamos com [o que vocês fazem] para [tipo de negócio] da região. Faz sentido conversarmos sobre a {{empresa}}? Se preferir não receber mensagens, é só responder SAIR.',
  'Bom dia! [Seu nome] aqui, da [sua empresa]. Encontrei a {{empresa}} e acho que podemos ajudar com [problema que vocês resolvem]. Tem interesse em saber mais? Caso não queira mais mensagens, responda SAIR.',
]
