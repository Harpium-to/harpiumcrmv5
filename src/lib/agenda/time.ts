// ============================================================
// Wall-clock time in an agenda's own time zone.
//
// An agenda's opening hours are written as "08:00 on Mondays" in the
// place where the professional works, and an appointment is stored as
// an instant (UTC). Everything that turns one into the other lives
// here, pure and with the zone as a parameter — so "what does 08:00
// in Manaus look like to someone in São Paulo" is a test, not a
// surprise the first time a client is in another state.
//
// Days travel as "YYYY-MM-DD" keys rather than Date objects: a Date
// is an instant, and "the 7th" is a different instant in every zone.
//
// `Intl` does the zone work (as in agents/schedule.ts) because
// offsets are not constants — a hand-rolled shift is wrong for half
// the year wherever daylight saving exists.
// ============================================================

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    formatters.set(timeZone, fmt)
  }
  return fmt
}

/** A zone this runtime does not know reads as the default one. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE
  try {
    formatterFor(timeZone)
    return timeZone
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** The calendar date and clock time of `date`, as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const out: Record<string, number> = {}
  for (const part of formatterFor(safeTimeZone(timeZone)).formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function toDayKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** "YYYY-MM-DD" of `date` in `timeZone`. */
export function dayKeyOf(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return toDayKey(p.year, p.month, p.day)
}

/** Minutes since local midnight of `date` in `timeZone`. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  return p.hour * 60 + p.minute
}

function parseDayKey(dayKey: string): [number, number, number] {
  const [y, m, d] = dayKey.split('-').map(Number)
  return [y, m, d]
}

/** Calendar arithmetic on a day key — no zone involved. */
export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = parseDayKey(dayKey)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return toDayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** ISO weekday of a day key: 1 = Monday … 7 = Sunday. */
export function weekdayOf(dayKey: string): number {
  const [y, m, d] = parseDayKey(dayKey)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

/** The Monday of the week `dayKey` falls in. */
export function startOfWeek(dayKey: string): string {
  return addDays(dayKey, 1 - weekdayOf(dayKey))
}

/**
 * The instant at which the clock in `timeZone` reads `minutes` past
 * midnight on `dayKey`.
 *
 * Guess the instant as if the zone were UTC, see what the zone's clock
 * actually reads there, and correct by the difference. The second pass
 * covers the day an offset changes; a time that does not exist (the
 * hour skipped by daylight saving) lands on the instant just after.
 */
export function zonedToUtc(dayKey: string, minutes: number, timeZone: string): Date {
  const zone = safeTimeZone(timeZone)
  const [y, m, d] = parseDayKey(dayKey)
  const wanted = Date.UTC(y, m - 1, d, 0, minutes)
  let guess = wanted
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), zone)
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += wanted - seen
  }
  return new Date(guess)
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight. NaN-free: bad input is 0. */
export function parseClock(value: string | null | undefined): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '')
  if (!match) return 0
  return Math.min(Number(match[1]) * 60 + Number(match[2]), 24 * 60)
}

/** Minutes since midnight → "HH:MM". */
export function formatClock(minutes: number): string {
  const m = Math.max(0, Math.min(Math.round(minutes), 24 * 60))
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** "14:30" — the time of `date` on the clock in `timeZone`. */
export function formatTime(date: Date, timeZone: string): string {
  return formatClock(minutesOfDay(date, timeZone))
}

const WEEKDAY_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const WEEKDAY_LONG = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
]
const MONTH_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]
const MONTH_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** ISO weekday → "seg". */
export function weekdayShort(weekday: number): string {
  return WEEKDAY_SHORT[weekday - 1] ?? ''
}

/** ISO weekday → "segunda-feira". */
export function weekdayLong(weekday: number): string {
  return WEEKDAY_LONG[weekday - 1] ?? ''
}

/** "seg, 7 jan" */
export function formatDayShort(dayKey: string): string {
  const [, m, d] = parseDayKey(dayKey)
  return `${weekdayShort(weekdayOf(dayKey))}, ${d} ${MONTH_SHORT[m - 1]}`
}

/** "7 de janeiro" — how a date is said to a customer. */
export function formatDayAndMonth(dayKey: string): string {
  const [, m, d] = parseDayKey(dayKey)
  return `${d} de ${MONTH_LONG[m - 1]}`
}

/** "segunda-feira, 7 de janeiro de 2030" */
export function formatDayLong(dayKey: string): string {
  const [y, m, d] = parseDayKey(dayKey)
  return `${weekdayLong(weekdayOf(dayKey))}, ${d} de ${MONTH_LONG[m - 1]} de ${y}`
}

/** "6 – 12 de janeiro de 2030", or across months "30 dez – 5 jan de 2030". */
export function formatWeekRange(mondayKey: string): string {
  const sundayKey = addDays(mondayKey, 6)
  const [, m1, d1] = parseDayKey(mondayKey)
  const [y2, m2, d2] = parseDayKey(sundayKey)
  if (m1 === m2) return `${d1} – ${d2} de ${MONTH_LONG[m2 - 1]} de ${y2}`
  return `${d1} ${MONTH_SHORT[m1 - 1]} – ${d2} ${MONTH_SHORT[m2 - 1]} de ${y2}`
}

/**
 * Value of an `<input type="datetime-local">` for `date`, on the clock
 * in `timeZone` — the field has no zone of its own, so the agenda's is
 * the one the person is typing in.
 */
export function toLocalInput(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return `${toDayKey(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** The instant a `datetime-local` value means in `timeZone`; null if unparseable. */
export function fromLocalInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  return zonedToUtc(match[1], Number(match[2]) * 60 + Number(match[3]), timeZone)
}
