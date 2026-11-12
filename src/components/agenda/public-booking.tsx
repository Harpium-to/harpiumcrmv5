'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, CalendarDays, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDuration } from '@/lib/agenda/status';
import { formatDayLong, formatDayShort, formatTime } from '@/lib/agenda/time';

interface PublicAgenda {
  business: string;
  agenda: string;
  slotMinutes: number;
  timezone: string;
  autoConfirm: boolean;
  slots: { day: string; start: string }[];
}

type Booked = { status: 'booked' | 'pending'; start: string };

/** Days offered at once before "ver mais dias". */
const DAYS_SHOWN = 7;

/** Slots grouped by the agenda-local day they fall on, in order. */
export function groupByDay(slots: PublicAgenda['slots']): { day: string; starts: string[] }[] {
  const groups: { day: string; starts: string[] }[] = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last?.day === slot.day) last.starts.push(slot.start);
    else groups.push({ day: slot.day, starts: [slot.start] });
  }
  return groups;
}

export function PublicBooking({ token }: { token: string }) {
  const [agenda, setAgenda] = useState<PublicAgenda | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [daysShown, setDaysShown] = useState(DAYS_SHOWN);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/agenda/${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setProblem(json?.error ?? 'Não consegui carregar os horários.');
        return;
      }
      setProblem(null);
      setAgenda(json as PublicAgenda);
    } catch {
      setProblem('Sem conexão. Confira a internet e tente de novo.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => groupByDay(agenda?.slots ?? []), [agenda]);
  const chosenDay = days.find((d) => d.day === day) ?? null;

  async function book() {
    if (!start) return;
    setSending(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/public/agenda/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, name, phone }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(json?.error ?? 'Não consegui marcar agora. Tente de novo.');
        // Taken meanwhile: show what is actually free now.
        if (res.status === 409) {
          setStart(null);
          await load();
        }
        return;
      }
      setBooked(json as Booked);
    } catch {
      setFormError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <main className="surface mx-auto flex max-w-lg flex-col gap-6 rounded-3xl p-6 sm:p-8">
        <header className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <CalendarDays className="size-5 text-primary" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {agenda ? `Agendar com ${agenda.agenda}` : 'Agendar horário'}
            </h1>
            {agenda ? (
              <p className="truncate text-sm text-muted-foreground">
                {[agenda.business, formatDuration(agenda.slotMinutes)].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
        </header>

        {booked && agenda ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <CalendarCheck className="size-6 text-primary" />
            </span>
            <h2 className="text-base font-medium">
              {booked.status === 'booked' ? 'Horário marcado!' : 'Pedido recebido!'}
            </h2>
            <p className="text-sm first-letter:uppercase">
              {formatDayLong(dayOf(booked.start, agenda))} às{' '}
              {formatTime(new Date(booked.start), agenda.timezone)}
            </p>
            <p className="text-sm text-muted-foreground">
              {booked.status === 'booked'
                ? 'Se precisar remarcar ou cancelar, é só falar com a gente pelo WhatsApp.'
                : 'O horário ficou reservado para você. A equipe confirma pelo WhatsApp em breve.'}
            </p>
          </div>
        ) : problem ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">{problem}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        ) : !agenda ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : days.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Não há horários livres nos próximos dias. Fale com a gente pelo WhatsApp.
          </p>
        ) : (
          <>
            <section className="grid gap-2">
              <h2 className="text-sm font-medium">1. Escolha o dia</h2>
              <div className="flex flex-wrap gap-1.5">
                {days.slice(0, daysShown).map((d) => (
                  <button
                    key={d.day}
                    type="button"
                    data-active={d.day === day}
                    onClick={() => {
                      setDay(d.day);
                      setStart(null);
                      setFormError(null);
                    }}
                    className="chip px-3 py-1.5 text-xs first-letter:uppercase"
                  >
                    {formatDayShort(d.day)}
                  </button>
                ))}
                {days.length > daysShown ? (
                  <button
                    type="button"
                    onClick={() => setDaysShown((n) => n + DAYS_SHOWN)}
                    className="px-2 text-xs text-primary hover:underline"
                  >
                    Ver mais dias
                  </button>
                ) : null}
              </div>
            </section>

            {chosenDay ? (
              <section className="grid gap-2">
                <h2 className="text-sm font-medium">2. Escolha o horário</h2>
                <div className="flex flex-wrap gap-1.5">
                  {chosenDay.starts.map((iso) => (
                    <button
                      key={iso}
                      type="button"
                      data-active={iso === start}
                      onClick={() => {
                        setStart(iso);
                        setFormError(null);
                      }}
                      className="chip px-3 py-1.5 text-xs tabular-nums"
                    >
                      {formatTime(new Date(iso), agenda.timezone)}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {start ? (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void book();
                }}
              >
                <h2 className="text-sm font-medium">3. Seus dados</h2>
                <div className="grid gap-1.5">
                  <Label htmlFor="booking-name" className="text-muted-foreground">
                    Nome
                  </Label>
                  <Input
                    id="booking-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="booking-phone" className="text-muted-foreground">
                    WhatsApp, com DDD
                  </Label>
                  <Input
                    id="booking-phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    placeholder="(11) 91234-5678"
                    maxLength={24}
                    required
                  />
                </div>
                {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                <Button type="submit" disabled={sending}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {agenda.autoConfirm ? 'Marcar' : 'Pedir este horário'} ·{' '}
                  {formatDayShort(dayOf(start, agenda))}, {formatTime(new Date(start), agenda.timezone)}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Usamos seu nome e seu número só para este atendimento.{' '}
                  <Link href="/privacidade" className="underline">
                    Política de privacidade
                  </Link>
                  .
                </p>
              </form>
            ) : formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

/** The agenda-local day of an offered slot — the server already worked it out. */
function dayOf(start: string, agenda: PublicAgenda): string {
  return agenda.slots.find((s) => s.start === start)?.day ?? start.slice(0, 10);
}
