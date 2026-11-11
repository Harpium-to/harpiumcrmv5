'use client';

import { Ban, Check, Hourglass } from 'lucide-react';

import { dayRanges, type HoursRow } from '@/lib/agenda/slots';
import { EVENT_STATUS_LABEL } from '@/lib/agenda/status';
import {
  addDays,
  formatClock,
  formatTime,
  minutesOfDay,
  weekdayOf,
  zonedToUtc,
} from '@/lib/agenda/time';
import { cn } from '@/lib/utils';
import type { AgendaCalendar, AgendaEvent } from '@/types';

/** Height of one hour. Everything vertical derives from it. */
const HOUR_PX = 56;
const PX_PER_MINUTE = HOUR_PX / 60;
/** An event shorter than this is still tall enough to read and click. */
const MIN_EVENT_PX = 22;

export interface GridColumn {
  key: string;
  calendar: AgendaCalendar;
  /** The agenda-local day this column shows. */
  dayKey: string;
  hours: HoursRow[];
  title: string;
  subtitle?: string;
  isToday: boolean;
}

interface TimeGridProps {
  columns: GridColumn[];
  events: AgendaEvent[];
  /** Minutes since midnight the grid starts and ends at, in whole hours. */
  range: [number, number];
  now: Date;
  /** Viewers see the agenda but cannot click a slot to book it. */
  canBook: boolean;
  onPickSlot: (column: GridColumn, minute: number) => void;
  onOpenEvent: (event: AgendaEvent) => void;
}

/** Who or what an event is about, in one line. */
export function eventLabel(event: AgendaEvent): string {
  if (event.kind === 'block') return event.title?.trim() || 'Bloqueado';
  return (
    event.contact?.name?.trim() ||
    event.contact?.phone ||
    event.title?.trim() ||
    'Sem contato'
  );
}

/**
 * "09:00 – 09:30", or "Dia inteiro" for an event that covers the whole
 * of the column's day — the clock times of a week of férias say
 * nothing useful on a Wednesday in the middle of it.
 */
export function eventTime(
  event: Pick<AgendaEvent, 'starts_at' | 'ends_at'>,
  column: Pick<GridColumn, 'calendar' | 'dayKey'>,
): string {
  const zone = column.calendar.timezone;
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const dayStart = zonedToUtc(column.dayKey, 0, zone);
  const dayEnd = zonedToUtc(addDays(column.dayKey, 1), 0, zone);
  if (start <= dayStart && end >= dayEnd) return 'Dia inteiro';
  return `${formatTime(start, zone)} – ${formatTime(end, zone)}`;
}

interface Placed {
  event: AgendaEvent;
  top: number;
  height: number;
}

/**
 * Where a column's events sit, in pixels from the top of the grid.
 * An event that runs past the column's day (a week of férias) is cut
 * to the part that falls inside it.
 */
export function placeEvents(
  column: Pick<GridColumn, 'calendar' | 'dayKey'>,
  events: AgendaEvent[],
  range: [number, number],
): Placed[] {
  const zone = column.calendar.timezone;
  const dayStart = zonedToUtc(column.dayKey, 0, zone).getTime();
  const dayEnd = zonedToUtc(addDays(column.dayKey, 1), 0, zone).getTime();
  const [from, until] = range;

  const placed: Placed[] = [];
  for (const event of events) {
    if (event.calendar_id !== column.calendar.id) continue;
    const start = new Date(event.starts_at).getTime();
    const end = new Date(event.ends_at).getTime();
    if (end <= dayStart || start >= dayEnd) continue;

    const startMinute = Math.max(from, (Math.max(start, dayStart) - dayStart) / 60000);
    const endMinute = Math.min(until, (Math.min(end, dayEnd) - dayStart) / 60000);
    if (endMinute <= startMinute) continue;

    placed.push({
      event,
      top: (startMinute - from) * PX_PER_MINUTE,
      height: Math.max((endMinute - startMinute) * PX_PER_MINUTE, MIN_EVENT_PX),
    });
  }
  return placed;
}

/** The parts of [from, until] an agenda does not attend on a weekday. */
function closedStretches(
  hours: HoursRow[],
  weekday: number,
  [from, until]: [number, number],
): [number, number][] {
  const closed: [number, number][] = [];
  let cursor = from;
  for (const [start, end] of dayRanges(hours, weekday)) {
    if (start > cursor) closed.push([cursor, Math.min(start, until)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < until) closed.push([cursor, until]);
  return closed.filter(([a, b]) => b > a);
}

/**
 * The agenda's grid: time down the side, one column per day (a
 * professional's week) or per professional (everyone's day). It only
 * draws and reports clicks — what a column is, and what happens when
 * a slot is picked, is the caller's business.
 */
export function TimeGrid({
  columns,
  events,
  range,
  now,
  canBook,
  onPickSlot,
  onOpenEvent,
}: TimeGridProps) {
  const [from, until] = range;
  const hourMarks: number[] = [];
  for (let m = from; m < until; m += 60) hourMarks.push(m);
  const bodyHeight = (until - from) * PX_PER_MINUTE;

  return (
    <div className="surface overflow-hidden rounded-3xl">
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${3.5 + columns.length * 8.5}rem` }}>
          {/* ---- Column headers ---- */}
          <div className="flex border-b border-foreground/10">
            <div className="w-14 shrink-0" />
            {columns.map((column) => (
              <div
                key={column.key}
                className="min-w-0 flex-1 border-l border-foreground/10 px-2 py-2.5 text-center"
              >
                <p
                  className={cn(
                    'flex items-center justify-center gap-1.5 truncate text-sm font-medium',
                    column.isToday ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {column.subtitle === undefined ? null : (
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: column.calendar.color }}
                    />
                  )}
                  <span className="truncate">{column.title}</span>
                </p>
                {column.subtitle ? (
                  <p className="truncate text-xs text-muted-foreground">{column.subtitle}</p>
                ) : null}
              </div>
            ))}
          </div>

          {/* ---- Body ---- */}
          <div className="flex">
            <div className="relative w-14 shrink-0" style={{ height: bodyHeight }}>
              {hourMarks.map((minute) => (
                <span
                  key={minute}
                  className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground first:translate-y-0.5"
                  style={{ top: (minute - from) * PX_PER_MINUTE }}
                >
                  {formatClock(minute)}
                </span>
              ))}
            </div>

            {columns.map((column) => {
              const zone = column.calendar.timezone;
              const step = Math.max(5, column.calendar.slot_minutes);
              const nowMinute = column.isToday ? minutesOfDay(now, zone) : null;
              return (
                <div
                  key={column.key}
                  data-testid={`agenda-column-${column.key}`}
                  className={cn(
                    'relative min-w-0 flex-1 border-l border-foreground/10',
                    canBook && 'cursor-pointer',
                  )}
                  style={{ height: bodyHeight }}
                  onClick={(e) => {
                    if (!canBook) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const offset = (e.clientY - rect.top) / PX_PER_MINUTE;
                    const minute = from + Math.floor(offset / step) * step;
                    onPickSlot(column, Math.max(from, Math.min(minute, until - step)));
                  }}
                >
                  {/* Hour lines. */}
                  {hourMarks.map((minute) => (
                    <span
                      key={minute}
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 h-px bg-foreground/[0.06]"
                      style={{ top: (minute - from) * PX_PER_MINUTE }}
                    />
                  ))}

                  {/* Outside opening hours: dimmed, still clickable (um encaixe). */}
                  {closedStretches(column.hours, weekdayOf(column.dayKey), range).map(
                    ([start, end]) => (
                      <span
                        key={start}
                        aria-hidden
                        className="agenda-closed pointer-events-none absolute inset-x-0"
                        style={{
                          top: (start - from) * PX_PER_MINUTE,
                          height: (end - start) * PX_PER_MINUTE,
                        }}
                      />
                    ),
                  )}

                  {placeEvents(column, events, range).map(({ event, top, height }) => {
                    const block = event.kind === 'block';
                    const cancelled = event.status === 'cancelled';
                    const awaiting = event.status === 'pending';
                    const label = eventLabel(event);
                    const time = eventTime(event, column);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        title={`${time} · ${label}${block ? '' : ` · ${EVENT_STATUS_LABEL[event.status]}`}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenEvent(event);
                        }}
                        className={cn(
                          'absolute flex flex-col items-stretch justify-start overflow-hidden rounded-lg px-2 py-1 text-left text-xs leading-tight transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          block
                            ? 'agenda-block text-muted-foreground'
                            : 'text-foreground',
                          event.status === 'done' && 'opacity-60',
                          // Held, not yet agreed: an outline instead of a solid fill.
                          awaiting && 'outline-dashed outline-1 -outline-offset-1 outline-current',
                          cancelled && 'opacity-45',
                        )}
                        style={{
                          top: top + 1,
                          height: height - 2,
                          // A cancelled event no longer holds the slot, so
                          // it steps aside for whatever was booked after.
                          left: cancelled ? '55%' : 4,
                          right: 4,
                          ...(block
                            ? {}
                            : {
                                backgroundColor: `color-mix(in oklab, ${column.calendar.color} ${awaiting ? 10 : 24}%, transparent)`,
                                boxShadow: `inset 3px 0 0 ${column.calendar.color}`,
                              }),
                        }}
                      >
                        <span
                          className={cn(
                            'flex items-center gap-1 font-medium',
                            (cancelled || event.status === 'no_show') && 'line-through',
                          )}
                        >
                          {block ? <Ban className="size-3 shrink-0" /> : null}
                          {awaiting ? <Hourglass className="size-3 shrink-0" /> : null}
                          {event.status === 'confirmed' || event.status === 'done' ? (
                            <Check className="size-3 shrink-0" />
                          ) : null}
                          <span className="truncate">{label}</span>
                        </span>
                        {height >= 38 ? (
                          <span className="block truncate text-[11px] opacity-80">
                            {time}
                            {!block && event.title?.trim() && label !== event.title.trim()
                              ? ` · ${event.title.trim()}`
                              : ''}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}

                  {nowMinute !== null && nowMinute >= from && nowMinute <= until ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                      style={{ top: (nowMinute - from) * PX_PER_MINUTE }}
                    >
                      <span className="-ml-1 size-2 rounded-full bg-destructive" />
                      <span className="h-px flex-1 bg-destructive" />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
