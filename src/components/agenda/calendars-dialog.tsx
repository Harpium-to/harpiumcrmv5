'use client';

import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
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
import { DEFAULT_CONFIRM_TEXT, DEFAULT_REMINDER_TEXT } from '@/lib/agenda/messages';
import type { HoursRow } from '@/lib/agenda/slots';
import type { CalendarWrite, TemplateOption, WriteError } from '@/lib/agenda/store';
import {
  CALENDAR_COLORS,
  describeAgendaError,
  formatDuration,
  REMINDER_HOURS_OPTIONS,
  SLOT_OPTIONS,
  TIMEZONE_OPTIONS,
} from '@/lib/agenda/status';
import { weekdayLong } from '@/lib/agenda/time';
import {
  DEFAULT_WEEK,
  fromWeekDraft,
  MAX_RANGES_PER_DAY,
  nextRange,
  toWeekDraft,
  type DayDraft,
} from '@/lib/agenda/week';
import { cn } from '@/lib/utils';
import type { AgendaCalendar } from '@/types';

import { GoogleAccounts, GoogleCard, type GoogleAgendaActions } from './google-card';
import { OptionSelect } from './option-select';

interface CalendarsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Every agenda of the CRM, archived ones included. */
  calendars: AgendaCalendar[];
  hoursByCalendar: Record<string, HoursRow[]>;
  /** Approved templates, when the CRM is on the official API. */
  templates: TemplateOption[];
  onSave: (values: CalendarWrite, hours: HoursRow[], id?: string) => Promise<WriteError>;
  onSetActive: (id: string, active: boolean) => Promise<WriteError>;
  onDelete: (id: string) => Promise<WriteError>;
  /** Google Agenda (069); null when this server does not have it. */
  google: GoogleAgendaActions | null;
  /** Open straight on this agenda's form (coming back from Google). */
  initialEditing?: string | null;
}

/** Admins create agendas and set their opening hours here. */
export function CalendarsDialog({ open, onClose, ...rest }: CalendarsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? <Calendars {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Calendars({
  calendars,
  hoursByCalendar,
  templates,
  onSave,
  onSetActive,
  onDelete,
  google,
  initialEditing,
}: Omit<CalendarsDialogProps, 'open' | 'onClose'>) {
  // null: the list. 'new' or an id: the form.
  const [editing, setEditing] = useState<string | null>(() =>
    initialEditing && calendars.some((c) => c.id === initialEditing)
      ? initialEditing
      : calendars.length === 0
        ? 'new'
        : null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  if (editing) {
    const calendar = calendars.find((c) => c.id === editing);
    return (
      <CalendarForm
        key={editing}
        calendar={calendar}
        hours={calendar ? (hoursByCalendar[calendar.id] ?? []) : DEFAULT_WEEK}
        templates={templates}
        canGoBack={calendars.length > 0}
        onBack={() => setEditing(null)}
        onSave={onSave}
        google={google}
      />
    );
  }

  async function toggle(calendar: AgendaCalendar) {
    setBusyId(calendar.id);
    const error = await onSetActive(calendar.id, !calendar.is_active);
    setBusyId(null);
    if (error) toast.error(describeAgendaError(error, 'Não consegui alterar a agenda.'));
  }

  async function remove(calendar: AgendaCalendar) {
    if (
      !window.confirm(
        `Apagar a agenda "${calendar.name}"? Todos os agendamentos e bloqueios dela são apagados junto e não dá para desfazer. Para guardar o histórico, arquive.`,
      )
    ) {
      return;
    }
    setBusyId(calendar.id);
    const error = await onDelete(calendar.id);
    setBusyId(null);
    if (error) toast.error(describeAgendaError(error, 'Não consegui apagar a agenda.'));
    else toast.success('Agenda apagada.');
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Agendas</DialogTitle>
        <DialogDescription>
          Uma agenda para cada profissional, sala ou serviço que atende com hora marcada.
        </DialogDescription>
      </DialogHeader>

      <ul className="grid gap-2">
        {calendars.map((calendar) => (
          <li
            key={calendar.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
          >
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: calendar.color }}
            />
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm font-medium', !calendar.is_active && 'opacity-60')}>
                {calendar.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {calendar.is_active ? `Consultas de ${formatDuration(calendar.slot_minutes)}` : 'Arquivada'}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Editar ${calendar.name}`}
              onClick={() => setEditing(calendar.id)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busyId === calendar.id}
              aria-label={calendar.is_active ? `Arquivar ${calendar.name}` : `Reativar ${calendar.name}`}
              title={calendar.is_active ? 'Arquivar' : 'Reativar'}
              onClick={() => void toggle(calendar)}
            >
              {busyId === calendar.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : calendar.is_active ? (
                <Archive className="size-3.5" />
              ) : (
                <ArchiveRestore className="size-3.5" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busyId === calendar.id}
              aria-label={`Apagar ${calendar.name}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void remove(calendar)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <Button type="button" size="sm" className="w-fit" onClick={() => setEditing('new')}>
        <Plus className="size-3.5" />
        Nova agenda
      </Button>

      {google ? <GoogleAccounts google={google} /> : null}
    </div>
  );
}

function CalendarForm({
  calendar,
  hours,
  templates,
  canGoBack,
  onBack,
  onSave,
  google,
}: {
  calendar: AgendaCalendar | undefined;
  hours: HoursRow[];
  templates: TemplateOption[];
  canGoBack: boolean;
  onBack: () => void;
  onSave: CalendarsDialogProps['onSave'];
  google: GoogleAgendaActions | null;
}) {
  const [name, setName] = useState(calendar?.name ?? '');
  const [color, setColor] = useState(calendar?.color ?? CALENDAR_COLORS[0]);
  const [slot, setSlot] = useState(calendar?.slot_minutes ?? 30);
  const [timezone, setTimezone] = useState(calendar?.timezone ?? TIMEZONE_OPTIONS[0].value);
  const [week, setWeek] = useState<DayDraft[]>(() => toWeekDraft(hours));
  const [confirmOn, setConfirmOn] = useState(calendar?.confirm_enabled ?? false);
  const [confirmText, setConfirmText] = useState(calendar?.confirm_text ?? '');
  const [confirmTemplate, setConfirmTemplate] = useState(
    templateKey(calendar?.confirm_template, calendar?.confirm_template_language),
  );
  const [reminderOn, setReminderOn] = useState(calendar?.reminder_enabled ?? false);
  const [reminderHours, setReminderHours] = useState(calendar?.reminder_hours ?? 24);
  const [reminderText, setReminderText] = useState(calendar?.reminder_text ?? '');
  const [reminderTemplate, setReminderTemplate] = useState(
    templateKey(calendar?.reminder_template, calendar?.reminder_template_language),
  );
  const [publicOn, setPublicOn] = useState(calendar?.public_enabled ?? false);
  const [publicAuto, setPublicAuto] = useState(calendar?.public_auto_confirm ?? true);
  const [feedOn, setFeedOn] = useState(calendar?.feed_enabled ?? false);
  const [saving, setSaving] = useState(false);

  // The links are built here, in the browser, so they carry whatever
  // address the CRM is being used at.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const publicUrl = calendar ? `${origin}/marcar/${calendar.public_token}` : '';
  const feedUrl = calendar ? `${origin}/api/agenda/feed/${calendar.feed_token}.ics` : '';

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não consegui copiar. Selecione o link e copie à mão.');
    }
  }

  const patchDay = (weekday: number, patch: (day: DayDraft) => DayDraft) =>
    setWeek((prev) => prev.map((d) => (d.weekday === weekday ? patch(d) : d)));

  async function submit() {
    if (!name.trim()) {
      toast.error('Dê um nome para a agenda.');
      return;
    }
    const result = fromWeekDraft(week);
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    setSaving(true);
    const error = await onSave(
      {
        name: name.trim(),
        color,
        slot_minutes: slot,
        timezone,
        confirm_enabled: confirmOn,
        confirm_text: confirmText.trim() || null,
        ...splitTemplateKey(confirmTemplate, 'confirm'),
        reminder_enabled: reminderOn,
        reminder_hours: reminderHours,
        reminder_text: reminderText.trim() || null,
        ...splitTemplateKey(reminderTemplate, 'reminder'),
        public_enabled: publicOn,
        public_auto_confirm: publicAuto,
        feed_enabled: feedOn,
      },
      result.rows,
      calendar?.id,
    );
    setSaving(false);
    if (error) {
      toast.error(describeAgendaError(error, 'Não consegui salvar a agenda.'));
      return;
    }
    toast.success(calendar ? 'Agenda atualizada.' : 'Agenda criada.');
    onBack();
  }

  const slotOptions = [...new Set([...SLOT_OPTIONS, slot])]
    .sort((a, b) => a - b)
    .map((m) => ({ value: String(m), label: formatDuration(m) }));
  // An agenda saved with a zone outside the short list keeps it.
  const zoneOptions = TIMEZONE_OPTIONS.some((z) => z.value === timezone)
    ? TIMEZONE_OPTIONS
    : [...TIMEZONE_OPTIONS, { value: timezone, label: timezone }];
  const fieldClass = 'bg-muted border-border text-foreground placeholder:text-muted-foreground';
  // A template saved here and since removed from Meta still shows, so
  // the form does not silently drop it on the next save.
  const templateOptions = (current: string) => [
    { value: NO_TEMPLATE, label: 'Não usar modelo (enviar o texto)' },
    ...templates.map((t) => ({ value: templateKey(t.name, t.language), label: `${t.name} · ${t.language}` })),
    ...(current !== NO_TEMPLATE && !templates.some((t) => templateKey(t.name, t.language) === current)
      ? [{ value: current, label: `${current.split('|')[0]} (não encontrado)` }]
      : []),
  ];
  const showTemplates =
    templates.length > 0 || confirmTemplate !== NO_TEMPLATE || reminderTemplate !== NO_TEMPLATE;
  const reminderOptions = [...new Set([...REMINDER_HOURS_OPTIONS, reminderHours])]
    .sort((a, b) => a - b)
    .map((h) => ({ value: String(h), label: h === 1 ? '1 hora antes' : `${h} horas antes` }));

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{calendar ? 'Editar agenda' : 'Nova agenda'}</DialogTitle>
        <DialogDescription>
          O horário de atendimento define os horários livres. Marcar fora dele continua possível,
          como encaixe.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="calendar-name" className="text-muted-foreground">
          Nome
        </Label>
        <Input
          id="calendar-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Ex.: Dr. João, Sala 2, Avaliações"
          className={fieldClass}
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground">Cor</Label>
        <div className="flex flex-wrap gap-2">
          {CALENDAR_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Cor ${option}`}
              aria-pressed={color === option}
              onClick={() => setColor(option)}
              className={cn(
                'size-7 rounded-full transition-shadow',
                color === option && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
              )}
              style={{ backgroundColor: option }}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-muted-foreground">Duração padrão</Label>
          <OptionSelect
            ariaLabel="Duração padrão"
            value={String(slot)}
            onChange={(v) => setSlot(Number(v))}
            options={slotOptions}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-muted-foreground">Fuso horário</Label>
          <OptionSelect
            ariaLabel="Fuso horário"
            value={timezone}
            onChange={setTimezone}
            options={zoneOptions}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground">Horário de atendimento</Label>
        <ul className="grid gap-1.5">
          {week.map((day) => (
            <li
              key={day.weekday}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2"
            >
              <Switch
                checked={day.open}
                onCheckedChange={(open) => patchDay(day.weekday, (d) => ({ ...d, open }))}
                aria-label={`Atende ${weekdayLong(day.weekday)}`}
              />
              <span className="w-24 text-sm first-letter:uppercase">{weekdayLong(day.weekday)}</span>
              {day.open ? (
                <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                  {day.ranges.map((range, index) => (
                    <span key={index} className="flex items-center gap-1 text-sm">
                      <Input
                        type="time"
                        value={range.starts}
                        aria-label={`${weekdayLong(day.weekday)}, início do período ${index + 1}`}
                        onChange={(e) =>
                          patchDay(day.weekday, (d) => ({
                            ...d,
                            ranges: d.ranges.map((r, i) =>
                              i === index ? { ...r, starts: e.target.value } : r,
                            ),
                          }))
                        }
                        className={cn(fieldClass, 'h-8 w-[6.25rem] px-2')}
                      />
                      <span className="text-muted-foreground">–</span>
                      <Input
                        type="time"
                        value={range.ends}
                        aria-label={`${weekdayLong(day.weekday)}, fim do período ${index + 1}`}
                        onChange={(e) =>
                          patchDay(day.weekday, (d) => ({
                            ...d,
                            ranges: d.ranges.map((r, i) =>
                              i === index ? { ...r, ends: e.target.value } : r,
                            ),
                          }))
                        }
                        className={cn(fieldClass, 'h-8 w-[6.25rem] px-2')}
                      />
                      {index > 0 ? (
                        <button
                          type="button"
                          aria-label="Remover período"
                          onClick={() =>
                            patchDay(day.weekday, (d) => ({
                              ...d,
                              ranges: d.ranges.filter((_, i) => i !== index),
                            }))
                          }
                          className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {day.ranges.length < MAX_RANGES_PER_DAY ? (
                    <button
                      type="button"
                      onClick={() =>
                        patchDay(day.weekday, (d) => ({
                          ...d,
                          ranges: [...d.ranges, nextRange(d)],
                        }))
                      }
                      className="text-xs text-primary hover:underline"
                    >
                      + período
                    </button>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Não atende</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground">Mensagens ao cliente pelo WhatsApp</Label>
        <div className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <Switch
              checked={confirmOn}
              onCheckedChange={setConfirmOn}
              aria-label="Confirmar ao marcar ou remarcar"
            />
            Confirmar quando marcar ou remarcar
          </label>
          {confirmOn ? (
            <>
              <Textarea
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                maxLength={1000}
                aria-label="Texto da confirmação"
                placeholder={DEFAULT_CONFIRM_TEXT}
                className={fieldClass}
              />
              {showTemplates ? (
                <OptionSelect
                  ariaLabel="Modelo aprovado para a confirmação"
                  value={confirmTemplate}
                  onChange={setConfirmTemplate}
                  options={templateOptions(confirmTemplate)}
                />
              ) : null}
            </>
          ) : null}
        </div>
        <div className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-1 cursor-pointer items-center gap-3 text-sm">
              <Switch
                checked={reminderOn}
                onCheckedChange={setReminderOn}
                aria-label="Lembrar antes do horário"
              />
              Lembrar antes do horário
            </label>
            {reminderOn ? (
              <OptionSelect
                ariaLabel="Quanto tempo antes"
                className="w-40"
                value={String(reminderHours)}
                onChange={(v) => setReminderHours(Number(v))}
                options={reminderOptions}
              />
            ) : null}
          </div>
          {reminderOn ? (
            <>
              <Textarea
                value={reminderText}
                onChange={(e) => setReminderText(e.target.value)}
                maxLength={1000}
                aria-label="Texto do lembrete"
                placeholder={DEFAULT_REMINDER_TEXT}
                className={fieldClass}
              />
              {showTemplates ? (
                <OptionSelect
                  ariaLabel="Modelo aprovado para o lembrete"
                  value={reminderTemplate}
                  onChange={setReminderTemplate}
                  options={templateOptions(reminderTemplate)}
                />
              ) : null}
            </>
          ) : null}
        </div>
        {confirmOn || reminderOn ? (
          <p className="text-xs text-muted-foreground">
            No texto, use {'{nome}'}, {'{agenda}'}, {'{dia}'}, {'{data}'} e {'{hora}'}. Em branco, vai o
            texto de exemplo.
            {showTemplates
              ? ' Na API oficial, um texto só é entregue até 24h depois da última mensagem do cliente: para o lembrete chegar sempre, escolha um modelo aprovado. O corpo do modelo recebe, nesta ordem, nome, data, hora e agenda.'
              : ''}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground">Links</Label>
        {calendar ? (
          <>
            <div className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Switch
                  checked={publicOn}
                  onCheckedChange={setPublicOn}
                  aria-label="Link público de agendamento"
                />
                Link público de agendamento
              </label>
              {publicOn ? (
                <>
                  <LinkRow url={publicUrl} label="Link público" onCopy={copy} />
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <Switch
                      checked={publicAuto}
                      onCheckedChange={setPublicAuto}
                      aria-label="Marcar direto, sem aprovação"
                    />
                    Marcar direto, sem aprovação
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Quem abre o link escolhe um horário livre e informa nome e WhatsApp. Não vê quem
                    ocupa os outros horários.{' '}
                    {publicAuto
                      ? 'O horário é marcado na hora.'
                      : 'O horário fica reservado como Aguardando aprovação até alguém da equipe aprovar.'}{' '}
                    Vale depois de salvar.
                  </p>
                </>
              ) : null}
            </div>
            <div className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Switch
                  checked={feedOn}
                  onCheckedChange={setFeedOn}
                  aria-label="Ver em outra agenda"
                />
                Ver no Google Agenda, Apple ou Outlook
              </label>
              {feedOn ? (
                <>
                  <LinkRow url={feedUrl} label="Endereço da agenda" onCopy={copy} />
                  <p className="text-xs text-muted-foreground">
                    No Google Agenda: Outras agendas › + › Do URL, e cole o endereço. Só leitura, e
                    o aplicativo atualiza sozinho a cada algumas horas. O endereço mostra os nomes
                    dos clientes: passe só para quem pode ver esta agenda. Vale depois de salvar.
                  </p>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Depois de criar a agenda, edite-a para ligar o link público de agendamento e o endereço
            para acompanhar no Google Agenda, Apple ou Outlook.
          </p>
        )}
      </div>

      {calendar && google ? (
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground">Ligar ao Google Agenda</Label>
          <GoogleCard calendar={calendar} google={google} />
        </div>
      ) : null}

      <DialogFooter className="gap-2 sm:justify-between">
        {canGoBack ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={saving}>
            <ArrowLeft className="size-3.5" />
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {calendar ? 'Salvar' : 'Criar agenda'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A link in a read-only field, with a button that copies it. */
function LinkRow({
  url,
  label,
  onCopy,
}: {
  url: string;
  label: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={url}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="bg-muted border-border h-8 min-w-0 flex-1 text-xs text-foreground"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => onCopy(url)}>
        <Copy className="size-3.5" />
        Copiar
      </Button>
    </div>
  );
}

/** "No template" in the template dropdowns. */
const NO_TEMPLATE = 'none';

/** A template is its name and its language; the dropdown needs one value. */
function templateKey(name: string | null | undefined, language: string | null | undefined): string {
  return name ? `${name}|${language || 'pt_BR'}` : NO_TEMPLATE;
}

function splitTemplateKey<P extends 'confirm' | 'reminder'>(key: string, prefix: P) {
  const [name, language] = key === NO_TEMPLATE ? [null, null] : key.split('|');
  return {
    [`${prefix}_template`]: name ?? null,
    [`${prefix}_template_language`]: name ? (language ?? 'pt_BR') : null,
  } as Record<`${P}_template` | `${P}_template_language`, string | null>;
}
