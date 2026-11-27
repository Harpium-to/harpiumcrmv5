// ============================================================
// When a round runs next. Pure: the clock is always a parameter.
// ============================================================

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** Wall clock minus UTC, in minutes, for `tz` at `date`. */
function offsetMinutes(date: Date, tz: string): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date)
  } catch {
    return 0
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE)
}

/** "HH:MM" → [h, m], or null. */
function parseHm(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return [h, min]
}

/**
 * The next time strictly after `now` that is `runAt` on one of `days`
 * (ISO weekdays, 1 = Monday) in `tz`. Null if it never comes (no days,
 * unreadable time).
 */
export function nextFixedRun(runAt: string, days: number[], tz: string, now: Date): Date | null {
  const hm = parseHm(runAt)
  if (!hm || days.length === 0) return null
  const offset = offsetMinutes(now, tz)
  const wallNow = new Date(now.getTime() + offset * MINUTE)
  for (let d = 0; d <= 8; d++) {
    const y = wallNow.getUTCFullYear()
    const mo = wallNow.getUTCMonth()
    const day = wallNow.getUTCDate() + d
    const wallTarget = Date.UTC(y, mo, day, hm[0], hm[1])
    const weekday = new Date(Date.UTC(y, mo, day)).getUTCDay()
    const iso = weekday === 0 ? 7 : weekday
    if (!days.includes(iso)) continue
    // Wall time → instant, re-checking the offset at that instant (DST).
    let instant = wallTarget - offset * MINUTE
    const offsetThen = offsetMinutes(new Date(instant), tz)
    instant = wallTarget - offsetThen * MINUTE
    if (instant > now.getTime()) return new Date(instant)
  }
  return null
}

export interface RondaSchedule {
  everyMinutes: number | null
  runAt: string | null
  runDays: number[]
}

/** The next run after one that happened at `now`. */
export function nextRondaRun(s: RondaSchedule, tz: string, now: Date): Date {
  if (s.everyMinutes && s.everyMinutes > 0) return new Date(now.getTime() + s.everyMinutes * MINUTE)
  if (s.runAt) {
    const next = nextFixedRun(s.runAt, s.runDays, tz, now)
    if (next) return next
  }
  // An unreadable schedule checks again tomorrow rather than spinning.
  return new Date(now.getTime() + DAY)
}

/**
 * The slot a case falls in for the round's cool-down: the same contact
 * is handed to the agent at most once per `coolDownDays`. Part of the
 * task's dedupe key, so the database enforces it.
 */
export function coolDownBucket(now: Date, coolDownDays: number): number {
  const days = Math.max(1, Math.round(coolDownDays))
  return Math.floor(now.getTime() / (days * DAY))
}
