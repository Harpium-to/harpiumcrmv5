'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CalendarClock,
  Hourglass,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PillNav } from '@/components/ui/pill-nav';
import { Switch } from '@/components/ui/switch';
import {
  busyOf,
  dayRanges,
  visibleRange,
  type HoursRow,
  type Interval,
  type Slot,
} from '@/lib/agenda/slots';
import type { AgendaStore, CalendarsResult, TemplateOption } from '@/lib/agenda/store';
import {
  addDays,
  dayKeyOf,
  DEFAULT_TIMEZONE,
  formatDayLong,
  formatDayShort,
  formatTime,
  formatWeekRange,
  minutesOfDay,
  startOfWeek,
  weekdayOf,
  zonedToUtc,
} from '@/lib/agenda/time';
import type { AgendaCalendar, AgendaEvent } from '@/types';

import { CalendarsDialog } from './calendars-dialog';
import { EventDialog, type EventSeed } from './event-dialog';
import { FreeSlotsDialog } from './free-slots-dialog';
import { OptionSelect } from './option-select';
import { eventLabel, TimeGrid, type GridColumn } from './time-grid';

type View = 'day' | 'week';

/** How often the screen re-reads the agenda while it is open. */
const REFRESH_MS = 60_000;

interface AgendaViewProps {
  store: AgendaStore;
  accountId: string | null;
  /** Agents and above: book, move, cancel, block. */
  canBook: boolean;
  /** Admins and above: create agendas and set their hours. */
  canManage: boolean;
}

/**
 * When a new appointment should start if nobody picked a slot: the
 * next slot from now if `dayKey` is today, otherwise the day's first
 * opening (08:00 for an agenda with no hours that day).
 */
export function defaultStart(
  calendar: AgendaCalendar,
  hours: HoursRow[],
  dayKey: string,
  now: Date,
): Date {
  const zone = calendar.timezone;
  const step = Math.max(5, calendar.slot_minutes);
  if (dayKeyOf(now, zone) === dayKey) {
    const next = Math.ceil((minutesOfDay(now, zone) + 1) / step) * step;
    return zonedToUtc(dayKey, Math.min(next, 24 * 60 - step), zone);
  }
  const first = dayRanges(hours, weekdayOf(dayKey))[0]?.[0] ?? 8 * 60;
  return zonedToUtc(dayKey, first, zone);
}

/**
 * The hours the grid shows: the opening hours of what is on screen,
 * stretched to include any appointment booked outside them — an
 * encaixe at 19h must not be hidden below an 18h grid.
 */
export function gridRange(columns: GridColumn[], events: AgendaEvent[]): [number, number] {
  let [from, until] = visibleRange(columns.flatMap((c) => c.hours));
  for (const column of columns) {
    const zone = column.calendar.timezone;
    for (const event of events) {
      // A block may cover whole days; it does not decide the grid's size.
      if (event.kind === 'block' || event.calendar_id !== column.calendar.id) continue;
      const start = new Date(event.starts_at);
      const end = new Date(event.ends_at);
      if (dayKeyOf(start, zone) !== column.dayKey) continue;
      from = Math.min(from, Math.floor(minutesOfDay(start, zone) / 60) * 60);
      const endMinute =
        dayKeyOf(end, zone) === column.dayKey ? minutesOfDay(end, zone) : 24 * 60;
      until = Math.max(until, Math.ceil(endMinute / 60) * 60);
    }
  }
  return [from, until];
}

export function AgendaView({ store, accountId, canBook, canManage }: AgendaViewProps) {
  const [data, setData] = useState<CalendarsResult | null>(null);
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [pending, setPending] = useState<AgendaEvent[]>([]);
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => dayKeyOf(new Date(), DEFAULT_TIMEZONE));
  const [pickedCalendarId, setPickedCalendarId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [seed, setSeed] = useState<EventSeed | null>(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);

  // Only the agenda form needs the templates, so they are read when it opens.
  useEffect(() => {
    if (!calendarsOpen) return;
    let cancelled = false;
    void store.loadTemplates().then((rows) => {
      if (!cancelled) setTemplates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [calendarsOpen, store]);

  const allCalendars = useMemo(
    () => (data?.status === 'ready' ? data.calendars : []),
    [data],
  );
  const activeCalendars = useMemo(() => allCalendars.filter((c) => c.is_active), [allCalendars]);
  const hoursByCalendar = useMemo(() => {
    const map: Record<string, HoursRow[]> = {};
    if (data?.status === 'ready') {
      for (const row of data.hours) (map[row.calendar_id] ??= []).push(row);
    }
    return map;
  }, [data]);

  // The week view is one agenda's week; fall back to the first active
  // one until the person picks, or if the picked one was archived.
  const calendar =
    activeCalendars.find((c) => c.id === pickedCalendarId) ?? activeCalendars[0] ?? null;

  const reloadCalendars = useCallback(async () => {
    setData(await store.loadCalendars());
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    void store.loadCalendars().then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  // What the grid shows, and the window of events that feeds it.
  const zone = calendar?.timezone ?? DEFAULT_TIMEZONE;
  const weekStart = startOfWeek(anchor);
  const firstDay = view === 'week' ? weekStart : anchor;
  const dayCount = view === 'week' ? 7 : 1;
  // A day either side, so agendas in other zones are covered too.
  const windowFrom = useMemo(() => zonedToUtc(addDays(firstDay, -1), 0, zone), [firstDay, zone]);
  const windowTo = useMemo(
    () => zonedToUtc(addDays(firstDay, dayCount + 1), 0, zone),
    [dayCount, firstDay, zone],
  );

  const ready = data?.status === 'ready';
  const reloadEvents = useCallback(async () => {
    if (!ready) return;
    // What waits for approval is read on its own, whatever week is on
    // screen: a request for next month must not go unseen.
    const [rows, waiting] = await Promise.all([
      store.loadEvents(windowFrom, windowTo),
      store.loadPending(new Date()),
    ]);
    if (rows === null) {
      toast.error('Não consegui carregar os agendamentos.');
    } else {
      setEvents(rows);
    }
    if (waiting !== null) setPending(waiting);
    setEventsLoaded(true);
  }, [ready, store, windowFrom, windowTo]);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  // Someone else on the team may be booking too: re-read on a timer
  // and whenever the tab comes back, and keep the "now" line moving.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(new Date());
      void reloadEvents();
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reloadEvents]);

  const shownEvents = useMemo(
    () => (showCancelled ? events : events.filter((e) => e.status !== 'cancelled')),
    [events, showCancelled],
  );

  const columns = useMemo<GridColumn[]>(() => {
    if (view === 'week') {
      if (!calendar) return [];
      const today = dayKeyOf(now, calendar.timezone);
      return Array.from({ length: 7 }, (_, i) => {
        const dayKey = addDays(weekStart, i);
        return {
          key: dayKey,
          calendar,
          dayKey,
          hours: hoursByCalendar[calendar.id] ?? [],
          title: formatDayShort(dayKey),
          isToday: dayKey === today,
        };
      });
    }
    return activeCalendars.map((c) => {
      const dayStart = zonedToUtc(anchor, 0, c.timezone);
      const dayEnd = zonedToUtc(addDays(anchor, 1), 0, c.timezone);
      const count = shownEvents.filter(
        (e) =>
          e.calendar_id === c.id &&
          e.kind === 'appointment' &&
          e.status !== 'cancelled' &&
          new Date(e.starts_at) >= dayStart &&
          new Date(e.starts_at) < dayEnd,
      ).length;
      return {
        key: c.id,
        calendar: c,
        dayKey: anchor,
        hours: hoursByCalendar[c.id] ?? [],
        title: c.name,
        subtitle: count === 1 ? '1 agendamento' : `${count} agendamentos`,
        isToday: anchor === dayKeyOf(now, c.timezone),
      };
    });
  }, [activeCalendars, anchor, calendar, hoursByCalendar, now, shownEvents, view, weekStart]);

  const range = useMemo(() => gridRange(columns, shownEvents), [columns, shownEvents]);

  const loadBusy = useCallback(
    async (calendarId: string, from: Date, to: Date): Promise<Interval[] | null> => {
      const rows = await store.loadEvents(from, to);
      return rows === null ? null : busyOf(rows.filter((e) => e.calendar_id === calendarId));
    },
    [store],
  );

  // ---- What the buttons open ----

  function openNew(kind: 'appointment' | 'block') {
    const target = calendar ?? activeCalendars[0];
    if (!target) return;
    const start =
      kind === 'block'
        ? zonedToUtc(anchor, 0, target.timezone)
        : defaultStart(target, hoursByCalendar[target.id] ?? [], anchor, now);
    setSeed({
      key: `new-${kind}-${Date.now()}`,
      calendarId: target.id,
      kind,
      start,
      // A block starts out as the whole day on screen.
      end: kind === 'block' ? zonedToUtc(addDays(anchor, 1), 0, target.timezone) : undefined,
    });
  }

  function openSlot(column: GridColumn, minute: number) {
    setSeed({
      key: `slot-${column.key}-${minute}-${Date.now()}`,
      calendarId: column.calendar.id,
      kind: 'appointment',
      start: zonedToUtc(column.dayKey, minute, column.calendar.timezone),
    });
  }

  function openEvent(event: AgendaEvent) {
    setSeed({
      key: `event-${event.id}-${Date.now()}`,
      event,
      calendarId: event.calendar_id,
      kind: event.kind,
      start: new Date(event.starts_at),
      end: new Date(event.ends_at),
    });
  }

  function pickFreeSlot(target: AgendaCalendar, slot: Slot) {
    setSlotsOpen(false);
    setAnchor(slot.dayKey);
    setPickedCalendarId(target.id);
    setSeed({
      key: `free-${target.id}-${slot.start.toISOString()}`,
      calendarId: target.id,
      kind: 'appointment',
      start: slot.start,
    });
  }

  // ---- States before there is a grid to show ----

  if (data === null) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data.status === 'unavailable') {
    return (
      <Notice
        title="A agenda ainda não está disponível neste servidor"
        body="Falta aplicar a migration 067 no banco de dados. Depois disso esta tela funciona sem mais nenhum ajuste."
      />
    );
  }
  if (data.status === 'error') {
    return (
      <Notice title="Não consegui carregar a agenda" body="Recarregue a página para tentar de novo.">
        <Button size="sm" variant="outline" onClick={() => void reloadCalendars()}>
          Tentar de novo
        </Button>
      </Notice>
    );
  }

  const calendarsDialog = (
    <CalendarsDialog
      open={calendarsOpen}
      onClose={() => setCalendarsOpen(false)}
      calendars={allCalendars}
      hoursByCalendar={hoursByCalendar}
      templates={templates}
      onSave={async (values, hours, id) => {
        const error = await store.saveCalendar(values, hours, id);
        // Reload even on failure: the agenda may exist without its hours.
        await reloadCalendars();
        return error;
      }}
      onSetActive={async (id, active) => {
        const error = await store.setCalendarActive(id, active);
        if (!error) await reloadCalendars();
        return error;
      }}
      onDelete={async (id) => {
        const error = await store.deleteCalendar(id);
        if (!error) await Promise.all([reloadCalendars(), reloadEvents()]);
        return error;
      }}
    />
  );

  if (activeCalendars.length === 0) {
    return (
      <>
        <Notice
          title={
            allCalendars.length === 0 ? 'Nenhuma agenda ainda' : 'Todas as agendas estão arquivadas'
          }
          body={
            canManage
              ? 'Crie uma agenda para cada profissional, sala ou serviço que atende com hora marcada. Você define os dias e horários de atendimento de cada uma.'
              : 'Peça a um administrador do CRM para criar a agenda dos profissionais.'
          }
        >
          {canManage ? (
            <Button size="sm" onClick={() => setCalendarsOpen(true)}>
              <CalendarPlus className="size-3.5" />
              {allCalendars.length === 0 ? 'Criar a primeira agenda' : 'Ver agendas'}
            </Button>
          ) : null}
        </Notice>
        {calendarsDialog}
      </>
    );
  }

  const step = view === 'week' ? 7 : 1;
  const today = dayKeyOf(now, zone);

  return (
    <div className="space-y-3">
      {/* ---- Toolbar ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <PillNav
          ariaLabel="Visão"
          value={view}
          onChange={(v) => setView(v as View)}
          items={[
            { value: 'week', label: 'Semana', icon: CalendarDays },
            { value: 'day', label: 'Dia', icon: CalendarClock },
          ]}
        />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={view === 'week' ? 'Semana anterior' : 'Dia anterior'}
            onClick={() => setAnchor((a) => addDays(a, -step))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={view === 'week' ? startOfWeek(today) === weekStart : today === anchor}
            onClick={() => setAnchor(today)}
          >
            Hoje
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={view === 'week' ? 'Próxima semana' : 'Próximo dia'}
            onClick={() => setAnchor((a) => addDays(a, step))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <label className="relative flex min-w-0 cursor-pointer items-center">
          <span className="truncate text-sm font-medium first-letter:uppercase">
            {view === 'week' ? formatWeekRange(weekStart) : formatDayLong(anchor)}
          </span>
          {/* The label is the button; the native field only supplies the picker. */}
          <input
            type="date"
            value={anchor}
            aria-label="Ir para a data"
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        {!eventsLoaded ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {view === 'week' && calendar && activeCalendars.length > 1 ? (
            <OptionSelect
              ariaLabel="Agenda"
              className="w-48"
              value={calendar.id}
              onChange={setPickedCalendarId}
              options={activeCalendars.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
            />
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setSlotsOpen(true)}>
            <CalendarClock className="size-3.5" />
            Horários livres
          </Button>
          {canBook ? (
            <>
              <Button variant="outline" size="sm" onClick={() => openNew('block')}>
                <Ban className="size-3.5" />
                Bloquear
              </Button>
              <Button size="sm" onClick={() => openNew('appointment')}>
                <CalendarPlus className="size-3.5" />
                Agendar
              </Button>
            </>
          ) : null}
          {canManage ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Agendas e horários de atendimento"
              title="Agendas e horários de atendimento"
              onClick={() => setCalendarsOpen(true)}
            >
              <Settings2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'week' && calendar && activeCalendars.length === 1 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: calendar.color }}
          />
          {calendar.name}
        </p>
      ) : null}

      {pending.length > 0 ? (
        <div className="surface flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Hourglass className="size-3.5 text-amber-500" />
            Aguardando aprovação ({pending.length})
          </span>
          {pending.map((event) => {
            const owner = allCalendars.find((c) => c.id === event.calendar_id);
            const zone = owner?.timezone ?? DEFAULT_TIMEZONE;
            const start = new Date(event.starts_at);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => {
                  // Show its week too, so it is seen where it sits.
                  setAnchor(dayKeyOf(start, zone));
                  if (owner) setPickedCalendarId(owner.id);
                  openEvent(event);
                }}
                className="chip px-3 py-1 text-xs"
              >
                {eventLabel(event)} · {formatDayShort(dayKeyOf(start, zone))} {formatTime(start, zone)}
                {activeCalendars.length > 1 && owner ? ` · ${owner.name}` : ''}
              </button>
            );
          })}
        </div>
      ) : null}

      <TimeGrid
        columns={columns}
        events={shownEvents}
        range={range}
        now={now}
        canBook={canBook}
        onPickSlot={openSlot}
        onOpenEvent={openEvent}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
        <p>
          {canBook
            ? 'Clique em um horário vazio para marcar. A área mais escura fica fora do horário de atendimento.'
            : 'A área mais escura fica fora do horário de atendimento.'}
        </p>
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
            aria-label="Mostrar cancelados"
          />
          Mostrar cancelados
        </label>
      </div>

      <EventDialog
        seed={seed}
        onClose={() => setSeed(null)}
        // The event's own agenda stays selectable even if archived since.
        calendars={
          seed?.event && !activeCalendars.some((c) => c.id === seed.event?.calendar_id)
            ? allCalendars.filter((c) => c.is_active || c.id === seed.event?.calendar_id)
            : activeCalendars
        }
        hoursByCalendar={hoursByCalendar}
        accountId={accountId}
        canBook={canBook}
        onSave={async (payload, id) => {
          const error = await store.saveEvent(payload, id);
          if (!error) await reloadEvents();
          return error;
        }}
        onDelete={async (id) => {
          const error = await store.deleteEvent(id);
          if (!error) await reloadEvents();
          return error;
        }}
      />

      <FreeSlotsDialog
        open={slotsOpen}
        onClose={() => setSlotsOpen(false)}
        calendars={activeCalendars}
        hoursByCalendar={hoursByCalendar}
        initialCalendarId={calendar?.id ?? null}
        loadBusy={loadBusy}
        canBook={canBook}
        onPick={pickFreeSlot}
      />

      {calendarsDialog}
    </div>
  );
}

function Notice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="surface mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-3xl px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/10">
        <CalendarDays className="size-5 text-primary" />
      </span>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
