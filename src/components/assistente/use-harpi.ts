"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StepStatus, UiAction, UiItem } from "@/lib/assistente/types";

// ============================================================
// The panel's brain on the client.
//
// The server runs one model turn per request; this keeps asking for
// the next one while the answer is "continue", streams the text as it
// arrives, and stops when a card needs the person or the answer is
// complete. The conversation as saved comes back with every step, so
// what is on screen is always what is in the database.
// ============================================================

export interface AttentionItem {
  kind: string;
  count: number;
  label: string;
  prompt: string;
}

export interface HarpiState {
  installed: boolean;
  ready: boolean;
  reason: "no_key" | "disabled" | null;
  message: string | null;
  readOnly: boolean;
  canConfigure: boolean;
  attention: AttentionItem[];
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  origin: "chat" | "routine";
  updated_at: string;
}

/** Client-side guard: never chain more turns than this per message. */
const MAX_CLIENT_STEPS = 12;

function zone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/Sao_Paulo";
  }
}

function currentPage(): { path: string; search: string } {
  if (typeof window === "undefined") return { path: "/", search: "" };
  return { path: window.location.pathname, search: window.location.search.replace(/^\?/, "") };
}

interface DoneLine {
  t: "done";
  status: StepStatus;
  conversationId: string;
  items: UiItem[];
  error?: string;
}

async function readStream(res: Response, onDelta: (text: string) => void): Promise<DoneLine> {
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? "O Harpi não respondeu. Tente de novo.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: DoneLine | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.t === "delta" && typeof parsed.text === "string") onDelta(parsed.text);
        if (parsed.t === "done") done = parsed as DoneLine;
      } catch {
        // A broken line is skipped; the final one carries the truth.
      }
    }
  }
  const rest = buffer.trim();
  if (rest) {
    try {
      const parsed = JSON.parse(rest);
      if (parsed.t === "done") done = parsed as DoneLine;
    } catch {
      /* ignore */
    }
  }
  if (!done) throw new Error("A resposta veio cortada. Tente de novo.");
  return done;
}

export function useHarpi() {
  const [state, setState] = useState<HarpiState | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<UiItem[]>([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastStatus, setLastStatus] = useState<StepStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const busyRef = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      const res = await fetch(`/api/assistente/estado?tz=${encodeURIComponent(zone())}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.installed === false) {
        setState({ installed: false, ready: false, reason: null, message: null, readOnly: true, canConfigure: false, attention: [] });
        return;
      }
      setState({
        installed: true,
        ready: json.ready === true,
        reason: json.reason ?? null,
        message: json.message ?? null,
        readOnly: json.readOnly === true,
        canConfigure: json.canConfigure === true,
        attention: Array.isArray(json.attention) ? json.attention : [],
      });
    } catch {
      // Offline for a moment: keep what we had.
    }
  }, []);

  useEffect(() => {
    refreshState();
    const id = window.setInterval(refreshState, 90_000);
    return () => window.clearInterval(id);
  }, [refreshState]);

  /** Keep asking for turns while the server says "continue". */
  const drive = useCallback(
    async (first: () => Promise<Response>) => {
      let request = first;
      for (let i = 0; i < MAX_CLIENT_STEPS; i++) {
        setStreamText("");
        const res = await request();
        const done = await readStream(res, (t) => setStreamText((s) => s + t));
        setConversationId(done.conversationId);
        setItems(done.items);
        setStreamText("");
        setLastStatus(done.status);
        if (done.error) setError(done.error);
        if (done.status !== "continue") break;
        const conv = done.conversationId;
        request = () =>
          fetch("/api/assistente/passo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: conv, page: currentPage(), timezone: zone() }),
          });
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string, opts: { fresh?: boolean } = {}) => {
      const clean = text.trim();
      if (!clean || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const targetConversation = opts.fresh ? null : conversationId;
      if (opts.fresh) {
        setConversationId(null);
        setItems([]);
      }
      // Show the person's message right away.
      setItems((prev) => [
        ...(opts.fresh ? [] : prev),
        { kind: "user", id: `local-${Date.now()}`, text: clean, at: new Date().toISOString() },
      ]);
      try {
        await drive(() =>
          fetch("/api/assistente/mensagem", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: clean,
              conversationId: targetConversation,
              page: currentPage(),
              timezone: zone(),
            }),
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Algo deu errado.");
      } finally {
        busyRef.current = false;
        setBusy(false);
        setStreamText("");
        refreshState();
      }
    },
    [conversationId, drive, refreshState],
  );

  const decide = useCallback(
    async (actionId: string, decisao: "confirmar" | "cancelar" | "ajustar" | "desfazer") => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      let updated: UiAction | null = null;
      try {
        const res = await fetch(`/api/assistente/acoes/${actionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisao, timezone: zone() }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Não consegui registrar sua resposta.");
        if (Array.isArray(json.items)) {
          setItems(json.items);
          const found = (json.items as UiItem[]).find(
            (i): i is Extract<UiItem, { kind: "action" }> => i.kind === "action" && i.action.id === actionId,
          );
          updated = found?.action ?? null;
        }
        if (json.ok === false && json.message) setError(json.message);
        if (json.continue && json.conversationId) {
          const conv = json.conversationId as string;
          await drive(() =>
            fetch("/api/assistente/passo", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversationId: conv, page: currentPage(), timezone: zone() }),
            }),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Algo deu errado.");
      } finally {
        busyRef.current = false;
        setBusy(false);
        refreshState();
      }
      return updated;
    },
    [drive, refreshState],
  );

  const openConversation = useCallback(async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/assistente/conversas/${id}?tz=${encodeURIComponent(zone())}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Não consegui abrir a conversa.");
      setConversationId(id);
      setItems(json.items ?? []);
      setLastStatus(json.pending > 0 ? "needs_confirmation" : "done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado.");
    } finally {
      setBusy(false);
    }
  }, []);

  const newConversation = useCallback(() => {
    if (busyRef.current) return;
    setConversationId(null);
    setItems([]);
    setError(null);
    setLastStatus(null);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/assistente/conversas", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      setConversations(res.ok ? (json?.conversations ?? []) : []);
    } catch {
      setConversations([]);
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/assistente/conversas/${id}`, { method: "DELETE" });
      if (!res.ok) return false;
      setConversations((list) => (list ?? []).filter((c) => c.id !== id));
      if (id === conversationId) newConversation();
      return true;
    },
    [conversationId, newConversation],
  );

  return {
    state,
    refreshState,
    conversationId,
    items,
    streamText,
    busy,
    lastStatus,
    error,
    setError,
    send,
    decide,
    openConversation,
    newConversation,
    conversations,
    loadConversations,
    deleteConversation,
  };
}
