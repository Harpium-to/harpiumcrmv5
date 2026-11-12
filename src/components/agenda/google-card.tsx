'use client';

import { useState } from 'react';
import { CalendarCheck, Loader2, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import type { GoogleCalendarEntry } from '@/lib/google/calendar-api';
import type { GoogleResult } from '@/lib/agenda/store';
import type { AgendaCalendar, GoogleConnection } from '@/types';

import { OptionSelect } from './option-select';

/** What the agenda screen can do with Google (069); null hides it all. */
export interface GoogleAgendaActions {
  connections: GoogleConnection[];
  list: (connectionId: string) => Promise<GoogleResult<GoogleCalendarEntry[]>>;
  link: (
    calendarId: string,
    connectionId: string | null,
    googleCalendarId?: string,
  ) => Promise<GoogleResult<true>>;
  disconnect: (connectionId: string, deleteRemote: boolean) => Promise<GoogleResult<{ removed: number }>>;
  /** Reload agendas and connections after a change. */
  onChanged: () => Promise<void>;
}

/** The address that starts "Conectar com o Google" for an agenda. */
export function googleConnectHref(calendarId: string): string {
  return `/api/google/oauth/start?calendar=${encodeURIComponent(calendarId)}`;
}

/**
 * One agenda's link to Google Agenda, on its form (G1). Acts at once —
 * unlike the rest of the form, nothing here waits for "Salvar".
 */
export function GoogleCard({
  calendar,
  google,
}: {
  calendar: AgendaCalendar;
  google: GoogleAgendaActions;
}) {
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<GoogleCalendarEntry[] | null>(null);
  const connection = google.connections.find((c) => c.id === calendar.google_connection_id) ?? null;
  const others = google.connections.filter((c) => c.id !== connection?.id && c.status === 'connected');

  async function run<T>(action: () => Promise<GoogleResult<T>>, done: string): Promise<GoogleResult<T>> {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      if (result.reconnect) await google.onChanged();
      return result;
    }
    toast.success(done);
    await google.onChanged();
    return result;
  }

  async function loadChoices(connectionId: string) {
    setBusy(true);
    const result = await google.list(connectionId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setChoices(result.data);
    return result.data;
  }

  async function linkAccount(connectionId: string) {
    const list = await loadChoices(connectionId);
    const main = list?.find((c) => c.primary) ?? list?.[0];
    if (!main) return;
    await run(
      () => google.link(calendar.id, connectionId, main.id),
      'Agenda ligada ao Google Agenda. Os agendamentos de hoje em diante vão para lá.',
    );
  }

  async function stop() {
    if (
      !window.confirm(
        `Parar de enviar "${calendar.name}" para o Google Agenda? Os agendamentos futuros desta agenda são tirados de lá. No CRM nada muda.`,
      )
    ) {
      return;
    }
    await run(() => google.link(calendar.id, null), 'Esta agenda não vai mais para o Google Agenda.');
    setChoices(null);
  }

  const connectNote = (
    <p className="text-xs text-muted-foreground">
      Abre a página do Google para entrar na conta do profissional. Salve antes as outras mudanças
      desta agenda.
    </p>
  );

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CalendarCheck className="size-4 text-muted-foreground" />
        Google Agenda
      </p>

      {connection ? (
        connection.status === 'needs_reconnect' ? (
          <>
            <p className="text-xs text-destructive">
              A conta {connection.email} precisa ser conectada de novo
              {connection.last_error ? `: ${connection.last_error}` : '.'} Enquanto isso, nada vai
              para o Google, mas a agenda do CRM segue normal.
            </p>
            <a href={googleConnectHref(calendar.id)} className={buttonVariants({ size: 'sm', className: 'w-fit' })}>
              Conectar de novo
            </a>
            {connectNote}
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Tudo o que é marcado, remarcado ou cancelado nesta agenda vai para o Google Agenda de{' '}
              <span className="text-foreground">{connection.email}</span>, na agenda{' '}
              <span className="text-foreground">
                “{calendar.google_calendar_name || calendar.google_calendar_id}”
              </span>
              . Inclusive o que o agente de IA e o link público marcarem.
            </p>
            {choices && choices.length > 1 ? (
              <OptionSelect
                ariaLabel="Agenda do Google onde gravar"
                disabled={busy}
                value={calendar.google_calendar_id ?? ''}
                onChange={(value) =>
                  void run(
                    () => google.link(calendar.id, connection.id, value),
                    'Agenda do Google trocada. Os agendamentos futuros passam para lá.',
                  )
                }
                options={choices.map((c) => ({
                  value: c.id,
                  label: c.primary ? `${c.name} (principal)` : c.name,
                }))}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {choices === null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void loadChoices(connection.id).then((list) => {
                      if (list && list.length <= 1) toast.info('Esta conta só tem uma agenda no Google.');
                    })
                  }
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Trocar a agenda do Google
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void stop()}
                className="text-muted-foreground hover:text-destructive"
              >
                Parar de enviar
              </Button>
            </div>
          </>
        )
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Ligue esta agenda ao Google Agenda do profissional: o que for marcado aqui, pela equipe,
            pelo agente de IA ou pelo link público, aparece lá na hora. O cliente não recebe convite
            do Google.
          </p>
          <div className="flex flex-wrap gap-2">
            {others.map((other) => (
              <Button
                key={other.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void linkAccount(other.id)}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Usar {other.email}
              </Button>
            ))}
            <a href={googleConnectHref(calendar.id)} className={buttonVariants({ size: 'sm' })}>
              {others.length > 0 ? 'Conectar outra conta Google' : 'Conectar com o Google'}
            </a>
          </div>
          {connectNote}
        </>
      )}
    </div>
  );
}

/**
 * The Google accounts connected to the CRM, under the list of agendas,
 * with "Desconectar" (G1).
 */
export function GoogleAccounts({ google }: { google: GoogleAgendaActions }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (google.connections.length === 0) return null;

  async function disconnect(connection: GoogleConnection) {
    if (
      !window.confirm(
        `Desconectar a conta Google ${connection.email}? As agendas que usam esta conta param de enviar para o Google. No CRM nada muda.`,
      )
    ) {
      return;
    }
    const deleteRemote = window.confirm(
      'Também apagar do Google Agenda os agendamentos futuros que o CRM colocou lá? OK apaga; Cancelar deixa como estão.',
    );
    setBusyId(connection.id);
    const result = await google.disconnect(connection.id, deleteRemote);
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      deleteRemote && result.data.removed > 0
        ? `Conta desconectada. ${result.data.removed} agendamento(s) tirados do Google.`
        : 'Conta Google desconectada.',
    );
    await google.onChanged();
  }

  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">Contas Google conectadas</p>
      <ul className="grid gap-2">
        {google.connections.map((connection) => (
          <li
            key={connection.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{connection.email}</p>
              <p
                className={
                  connection.status === 'connected'
                    ? 'text-xs text-muted-foreground'
                    : 'text-xs text-destructive'
                }
              >
                {connection.status === 'connected'
                  ? 'Conectada'
                  : 'Precisa conectar de novo (edite a agenda que a usa)'}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyId === connection.id}
              onClick={() => void disconnect(connection)}
              className="text-muted-foreground hover:text-destructive"
            >
              {busyId === connection.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Unplug className="size-3.5" />
              )}
              Desconectar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
