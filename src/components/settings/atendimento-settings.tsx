'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { OptionSelect } from '@/components/agenda/option-select';
import { PresenceDot } from '@/components/presence/presence-dot';
import { useAuth } from '@/hooks/use-auth';
import { useMembers, useTeams } from '@/hooks/use-atendimento';
import { usePresence } from '@/hooks/use-presence';
import { createClient } from '@/lib/supabase/client';
import { presenceLabel } from '@/lib/presence';
import { TEAM_MODE_LABEL, type Team } from '@/lib/atendimento/setores';
import type { ArrivalMode, InboxSettings, ReturnMode } from '@/lib/atendimento/chegada';
import { SettingsPanelHead } from './settings-panel-head';
import { TeamEditorDialog } from './team-editor-dialog';

const ARRIVAL_LABEL: Record<ArrivalMode, string> = {
  fila_geral: 'Ficam na fila geral (como hoje)',
  rodizio: 'Rodízio entre a equipe',
  setor_entrada: 'Vão para o setor de entrada',
  por_canal: 'Depende do canal',
};

const RETURN_LABEL: Record<ReturnMode, string> = {
  mesma_pessoa: 'Volta para quem atendeu, se falou há pouco',
  ia: 'Recomeça do zero (a IA atende de novo)',
  distribuir: 'Vai para a distribuição',
};

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
] as const;

/**
 * Configurações › Atendimento e setores: who receives conversations,
 * the setores (and their rules), and what happens when a customer
 * writes and nobody is answering, or comes back.
 * See docs/plano-distribuicao-atendimento.md §4.4.
 */
export function AtendimentoSettings() {
  const { user, canManageMembers } = useAuth();
  const { members, reload: reloadMembers } = useMembers();
  const { teams, loaded: teamsLoaded, reload: reloadTeams } = useTeams();
  const { getPresence, getRow, now } = usePresence();

  const [editing, setEditing] = useState<Team | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/inbox-settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { settings?: InboxSettings } | null) => {
        if (!cancelled && json?.settings) setSettings(json.settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const people = useMemo(() => members.filter((m) => m.role !== 'viewer'), [members]);
  const activeTeams = teams.filter((t) => t.active);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: t.name, color: t.color }));

  const toggleReceives = async (userId: string, on: boolean) => {
    const { error } = await createClient().rpc('set_receives_conversations', {
      p_user_id: userId,
      p_on: on,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(on ? 'Volta a receber conversas' : 'Não recebe conversas novas');
    void reloadMembers();
  };

  const removeTeam = async (team: Team) => {
    if (!window.confirm(`Apagar o setor ${team.name}? As conversas dele continuam, sem setor.`)) return;
    const res = await fetch(`/api/teams/${team.id}`, { method: 'DELETE' });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(json.error || 'Falha ao apagar o setor');
      return;
    }
    toast.success('Setor apagado');
    void reloadTeams();
  };

  const saveRules = async (patch: Partial<InboxSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingRules(true);
    try {
      const res = await fetch('/api/inbox-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrival_mode: next.arrivalMode,
          arrival_by_channel: next.arrivalByChannel,
          return_mode: next.returnMode,
          return_days: next.returnDays,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; settings?: InboxSettings };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.settings) setSettings(json.settings);
      toast.success('Regras salvas');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setSavingRules(false);
    }
  };

  const nameOf = (userId: string) => members.find((m) => m.user_id === userId)?.full_name || 'Sem nome';

  return (
    <div className="space-y-8">
      <SettingsPanelHead
        title="Atendimento e setores"
        description="Quem recebe as conversas, os setores que a IA usa para passar cada conversa para quem resolve, e o que acontece quando ninguém está respondendo."
      />

      {/* ---- People ---- */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Quem recebe conversas</h3>
          <p className="text-xs text-muted-foreground">
            Desligado, a pessoa sai do rodízio e de todos os setores (ex.: o dono, uma profissional que não atende o
            chat, férias). Continua podendo receber uma transferência direta.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {people.map((m) => {
            const presence = getPresence(m.user_id);
            const self = m.user_id === user?.id;
            const editable = canManageMembers || self;
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                <PresenceDot
                  status={presence}
                  label={presenceLabel(presence, getRow(m.user_id)?.last_seen_at ?? null, now)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {m.full_name || m.email || 'Sem nome'}
                  {self ? ' (você)' : ''}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {teams
                    .filter((t) => t.active && t.members.includes(m.user_id))
                    .map((t) => t.name)
                    .join(', ') || 'Sem setor'}
                </span>
                <Switch
                  checked={m.receives_conversations !== false}
                  disabled={!editable}
                  aria-label={`${m.full_name || 'Pessoa'} recebe conversas`}
                  onCheckedChange={(v) => void toggleReceives(m.user_id, v)}
                />
              </li>
            );
          })}
          {people.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Ninguém da equipe ainda.</li>}
        </ul>
      </section>

      {/* ---- Setores ---- */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Setores</h3>
            <p className="text-xs text-muted-foreground">
              Ex.: Recepção, Financeiro, Orçamentos, Dra. Ana. Quando a IA passa a conversa, ela escolhe o setor pelo
              que ele resolve, e o setor escolhe a pessoa.
            </p>
          </div>
          {canManageMembers && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="size-4" />
              Novo setor
            </Button>
          )}
        </div>

        {teamsLoaded && teams.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum setor ainda. Sem setores, a IA passa a conversa para a pessoa de Configurações › IA, e as
            automações usam o rodízio da equipe toda.
          </p>
        ) : (
          <ul className="space-y-2">
            {teams.map((t) => (
              <li key={t.id} className="rounded-md border border-border p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {t.name}
                      {t.is_entry && (
                        <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          entrada
                        </span>
                      )}
                      {!t.active && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          desativado
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description || 'Sem descrição: a IA só vê o nome.'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {TEAM_MODE_LABEL[t.mode]}
                      {t.mode !== 'fila' && t.online_only ? ' · só online' : ''}
                      {t.max_open_per_person ? ` · até ${t.max_open_per_person} por pessoa` : ''}
                      {t.sla_minutes
                        ? ` · prazo ${t.sla_minutes} min (${t.sla_action === 'proximo' ? 'passa adiante' : 'avisa'})`
                        : ''}
                    </p>
                    <p className="mt-1 text-xs text-foreground/80">
                      {t.members.length > 0 ? t.members.map(nameOf).join(', ') : 'Ninguém no setor ainda'}
                    </p>
                  </div>
                  {canManageMembers && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Editar ${t.name}`}
                        onClick={() => {
                          setEditing(t);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Apagar ${t.name}`}
                        onClick={() => void removeTeam(t)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Rules ---- */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Regras</h3>
          <p className="text-xs text-muted-foreground">
            Valem quando nenhuma IA, fluxo ou automação está cuidando da conversa.
          </p>
        </div>

        {!settings ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">Mensagem nova que ninguém está respondendo</p>
              <p className="text-xs text-muted-foreground">
                Por exemplo, num canal sem IA. Com IA, ela atende primeiro e passa quando precisar.
              </p>
              <div className="mt-2 max-w-sm">
                <OptionSelect
                  ariaLabel="Mensagem nova que ninguém está respondendo"
                  value={settings.arrivalMode}
                  disabled={!canManageMembers || savingRules}
                  onChange={(v) => void saveRules({ arrivalMode: v as ArrivalMode })}
                  options={(Object.keys(ARRIVAL_LABEL) as ArrivalMode[])
                    .filter((v) => v !== 'setor_entrada' || activeTeams.some((t) => t.is_entry))
                    .map((v) => ({ value: v, label: ARRIVAL_LABEL[v] }))}
                />
              </div>
              {settings.arrivalMode === 'por_canal' && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {CHANNELS.map((ch) => (
                    <div key={ch.id} className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">{ch.label}</span>
                      <OptionSelect
                        ariaLabel={`Regra do ${ch.label}`}
                        value={settings.arrivalByChannel[ch.id] ?? 'fila'}
                        disabled={!canManageMembers || savingRules}
                        onChange={(v) =>
                          void saveRules({
                            arrivalByChannel: { ...settings.arrivalByChannel, [ch.id]: v },
                          })
                        }
                        options={[
                          { value: 'fila', label: 'Fila geral' },
                          { value: 'rodizio', label: 'Rodízio da equipe' },
                          ...teamOptions,
                        ]}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">Cliente que volta a escrever numa conversa encerrada</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="max-w-sm flex-1">
                  <OptionSelect
                    ariaLabel="Cliente que volta"
                    value={settings.returnMode}
                    disabled={!canManageMembers || savingRules}
                    onChange={(v) => void saveRules({ returnMode: v as ReturnMode })}
                    options={(Object.keys(RETURN_LABEL) as ReturnMode[]).map((v) => ({
                      value: v,
                      label: RETURN_LABEL[v],
                    }))}
                  />
                </div>
                {settings.returnMode === 'mesma_pessoa' && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    há até
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={settings.returnDays}
                      disabled={!canManageMembers || savingRules}
                      className="h-8 w-16"
                      onBlur={(e) => {
                        const days = Number(e.target.value);
                        if (Number.isFinite(days) && days >= 1 && days !== settings.returnDays) {
                          void saveRules({ returnDays: Math.min(365, Math.floor(days)) });
                        }
                      }}
                    />
                    dias
                  </label>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {settings.returnMode === 'mesma_pessoa'
                  ? `Se a pessoa estiver indisponível, vai para o setor da conversa ou para a regra acima. Depois de ${settings.returnDays} dia(s) sem falar com alguém da equipe, recomeça do zero.`
                  : settings.returnMode === 'ia'
                    ? 'A conversa perde o responsável e a IA volta a responder, como no "Retomar IA".'
                    : 'Vai para o setor da conversa ou para a regra acima, mesmo se quem atendia estiver online.'}
              </p>
            </div>
            {!canManageMembers && (
              <p className="text-xs text-muted-foreground">Só o dono e os administradores mudam estas regras.</p>
            )}
          </div>
        )}
      </section>

      <TeamEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        team={editing}
        members={members}
        onSaved={() => void reloadTeams()}
      />
    </div>
  );
}
