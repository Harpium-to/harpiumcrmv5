"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Brain, Check, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import type { Agent } from "@/lib/agents/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/dashboard/skeleton";
import { compactAgo } from "@/components/agents/format";

// ============================================================
// Memória: what the agents learned, in the open
// (docs/plano-agentes-ativos.md, Fase 0).
//
// The agents read this before every reply and every task, so a wrong
// memory makes a wrong answer. Admins can correct it, delete it, or
// teach the team something new.
// ============================================================

interface MemoryItem {
  id: string;
  agentId: string | null;
  contactId: string | null;
  contactName: string | null;
  scope: "agent" | "team" | "contact";
  kind: string;
  content: string;
  createdAt: string;
}

const SCOPES = [
  { value: "", label: "Tudo" },
  { value: "contact", label: "Sobre clientes" },
  { value: "team", label: "Da equipe" },
  { value: "agent", label: "De cada agente" },
];

const KIND_LABEL: Record<string, string> = {
  fact: "fato",
  objection: "objeção",
  preference: "preferência",
  outcome: "resultado",
  instruction: "instrução",
};

export function AgentMemory({ agents, canEdit }: { agents: Agent[] | null; canEdit: boolean }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [teaching, setTeaching] = useState("");
  const [teachingBusy, setTeachingBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "150" });
    if (scope) params.set("scope", scope);
    if (applied) params.set("q", applied);
    try {
      const res = await fetch(`/api/agents/memory?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { memories: MemoryItem[] };
      setItems(data.memories ?? []);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, [scope, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentName = (id: string | null) => agents?.find((a) => a.id === id)?.name ?? null;

  async function saveEdit(item: MemoryItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/agents/memory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "erro");
      setItems((prev) => (prev ?? []).map((m) => (m.id === item.id ? { ...m, content: draft.trim() } : m)));
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: MemoryItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/agents/memory/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "erro");
      setItems((prev) => (prev ?? []).filter((m) => m.id !== item.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setBusyId(null);
    }
  }

  async function teach() {
    setTeachingBusy(true);
    try {
      const res = await fetch("/api/agents/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: teaching, kind: "instruction" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "erro");
      setTeaching("");
      toast.success("Todos os agentes vão levar isso em conta.");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setTeachingBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        O que os agentes aprenderam conversando: preferências e objeções de cada cliente, e o que vale para a equipe
        toda. Eles leem isso antes de responder. Se algo estiver errado, corrija ou apague.
      </p>

      {canEdit ? (
        <div className="surface space-y-2 rounded-2xl p-4">
          <label htmlFor="memory-teach" className="text-sm font-medium text-foreground">
            Ensinar a equipe
          </label>
          <Textarea
            id="memory-teach"
            rows={2}
            maxLength={2000}
            placeholder="Nunca prometa entrega em menos de 30 dias."
            value={teaching}
            onChange={(e) => setTeaching(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void teach()} disabled={teachingBusy || !teaching.trim()}>
              {teachingBusy ? <Loader2 className="animate-spin" /> : <Plus />}
              Guardar para todos
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={scope === s.value ? "default" : "outline"}
            aria-pressed={scope === s.value}
            onClick={() => setScope(s.value)}
          >
            {s.label}
          </Button>
        ))}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(query.trim());
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar"
            className="h-9 w-48"
            aria-label="Procurar na memória"
          />
          <Button type="submit" size="icon" variant="outline" aria-label="Procurar">
            <Search />
          </Button>
        </form>
      </div>

      {items === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="surface rounded-2xl px-6 py-16 text-center">
          <Brain className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
            Nada guardado ainda. Os agentes guardam o que aprendem conforme conversam.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {items.map((m) => {
            const who =
              m.scope === "contact"
                ? m.contactName ?? "cliente"
                : m.scope === "team"
                  ? "equipe"
                  : agentName(m.agentId) ?? "agente";
            return (
              <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {who} · {KIND_LABEL[m.kind] ?? m.kind} · há {compactAgo(m.createdAt)}
                    {m.scope === "contact" && agentName(m.agentId) ? ` · por ${agentName(m.agentId)}` : ""}
                  </p>
                  {editingId === m.id ? (
                    <Textarea
                      className="mt-1"
                      rows={2}
                      maxLength={2000}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label="Corrigir memória"
                    />
                  ) : (
                    <p className="mt-0.5 text-sm text-foreground">{m.content}</p>
                  )}
                </div>
                {canEdit ? (
                  editingId === m.id ? (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Salvar"
                        disabled={busyId === m.id || !draft.trim()}
                        onClick={() => void saveEdit(m)}
                      >
                        <Check />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Cancelar" onClick={() => setEditingId(null)}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Corrigir"
                        onClick={() => {
                          setEditingId(m.id);
                          setDraft(m.content);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Apagar"
                        disabled={busyId === m.id}
                        onClick={() => void remove(m)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
