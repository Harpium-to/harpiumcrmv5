'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { OptionSelect } from '@/components/agenda/option-select';
import { useAuth } from '@/hooks/use-auth';
import { useMembers } from '@/hooks/use-atendimento';
import type { RadarSettings as Settings } from '@/lib/radar/config';
import { SettingsPanelHead } from './settings-panel-head';

const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/**
 * Configurações › Radar (docs/plano-radar-monitoramento.md §4.5): on/off,
 * sensitivity, who is told, the weekly digest, which alerts, snoozes,
 * and whether attendants see the chance of closing.
 */
export function RadarSettings() {
  const { canManageMembers } = useAuth();
  const { members } = useMembers();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [alertKeys, setAlertKeys] = useState<{ key: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/radar/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { settings?: Settings; alertKeys?: { key: string; label: string }[] } | null) => {
        if (cancelled || !json?.settings) return;
        setSettings(json.settings);
        setAlertKeys(json.alertKeys ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (patch: Partial<Settings>, message = 'Salvo') => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSaving(true);
    try {
      const res = await fetch('/api/radar/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; settings?: Settings };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.settings) setSettings(json.settings);
      toast.success(message);
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div>
        <SettingsPanelHead title="Radar" description="Carregando…" />
      </div>
    );
  }
  const disabled = !canManageMembers || saving;
  const people = members.filter((m) => m.role !== 'viewer');
  const snoozes = Object.entries(settings.snoozed);
  const labelOf = (key: string) => {
    const [metric, dimension] = key.split('|');
    const base = alertKeys.find((k) => k.key === metric)?.label ?? metric;
    return dimension ? `${base} (${dimension})` : base;
  };

  return (
    <div className="space-y-8">
      <SettingsPanelHead
        title="Radar"
        description="O Radar compara os números do CRM com o normal dele e avisa o que mudou, prevê o mês e manda um resumo toda semana. Os cálculos não usam IA; a IA só escreve o texto do resumo, com a chave deste CRM."
      />

      <section className="space-y-3">
        <Row title="Radar ligado" hint="Desligado, ele não avisa nem manda resumo. A chance de fechar continua sendo calculada.">
          <Switch checked={settings.enabled} disabled={disabled} onCheckedChange={(v) => void save({ enabled: v }, v ? 'Radar ligado' : 'Radar desligado')} />
        </Row>
        <Row title="Sensibilidade" hint="Alta avisa mais cedo e mais vezes; baixa, só mudanças grandes.">
          <div className="w-40">
            <OptionSelect
              ariaLabel="Sensibilidade"
              value={settings.sensitivity}
              disabled={disabled}
              onChange={(v) => void save({ sensitivity: v as Settings['sensitivity'] })}
              options={[
                { value: 'baixa', label: 'Baixa' },
                { value: 'normal', label: 'Normal' },
                { value: 'alta', label: 'Alta' },
              ]}
            />
          </div>
        </Row>
        <Row
          title="Semanas aprendendo"
          hint="Quantas semanas de dados o Radar espera antes de avisar mudanças. Com menos, o normal ainda não é confiável."
        >
          <div className="w-28">
            <OptionSelect
              ariaLabel="Semanas aprendendo"
              value={String(settings.minWeeks)}
              disabled={disabled}
              onChange={(v) => void save({ minWeeks: Number(v) })}
              options={[2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `${n} semanas` }))}
            />
          </div>
        </Row>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Quem recebe os avisos e o resumo</h3>
        <div className="max-w-sm">
          <OptionSelect
            ariaLabel="Quem recebe"
            value={settings.recipients}
            disabled={disabled}
            onChange={(v) => void save({ recipients: v as Settings['recipients'] })}
            options={[
              { value: 'admins', label: 'Dono e administradores' },
              { value: 'escolhidos', label: 'Pessoas escolhidas' },
            ]}
          />
        </div>
        {settings.recipients === 'escolhidos' && (
          <ul className="grid gap-1 sm:grid-cols-2">
            {people.map((m) => (
              <li key={m.user_id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    checked={settings.recipientIds.includes(m.user_id)}
                    disabled={disabled}
                    onCheckedChange={(v) =>
                      void save({
                        recipientIds: v
                          ? [...new Set([...settings.recipientIds, m.user_id])]
                          : settings.recipientIds.filter((id) => id !== m.user_id),
                      })
                    }
                  />
                  {m.full_name || m.email || 'Sem nome'}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Resumo da semana</h3>
        <Row title="Mandar o resumo" hint="No sino e numa conversa da Harpi chamada Radar.">
          <Switch checked={settings.digestEnabled} disabled={disabled} onCheckedChange={(v) => void save({ digestEnabled: v })} />
        </Row>
        {settings.digestEnabled && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Toda
            <div className="w-36">
              <OptionSelect
                ariaLabel="Dia do resumo"
                value={String(settings.digestWeekday)}
                disabled={disabled}
                onChange={(v) => void save({ digestWeekday: Number(v) })}
                options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))}
              />
            </div>
            às
            <div className="w-24">
              <OptionSelect
                ariaLabel="Hora do resumo"
                value={String(settings.digestHour)}
                disabled={disabled}
                onChange={(v) => void save({ digestHour: Number(v) })}
                options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}h` }))}
              />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Alertas</h3>
          <p className="text-xs text-muted-foreground">Desmarque o que não faz sentido para este CRM.</p>
        </div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {alertKeys.map((k) => (
            <li key={k.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={!settings.disabledMetrics.includes(k.key)}
                  disabled={disabled}
                  onCheckedChange={(v) =>
                    void save({
                      disabledMetrics: v
                        ? settings.disabledMetrics.filter((x) => x !== k.key)
                        : [...settings.disabledMetrics, k.key],
                    })
                  }
                />
                {k.label}
              </label>
            </li>
          ))}
        </ul>
        {snoozes.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Ignorados por um tempo</p>
            <ul className="flex flex-wrap gap-2">
              {snoozes.map(([key, until]) => (
                <li
                  key={key}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground"
                >
                  {labelOf(key)} até {until.slice(8, 10)}/{until.slice(5, 7)}
                  {canManageMembers && (
                    <button
                      type="button"
                      aria-label="Voltar a avisar"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        const next = { ...settings.snoozed };
                        delete next[key];
                        void save({ snoozed: next }, 'Volta a avisar');
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <Row
          title="Atendentes veem a chance de fechar"
          hint="A porcentagem no cartão de cada negócio. Desligado, só dono e administradores veem."
        >
          <Switch
            checked={settings.showChanceToAgents}
            disabled={disabled}
            onCheckedChange={(v) => void save({ showChanceToAgents: v })}
          />
        </Row>
        {!canManageMembers && (
          <p className="text-xs text-muted-foreground">Só o dono e os administradores mudam estas opções.</p>
        )}
      </section>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
