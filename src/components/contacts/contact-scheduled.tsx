'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { isMissingTable } from '@/lib/auth/account-context';
import { QUICK_REPLY_MEDIA_LABELS, isQuickReplyMediaKind } from '@/lib/quick-replies/media';
import { describeScheduled } from '@/lib/scheduled/describe';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

const COLUMNS =
  'id, content_text, media_kind, media_filename, send_at, only_if_no_reply, status, outcome';
/** Done ones shown under the waiting ones — the recent past, not an archive. */
const DONE_SHOWN = 5;

interface ScheduledItem {
  id: string;
  content_text: string | null;
  media_kind: string | null;
  media_filename: string | null;
  send_at: string;
  only_if_no_reply: boolean;
  status: string;
  outcome: string | null;
}

const isWaiting = (m: ScheduledItem) => m.status === 'scheduled' || m.status === 'sending';

/** Waiting first, soonest first; then the done ones, newest first. */
export function orderScheduled(items: ScheduledItem[]): ScheduledItem[] {
  const waiting = items.filter(isWaiting).sort((a, b) => a.send_at.localeCompare(b.send_at));
  const done = items
    .filter((m) => !isWaiting(m))
    .sort((a, b) => b.send_at.localeCompare(a.send_at))
    .slice(0, DONE_SHOWN);
  return [...waiting, ...done];
}

/**
 * The messages scheduled for a contact (migration 064) — usually from
 * the Chrome extension, beside the WhatsApp chat. Shown here so whoever
 * attends from the inbox sees what is about to go, and can cancel it.
 * Through RLS: the team sees them, agents and above cancel.
 */
export function ContactScheduled({ contactId }: { contactId: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ScheduledItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');

  // The parent keys this component by contact.
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('scheduled_messages')
        .select(COLUMNS)
        .eq('contact_id', contactId)
        .order('send_at', { ascending: true })
        .limit(100);
      if (cancelled) return;
      if (error) {
        setState(isMissingTable(error) ? 'unavailable' : 'error');
        return;
      }
      setItems((data ?? []) as ScheduledItem[]);
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, supabase]);

  async function cancel(item: ScheduledItem) {
    const { data, error } = await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled', processed_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'scheduled')
      .select('id');
    if (error || !data?.length) {
      toast.error('Não consegui cancelar: ela já saiu ou você não tem permissão.');
      return;
    }
    setItems((prev) => prev.map((m) => (m.id === item.id ? { ...m, status: 'cancelled' } : m)));
  }

  // Before migration 064 there is simply nothing to show.
  if (state === 'unavailable') return null;
  if (state === 'loading') {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <p className="py-3 text-center text-sm text-muted-foreground">
        Não consegui carregar as mensagens agendadas.
      </p>
    );
  }

  const shown = orderScheduled(items);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Mensagens agendadas</h3>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma. Pela extensão do Chrome, em Respostas › Agendar, dá para programar uma mensagem
          ou um follow-up para este contato.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((m) => {
            const label = isQuickReplyMediaKind(m.media_kind)
              ? QUICK_REPLY_MEDIA_LABELS[m.media_kind]
              : null;
            const preview =
              [label, m.content_text || (label ? m.media_filename : null)].filter(Boolean).join(' · ') ||
              'Mensagem';
            return (
              <li
                key={m.id}
                className={cn(
                  'flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2',
                  !isWaiting(m) && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">{describeScheduled(m)}</p>
                  <p className="break-words whitespace-pre-line text-sm">{preview}</p>
                </div>
                {m.status === 'scheduled' && (
                  <Button size="sm" variant="ghost" onClick={() => void cancel(m)}>
                    Cancelar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
