import { safeZone } from './format'

// ============================================================
// Wall-clock time in a zone ↔ instants. Pure.
//
// The CRM has no timezone column; the person's browser zone travels
// with each request, and a routine stores the zone it was created in.
// "Today", "next Monday at 08:00" and "until Friday" all mean the wall
// clock there, not UTC and not the server's zone.
// ============================================================

export interface WallClock {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** The wall clock in `zone` at instant `at`. */
export function wallClock(at: Date, zone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAY[get('weekday')] ?? 1,
  }
}

/** Offset of `zone` from UTC at instant `at`, in minutes. */
function offsetMinutes(at: Date, zone: string): number {
  const w = wallClock(at, zone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  const truncated = Math.floor(at.getTime() / 60_000) * 60_000
  return Math.round((asUtc - truncated) / 60_000)
}

/** The instant when the wall clock in `zone` reads the given time. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  let instant = guess - offsetMinutes(new Date(guess), zone) * 60_000
  // Second pass settles a guess that landed across a DST change.
  instant = guess - offsetMinutes(new Date(instant), zone) * 60_000
  return new Date(instant)
}

/** "2026-11-19" → start of that day in `zone`. Null when malformed. */
export function dayStart(date: string, zone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!m) return null
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, zone)
}

/** Start of today in `zone`. */
export function todayStart(now: Date, zone: string): Date {
  const w = wallClock(now, zone)
  return zonedToUtc(w.year, w.month, w.day, 0, 0, zone)
}

/** Add whole calendar days to a "start of day" instant, staying on midnight. */
export function addDays(start: Date, days: number, zone: string): Date {
  const w = wallClock(new Date(start.getTime() + 12 * 3_600_000), zone)
  const base = new Date(Date.UTC(w.year, w.month - 1, w.day + days))
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, zone)
}

/** "2026-11-19T14:00" (wall clock in `zone`) or a full ISO → instant. */
export function parseLocalDateTime(value: string, zone: string): Date | null {
  const v = value.trim()
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(v)
  if (local) {
    return zonedToUtc(
      Number(local[1]),
      Number(local[2]),
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      zone,
    )
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (day) return zonedToUtc(Number(day[1]), Number(day[2]), Number(day[3]), 9, 0, zone)
  // Anything with an explicit offset or Z is already an instant.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * The next time a routine should run: the first moment strictly after
 * `after` whose weekday is in `weekdays` and whose wall clock in `zone`
 * reads `time` ("HH:MM"). Null when nothing matches (no weekdays).
 */
export function nextRunAt(
  weekdays: number[],
  time: string,
  zone: string,
  after: Date,
): Date | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m || weekdays.length === 0) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  const today = wallClock(after, zone)
  for (let i = 0; i <= 7; i++) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + i))
    const isoWeekday = ((base.getUTCDay() + 6) % 7) + 1
    if (!weekdays.includes(isoWeekday)) continue
    const candidate = zonedToUtc(
      base.getUTCFullYear(),
      base.getUTCMonth() + 1,
      base.getUTCDate(),
      hour,
      minute,
      zone,
    )
    if (candidate.getTime() > after.getTime()) return candidate
  }
  return null
}

const WEEKDAY_NAMES = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

/** "seg a sex às 08:00", "toda segunda às 08:00", "todo dia às 18:30". */
export function describeSchedule(weekdays: number[], time: string): string {
  const days = [...new Set(weekdays)].filter((d) => d >= 1 && d <= 7).sort()
  const key = days.join(',')
  let when: string
  if (key === '1,2,3,4,5,6,7') when = 'todo dia'
  else if (key === '1,2,3,4,5') when = 'de segunda a sexta'
  else if (key === '6,7') when = 'sábado e domingo'
  else if (days.length === 1) {
    when = days[0] >= 6 ? `todo ${WEEKDAY_NAMES[days[0]]}` : `toda ${WEEKDAY_NAMES[days[0]]}`
  } else {
    const names = days.map((d) => WEEKDAY_NAMES[d])
    when = `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
  }
  return `${when} às ${time}`
}
