'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, CalendarPlus, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { withinHours, type HoursRow } from '@/lib/agenda/slots';
import {
  describeAgendaError,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_STEPS,
  formatDuration,
  SLOT_OPTIONS,
} from '@/lib/agenda/status';
import type { EventWrite, WriteError } from '@/lib/agenda/store';
import { googleCalendarUrl } from '@/lib/tasks/calendar';
import { formatDayShort, formatTime, fromLocalInput, dayKeyOf, parseClock, toLocalInput } from '@/lib/agenda/time';
import type {
  AgendaCalendar,
  AgendaEvent,
  AgendaEventKind,
  AgendaEventStatus,
  GoogleBusyBlock,
} from '@/types';

import { ContactPicker, type PickedContact } from './contact-picker';
import { OptionSelect } from './option-select';

/** What the dialog opens with: an existing event, or a slot to fill. */
export interface EventSeed {
  /** Changes whenever the dialog should start over — it is the form's key. */
  key: string;
  event?: AgendaEvent;
  calendarId: string;
  kind: AgendaEventKind;
  start: Date;
  /** Blocks only; appointments take the agenda's slot length. */
  end?: Date;
  /** Booking from a contact's record or conversation: already chosen. */
  contact?: PickedContact;
}


interface EventDialogProps {
  seed: EventSeed | null;
  onClose: () => void;
  calendars: AgendaCalendar[];
  hoursByCalendar: Record<string, HoursRow[]>;
  /** Busy in the professionals' Google Agenda (071): booking over it warns. */
  googleBusy?: GoogleBusyBlock[];
  accountId: string | null;
  /** Viewers open an event to read it; nothing is editable. */
  canBook: boolean;
  onSave: (payload: EventWrite, id?: string) => Promise<WriteError>;
  onDelete: (id: string) => Promise<WriteError>;
}

export function EventDialog({ seed, onClose, ...rest }: EventDialogProps) {
  return (
    <Dialog open={seed !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        {/* Keyed by the seed so opening another slot starts a fresh form. */}
        {seed ? <EventForm key={seed.key} seed={seed} onClose={onClose} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  seed,
  onClose,
  calendars,
  hoursByCalendar,
  googleBusy = [],
  accountId,
  canBook,
  onSave,
  onDelete,
}: EventDialogProps & { seed: EventSeed }) {
  const editing = seed.event;
  const seedCalendar = calendars.find((c) => c.id === seed.calendarId);
  const seedZone = seedCalendar?.timezone ?? 'America/Sao_Paulo';

  const [calendarId, setCalendarId] = useState(seed.calendarId);
  const [kind, setKind] = useState<AgendaEventKind>(seed.kind);
  const [contact, setContact] = useState<PickedContact | null>(
    editing?.contact ?? seed.contact ?? null,
  );
  const [notify, setNotify] = useState(editing?.notify ?? true);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [startLocal, setStartLocal] = useState(toLocalInput(seed.start, seedZone));
  const [duration, setDuration] = useState(() => {
    if (editing) {
      const ms = new Date(editing.ends_at).getTime() - new Date(editing.starts_at).getTime();
      return Math.max(5, Math.round(ms / 60000));
    }
    return seedCalendar?.slot_minutes ?? 30;
  });
  const [endLocal, setEndLocal] = useState(() =>
    toLocalInput(
      seed.end ?? new Date(seed.start.getTime() + 60 * 60000),
      seedZone,
    ),
  );
  const [status, setStatus] = useState<AgendaEventStatus>(editing?.status ?? 'scheduled');
  const [busy, setBusy] = useState<'save' | 'cancel' | 'delete' | null>(null);

  const calendar = calendars.find((c) => c.id === calendarId) ?? seedCalendar;
  const zone = calendar?.timezone ?? seedZone;
  const block = kind === 'block';
  const cancelled = editing?.status === 'cancelled';
  // Reserved by an AI agent that may not book on its own (067).
  const awaiting = editing?.status === 'pending';
  const readOnly = !canBook;

  const durationOptions = [...new Set([...SLOT_OPTIONS, calendar?.slot_minutes ?? 30, duration])]
    .sort((a, b) => a - b)
    .map((m) => ({ value: String(m), label: formatDuration(m) }));

  // Booking outside the opening hours is allowed, but worth saying.
  const startDay = startLocal.slice(0, 10);
  const startMinute = parseClock(startLocal.slice(11));
  const outsideHours =
    !block &&
    startLocal.length >= 16 &&
    !withinHours(hoursByCalendar[calendarId] ?? [], startDay, startMinute, startMinute + duration);

  // Busy in the professional's Google Agenda (071): allowed, but said.
  const pickedStart = startLocal.length >= 16 ? fromLocalInput(startLocal, zone) : null;
  const pickedEnd = pickedStart
    ? block
      ? fromLocalInput(endLocal, zone)
      : new Date(pickedStart.getTime() + duration * 60000)
    : null;
  const overGoogle =
    !cancelled &&
    !!pickedStart &&
    !!pickedEnd &&
    googleBusy.some(
      (b) =>
        b.calendar_id === calendarId &&
        new Date(b.starts_at) < pickedEnd &&
        new Date(b.ends_at) > pickedStart,
    );

  function build(nextStatus: AgendaEventStatus): EventWrite | string {
    if (!calendar) return 'Escolha uma agenda.';
    const start = fromLocalInput(startLocal, zone);
    if (!start) return 'Informe quando começa.';
    const end = block
      ? fromLocalInput(endLocal, zone)
      : new Date(start.getTime() + duration * 60000);
    if (!end) return 'Informe quando termina.';
    if (end <= start) return 'O fim precisa ser depois do início.';
    if (!block && !contact && !title.trim()) {
      return 'Escolha um contato ou escreva um título.';
    }
    return {
      calendar_id: calendar.id,
      kind,
      contact_id: block ? null : (contact?.id ?? null),
      title: title.trim() || null,
      notes: notes.trim() || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: block ? 'scheduled' : nextStatus,
      notify,
    };
  }

  async function save(nextStatus: AgendaEventStatus, action: 'save' | 'cancel') {
    const payload = build(nextStatus);
    if (typeof payload === 'string') {
      toast.error(payload);
      return;
    }
    setBusy(action);
    const error = await onSave(payload, editing?.id);
    setBusy(null);
    if (error) {
      toast.error(describeAgendaError(error, 'Não consegui salvar.'));
      return;
    }
    toast.success(
      awaiting
        ? action === 'cancel'
          ? 'Reserva recusada. O horário ficou livre.'
          : 'Agendamento aprovado. O cliente recebe a confirmação.'
        : action === 'cancel'
        ? 'Agendamento cancelado. O horário ficou livre.'
        : block
          ? 'Horário bloqueado.'
          : editing
            ? 'Agendamento atualizado.'
            : 'Agendamento marcado.',
    );
    onClose();
  }

  async function remove() {
    if (!editing) return;
    const question = block
      ? 'Remover este bloqueio? O horário volta a ficar livre.'
      : 'Apagar este agendamento de vez? Para manter o histórico, prefira cancelar.';
    if (!window.confirm(question)) return;
    setBusy('delete');
    const error = await onDelete(editing.id);
    setBusy(null);
    if (error) {
      toast.error(describeAgendaError(error, 'Não consegui apagar.'));
      return;
    }
    toast.success(block ? 'Bloqueio removido.' : 'Agendamento apagado.');
    onClose();
  }

  const fieldClass = 'bg-muted border-border text-foreground placeholder:text-muted-foreground';

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) void save(cancelled || awaiting ? 'scheduled' : status, 'save');
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {editing
            ? block
              ? 'Bloqueio'
              : 'Agendamento'
            : block
              ? 'Bloquear horário'
              : 'Novo agendamento'}
        </DialogTitle>
        <DialogDescription>
          {block
            ? 'Férias, almoço, feriado: ninguém consegue marcar neste período.'
            : cancelled
              ? 'Este agendamento foi cancelado. Salvar marca de novo, se o horário ainda estiver livre.'
              : awaiting
                ? editing?.source === 'public'
                  ? 'Pedido feito pelo link público. O horário está reservado: aprove para confirmar, ou recuse para liberar.'
                  : 'O agente de IA reservou este horário e disse ao cliente que a equipe confirma. Aprove para confirmar, ou recuse para liberar o horário.'
                : 'O horário fica reservado nesta agenda.'}
        </DialogDescription>
      </DialogHeader>

      {/* Appointment or block — only chosen when creating. */}
      {!editing ? (
        <div className="pill-track w-fit" role="tablist" aria-label="Tipo">
          {(
            [
              ['appointment', 'Agendamento'],
              ['block', 'Bloqueio'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              data-active={kind === value}
              onClick={() => setKind(value)}
              className="pill"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground">Agenda</Label>
        <OptionSelect
          ariaLabel="Agenda"
          value={calendarId}
          onChange={setCalendarId}
          disabled={readOnly}
          options={calendars.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
        />
      </div>

      {block ? null : (
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground">Contato</Label>
          <ContactPicker
            accountId={accountId}
            value={contact}
            onChange={setContact}
            disabled={readOnly}
          />
          {contact && editing ? (
            <Link
              href={`/contacts?contact=${contact.id}`}
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              Abrir a ficha do contato <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="agenda-title" className="text-muted-foreground">
          {block ? 'Motivo' : 'Título'} <span className="text-xs">(opcional)</span>
        </Label>
        <Input
          id="agenda-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          disabled={readOnly}
          placeholder={block ? 'Ex.: Férias, almoço, feriado' : 'Ex.: Consulta, retorno, avaliação'}
          className={fieldClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="agenda-start" className="text-muted-foreground">
            Começa
          </Label>
          <Input
            id="agenda-start"
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            disabled={readOnly}
            required
            className={fieldClass}
          />
        </div>
        {block ? (
          <div className="grid gap-1.5">
            <Label htmlFor="agenda-end" className="text-muted-foreground">
              Termina
            </Label>
            <Input
              id="agenda-end"
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              disabled={readOnly}
              required
              className={fieldClass}
            />
          </div>
        ) : (
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-muted-foreground">Duração</Label>
            <OptionSelect
              ariaLabel="Duração"
              value={String(duration)}
              onChange={(v) => setDuration(Number(v))}
              disabled={readOnly}
              options={durationOptions}
            />
          </div>
        )}
      </div>

      {overGoogle ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Esse horário está ocupado no Google Agenda do profissional. Dá para marcar mesmo assim, como
          encaixe.
        </p>
      ) : null}

      {outsideHours ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Fora do horário de atendimento desta agenda. Dá para marcar mesmo assim, como encaixe.
        </p>
      ) : null}

      {/* Only where there is something to send, and someone to send it to. */}
      {!block && contact && calendar && (calendar.confirm_enabled || calendar.reminder_enabled) ? (
        <div className="grid gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <Switch
              checked={notify}
              onCheckedChange={setNotify}
              disabled={readOnly}
              aria-label="Avisar o cliente pelo WhatsApp"
            />
            Avisar o cliente pelo WhatsApp
          </label>
          <p className="text-xs text-muted-foreground">
            {notify
              ? [
                  calendar.confirm_enabled ? 'confirmação ao salvar um horário novo' : null,
                  calendar.reminder_enabled
                    ? `lembrete ${calendar.reminder_hours}h antes`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' e ')
                  .replace(/^./, (c) => c.toUpperCase()) + '.'
              : 'Este cliente não recebe confirmação nem lembrete deste horário.'}
          </p>
          {editing ? (
            <MessageLog event={editing} zone={zone} />
          ) : null}
        </div>
      ) : null}

      {editing && !block && !cancelled && !awaiting ? (
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground">Situação</Label>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_STATUS_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                disabled={readOnly}
                data-active={status === step}
                onClick={() => setStatus(step)}
                className="chip px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {EVENT_STATUS_LABEL[step]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="agenda-notes" className="text-muted-foreground">
          Observações <span className="text-xs">(opcional)</span>
        </Label>
        <Textarea
          id="agenda-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          disabled={readOnly}
          className={fieldClass}
        />
      </div>

      {editing ? <GoogleSyncLine event={editing} /> : null}

      {editing && !block && !cancelled && calendar && !calendar.google_connection_id ? (
        // Google's own "new event" page, filled in: the person's
        // calendar, no access to their account (same as tasks, Fase 9).
        // Not offered when the agenda already writes to Google (069).
        <GoogleLink
          title={[contact?.name?.trim() || contact?.phone, title.trim()].filter(Boolean).join(' — ') || calendar.name}
          start={editing.starts_at}
          minutes={duration}
          details={[`Agenda: ${calendar.name}`, contact?.phone ? `WhatsApp: ${contact.phone}` : '']
            .filter(Boolean)
            .join('\n')}
        />
      ) : null}

      {readOnly ? (
        <p className="text-xs text-muted-foreground">
          Seu acesso é só de leitura: você vê a agenda, mas não marca nem altera.
        </p>
      ) : (
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void remove()}
                className="text-muted-foreground hover:text-destructive"
              >
                {busy === 'delete' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {block ? 'Remover bloqueio' : 'Apagar'}
              </Button>
            ) : null}
            {editing && !block && !cancelled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void save('cancelled', 'cancel')}
              >
                {busy === 'cancel' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {awaiting ? 'Recusar' : 'Cancelar agendamento'}
              </Button>
            ) : null}
          </div>
          <Button type="submit" size="sm" disabled={busy !== null}>
            {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {editing
              ? cancelled
                ? 'Marcar de novo'
                : awaiting
                  ? 'Aprovar'
                  : 'Salvar'
              : block
                ? 'Bloquear'
                : 'Marcar'}
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}

function GoogleLink(props: { title: string; start: string; minutes: number; details: string }) {
  const url = googleCalendarUrl(props);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
    >
      <CalendarPlus className="size-3" />
      Adicionar ao meu Google Agenda
    </a>
  );
}

/** Where this event stands in Google Agenda, when its agenda writes there (069). */
function GoogleSyncLine({ event }: { event: AgendaEvent }) {
  const state = event.google_sync_state;
  // Moved or deleted directly in Google (071): the CRM did not follow.
  if (event.google_remote_notice) {
    return (
      <p className="inline-flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <CalendarCheck className="mt-0.5 size-3 shrink-0" />
        {event.google_remote_notice} O CRM não mudou nada: remarque ou cancele aqui, se for o caso.
        Salvar este agendamento põe o Google de volta como está no CRM.
      </p>
    );
  }
  if (!state) return null;
  const line =
    state === 'synced'
      ? { text: 'Está no Google Agenda do profissional.', failed: false }
      : state === 'error'
        ? {
            text: `Não foi para o Google Agenda: ${event.google_sync_error ?? 'erro desconhecido.'}`,
            failed: true,
          }
        : { text: 'Enviando para o Google Agenda…', failed: false };
  return (
    <p
      className={`inline-flex items-start gap-1.5 text-xs ${line.failed ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      <CalendarCheck className="mt-0.5 size-3 shrink-0" />
      {line.text}
    </p>
  );
}

/** What already went (or failed to go) to the customer about this event. */
function MessageLog({ event, zone }: { event: AgendaEvent; zone: string }) {
  const when = (iso: string) => {
    const date = new Date(iso);
    return `${formatDayShort(dayKeyOf(date, zone))} às ${formatTime(date, zone)}`;
  };
  const lines: { text: string; failed: boolean }[] = [];
  if (event.confirmation_at) {
    lines.push(
      event.confirmation_error
        ? { text: `A confirmação não foi entregue: ${event.confirmation_error}`, failed: true }
        : { text: `Confirmação enviada ${when(event.confirmation_at)}.`, failed: false },
    );
  }
  if (event.reminder_at) {
    lines.push(
      event.reminder_error
        ? { text: `O lembrete não foi entregue: ${event.reminder_error}`, failed: true }
        : { text: `Lembrete enviado ${when(event.reminder_at)}.`, failed: false },
    );
  }
  if (lines.length === 0) return null;
  return (
    <ul className="grid gap-0.5 text-xs">
      {lines.map((line) => (
        <li key={line.text} className={line.failed ? 'text-destructive' : 'text-muted-foreground'}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}
