// ============================================================
// The opening-hours form, as data.
//
// The database stores a week as loose rows (weekday, from, until).
// A person edits it as seven days, each open or closed, each with one
// or two stretches (the second is what a lunch break leaves). These
// two functions go between the shapes, and `fromWeekDraft` is where a
// week is refused before it reaches the database — with a sentence a
// person can act on instead of a constraint name.
// ============================================================

import type { HoursRow } from './slots'
import { formatClock, parseClock, weekdayLong } from './time'

export interface RangeDraft {
  /** "HH:MM", as an `<input type="time">` holds it. */
  starts: string
  ends: string
}

export interface DayDraft {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number
  open: boolean
  ranges: RangeDraft[]
}

/** At most this many stretches a day — morning and afternoon. */
export const MAX_RANGES_PER_DAY = 2

/** What a day gets the first time it is switched on. */
const FIRST_RANGE: RangeDraft = { starts: '08:00', ends: '12:00' }
const SECOND_RANGE: RangeDraft = { starts: '14:00', ends: '18:00' }

/** A new agenda: Monday to Friday, 08–12 and 14–18. */
export const DEFAULT_WEEK: HoursRow[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, ...FIRST_RANGE },
  { weekday, ...SECOND_RANGE },
])

export function toWeekDraft(hours: HoursRow[]): DayDraft[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const ranges = hours
      .filter((h) => h.weekday === weekday)
      .map((h) => ({
        starts: formatClock(parseClock(h.starts)),
        ends: formatClock(parseClock(h.ends)),
      }))
      .sort((a, b) => parseClock(a.starts) - parseClock(b.starts))
      .slice(0, MAX_RANGES_PER_DAY)
    return ranges.length > 0
      ? { weekday, open: true, ranges }
      : // A closed day keeps a sensible stretch ready for when it opens.
        { weekday, open: false, ranges: [{ ...FIRST_RANGE }] }
  })
}

/** The stretch to add when a day gets its second one. */
export function nextRange(day: DayDraft): RangeDraft {
  const last = day.ranges[day.ranges.length - 1]
  if (!last) return { ...FIRST_RANGE }
  const lastEnd = parseClock(last.ends)
  // After a morning, the afternoon; otherwise two hours after closing.
  if (lastEnd <= parseClock(SECOND_RANGE.starts)) return { ...SECOND_RANGE }
  const starts = Math.min(lastEnd + 60, 22 * 60)
  return { starts: formatClock(starts), ends: formatClock(Math.min(starts + 120, 24 * 60)) }
}

export type WeekResult = { rows: HoursRow[] } | { error: string }

export function fromWeekDraft(draft: DayDraft[]): WeekResult {
  const rows: HoursRow[] = []
  for (const day of draft) {
    if (!day.open) continue
    const name = weekdayLong(day.weekday)
    const ranges = day.ranges
      .map((r) => ({ from: parseClock(r.starts), until: parseClock(r.ends), raw: r }))
      .sort((a, b) => a.from - b.from)

    for (const [i, range] of ranges.entries()) {
      if (!range.raw.starts || !range.raw.ends) {
        return { error: `Preencha os horários de ${name}.` }
      }
      if (range.until <= range.from) {
        return { error: `Em ${name}, o fim precisa ser depois do início.` }
      }
      const previous = ranges[i - 1]
      if (previous && range.from < previous.until) {
        return { error: `Em ${name}, os dois períodos se sobrepõem.` }
      }
      rows.push({
        weekday: day.weekday,
        starts: formatClock(range.from),
        ends: formatClock(range.until),
      })
    }
  }
  return { rows }
}
