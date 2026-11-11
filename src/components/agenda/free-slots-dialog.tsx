'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { freeSlots, type HoursRow, type Interval, type Slot } from '@/lib/agenda/slots';
import { formatDuration } from '@/lib/agenda/status';
import { addDays, dayKeyOf, formatDayLong, formatTime, zonedToUtc } from '@/lib/agenda/time';
import type { AgendaCalendar } from '@/types';

import { OptionSelect } from './option-select';

/** How far ahead the first look goes, and each "ver mais" after it. */
const WINDOW_DAYS = 14;
const MAX_DAYS = 84;

interface FreeSlotsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Active agendas only — an archived one takes no bookings. */
  calendars: AgendaCalendar[];
  hoursByCalendar: Record<string, HoursRow[]>;
  initialCalendarId: string | null;
  /** What already occupies an agenda between two instants. */
  loadBusy: (calendarId: string, from: Date, to: Date) => Promise<Interval[] | null>;
  canBook: boolean;
  onPick: (calendar: AgendaCalendar, slot: Slot) => void;
}

export function FreeSlotsDialog({ open, onClose, ...rest }: FreeSlotsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? <FreeSlots onClose={onClose} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FreeSlots({
  calendars,
  hoursByCalendar,
  initialCalendarId,
  loadBusy,
  canBook,
  onPick,
}: Omit<FreeSlotsDialogProps, 'open'>) {
  const [calendarId, setCalendarId] = useState(
    () => calendars.find((c) => c.id === initialCalendarId)?.id ?? calendars[0]?.id ?? '',
  );
  const [days, setDays] = useState(WINDOW_DAYS);
  // Keyed by what was asked, so a stale answer is never shown for a new question.
  const [loaded, setLoaded] = useState<{ key: string; busy: Interval[] | null } | null>(null);
  // The clock is read once, when the dialog opens: slots must not
  // vanish from under the pointer because a minute went by.
  const [now] = useState(() => new Date());

  const calendar = calendars.find((c) => c.id === calendarId);
  const requestKey = `${calendarId}:${days}`;

  useEffect(() => {
    if (!calendar) return;
    let cancelled = false;
    const fromDay = dayKeyOf(now, calendar.timezone);
    const from = zonedToUtc(fromDay, 0, calendar.timezone);
    const to = zonedToUtc(addDays(fromDay, days), 0, calendar.timezone);
    void loadBusy(calendar.id, from, to).then((busy) => {
      if (!cancelled) setLoaded({ key: `${calendar.id}:${days}`, busy });
    });
    return () => {
      cancelled = true;
    };
  }, [calendar, days, loadBusy, now]);

  const current = loaded?.key === requestKey ? loaded : null;
  const hours = hoursByCalendar[calendarId];

  const byDay = useMemo(() => {
    if (!calendar || !current?.busy) return [];
    const slots = freeSlots({
      hours: hours ?? [],
      slotMinutes: calendar.slot_minutes,
      timezone: calendar.timezone,
      busy: current.busy,
      fromDay: dayKeyOf(now, calendar.timezone),
      days,
      now,
    });
    const groups: { dayKey: string; slots: Slot[] }[] = [];
    for (const slot of slots) {
      const last = groups[groups.length - 1];
      if (last?.dayKey === slot.dayKey) last.slots.push(slot);
      else groups.push({ dayKey: slot.dayKey, slots: [slot] });
    }
    return groups;
  }, [calendar, current, days, hours, now]);

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Horários livres</DialogTitle>
        <DialogDescription>
          {calendar
            ? `Vagas de ${formatDuration(calendar.slot_minutes)} dentro do horário de atendimento, nos próximos ${days} dias.`
            : 'Escolha uma agenda.'}
        </DialogDescription>
      </DialogHeader>

      {calendars.length > 1 ? (
        <OptionSelect
          ariaLabel="Agenda"
          value={calendarId}
          onChange={(id) => {
            setCalendarId(id);
            setDays(WINDOW_DAYS);
          }}
          options={calendars.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
        />
      ) : null}

      {!calendar ? null : (hours ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Esta agenda ainda não tem horário de atendimento. Um administrador define em “Agendas”.
        </p>
      ) : !current ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : current.busy === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Não consegui carregar a agenda.
        </p>
      ) : byDay.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum horário livre nos próximos {days} dias.
        </p>
      ) : (
        <ul className="grid gap-4">
          {byDay.map((group) => (
            <li key={group.dayKey} className="grid gap-2">
              <p className="text-sm font-medium first-letter:uppercase">
                {formatDayLong(group.dayKey)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.slots.map((slot) => (
                  <button
                    key={slot.start.toISOString()}
                    type="button"
                    disabled={!canBook}
                    onClick={() => onPick(calendar, slot)}
                    className="chip px-3 py-1.5 text-xs tabular-nums disabled:cursor-default"
                  >
                    {formatTime(slot.start, calendar.timezone)}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {calendar && current?.busy && days < MAX_DAYS && (hours ?? []).length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setDays((d) => Math.min(d + WINDOW_DAYS, MAX_DAYS))}
        >
          Ver mais {WINDOW_DAYS} dias
        </Button>
      ) : null}
    </div>
  );
}
