// ============================================================
// "Tem horário livre?" — the one question the agenda exists to answer.
//
// Pure: opening hours, what is already booked and a clock go in, the
// free slots come out. No database and no hidden `new Date()`, so the
// same function serves the screen today and whoever books next (the
// AI agents, Fase 3) — and "the 11:30 slot is gone because of the
// 11:15 encaixe" is a test.
//
// A slot is free when it sits wholly inside the agenda's opening
// hours, has not started yet, and touches nothing booked. Blocks and
// appointments are both just "busy" here; cancelled events must be
// left out by the caller (see `busyOf`).
// ============================================================

import { addDays, parseClock, weekdayOf, zonedToUtc } from './time'

/** One row of calendar_hours. */
export interface HoursRow {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number
  /** "HH:MM" or "HH:MM:SS", on the agenda's own clock. */
  starts: string
  ends: string
}

export interface Interval {
  start: Date
  end: Date
}

export interface Slot extends Interval {
  /** The agenda-local day the slot falls on, "YYYY-MM-DD". */
  dayKey: string
}

/** Minute ranges an agenda attends on `weekday`, merged and in order. */
export function dayRanges(hours: HoursRow[], weekday: number): [number, number][] {
  const ranges = hours
    .filter((h) => h.weekday === weekday)
    .map((h): [number, number] => [parseClock(h.starts), parseClock(h.ends)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])

  // Two rows that touch or overlap are one stretch of work: without
  // this, 08–12 + 12–18 would never offer the slot that crosses noon.
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/** [a, b) and [c, d) share at least an instant. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * What occupies an agenda: everything that is not cancelled. The same
 * rule as the database's exclusion constraint (067).
 */
export function busyOf<T extends { starts_at: string; ends_at: string; status: string }>(
  events: T[],
): Interval[] {
  return events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({ start: new Date(e.starts_at), end: new Date(e.ends_at) }))
}

export interface FreeSlotsInput {
  hours: HoursRow[]
  /** Length of a slot, and the step between two of them. */
  slotMinutes: number
  timezone: string
  busy: Interval[]
  /** First agenda-local day to look at. */
  fromDay: string
  /** How many days, `fromDay` included. */
  days: number
  /** Slots that have already started are not offered. */
  now: Date
  /** Stop after this many. */
  limit?: number
}

export function freeSlots(input: FreeSlotsInput): Slot[] {
  const step = Math.max(5, Math.round(input.slotMinutes))
  const limit = input.limit ?? Number.POSITIVE_INFINITY
  const out: Slot[] = []

  for (let i = 0; i < input.days && out.length < limit; i++) {
    const dayKey = addDays(input.fromDay, i)
    for (const [from, until] of dayRanges(input.hours, weekdayOf(dayKey))) {
      for (let minute = from; minute + step <= until; minute += step) {
        const slot: Slot = {
          dayKey,
          start: zonedToUtc(dayKey, minute, input.timezone),
          end: zonedToUtc(dayKey, minute + step, input.timezone),
        }
        if (slot.start < input.now) continue
        if (input.busy.some((b) => overlaps(slot, b))) continue
        out.push(slot)
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

/**
 * Whether [start, end) sits wholly inside the opening hours of one
 * agenda-local day. Booking outside them is allowed (um encaixe); the
 * screen uses this to say so before saving.
 */
export function withinHours(
  hours: HoursRow[],
  dayKey: string,
  startMinute: number,
  endMinute: number,
): boolean {
  return dayRanges(hours, weekdayOf(dayKey)).some(
    ([from, until]) => startMinute >= from && endMinute <= until,
  )
}

/**
 * The stretch of the day a grid needs to show: from the earliest
 * opening to the latest closing across `hours`, widened to whole
 * hours, and never narrower than the fallback (a new agenda with no
 * hours yet still gets a usable grid).
 */
export function visibleRange(
  hours: HoursRow[],
  fallback: [number, number] = [8 * 60, 18 * 60],
): [number, number] {
  let from = fallback[0]
  let until = fallback[1]
  for (const h of hours) {
    const start = parseClock(h.starts)
    const end = parseClock(h.ends)
    if (end <= start) continue
    from = Math.min(from, start)
    until = Math.max(until, end)
  }
  return [Math.floor(from / 60) * 60, Math.ceil(until / 60) * 60]
}
