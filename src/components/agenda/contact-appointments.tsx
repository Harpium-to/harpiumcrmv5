'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CalendarPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { busyOf, type HoursRow, type Interval } from '@/lib/agenda/slots';
import { EVENT_STATUS_LABEL } from '@/lib/agenda/status';
import {
  createSupabaseAgendaStore,
  type AgendaStore,
  type CalendarsResult,
} from '@/lib/agenda/store';
import { dayKeyOf, DEFAULT_TIMEZONE, formatDayShort, formatTime } from '@/lib/agenda/time';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { AgendaEvent } from '@/types';

import type { PickedContact } from './contact-picker';
import { EventDialog, type EventSeed } from './event-dialog';
import { FreeSlotsDialog } from './free-slots-dialog';

/** Past appointments shown under the coming ones — the recent past, not an archive. */
const PAST_SHOWN = 3;

/**
 * A contact's appointments, split the way they are read: what is
 * coming (soonest first, cancelled ones left out) and the last few
 * that are over or were cancelled (newest first).
 */
export function splitContactEvents(
  events: AgendaEvent[],
  now: Date,
): { upcoming: AgendaEvent[]; past: AgendaEvent[] } {
  const time = (e: AgendaEvent) => new Date(e.starts_at).getTime();
  const coming = (e: AgendaEvent) =>
    e.status !== 'cancelled' && new Date(e.ends_at).getTime() > now.getTime();
  return {
    upcoming: events.filter(coming).sort((a, b) => time(a) - time(b)),
    past: events
      .filter((e) => !coming(e))
      .sort((a, b) => time(b) - time(a))
      .slice(0, PAST_SHOWN),
  };
}

interface ContactAppointmentsProps {
  contact: PickedContact | null;
  /** Draws a rule under the section — for the inbox's stacked sidebar. */
  divider?: boolean;
  className?: string;
}

/**
 * The agenda, from a contact's side: their appointments, and booking a
 * free slot without leaving the conversation or the contact's record.
 * Renders nothing in a CRM that has no agenda (or before migration
 * 067), so it costs no space where it is not used.
 */
export function ContactAppointments(props: ContactAppointmentsProps) {
  const { user, accountId } = useAuth();
  const canBook = useCan('send-messages');
  const store = useMemo(
    () =>
      accountId ? createSupabaseAgendaStore(createClient(), accountId, user?.id ?? null) : null,
    [accountId, user?.id],
  );
  if (!store || !props.contact) return null;
  return (
    <ContactAppointmentsView
      // Another contact starts over instead of flashing the previous one's.
      key={props.contact.id}
      {...props}
      contact={props.contact}
      store={store}
      accountId={accountId}
      canBook={canBook}
    />
  );
}

export function ContactAppointmentsView({
  contact,
  divider,
  className,
  store,
  accountId,
  canBook,
}: Omit<ContactAppointmentsProps, 'contact'> & {
  contact: PickedContact;
  store: AgendaStore;
  accountId: string | null;
  canBook: boolean;
}) {
  const [data, setData] = useState<CalendarsResult | null>(null);
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const [seed, setSeed] = useState<EventSeed | null>(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  // Read once: "coming" must not flip while the list is on screen.
  const [now] = useState(() => new Date());

  const reloadEvents = useCallback(async () => {
    setEvents(await store.loadContactEvents(contact.id));
  }, [contact.id, store]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([store.loadCalendars(), store.loadContactEvents(contact.id)]).then(
      ([calendars, rows]) => {
        if (cancelled) return;
        setData(calendars);
        setEvents(rows);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [contact.id, store]);

  const calendars = useMemo(() => (data?.status === 'ready' ? data.calendars : []), [data]);
  const activeCalendars = useMemo(() => calendars.filter((c) => c.is_active), [calendars]);
  const hoursByCalendar = useMemo(() => {
    const map: Record<string, HoursRow[]> = {};
    if (data?.status === 'ready') {
      for (const row of data.hours) (map[row.calendar_id] ??= []).push(row);
    }
    return map;
  }, [data]);

  const loadBusy = useCallback(
    async (calendarId: string, from: Date, to: Date): Promise<Interval[] | null> => {
      const rows = await store.loadEvents(from, to);
      return rows === null ? null : busyOf(rows.filter((e) => e.calendar_id === calendarId));
    },
    [store],
  );

  // No agenda in this CRM (or not yet on this server): nothing to show.
  if (data?.status !== 'ready' || calendars.length === 0) return null;

  const { upcoming, past } = splitContactEvents(events ?? [], now);
  const nameOf = (id: string) => calendars.find((c) => c.id === id);

  const line = (event: AgendaEvent, faded: boolean) => {
    const calendar = nameOf(event.calendar_id);
    const zone = calendar?.timezone ?? DEFAULT_TIMEZONE;
    const start = new Date(event.starts_at);
    return (
      <li key={event.id}>
        <button
          type="button"
          onClick={() =>
            setSeed({
              key: `event-${event.id}-${Date.now()}`,
              event,
              calendarId: event.calendar_id,
              kind: event.kind,
              start,
              end: new Date(event.ends_at),
            })
          }
          className={cn(
            'flex w-full items-start gap-2 rounded-lg bg-muted px-3 py-2 text-left transition-colors hover:bg-foreground/10',
            faded && 'opacity-60',
          )}
        >
          <span
            aria-hidden
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: calendar?.color ?? 'currentColor' }}
          />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block text-sm font-medium text-foreground first-letter:uppercase',
                event.status === 'cancelled' && 'line-through',
              )}
            >
              {formatDayShort(dayKeyOf(start, zone))} · {formatTime(start, zone)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {[calendar?.name, event.title?.trim(), EVENT_STATUS_LABEL[event.status]]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        <CalendarDays className="size-3" />
        Agenda
      </div>

      <div className="mt-2 space-y-2">
        {events === null ? (
          <p className="px-1 text-xs text-muted-foreground">
            Não consegui carregar os agendamentos.
          </p>
        ) : upcoming.length === 0 && past.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">Nenhum horário marcado.</p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.map((event) => line(event, false))}
            {past.map((event) => line(event, true))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {canBook && activeCalendars.length > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setSlotsOpen(true)}>
              <CalendarPlus className="size-3.5" />
              Marcar horário
            </Button>
          ) : null}
          <Link href="/agenda" className="text-xs text-primary hover:underline">
            Abrir a agenda
          </Link>
        </div>
      </div>

      {divider ? <div className="my-4 border-t border-border" /> : null}

      <FreeSlotsDialog
        open={slotsOpen}
        onClose={() => setSlotsOpen(false)}
        calendars={activeCalendars}
        hoursByCalendar={hoursByCalendar}
        initialCalendarId={activeCalendars[0]?.id ?? null}
        loadBusy={loadBusy}
        canBook={canBook}
        onPick={(calendar, slot) => {
          setSlotsOpen(false);
          setSeed({
            key: `free-${calendar.id}-${slot.start.toISOString()}`,
            calendarId: calendar.id,
            kind: 'appointment',
            start: slot.start,
            contact,
          });
        }}
      />

      <EventDialog
        seed={seed}
        onClose={() => setSeed(null)}
        calendars={
          seed?.event && !activeCalendars.some((c) => c.id === seed.event?.calendar_id)
            ? calendars.filter((c) => c.is_active || c.id === seed.event?.calendar_id)
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
    </div>
  );
}
