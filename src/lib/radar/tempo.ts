// ============================================================
// Days in the CRM's time zone, as plain 'YYYY-MM-DD' strings. Pure.
// ============================================================

export const DEFAULT_TZ = 'America/Sao_Paulo'

/** The local date and hour of `at` in `tz`. */
export function localParts(at: Date, tz: string): { day: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = `${get('year')}-${get('month')}-${get('day')}`
  const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return { day, hour: Number(get('hour')), weekday: WEEKDAY[get('weekday')] ?? 1 }
}

/** `day` plus `n` days (n may be negative). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** ISO weekday of a date string: 1 = Monday … 7 = Sunday. */
export function weekdayOf(day: string): number {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay()
  return w === 0 ? 7 : w
}

/** ISO week key, e.g. "2026-W47" — marks the weekly digest as sent. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  const wd = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - wd)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Is `tz` a zone this runtime knows? */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
