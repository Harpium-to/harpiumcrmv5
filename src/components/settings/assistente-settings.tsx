'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Repeat, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { HarpiFace } from '@/components/assistente/harpi-face';
import { openHarpi } from '@/components/assistente/harpi';
import { SettingsPanelHead } from './settings-panel-head';

// ============================================================
// Configurações › Harpi — the CRM's switches for the assistant, the
// routines it runs, what it remembers, and what it changed.
// ============================================================

interface Config {
  settings: { enabled: boolean; model: string | null; smallChanges: boolean };
  provider: 'openai' | 'anthropic' | null;
  replyModel: string | null;
  defaultModel: string | null;
  hasKey: boolean;
  canEdit: boolean;
}

interface Routine {
  id: string;
  name: string;
  instruction: string;
  schedule: string;
  timezone: string;
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  owner: string | null;
  mine: boolean;
}

interface MemoryItem {
  id: string;
  content: string;
}

interface HistoryItem {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  auto: boolean;
  viaAgency: boolean;
  error: string | null;
  who: string | null;
  at: string;
}

function when(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'Algo deu errado');
  return body as T;
}

export function AssistenteSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [memory, setMemory] = useState<MemoryItem[] | null>(null);
  const [canEditMemory, setCanEditMemory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [model, setModel] = useState('');
  const [newFact, setNewFact] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r, m, h] = await Promise.all([
        fetch('/api/assistente/config').then((res) => json<Config>(res)),
        fetch('/api/assistente/rotinas').then((res) => json<{ routines: Routine[] }>(res)),
        fetch('/api/assistente/memoria').then((res) => json<{ memory: MemoryItem[]; canEdit?: boolean }>(res)),
        fetch('/api/assistente/historico').then((res) => json<{ actions: HistoryItem[] }>(res)),
      ]);
      setConfig(c);
      setModel(c.settings.model ?? '');
      setRoutines(r.routines);
      setMemory(m.memory);
      setCanEditMemory(m.canEdit === true);
      setHistory(h.actions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui carregar o Harpi');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, ok: string) => {
    setSaving(true);
    try {
      await json(
        await fetch('/api/assistente/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui salvar');
    } finally {
      setSaving(false);
    }
  };

  const toggleRoutine = async (r: Routine) => {
    try {
      await json(
        await fetch(`/api/assistente/rotinas/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ativa: !r.is_active }),
        }),
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui mudar a rotina');
    }
  };

  const deleteRoutine = async (r: Routine) => {
    if (!window.confirm(`Apagar a rotina "${r.name}"?`)) return;
    try {
      await json(await fetch(`/api/assistente/rotinas/${r.id}`, { method: 'DELETE' }));
      toast.success('Rotina apagada');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui apagar');
    }
  };

  const addFact = async () => {
    const content = newFact.trim();
    if (content.length < 3) return;
    try {
      await json(
        await fetch('/api/assistente/memoria', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        }),
      );
      setNewFact('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui guardar');
    }
  };

  const removeFact = async (id: string) => {
    try {
      await json(await fetch(`/api/assistente/memoria/${id}`, { method: 'DELETE' }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui apagar');
    }
  };

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const editable = config.canEdit && config.hasKey;

  return (
    <div className="space-y-8">
      <SettingsPanelHead
        title="Harpi, o assistente do CRM"
        description="O Harpi fica no canto da tela, responde sobre o CRM e faz mudanças quando você pede, sempre mostrando antes num cartão para você confirmar. Ele usa a chave de IA deste CRM."
        action={
          <Button size="sm" variant="outline" onClick={() => openHarpi()}>
            <HarpiFace className="size-4" />
            Abrir o Harpi
          </Button>
        }
      />

      {!config.hasKey && (
        <p className="rounded-lg bg-amber-400/15 px-3 py-2 text-sm text-foreground">
          Cadastre a chave da OpenAI ou da Anthropic em Agentes › Chave e modelo para o Harpi funcionar.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Harpi ligado</p>
            <p className="text-xs text-muted-foreground">Desligado, a carinha continua no canto, mas ele não responde.</p>
          </div>
          <Switch
            checked={config.settings.enabled}
            disabled={!editable || saving}
            onCheckedChange={(v) => patch({ enabled: v }, v ? 'Harpi ligado' : 'Harpi desligado')}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Alterações pequenas sem perguntar</p>
            <p className="text-xs text-muted-foreground">
              Uma nota, uma tarefa, uma etiqueta em um contato ou mover um negócio de etapa acontecem direto, com o botão
              Desfazer. Alterações maiores e tudo que fala com clientes continuam pedindo o seu OK.
            </p>
          </div>
          <Switch
            checked={config.settings.smallChanges}
            disabled={!editable || saving}
            onCheckedChange={(v) => patch({ smallChanges: v }, 'Salvo')}
          />
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">Modelo do assistente</p>
          <p className="text-xs text-muted-foreground">
            Montar automações pede um modelo melhor que o das respostas automáticas
            {config.replyModel ? ` (${config.replyModel})` : ''}. Em branco, usa{' '}
            <strong>{config.defaultModel ?? 'o padrão'}</strong>; se a sua chave não tiver acesso a ele, o Harpi volta
            sozinho para o modelo das respostas.
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={config.defaultModel ?? ''}
              disabled={!editable || saving}
              className="max-w-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!editable || saving || model.trim() === (config.settings.model ?? '')}
              onClick={() => patch({ model: model.trim() || null }, 'Modelo salvo')}
            >
              Salvar
            </Button>
          </div>
        </div>
        {!config.canEdit && (
          <p className="text-xs text-muted-foreground">Só o dono e os administradores mudam estas opções.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Rotinas</h3>
            <p className="text-xs text-muted-foreground">
              Tarefas que o Harpi faz sozinho num horário. Ele só consulta; o que quiser mudar fica esperando o seu OK.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openHarpi({ prompt: 'Quero criar uma rotina. Me ajuda a montar?' })}
          >
            <Plus className="size-3.5" />
            Nova rotina
          </Button>
        </div>
        {routines === null ? null : routines.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            Nenhuma rotina. Peça ao Harpi, por exemplo: “toda segunda às 8h, me manda o resumo do funil”.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {routines.map((r) => (
              <li key={r.id} className="flex items-start gap-3 p-3">
                <Repeat className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.schedule} · próxima: {r.is_active ? when(r.next_run_at) : 'desligada'}
                    {!r.mine && r.owner ? ` · de ${r.owner}` : ''}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.instruction}</p>
                </div>
                <Switch checked={r.is_active} onCheckedChange={() => toggleRoutine(r)} />
                <Button size="icon-sm" variant="ghost" aria-label="Apagar rotina" onClick={() => deleteRoutine(r)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Memória do CRM</h3>
          <p className="text-xs text-muted-foreground">
            O que o Harpi lembra em todas as conversas, para toda a equipe. Também dá para pedir: “lembre que…”.
          </p>
        </div>
        {memory && memory.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {memory.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm text-foreground">{m.content}</span>
                {canEditMemory && (
                  <Button size="icon-sm" variant="ghost" aria-label="Esquecer" onClick={() => removeFact(m.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditMemory && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addFact();
            }}
          >
            <Input
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              maxLength={500}
              placeholder="Ex.: Nunca mandamos mensagem depois das 20h"
            />
            <Button type="submit" size="sm" disabled={newFact.trim().length < 3}>
              Guardar
            </Button>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">O que o Harpi mudou</h3>
          <p className="text-xs text-muted-foreground">
            As últimas alterações feitas pelo Harpi{config.canEdit ? ', de toda a equipe' : ', as suas'}.
          </p>
        </div>
        {history === null ? null : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada ainda.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {history.map((h) => (
              <li key={h.id} className="px-3 py-2">
                <p className="text-sm text-foreground">{h.title}</p>
                <p className="text-xs text-muted-foreground">
                  {when(h.at)}
                  {h.who ? ` · ${h.who}` : ''}
                  {h.viaAgency ? ' (agência)' : ''}
                  {h.auto ? ' · sem perguntar' : ''}
                  {' · '}
                  {h.status === 'done'
                    ? h.summary ?? 'feito'
                    : h.status === 'undone'
                      ? 'desfeito'
                      : `falhou: ${h.error ?? 'erro'}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
