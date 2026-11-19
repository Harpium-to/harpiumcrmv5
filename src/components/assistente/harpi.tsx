"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  History,
  Loader2,
  MessageSquarePlus,
  Repeat,
  Settings2,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { UiItem } from "@/lib/assistente/types";

import { HarpiActionCard } from "./harpi-action-card";
import { HarpiFace, type HarpiMood } from "./harpi-face";
import { HarpiMarkdown } from "./harpi-markdown";
import { useHarpi } from "./use-harpi";

// ============================================================
// Harpi in the corner: the face that opens the panel, on every screen
// of the CRM. Mounted once, in the dashboard shell.
//
// Other screens can open it (and ask something) with
//   openHarpi({ prompt })  or  openHarpi({ view: "history" })
// ============================================================

export const HARPI_OPEN_EVENT = "harpi:open";

export function openHarpi(opts: { prompt?: string; view?: "history" } = {}) {
  window.dispatchEvent(new CustomEvent(HARPI_OPEN_EVENT, { detail: opts }));
}

const DAILY_KEY = "harpi:resumo-diario";
const DAILY_LAST_KEY = "harpi:resumo-ultimo";
const DAILY_PROMPT =
  "Resumo do dia: leads que chegaram desde ontem, conversas esperando atendente, minhas tarefas de hoje e as atrasadas, compromissos de hoje e negócios parados que pedem atenção. Curto, em tópicos, com links.";

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private window: the preference just doesn't stick */
  }
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Suggestions for the screen the person is on. */
function suggestionsFor(path: string): string[] {
  if (path.startsWith("/automations")) {
    return [
      "Cria uma automação de boas-vindas para os leads do quiz",
      "Quais automações falharam esta semana?",
      "O que essa automação faz?",
    ];
  }
  if (path.startsWith("/pipelines")) {
    return [
      "Quais negócios estão parados há mais de 15 dias?",
      "Quanto temos em aberto em cada etapa do funil?",
      "Quanto vendemos este mês?",
    ];
  }
  if (path.startsWith("/contacts") || path.startsWith("/leads")) {
    return [
      "Quantos leads chegaram esta semana e de onde?",
      "Quem são os leads quentes sem negócio aberto?",
      "Marca como quente quem respondeu o quiz ontem",
    ];
  }
  if (path.startsWith("/inbox")) {
    return [
      "Quais conversas estão esperando atendente?",
      "Resume essa conversa para mim",
      "Cria uma tarefa para eu retornar esse contato amanhã às 10h",
    ];
  }
  if (path.startsWith("/agenda")) {
    return ["O que tem na agenda hoje?", "Quais horários estão livres amanhã?", "Quem faltou esta semana?"];
  }
  if (path.startsWith("/agents")) {
    return ["O que os agentes estão fazendo agora?", "Tem aprovação de agente parada?", "Cria um agente SDR para os leads do quiz"];
  }
  return [
    "Como foi a última semana em vendas e leads?",
    "Toda segunda às 8h, me manda o resumo do funil",
    "Quais conversas estão esperando atendente?",
  ];
}

export function Harpi() {
  const pathname = usePathname() ?? "/";
  const { profile } = useAuth();
  const harpi = useHarpi();
  const { state, busy, items, streamText, lastStatus, error } = harpi;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [draft, setDraft] = useState("");
  const [daily, setDaily] = useState(() => typeof window !== "undefined" && readFlag(DAILY_KEY) === "on");
  const [celebrate, setCelebrate] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ready = !!state?.installed && state.ready;
  const attentionCount = (state?.attention ?? []).reduce((n, a) => n + a.count, 0);
  const pendingCards = items.filter((i) => i.kind === "action" && i.action.status === "pending").length;

  const mood: HarpiMood = busy
    ? "thinking"
    : error
      ? "error"
      : celebrate
        ? "happy"
        : pendingCards > 0 || lastStatus === "needs_confirmation"
          ? "waiting"
          : state && !state.ready
            ? "sleeping"
            : "idle";

  // A short hop when a turn finishes well.
  const prevBusy = useRef(false);
  useEffect(() => {
    const was = prevBusy.current;
    prevBusy.current = busy;
    if (!was || busy || error || lastStatus !== "done") return;
    const on = window.setTimeout(() => setCelebrate(true), 0);
    const off = window.setTimeout(() => setCelebrate(false), 1400);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [busy, error, lastStatus]);

  const submit = useCallback(
    (text: string, fresh = false) => {
      if (!text.trim() || busy || !ready) return;
      setView("chat");
      setDraft("");
      void harpi.send(text, { fresh });
    },
    [busy, ready, harpi],
  );

  // ⌘J / Ctrl+J toggles; Esc closes.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opened from elsewhere (a notification, settings, a help button).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string; view?: "history" }>).detail ?? {};
      setOpen(true);
      if (detail.view === "history") setView("history");
      else if (detail.prompt) submit(detail.prompt, true);
    };
    window.addEventListener(HARPI_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(HARPI_OPEN_EVENT, onOpen);
  }, [submit]);

  // The day's summary, once a day, when the person turned it on.
  useEffect(() => {
    if (!open || !ready || !daily || busy || items.length > 0) return;
    if (readFlag(DAILY_LAST_KEY) === todayKey()) return;
    writeFlag(DAILY_LAST_KEY, todayKey());
    submit(DAILY_PROMPT, true);
  }, [open, ready, daily, busy, items.length, submit]);

  useEffect(() => {
    if (open && view === "chat") window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, view]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, streamText, open, view]);

  useEffect(() => {
    if (open && view === "history") void harpi.loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  const firstName = (profile?.full_name ?? "").split(" ")[0];
  const suggestions = useMemo(() => suggestionsFor(pathname), [pathname]);

  if (!state?.installed) return null;
  // The agency console has its own screens; Harpi lives in the CRM.
  if (pathname.startsWith("/agencia")) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  const toggleDaily = () => {
    const next = !daily;
    setDaily(next);
    writeFlag(DAILY_KEY, next ? "on" : null);
  };

  return (
    <div data-print="hide">
      {open && (
        <section
          role="dialog"
          aria-label="Harpi, assistente do CRM"
          className="fixed inset-0 z-50 flex flex-col bg-card sm:inset-auto sm:right-6 sm:bottom-24 sm:h-[min(680px,calc(100vh-8rem))] sm:w-[420px] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl"
        >
          <header className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
            <HarpiFace mood={mood} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight text-foreground">Harpi</p>
              <p className="truncate text-xs text-muted-foreground">
                {busy
                  ? "Trabalhando…"
                  : pendingCards > 0
                    ? "Esperando o seu OK"
                    : state.readOnly
                      ? "Só consulta (seu acesso é de leitura)"
                      : "Assistente do CRM"}
              </p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Nova conversa"
              title="Nova conversa"
              disabled={busy}
              onClick={() => {
                harpi.newConversation();
                setView("chat");
              }}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Conversas anteriores"
              title="Conversas anteriores"
              aria-pressed={view === "history"}
              onClick={() => setView(view === "history" ? "chat" : "history")}
            >
              <History className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Fechar" title="Fechar (Esc)" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </header>

          {view === "history" ? (
            <HistoryList
              harpi={harpi}
              onOpen={(id) => {
                void harpi.openConversation(id);
                setView("chat");
              }}
            />
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {!state.ready ? (
                  <NotReady message={state.message} reason={state.reason} canConfigure={state.canConfigure} onNavigate={() => setOpen(false)} />
                ) : items.length === 0 && !busy ? (
                  <Welcome
                    name={firstName}
                    readOnly={state.readOnly}
                    suggestions={suggestions}
                    attention={state.attention}
                    daily={daily}
                    onToggleDaily={toggleDaily}
                    onAsk={(p) => submit(p, true)}
                  />
                ) : (
                  <Items
                    items={items}
                    busy={busy}
                    onDecide={async (id, decision) => {
                      const updated = await harpi.decide(id, decision);
                      // "Ajustar": the card is set aside; say what to change.
                      if (decision === "ajustar") inputRef.current?.focus();
                      return updated;
                    }}
                    onNavigate={() => setOpen(false)}
                  />
                )}
                {busy && (
                  <div className="flex gap-2">
                    <HarpiFace mood="thinking" className="mt-0.5 size-6" />
                    {streamText ? (
                      <div className="min-w-0 flex-1">
                        <HarpiMarkdown text={streamText} />
                        <span className="harpi-caret ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-primary/70" />
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        Pensando…
                      </p>
                    )}
                  </div>
                )}
                {error && !busy && (
                  <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <form
                className="border-t border-border p-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(draft);
                }}
              >
                <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-2.5 py-1.5 focus-within:border-primary/60">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    maxLength={4000}
                    disabled={!state.ready}
                    placeholder={state.ready ? "Pergunte ou peça algo ao Harpi" : "O Harpi não está disponível"}
                    className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <Button type="submit" size="icon-sm" aria-label="Enviar" disabled={busy || !draft.trim() || !state.ready}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  </Button>
                </div>
                <p className="mt-1.5 px-1 text-[0.68rem] text-muted-foreground">
                  Nada muda no CRM sem o seu OK. Atalho: ⌘J / Ctrl+J.
                </p>
              </form>
            </>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Fechar o Harpi" : `Abrir o Harpi${attentionCount ? ` (${attentionCount} coisas pedem atenção)` : ""}`}
        title="Harpi — assistente do CRM (⌘J)"
        className={cn(
          "fixed right-4 bottom-4 z-40 flex size-14 items-center justify-center rounded-full bg-card shadow-lg ring-1 ring-border transition-transform hover:-translate-y-0.5 sm:right-6 sm:bottom-6",
          open && "hidden sm:flex",
        )}
      >
        <HarpiFace mood={open ? mood : attentionCount > 0 ? "waiting" : mood} className="size-11" />
        {!open && attentionCount > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[0.68rem] font-bold text-amber-950 ring-2 ring-background">
            {attentionCount > 99 ? "99+" : attentionCount}
          </span>
        )}
      </button>
    </div>
  );
}

function Items({
  items,
  busy,
  onDecide,
  onNavigate,
}: {
  items: UiItem[];
  busy: boolean;
  onDecide: ReturnType<typeof useHarpi>["decide"];
  onNavigate: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                {item.text}
              </p>
            </div>
          );
        }
        if (item.kind === "assistant") {
          return (
            <div key={item.id} className="flex gap-2">
              <HarpiFace className="mt-0.5 size-6" />
              <div className="min-w-0 flex-1">
                <HarpiMarkdown text={item.text} onNavigate={onNavigate} />
              </div>
            </div>
          );
        }
        if (item.kind === "activity") {
          return (
            <p key={item.id} className="flex items-center gap-1.5 pl-8 text-xs text-muted-foreground">
              {item.failed ? <X className="size-3 text-destructive" /> : <Check className="size-3" />}
              {item.label}
            </p>
          );
        }
        if (item.kind === "notice") {
          return (
            <p key={item.id} className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Repeat className="size-3" />
              {item.text}
            </p>
          );
        }
        return (
          <div key={item.id} className="pl-8">
            <HarpiActionCard
              action={item.action}
              busy={busy}
              onDecide={(d) => onDecide(item.action.id, d)}
              onNavigate={onNavigate}
            />
          </div>
        );
      })}
    </>
  );
}

function Welcome({
  name,
  readOnly,
  suggestions,
  attention,
  daily,
  onToggleDaily,
  onAsk,
}: {
  name: string;
  readOnly: boolean;
  suggestions: string[];
  attention: { kind: string; count: number; label: string; prompt: string }[];
  daily: boolean;
  onToggleDaily: () => void;
  onAsk: (prompt: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <HarpiFace mood="happy" className="size-16" />
        <p className="text-base font-semibold text-foreground">{name ? `Oi, ${name}!` : "Oi!"} Eu sou o Harpi.</p>
        <p className="max-w-[30ch] text-sm text-muted-foreground">
          {readOnly
            ? "Pergunte qualquer coisa sobre o CRM. Seu acesso é de leitura, então eu só consulto."
            : "Pergunte qualquer coisa sobre o CRM ou peça uma mudança. Antes de alterar algo, eu te mostro e espero o seu OK."}
        </p>
      </div>

      {attention.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Pedem atenção</p>
          {attention.map((a) => (
            <button
              key={a.kind}
              type="button"
              onClick={() => onAsk(a.prompt)}
              className="flex w-full items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-left text-sm font-medium text-amber-950 hover:bg-amber-300"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-950 text-[0.68rem] font-bold text-amber-50">
                {a.count > 99 ? "99+" : a.count}
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Experimente</p>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onAsk(s)}
            className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            {s}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleDaily}
        aria-pressed={daily}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <Sunrise className="size-3.5" />
        <span className="flex-1">Resumo do dia quando eu abrir o Harpi</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.68rem] font-medium",
            daily ? "bg-primary text-primary-foreground" : "bg-muted",
          )}
        >
          {daily ? "Ligado" : "Desligado"}
        </span>
      </button>
    </div>
  );
}

function NotReady({
  message,
  reason,
  canConfigure,
  onNavigate,
}: {
  message: string | null;
  reason: "no_key" | "disabled" | null;
  canConfigure: boolean;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 pt-8 text-center">
      <HarpiFace mood="sleeping" className="size-16" />
      <p className="max-w-[32ch] text-sm text-muted-foreground">{message ?? "O Harpi não está disponível agora."}</p>
      {canConfigure && (
        <Link
          href={reason === "no_key" ? "/agents?tab=setup" : "/settings?tab=assistente"}
          onClick={onNavigate}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Settings2 className="size-4" />
          {reason === "no_key" ? "Cadastrar a chave de IA" : "Abrir as configurações do Harpi"}
        </Link>
      )}
    </div>
  );
}

function HistoryList({
  harpi,
  onOpen,
}: {
  harpi: ReturnType<typeof useHarpi>;
  onOpen: (id: string) => void;
}) {
  const list = harpi.conversations;
  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {list === null ? (
        <p className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Carregando…
        </p>
      ) : list.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
      ) : (
        <ul className="space-y-0.5">
          {list.map((c) => (
            <li key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-muted">
              <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
                {c.origin === "routine" ? (
                  <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <History className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.title || "Conversa"}</span>
                <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                  {new Date(c.updated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
              </button>
              <button
                type="button"
                aria-label="Apagar conversa"
                title="Apagar conversa"
                onClick={() => void harpi.deleteConversation(c.id)}
                className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-2 pt-3 text-[0.7rem] text-muted-foreground">
        As conversas ficam guardadas por 90 dias e só você as vê.
      </p>
    </div>
  );
}
