'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { OptionSelect } from '@/components/agenda/option-select';
import { TEAM_COLORS, TEAM_MODE_LABEL, type Team, type TeamMode } from '@/lib/atendimento/setores';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';

interface Draft {
  name: string;
  description: string;
  color: string;
  mode: TeamMode;
  online_only: boolean;
  max_open_per_person: string;
  sla_minutes: string;
  sla_action: 'avisar' | 'proximo';
  is_entry: boolean;
  active: boolean;
  members: string[];
}

const EMPTY: Draft = {
  name: '',
  description: '',
  color: TEAM_COLORS[0],
  mode: 'rodizio',
  online_only: true,
  max_open_per_person: '',
  sla_minutes: '',
  sla_action: 'avisar',
  is_entry: false,
  active: true,
  members: [],
};

function draftOf(team: Team | null): Draft {
  if (!team) return { ...EMPTY };
  return {
    name: team.name,
    description: team.description ?? '',
    color: team.color,
    mode: team.mode,
    online_only: team.online_only,
    max_open_per_person: team.max_open_per_person ? String(team.max_open_per_person) : '',
    sla_minutes: team.sla_minutes ? String(team.sla_minutes) : '',
    sla_action: team.sla_action,
    is_entry: team.is_entry,
    active: team.active,
    members: team.members,
  };
}

/** Create or edit a setor: what it handles (the AI reads it), its people and its rule. */
export function TeamEditorDialog({
  open,
  onOpenChange,
  team,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = a new setor. */
  team: Team | null;
  members: AccountMember[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(team));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(draftOf(team));
  }, [open, team]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const toggleMember = (userId: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      members: on ? [...new Set([...d.members, userId])] : d.members.filter((u) => u !== userId),
    }));

  const people = members.filter((m) => m.role !== 'viewer');

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error('Dê um nome ao setor');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        color: draft.color,
        mode: draft.mode,
        online_only: draft.online_only,
        max_open_per_person: draft.max_open_per_person ? Number(draft.max_open_per_person) : null,
        sla_minutes: draft.sla_minutes ? Number(draft.sla_minutes) : null,
        sla_action: draft.sla_action,
        is_entry: draft.is_entry,
        active: draft.active,
        members: draft.members,
      };
      const res = await fetch(team ? `/api/teams/${team.id}` : '/api/teams', {
        method: team ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(team ? 'Setor salvo' : 'Setor criado');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar o setor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{team ? `Editar ${team.name}` : 'Novo setor'}</DialogTitle>
          <DialogDescription>
            Um setor é um grupo de pessoas que resolve um assunto. Pode ter uma pessoa só, como a secretária de uma
            profissional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="team-name">Nome</Label>
              <Input
                id="team-name"
                value={draft.name}
                maxLength={60}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Ex.: Financeiro"
              />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">Cor</span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {TEAM_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    onClick={() => set('color', c)}
                    className={cn(
                      'h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition',
                      draft.color === c && 'ring-2 ring-foreground',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="team-desc">O que esse setor resolve</Label>
            <Textarea
              id="team-desc"
              value={draft.description}
              maxLength={500}
              rows={2}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Ex.: boletos, pagamentos, parcelamento, nota fiscal"
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              A IA lê este texto para decidir para qual setor passar a conversa. Liste os assuntos com as palavras que
              os clientes usam.
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Pessoas do setor</span>
            {people.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ninguém da equipe ainda.</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {people.map((m) => (
                  <li key={m.user_id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <Checkbox
                        checked={draft.members.includes(m.user_id)}
                        onCheckedChange={(v) => toggleMember(m.user_id, v === true)}
                      />
                      <span className="truncate">{m.full_name || m.email || 'Sem nome'}</span>
                      {m.receives_conversations === false && (
                        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          pausado
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">Como distribuir</span>
              <OptionSelect
                ariaLabel="Como distribuir"
                value={draft.mode}
                onChange={(v) => set('mode', v as TeamMode)}
                options={(Object.keys(TEAM_MODE_LABEL) as TeamMode[]).map((v) => ({
                  value: v,
                  label: TEAM_MODE_LABEL[v],
                }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-max">Limite de conversas abertas por pessoa</Label>
              <Input
                id="team-max"
                type="number"
                min={1}
                max={500}
                value={draft.max_open_per_person}
                onChange={(e) => set('max_open_per_person', e.target.value)}
                placeholder="Sem limite"
                disabled={draft.mode === 'fila'}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Só para quem está online</p>
              <p className="text-xs text-muted-foreground">
                Ninguém online: a conversa espera na fila do setor e vai para o primeiro que entrar.
              </p>
            </div>
            <Switch
              checked={draft.online_only}
              disabled={draft.mode === 'fila'}
              onCheckedChange={(v) => set('online_only', v)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="team-sla">Prazo para responder (minutos)</Label>
              <Input
                id="team-sla"
                type="number"
                min={1}
                max={1440}
                value={draft.sla_minutes}
                onChange={(e) => set('sla_minutes', e.target.value)}
                placeholder="Sem prazo"
              />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">Quando o prazo estoura</span>
              <OptionSelect
                ariaLabel="Quando o prazo estoura"
                value={draft.sla_action}
                disabled={!draft.sla_minutes}
                onChange={(v) => set('sla_action', v as 'avisar' | 'proximo')}
                options={[
                  { value: 'avisar', label: 'Avisar a gestão' },
                  { value: 'proximo', label: 'Passar para o próximo' },
                ]}
              />
            </div>
          </div>
          {draft.sla_minutes && (
            <p className="-mt-2 text-xs text-muted-foreground">O prazo é conferido a cada poucos minutos.</p>
          )}

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Setor de entrada</p>
              <p className="text-xs text-muted-foreground">
                Recebe o que a IA não soube classificar. Só um setor do CRM pode ser o de entrada.
              </p>
            </div>
            <Switch checked={draft.is_entry} onCheckedChange={(v) => set('is_entry', v)} />
          </div>

          {team && (
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Setor ativo</p>
                <p className="text-xs text-muted-foreground">Desativado, some das transferências e a IA não o escolhe.</p>
              </div>
              <Switch checked={draft.active} onCheckedChange={(v) => set('active', v)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : team ? 'Salvar' : 'Criar setor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
