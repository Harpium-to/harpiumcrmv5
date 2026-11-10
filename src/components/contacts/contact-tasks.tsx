'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { isMissingTable } from '@/lib/auth/account-context';
import { createClient } from '@/lib/supabase/client';
import { describeDue } from '@/lib/tasks/due';
import { cn } from '@/lib/utils';
import type { ContactTask } from '@/types';

const TASK_COLUMNS = 'id, contact_id, title, due_at, done_at, assigned_to, created_at';
/** Done tasks shown under the open ones — the recent past, not an archive. */
const DONE_SHOWN = 10;

/** Open first, soonest first, undated last; then done, newest first. */
export function sortTasks(tasks: ContactTask[]): ContactTask[] {
  const time = (value: string | null | undefined) =>
    value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
  const open = tasks
    .filter((t) => !t.done_at)
    .sort((a, b) => time(a.due_at) - time(b.due_at) || time(a.created_at) - time(b.created_at));
  const done = tasks
    .filter((t) => t.done_at)
    .sort((a, b) => time(b.done_at) - time(a.done_at));
  return [...open, ...done];
}

/**
 * A contact's to-dos (migration 060): "ligar na quinta". The same
 * tasks the Chrome extension shows beside the WhatsApp chat. Reads and
 * writes go straight through RLS — the team sees them, agents and
 * above change them.
 */
export function ContactTasks({ contactId }: { contactId: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const { user, accountId } = useAuth();

  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  // The parent keys this component by contact, so a change of contact
  // starts again from the loading state above.
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('contact_tasks')
        .select(TASK_COLUMNS)
        .eq('contact_id', contactId);
      // Closed, or another contact opened, while this was loading.
      if (cancelled) return;
      if (error) {
        setState(isMissingTable(error) ? 'unavailable' : 'error');
        return;
      }
      setTasks((data ?? []) as ContactTask[]);
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, supabase]);

  async function add() {
    const text = title.trim();
    if (!text || !contactId) return;
    if (!user || !accountId) {
      toast.error('Entre de novo para adicionar a tarefa.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('contact_tasks')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        title: text,
        // The field is in the person's own time; stored in UTC.
        due_at: due ? new Date(due).toISOString() : null,
        created_by: user.id,
        assigned_to: user.id,
      })
      .select(TASK_COLUMNS)
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error('Não consegui adicionar a tarefa.');
      return;
    }
    setTasks((prev) => [...prev, data as ContactTask]);
    setTitle('');
    setDue('');
  }

  async function toggle(task: ContactTask) {
    const done_at = task.done_at ? null : new Date().toISOString();
    // Ticked at once; put back if the write is refused.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done_at } : t)));
    const { error } = await supabase.from('contact_tasks').update({ done_at }).eq('id', task.id);
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      toast.error('Não consegui atualizar a tarefa.');
    }
  }

  async function remove(task: ContactTask) {
    const { error } = await supabase.from('contact_tasks').delete().eq('id', task.id);
    if (error) {
      toast.error('Não consegui apagar a tarefa.');
      return;
    }
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (state === 'unavailable') {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Tarefas indisponíveis neste servidor: falta aplicar a migration 060.
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Não consegui carregar as tarefas.
      </p>
    );
  }

  const sorted = sortTasks(tasks);
  const open = sorted.filter((t) => !t.done_at);
  const done = sorted.filter((t) => t.done_at).slice(0, DONE_SHOWN);

  return (
    <div className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="O que precisa ser feito? Ex.: Ligar na quinta"
          maxLength={200}
          aria-label="Nova tarefa"
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Para quando (opcional)"
            className="bg-muted border-border text-foreground"
          />
          <Button type="submit" size="sm" disabled={!title.trim() || saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Adicionar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Com data e hora, você recebe um aviso no sino quando chegar a hora.
        </p>
      </form>

      {open.length === 0 && done.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma tarefa ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {[...open, ...done].map((task) => {
            const when = task.done_at ? null : describeDue(task.due_at);
            return (
              <li
                key={task.id}
                className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={Boolean(task.done_at)}
                  onChange={() => void toggle(task)}
                  aria-label={task.done_at ? `Reabrir: ${task.title}` : `Concluir: ${task.title}`}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'break-words text-sm',
                      task.done_at && 'text-muted-foreground line-through'
                    )}
                  >
                    {task.title}
                  </p>
                  {when && (
                    <p
                      className={cn(
                        'text-xs',
                        when.tone === 'overdue'
                          ? 'text-destructive'
                          : when.tone === 'today'
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                      )}
                    >
                      {when.label}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void remove(task)}
                  aria-label={`Apagar: ${task.title}`}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
