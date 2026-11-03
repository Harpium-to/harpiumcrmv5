// ============================================================
// When an agent is allowed to work.
//
// Pure: takes a schedule and a clock, returns a verdict. No database,
// no `new Date()` hidden inside — the current time is always a
// parameter, which is what makes "does it defer correctly at 17:59 on
// a Friday" a test rather than a thing you wait until Friday to find
// out.
//
// WHY THIS EXISTS AT ALL
//   An outbound agent that messages a stranger at 3am burns the lead,
//   and in Brazil (and most places) unsolicited commercial contact
//   outside reasonable hours is a compliance problem, not a style one.
//   So the runner does not send outside the window — it reschedules
//   the task to the next opening.
// ============================================================

export interface WorkSchedule {
  /** ISO weekdays the agent works: 1 = Monday … 7 = Sunday. */
  workDays: number[]
  /** "HH:MM" or "HH:MM:SS", in `timezone`. */
  workStart: string
  workEnd: string
  /** IANA zone, e.g. "America/Sao_Paulo". */
  timezone: string
}

interface ZonedNow {
  /** ISO weekday, 1–7. */
  weekday: number
  /** Minutes since midnight, local to the zone. */
  minutes: number
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

/**
 * The wall-clock weekday and time at `date`, as seen in `timeZone`.
 *
 * Uses `Intl` rather than an offset calculation because offsets are
 * not constant: São Paulo has dropped DST, but plenty of deployments
 * will not have, and a hand-rolled `getTimezoneOffset` shift is wrong
 * twice a year in exactly the way nobody notices until an agent
 * messages someone at 4am.
 */
function zonedNow(date: Date, timeZone: string): ZonedNow {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date)
  } catch {
    // An invalid IANA name would otherwise throw deep inside the
    // runner. Fall back to UTC: wrong window beats no agent at all,
    // and the operator sees the zone they typed on the agent card.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date)
  }

  const lookup = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? ''

  // `hour12: false` yields "24" for midnight in some ICU versions.
  const hour = Number(lookup('hour')) % 24
  const minute = Number(lookup('minute'))
  const weekday = WEEKDAY_TO_ISO[lookup('weekday')] ?? 1

  return { weekday, minutes: hour * 60 + minute }
}

/** "09:30" / "09:30:00" → 570. Returns null on anything unparseable. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Is the agent on shift at `now`?
 *
 * Handles an overnight window (start > end, e.g. 22:00–06:00) by
 * testing the union of the two spans rather than the intersection —
 * support desks really do run those, and the naive `start <= t && t <
 * end` silently means "never" for them.
 */
export function isWithinWorkingHours(
  schedule: WorkSchedule,
  now: Date,
): boolean {
  const start = parseTimeOfDay(schedule.workStart)
  const end = parseTimeOfDay(schedule.workEnd)
  // A schedule we can't read should not silently become a 24/7 agent.
  if (start === null || end === null) return false
  if (schedule.workDays.length === 0) return false

  const { weekday, minutes } = zonedNow(now, schedule.timezone)
  if (!schedule.workDays.includes(weekday)) return false

  // A window that starts and ends at the same minute means all day —
  // the natural way to express "always" without a separate flag.
  if (start === end) return true
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

/**
 * When the agent is next on shift, for rescheduling a deferred task.
 *
 * Steps in 15-minute increments over the coming week rather than doing
 * zone arithmetic: it is a handful of cheap `Intl` formats, it is
 * obviously correct across DST boundaries, and it cannot produce a
 * time that `isWithinWorkingHours` would then reject — the two
 * functions agree by construction because one calls the other.
 *
 * Returns null if the schedule never opens (no work days, or
 * unparseable times), which the caller treats as "leave it queued for
 * a human".
 */
export function nextWorkingSlot(
  schedule: WorkSchedule,
  now: Date,
): Date | null {
  if (isWithinWorkingHours(schedule, now)) return now

  const STEP_MS = 15 * 60 * 1000
  const HORIZON = (8 * 24 * 60) / 15 // eight days of 15-minute steps

  // Start from the next quarter-hour boundary so the scheduled time is
  // a round one, which reads better in the queue than 14:07.
  let cursor = new Date(Math.ceil(now.getTime() / STEP_MS) * STEP_MS)
  for (let i = 0; i < HORIZON; i++) {
    if (isWithinWorkingHours(schedule, cursor)) return cursor
    cursor = new Date(cursor.getTime() + STEP_MS)
  }
  return null
}
