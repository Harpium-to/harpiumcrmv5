'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, QrCode, Send, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import type { QuickReply, Tag } from '@/types';
import { PROSPECT_EXAMPLES, PROSPECT_MIN_VARIATIONS } from '@/lib/bulk/prospect';

// ============================================================
// Bulk sends through the QR-code number (Fase 8): a text or a quick
// reply to everyone with a tag, or to a pasted list of numbers that are
// CRM contacts. Paced by the CRM — one every 30–90 s, at most 200 a day
// — and sent by its scheduler (src/lib/bulk/sends.ts). Started by
// admins, after reading the risk.
//
// The prospecting mode (073) is for people who never talked to the
// company — the lead extractor's lists: slower, business hours only,
// a growing ceiling per day, several texts, numbers checked on WhatsApp
// first and an automatic brake (src/lib/bulk/prospect.ts). The
// extractor links here with ?prospectar=<list>, which opens it ready.
// ============================================================

interface BulkView {
  id: string;
  name: string;
  total: number;
  created_at: string;
  stopped_at: string | null;
  counts: Record<'scheduled' | 'sending' | 'sent' | 'skipped' | 'cancelled' | 'failed', number>;
  mode?: 'normal' | 'prospeccao';
  stopped_reason?: string | null;
  replied?: number;
  opted_out?: number;
}

interface State {
  available: boolean;
  reason?: string;
  limit: number;
  used_today: number;
  items: BulkView[];
}

interface Plan {
  total: number;
  not_found: number;
  opted_out?: number;
  first_at: string | null;
  last_at: string | null;
  no_whatsapp?: number;
  already_prospected?: number;
  days?: number;
}

const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** "enviadas 12 de 40 · 1 falhou", the way a person reads progress. */
export function describeBulkProgress(
  b: Pick<BulkView, 'total' | 'counts' | 'stopped_at'> & Pick<Partial<BulkView>, 'mode' | 'replied' | 'opted_out'>,
): string {
  const c = b.counts;
  const parts = [`enviadas ${c.sent} de ${b.total}`];
  if (c.failed) parts.push(c.failed === 1 ? '1 falhou' : `${c.failed} falharam`);
  if (c.cancelled) parts.push(`${c.cancelled} canceladas`);
  const waiting = c.scheduled + c.sending;
  if (waiting && !b.stopped_at) parts.push(`${waiting} na fila`);
  if (b.mode === 'prospeccao' && c.sent) {
    parts.push(`${b.replied ?? 0} ${(b.replied ?? 0) === 1 ? 'respondeu' : 'responderam'}`);
    if (b.opted_out) parts.push(`${b.opted_out} pediram para sair`);
  }
  if (!waiting) parts.push(b.stopped_at ? 'parado' : 'concluído');
  return parts.join(' · ');
}

export function QrBulkSends() {
  const supabase = useMemo(() => createClient(), []);
  const canStart = useCan('edit-settings');
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  // The extractor's "Prospectar esta lista": the tag's name to open with.
  // Read once from the address; nothing renders before the state loads,
  // so the server and the browser agree on the first render.
  const [prospectList, setProspectList] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('prospectar'),
  );
  // Bumped to load again after a start or a stop.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      const res = await fetch('/api/bulk-sends', { cache: 'no-store' });
      if (!cancelled && res.ok) setState((await res.json()) as State);
    };
    void fetchState();
    // Progress moves while the page is open.
    const timer = setInterval(() => void fetchState(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [version]);

  async function stop(id: string) {
    if (!window.confirm('Parar este disparo? O que já saiu, saiu; o resto é cancelado.')) return;
    const res = await fetch(`/api/bulk-sends/${id}/stop`, { method: 'POST' });
    if (!res.ok) {
      toast.error('Não consegui parar o disparo.');
      return;
    }
    toast.success('Disparo parado.');
    void load();
  }

  useEffect(() => {
    // Once: reloading the page should not open it again.
    if (new URLSearchParams(window.location.search).has('prospectar')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  if (!state) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <QrCode className="size-4" />
            Disparos pelo QR code
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.available
              ? `Texto ou resposta rápida para uma etiqueta ou uma lista. Um envio a cada 30–90 s, até ${state.limit} por dia. Hoje: ${state.used_today} de ${state.limit}. Para quem nunca falou com a empresa, use o modo prospecção.`
              : state.reason}
          </p>
        </div>
        {state.available && (
          <GatedButton canAct={canStart} gateReason="disparar pelo QR code" onClick={() => setOpen(true)}>
            <Send className="size-4" />
            Novo disparo pelo QR
          </GatedButton>
        )}
      </div>

      {state.items.length > 0 && (
        <ul className="divide-y divide-border">
          {state.items.map((b) => {
            const waiting = b.counts.scheduled + b.counts.sending;
            return (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {b.name}
                    {b.mode === 'prospeccao' ? (
                      <span className="ml-2 rounded-full bg-sky-500/12 px-2 py-0.5 text-[0.7rem] font-medium text-sky-600 dark:text-sky-400">
                        prospecção
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {time(b.created_at)} · {describeBulkProgress(b)}
                  </p>
                  {b.stopped_reason ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">{b.stopped_reason}</p>
                  ) : null}
                </div>
                {waiting > 0 && !b.stopped_at && canStart && (
                  <Button size="sm" variant="outline" onClick={() => void stop(b.id)}>
                    <Square className="size-3.5" />
                    Parar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(open || (prospectList !== null && state.available && canStart)) && (
        <NewBulkDialog
          supabase={supabase}
          prospectList={prospectList}
          onClose={() => {
            setOpen(false);
            setProspectList(null);
          }}
          onStarted={() => {
            setOpen(false);
            setProspectList(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function NewBulkDialog({
  supabase,
  prospectList,
  onClose,
  onStarted,
}: {
  supabase: ReturnType<typeof createClient>;
  prospectList: string | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [kind, setKind] = useState<'normal' | 'prospeccao'>(prospectList ? 'prospeccao' : 'normal');
  const [variations, setVariations] = useState<string[]>(PROSPECT_EXAMPLES);
  const [tags, setTags] = useState<Tag[]>([]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [name, setName] = useState(prospectList ? `Prospecção · ${prospectList}` : '');
  const [mode, setMode] = useState<'tag' | 'list'>('tag');
  const [tagId, setTagId] = useState('');
  const [phones, setPhones] = useState('');
  const [replyId, setReplyId] = useState('');
  const [text, setText] = useState('');
  const [risk, setRisk] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data: tagRows }, repliesRes] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        fetch('/api/quick-replies', { cache: 'no-store' }),
      ]);
      if (cancelled) return;
      const list = (tagRows ?? []) as Tag[];
      setTags(list);
      if (prospectList) {
        const match = list.find((t) => t.name.trim().toLowerCase() === prospectList.trim().toLowerCase());
        if (match) setTagId(match.id);
      }
      const json = await repliesRes.json().catch(() => ({}));
      setReplies(((json.quick_replies ?? []) as QuickReply[]).filter((r) => r.kind !== 'interactive'));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, prospectList]);

  const prospect = kind === 'prospeccao';
  const body = (dryRun: boolean) => ({
    name,
    ...(prospect
      ? { mode: 'prospeccao', variations: variations.filter((v) => v.trim()) }
      : { text: text.trim() ? text : null, quick_reply_id: replyId || null }),
    ...(mode === 'tag' ? { tag_id: tagId } : { phones }),
    risk_accepted: risk,
    dry_run: dryRun,
  });

  // Any change makes the last preview stale.
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPlan(null);
  };

  async function call(dryRun: boolean) {
    setBusy(true);
    try {
      const res = await fetch('/api/bulk-sends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(dryRun)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? 'Não consegui preparar o disparo.');
        return;
      }
      if (dryRun) setPlan(json as Plan);
      else {
        toast.success(
          prospect
            ? `Prospecção começou: ${json.total} mensagens em ${json.days} ${json.days === 1 ? 'dia útil' : 'dias úteis'}, até ${time(json.last_at)}.`
            : `Disparo começou: ${json.total} mensagens até ${time(json.last_at)}.`,
        );
        onStarted();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo disparo pelo QR code</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'normal' as const, title: 'Quem conhece a empresa', text: 'Clientes e contatos que já conversaram.' },
                { key: 'prospeccao' as const, title: 'Prospecção', text: 'Contato frio, como as listas do Extrator.' },
              ]
            ).map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => change(setKind)(k.key)}
                className={
                  kind === k.key
                    ? 'rounded-md border border-primary bg-primary/10 p-2 text-left'
                    : 'rounded-md border border-border bg-muted p-2 text-left'
                }
              >
                <span className="block text-sm font-medium text-foreground">{k.title}</span>
                <span className="block text-xs text-muted-foreground">{k.text}</span>
              </button>
            ))}
          </div>
          {prospect ? (
            <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs leading-relaxed text-foreground">
              Mais devagar que o disparo comum: um envio a cada 1 a 3 minutos, só de segunda a sexta, das 9h às 18h,
              sem feriado. O limite por dia começa em 20 e sobe a cada semana até 80. Só recebe quem tem WhatsApp, e
              ninguém recebe duas prospecções. Para sozinho se as mensagens falharem ou se 30 saírem sem resposta.
              Quem responder SAIR sai da lista na hora. Se puder, use um número só para prospecção.
            </p>
          ) : null}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Nome do disparo</label>
            <Input value={name} onChange={(e) => change(setName)(e.target.value)} maxLength={120} placeholder="ex.: Novidade de novembro" />
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              {(['tag', 'list'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => change(setMode)(m)}
                  className={
                    mode === m
                      ? 'flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary'
                      : 'flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground'
                  }
                >
                  {m === 'tag' ? 'Por etiqueta' : 'Lista de números'}
                </button>
              ))}
            </div>
            {mode === 'tag' ? (
              <select
                value={tagId}
                onChange={(e) => change(setTagId)(e.target.value)}
                className="w-full rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground"
                aria-label="Etiqueta"
              >
                <option value="">Escolha a etiqueta</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <Textarea
                  value={phones}
                  onChange={(e) => change(setPhones)(e.target.value)}
                  placeholder="Um número por linha. Só os que são contatos do CRM recebem."
                  className="min-h-24 bg-muted"
                />
              </>
            )}
          </div>

          {prospect ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Cada contato recebe um destes textos, sorteado (no mínimo {PROSPECT_MIN_VARIATIONS}). Diga quem é, por
                que está escrevendo e como sair. Sem link e sem arquivo na primeira mensagem.
              </p>
              {variations.map((v, i) => (
                <div key={i} className="flex items-start gap-1">
                  <Textarea
                    value={v}
                    onChange={(e) =>
                      change(setVariations)(variations.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    maxLength={700}
                    className="min-h-20 bg-muted"
                    aria-label={`Texto ${i + 1}`}
                  />
                  {variations.length > PROSPECT_MIN_VARIATIONS ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Tirar o texto ${i + 1}`}
                      onClick={() => change(setVariations)(variations.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              ))}
              {variations.length < 10 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => change(setVariations)([...variations, ''])}>
                  <Plus className="size-3.5" />
                  Mais um texto
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Troque o que está entre colchetes. <code>{'{{primeiro_nome}}'}</code> e <code>{'{{empresa}}'}</code> saem
                com os dados de cada contato.
              </p>
            </div>
          ) : (
          <div className="space-y-2">
            <select
              value={replyId}
              onChange={(e) => change(setReplyId)(e.target.value)}
              className="w-full rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground"
              aria-label="Resposta rápida"
            >
              <option value="">Sem resposta rápida (escrever abaixo)</option>
              {replies.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                  {r.kind === 'media' ? ' (com arquivo)' : ''}
                </option>
              ))}
            </select>
            <Textarea
              value={text}
              onChange={(e) => change(setText)(e.target.value)}
              maxLength={4096}
              placeholder={replyId ? 'Opcional: escreva para usar este texto no lugar do da resposta' : 'A mensagem'}
              className="min-h-24 bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              <code>{'{{nome}}'}</code>, <code>{'{{primeiro_nome}}'}</code> e <code>{'{{empresa}}'}</code> saem
              com os dados de cada contato.
            </p>
          </div>
          )}

          {plan && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">
                {plan.total} {plan.total === 1 ? 'contato' : 'contatos'} · de {time(plan.first_at)} até por volta de{' '}
                {time(plan.last_at)}
                {prospect && plan.days ? ` · ${plan.days} ${plan.days === 1 ? 'dia útil' : 'dias úteis'}` : ''}
              </p>
              {(plan.no_whatsapp ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plan.no_whatsapp} {plan.no_whatsapp === 1 ? 'número não tem' : 'números não têm'} WhatsApp e
                  fica{plan.no_whatsapp === 1 ? '' : 'm'} de fora.
                </p>
              )}
              {(plan.already_prospected ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plan.already_prospected}{' '}
                  {plan.already_prospected === 1 ? 'contato já recebeu' : 'contatos já receberam'} uma prospecção e
                  fica{plan.already_prospected === 1 ? '' : 'm'} de fora.
                </p>
              )}
              {(plan.opted_out ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plan.opted_out} {plan.opted_out === 1 ? 'contato pediu' : 'contatos pediram'} para não receber
                  mensagens automáticas e fica{plan.opted_out === 1 ? '' : 'm'} de fora.
                </p>
              )}
              {plan.not_found > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plan.not_found} {plan.not_found === 1 ? 'número não é contato' : 'números não são contatos'} do CRM e
                  fica{plan.not_found === 1 ? '' : 'm'} de fora.
                </p>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={risk}
              onChange={(e) => setRisk(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <AlertTriangle className="mr-1 inline size-4 text-amber-500" />
              {prospect
                ? 'Entendo que mandar mensagem para quem nunca falou com a empresa é o que mais leva o WhatsApp a bloquear o número, mesmo com estes limites, e que a minha empresa responde por esse contato.'
                : 'Entendo que mandar mensagens automáticas em volume pelo número do QR code é o que mais leva o WhatsApp a bloquear o número, e que o disparo é para quem espera receber.'}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => void call(true)} disabled={busy}>
            {busy && !plan ? <Loader2 className="size-4 animate-spin" /> : null}
            Ver quantos
          </Button>
          <Button onClick={() => void call(false)} disabled={busy || !plan || !risk}>
            {busy && plan ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Disparar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
