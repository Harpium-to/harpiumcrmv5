'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Clock,
  HeartPulse,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import {
  AGENCY_ACCESS_DESCRIPTION,
  AGENCY_ACCESS_LABEL,
  AGENCY_ACCESS_LEVELS,
  AUDIT_ACTION_LABEL,
  HEALTH_NICHES,
  isAgencyAccessLevel,
  type AgencyAccessLevel,
} from '@/lib/agencia/crm';
import { describeRequest } from '@/lib/agencia/consent';
import type { AgencyAccessView } from '@/types/platform';

type View = Extract<AgencyAccessView, { available: true }>;

const TEMP_DURATIONS = [
  { label: '1 hora', hours: 1 },
  { label: '24 horas', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '7 dias', hours: 168 },
];

const rank = (l: string) => (l === 'full' ? 2 : l === 'read' ? 1 : 0);

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const selectClass =
  'h-9 rounded-md border border-border bg-muted px-2 text-sm text-foreground';

/**
 * Settings → Acesso da agência (Fase 3). The owner decides how much the
 * agency that runs the platform may see and do in this CRM, answers its
 * requests, and reads what it did. Everyone else sees the current level.
 */
export function AgencyAccessPanel() {
  const [view, setView] = useState<AgencyAccessView | null>(null);
  const [selected, setSelected] = useState<AgencyAccessLevel>('metrics');
  const [tempLevel, setTempLevel] = useState<'read' | 'full'>('full');
  const [tempHours, setTempHours] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/agency-access', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao carregar');
      setView(json);
      if (json.available && isAgencyAccessLevel(json.level))
        setSelected(json.level);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar');
      setView({ available: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const put = async (key: string, body: object, done: string) => {
    setBusy(key);
    try {
      const res = await fetch('/api/account/agency-access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao salvar');
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(approve ? 'approve' : 'deny');
    try {
      const res = await fetch(`/api/account/agency-access/requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao responder');
      toast.success(approve ? 'Acesso liberado.' : 'Pedido recusado.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao responder');
    } finally {
      setBusy(null);
    }
  };

  const head = (
    <SettingsPanelHead
      title="Acesso da agência"
      description="Quanto a agência que administra este sistema pode ver e fazer neste CRM. Quem decide é o dono do CRM, e tudo o que a agência faz aqui fica registrado."
    />
  );

  if (view === null) {
    return (
      <div>
        {head}
        <div className="flex justify-center py-10">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (!view.available) {
    return (
      <div>
        {head}
        <p className="border-border bg-card text-muted-foreground rounded-xl border px-4 py-6 text-sm">
          Indisponível neste servidor: falta aplicar as migrations da plataforma
          (049 em diante).
        </p>
      </div>
    );
  }

  return (
    <AgencyAccessDetails
      view={view}
      head={head}
      busy={busy}
      selected={selected}
      setSelected={setSelected}
      tempLevel={tempLevel}
      setTempLevel={setTempLevel}
      tempHours={tempHours}
      setTempHours={setTempHours}
      put={put}
      decide={decide}
    />
  );
}

export function AgencyAccessDetails({
  view,
  head,
  busy,
  selected,
  setSelected,
  tempLevel,
  setTempLevel,
  tempHours,
  setTempHours,
  put,
  decide,
}: {
  view: View;
  head: React.ReactNode;
  busy: string | null;
  selected: AgencyAccessLevel;
  setSelected: (l: AgencyAccessLevel) => void;
  tempLevel: 'read' | 'full';
  setTempLevel: (l: 'read' | 'full') => void;
  tempHours: number;
  setTempHours: (h: number) => void;
  put: (key: string, body: object, done: string) => Promise<void>;
  decide: (id: string, approve: boolean) => Promise<void>;
}) {
  const tempActive =
    view.tempLevel !== null &&
    view.tempUntil !== null &&
    new Date(view.tempUntil) > new Date();
  const isHealth = !!view.niche && HEALTH_NICHES.includes(view.niche);
  const tempOptions = (['read', 'full'] as const).filter(
    (l) => rank(l) > rank(view.level)
  );

  return (
    <div className="space-y-5">
      {head}

      {isHealth && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <HeartPulse className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p>
            Este CRM guarda dados de saúde de pacientes, que a LGPD trata como
            sensíveis. Libere Leitura ou Total só se precisar, de preferência
            por tempo limitado.
          </p>
        </div>
      )}

      {view.pending && (
        <div className="border-primary/30 bg-primary/5 space-y-3 rounded-xl border p-4">
          <p className="text-sm">
            <span className="font-medium">
              A agência pediu acesso{' '}
              {describeRequest(view.pending.level, view.pending.tempHours)}
            </span>{' '}
            <span className="text-muted-foreground">
              em {fmt(view.pending.createdAt)}
            </span>
          </p>
          {view.pending.reason && (
            <p className="text-muted-foreground text-sm">
              “{view.pending.reason}”
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {AGENCY_ACCESS_DESCRIPTION[view.pending.level]}
          </p>
          {view.canDecide ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => decide(view.pending!.id, true)}
              >
                {busy === 'approve' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Liberar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => decide(view.pending!.id, false)}
              >
                {busy === 'deny' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                Recusar
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Só o dono do CRM responde.
            </p>
          )}
        </div>
      )}

      {/* Permanent level */}
      <section className="border-border bg-card space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-primary size-4" />
          <h3 className="text-sm font-semibold">Nível permanente</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {AGENCY_ACCESS_LEVELS.map((level) => {
            const active = selected === level;
            return (
              <button
                key={level}
                type="button"
                disabled={!view.canDecide}
                onClick={() => setSelected(level)}
                aria-pressed={active}
                className={`rounded-xl border p-3 text-left text-sm transition-colors disabled:cursor-default ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <span className="font-medium">
                  {AGENCY_ACCESS_LABEL[level]}
                </span>
                {view.level === level && (
                  <span className="text-primary ml-2 text-xs">atual</span>
                )}
                <span className="text-muted-foreground mt-1 block text-xs">
                  {AGENCY_ACCESS_DESCRIPTION[level]}
                </span>
              </button>
            );
          })}
        </div>
        {view.canDecide ? (
          selected !== view.level && (
            <div className="flex justify-end">
              <Button
                disabled={busy !== null}
                onClick={() =>
                  put(
                    'level',
                    {
                      level: selected,
                      // Keep a running temporary grant only if it still raises access.
                      tempLevel:
                        tempActive && rank(view.tempLevel!) > rank(selected)
                          ? view.tempLevel
                          : null,
                      tempHours: tempActive
                        ? Math.max(
                            1,
                            Math.ceil(
                              (new Date(view.tempUntil!).getTime() -
                                Date.now()) /
                                3_600_000
                            )
                          )
                        : null,
                    },
                    `Acesso da agência: ${AGENCY_ACCESS_LABEL[selected]}.`
                  )
                }
              >
                {busy === 'level' && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Salvar: {AGENCY_ACCESS_LABEL[selected]}
              </Button>
            </div>
          )
        ) : (
          <p className="text-muted-foreground text-xs">
            Só o dono do CRM muda o acesso da agência.
          </p>
        )}
      </section>

      {/* Temporary grant */}
      <section className="border-border bg-card space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Clock className="text-primary size-4" />
          <h3 className="text-sm font-semibold">Acesso temporário</h3>
        </div>
        {tempActive ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              <span className="font-medium">
                {AGENCY_ACCESS_LABEL[view.tempLevel!]}
              </span>{' '}
              liberado até {fmt(view.tempUntil!)}. Depois volta sozinho para{' '}
              {AGENCY_ACCESS_LABEL[view.level]}.
            </p>
            {view.canDecide && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  put(
                    'endTemp',
                    { level: view.level, tempLevel: null },
                    'Acesso temporário encerrado.'
                  )
                }
              >
                {busy === 'endTemp' && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Encerrar agora
              </Button>
            )}
          </div>
        ) : view.canDecide && tempOptions.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <span className="text-muted-foreground">Liberar</span>
            <select
              aria-label="Nível temporário"
              value={
                tempOptions.includes(tempLevel) ? tempLevel : tempOptions[0]
              }
              onChange={(e) =>
                setTempLevel(e.target.value === 'read' ? 'read' : 'full')
              }
              className={selectClass}
            >
              {tempOptions.map((l) => (
                <option key={l} value={l}>
                  {AGENCY_ACCESS_LABEL[l]}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">por</span>
            <select
              aria-label="Duração"
              value={tempHours}
              onChange={(e) => setTempHours(Number(e.target.value))}
              className={selectClass}
            >
              {TEMP_DURATIONS.map((d) => (
                <option key={d.hours} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                const lvl = tempOptions.includes(tempLevel)
                  ? tempLevel
                  : tempOptions[0];
                void put(
                  'temp',
                  { level: view.level, tempLevel: lvl, tempHours },
                  `${AGENCY_ACCESS_LABEL[lvl]} liberado temporariamente.`
                );
              }}
            >
              {busy === 'temp' && <Loader2 className="size-4 animate-spin" />}
              Liberar
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {view.canDecide
              ? 'O nível permanente já é o máximo.'
              : 'Nenhum acesso temporário ativo.'}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Útil para um suporte pontual: termina sozinho, sem você precisar
          lembrar de tirar.
        </p>
      </section>

      {view.canSeeLog && (
        <section className="border-border bg-card overflow-hidden rounded-xl border">
          <h3 className="border-border border-b px-4 py-3 text-sm font-semibold">
            O que a agência fez neste CRM
          </h3>
          {view.activity.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              Nenhuma ação registrada.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {view.activity.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span>
                    <span className="font-medium">{a.by}</span>{' '}
                    <span className="text-muted-foreground">
                      {(AUDIT_ACTION_LABEL[a.action] ?? a.action).toLowerCase()}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {fmt(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view.canSeeLog && view.history.length > 0 && (
        <section className="border-border bg-card overflow-hidden rounded-xl border">
          <h3 className="border-border border-b px-4 py-3 text-sm font-semibold">
            Histórico do acesso
          </h3>
          <ul className="divide-border divide-y">
            {view.history.map((h, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span>
                  {isAgencyAccessLevel(h.level)
                    ? AGENCY_ACCESS_LABEL[h.level]
                    : h.level}
                  {h.tempLevel &&
                    h.tempUntil &&
                    isAgencyAccessLevel(h.tempLevel) && (
                      <span className="text-muted-foreground">
                        {' '}
                        + {AGENCY_ACCESS_LABEL[h.tempLevel]} até{' '}
                        {fmt(h.tempUntil)}
                      </span>
                    )}
                  <span className="text-muted-foreground"> · {h.by}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {fmt(h.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
