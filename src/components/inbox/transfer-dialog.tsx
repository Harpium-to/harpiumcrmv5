"use client";

import { useMemo, useState } from "react";
import { Check, Search, Users, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PresenceDot } from "@/components/presence/presence-dot";
import { usePresence } from "@/hooks/use-presence";
import { useMembers, useTeams } from "@/hooks/use-atendimento";
import { presenceLabel } from "@/lib/presence";
import { TEAM_MODE_LABEL } from "@/lib/atendimento/setores";
import { cn } from "@/lib/utils";

export interface TransferOutcome {
  toUserId: string | null;
  teamId: string | null;
}

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  assignedAgentId: string | null;
  teamId: string | null;
  currentUserId: string | undefined;
  /** Open conversations each person owns, from the loaded inbox. */
  openCountByUser?: Record<string, number>;
  onTransferred: (outcome: TransferOutcome) => void;
}

type Tab = "pessoa" | "setor";

/**
 * "Transferir": to a person or a setor, with an optional note that the
 * person who receives it reads in the notification and in the
 * conversation's history. Goes through POST /api/conversations/{id}/transfer.
 */
export function TransferDialog({
  open,
  onOpenChange,
  conversationId,
  assignedAgentId,
  teamId,
  currentUserId,
  openCountByUser = {},
  onTransferred,
}: TransferDialogProps) {
  const { members } = useMembers();
  const { teams } = useTeams();
  const { getPresence, getRow, now } = usePresence();

  const activeTeams = useMemo(() => teams.filter((t) => t.active), [teams]);
  const [tab, setTab] = useState<Tab>("pessoa");
  const [personId, setPersonId] = useState<string | null>(null);
  const [setorId, setSetorId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.role !== "viewer")
      .filter((m) => !q || (m.full_name || m.email || "").toLowerCase().includes(q))
      .sort((a, b) => {
        // Online first, then by name.
        const pa = getPresence(a.user_id) === "online" ? 0 : 1;
        const pb = getPresence(b.user_id) === "online" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.full_name || "").localeCompare(b.full_name || "");
      });
  }, [members, query, getPresence]);

  const reset = () => {
    setPersonId(null);
    setSetorId(null);
    setNote("");
    setQuery("");
    setTab("pessoa");
  };

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        reason?: string | null;
        to_user_id?: string | null;
        team_id?: string | null;
      };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const toName = members.find((m) => m.user_id === json.to_user_id)?.full_name;
      const teamName = teams.find((t) => t.id === json.team_id)?.name;
      if (json.reason === "queued") {
        toast.success(`Na fila de ${teamName ?? "setor"}: quem do setor pegar primeiro fica com ela`);
      } else if (json.reason === "nobody_available") {
        toast.warning("Ninguém disponível para receber agora");
      } else if (json.to_user_id) {
        toast.success(
          json.to_user_id === currentUserId
            ? "A conversa é sua"
            : `Passada para ${toName ?? "a pessoa"}${teamName ? ` · ${teamName}` : ""}`,
        );
      } else {
        toast.success("Devolvida para a fila");
      }
      onTransferred({ toUserId: json.to_user_id ?? null, teamId: json.team_id ?? null });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Não consegui transferir: ${err instanceof Error ? err.message : "erro"}`);
    } finally {
      setBusy(false);
    }
  };

  const canSend = tab === "pessoa" ? !!personId : !!setorId;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
          <DialogDescription>
            Quem recebe é avisado, com a sua nota. Fica registrado no histórico da conversa.
          </DialogDescription>
        </DialogHeader>

        {activeTeams.length > 0 && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
            {(
              [
                ["pessoa", "Para uma pessoa", UserRound],
                ["setor", "Para um setor", Users],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  tab === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "pessoa" ? (
          <div className="space-y-2">
            {members.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar pessoa"
                  className="h-8 border-border bg-muted pl-8 text-sm"
                />
              </div>
            )}
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {people.length === 0 && (
                <li className="px-2 py-3 text-sm text-muted-foreground">Ninguém da equipe encontrado.</li>
              )}
              {people.map((m) => {
                const presence = getPresence(m.user_id);
                const isOwner = m.user_id === assignedAgentId;
                const selected = personId === m.user_id;
                const open = openCountByUser[m.user_id] ?? 0;
                return (
                  <li key={m.user_id}>
                    <button
                      type="button"
                      disabled={isOwner}
                      onClick={() => setPersonId(m.user_id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-transparent hover:bg-muted",
                        isOwner && "cursor-default opacity-60",
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(presence, getRow(m.user_id)?.last_seen_at ?? null, now)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {m.full_name || m.email || "Sem nome"}
                        {m.user_id === currentUserId ? " (eu)" : ""}
                      </span>
                      {isOwner ? (
                        <span className="text-[11px] text-muted-foreground">está com ela</span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          {m.receives_conversations === false && (
                            <span className="rounded bg-muted px-1.5 py-0.5">pausado</span>
                          )}
                          {open} {open === 1 ? "aberta" : "abertas"}
                        </span>
                      )}
                      {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {activeTeams.map((t) => {
              const selected = setorId === t.id;
              const onlineHere = t.members.filter((u) => getPresence(u) === "online").length;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSetorId(t.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                      selected ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted",
                    )}
                  >
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {t.name}
                        {t.id === teamId ? " (atual)" : ""}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {TEAM_MODE_LABEL[t.mode]} · {t.members.length}{" "}
                        {t.members.length === 1 ? "pessoa" : "pessoas"} · {onlineHere} online
                      </span>
                    </span>
                    {selected && <Check className="mt-1 h-3.5 w-3.5 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1">
          <label htmlFor="transfer-note" className="text-xs font-medium text-muted-foreground">
            Nota para quem recebe (opcional)
          </label>
          <Textarea
            id="transfer-note"
            value={note}
            maxLength={500}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: quer parcelar em 10x, já mandei a tabela"
            className="resize-none border-border bg-muted text-sm"
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {assignedAgentId ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => send({ para: "fila", nota: note })}
            >
              Devolver para a fila
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            disabled={!canSend || busy}
            onClick={() =>
              tab === "pessoa"
                ? send({ para: "pessoa", pessoa_id: personId, nota: note })
                : send({ para: "setor", setor_id: setorId, nota: note })
            }
          >
            {busy ? "Transferindo…" : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
