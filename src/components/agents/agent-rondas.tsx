"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Repeat, Trash2 } from "lucide-react";

import type { Agent } from "@/lib/agents/types";
import { RONDA_PRESETS, rondaPreset, type RondaKind } from "@/lib/agents/rondas-catalogo";
import type { RondaRow } from "@/lib/agents/rondas-payload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/dashboard/skeleton";
import { compactAgo } from "@/components/agents/format";

// ============================================================
// Rondas: what each agent checks on its own, and when
// (docs/plano-agentes-ativos.md, Fase 2).
// ============================================================

interface RunRow {
  ronda_id: string;
  ran_at: string;
  found: number;
  queued: number;
  skipped: Record<string, number> | null;
  note: string | null;
}

const DAYS = [
  { iso: 1, label: "Seg" },
  { iso: 2, label: "Ter" },
  { iso: 3, label: "Qua" },
  { iso: 4, label: "Qui" },
  { iso: 5, label: "Sex" },
  { iso: 6, label: "Sáb" },
  { iso: 7, label: "Dom" },
];

const SKIP_LABEL: Record<string, string> = {
  opt_out: "pediram para não receber",
  ocupado: "já com o agente",
  limite: "no limite de mensagens",
  nunca_conversou: "nunca conversaram (WhatsApp não oficial)",
  repetido: "já tratados há pouco",
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** "há 4 min" for the past, "em 12 min" for the future. */
function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "—";
  if (diff <= 45_000) {
    const ago = compactAgo(iso);
    return ago === "agora" ? "agora" : `há ${ago}`;
  }
  const back = new Date(Date.now() - diff).toISOString();
  return `em ${compactAgo(back)}`;
}

function scheduleText(r: RondaRow): string {
  if (r.every_minutes) {
    return r.every_minutes % 60 === 0
      ? `A cada ${r.every_minutes / 60} h, no expediente do agente`
      : `A cada ${r.every_minutes} min, no expediente do agente`;
  }
  const days = (r.run_days ?? []).map((d) => DAYS.find((x) => x.iso === d)?.label).filter(Boolean).join(", ");
  return `Às ${String(r.run_at ?? "").slice(0, 5)} · ${days}`;
}

export function AgentRondas({ agents, canEdit }: { agents: Agent[] | null; canEdit: boolean }) {
  const [rondas, setRondas] = useState<RondaRow[] | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [editing, setEditing] = useState<RondaRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/rondas");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rondas: RondaRow[]; runs: RunRow[] };
      setRondas(data.rondas ?? []);
      setRuns(data.runs ?? []);
    } catch {
      setRondas((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const agentName = useMemo(() => {
    const map = new Map((agents ?? []).map((a) => [a.id, a]));
    return (id: string) => map.get(id);
  }, [agents]);

  async function patch(r: RondaRow, body: Record<string, unknown>) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/agents/rondas/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      setRondas((prev) => (prev ?? []).map((x) => (x.id === r.id ? (data.ronda as RondaRow) : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: RondaRow) {
    if (!window.confirm(`Apagar a ronda "${r.name}"? O histórico dela vai junto.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/agents/rondas/${r.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "erro");
      setRondas((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Numa ronda, o agente olha o CRM sozinho de tempos em tempos e cuida do que encontrar. A procura é feita no
          banco, sem IA: a IA só é chamada quando há algo para fazer. Mensagens de uma ronda pedem o seu OK em
          Aprovações até você liberar, e nenhum cliente recebe mais de 1 mensagem por dia nem 3 por semana por
          iniciativa dos agentes.
        </p>
        {canEdit ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            disabled={!agents || agents.length === 0}
          >
            <Plus />
            Nova ronda
          </Button>
        ) : null}
      </div>

      {rondas === null ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : rondas.length === 0 ? (
        <div className="surface rounded-2xl px-6 py-16 text-center">
          <Repeat className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
            Nenhuma ronda ainda. Comece por uma simples, como &quot;Lead novo sem primeiro contato&quot; no SDR ou
            &quot;Orçamento parado&quot; no follow-up.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rondas.map((r) => {
            const agent = agentName(r.agent_id);
            const preset = rondaPreset(r.check_kind);
            const recent = runs.filter((x) => x.ronda_id === r.id).slice(0, 3);
            return (
              <li key={r.id} className="surface rounded-2xl p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{r.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {agent ? agent.name : "Agente removido"} · {preset?.name ?? r.check_kind} · {scheduleText(r)}
                      {agent && !agent.isActive ? " · agente desligado" : ""}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${r.name}`}
                        onClick={() => {
                          setEditing(r);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Apagar ${r.name}`}
                        onClick={() => void remove(r)}
                        disabled={busyId === r.id}
                      >
                        <Trash2 />
                      </Button>
                      <Switch
                        aria-label={r.is_active ? `Desligar ${r.name}` : `Ligar ${r.name}`}
                        checked={r.is_active}
                        disabled={busyId === r.id}
                        onCheckedChange={(v) => void patch(r, { isActive: v })}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{r.is_active ? "Ligada" : "Desligada"}</span>
                  )}
                </div>

                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>
                    Última vez:{" "}
                    {r.last_run_at ? `${relative(r.last_run_at)} — ${r.last_note ?? ""}` : "ainda não rodou"}
                  </p>
                  <p>Próxima: {r.is_active ? relative(r.next_run_at) : "desligada"}</p>
                  <p>
                    Mensagens:{" "}
                    {r.send_needs_approval ? "pedem o seu OK em Aprovações" : "saem sozinhas, dentro da autonomia do agente"}
                  </p>
                  <p>Até {r.max_per_run} caso(s) por ronda</p>
                </div>

                {canEdit && r.send_needs_approval ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-foreground underline underline-offset-4"
                    disabled={busyId === r.id}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Liberar esta ronda para mandar mensagens sem pedir OK? Ela ainda respeita a autonomia do agente, o expediente, o opt-out e o limite de 1 mensagem por dia e 3 por semana por cliente.",
                        )
                      ) {
                        void patch(r, { sendNeedsApproval: false });
                      }
                    }}
                  >
                    Liberar mensagens sem aprovação
                  </button>
                ) : null}

                {recent.length > 0 ? (
                  <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    {recent.map((run) => {
                      const skipped = Object.entries(run.skipped ?? {})
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${n} ${SKIP_LABEL[k] ?? k}`)
                        .join(", ");
                      return (
                        <li key={run.ran_at}>
                          {relative(run.ran_at)}: achou {run.found}, passou {run.queued} ao agente
                          {skipped ? ` (fora: ${skipped})` : ""}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <RondaForm
        open={formOpen}
        onOpenChange={setFormOpen}
        agents={agents ?? []}
        ronda={editing}
        onSaved={(saved) =>
          setRondas((prev) => {
            const list = prev ?? [];
            return list.some((x) => x.id === saved.id)
              ? list.map((x) => (x.id === saved.id ? saved : x))
              : [...list, saved];
          })
        }
      />
    </div>
  );
}

function RondaForm({
  open,
  onOpenChange,
  agents,
  ronda,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  ronda: RondaRow | null;
  onSaved: (r: RondaRow) => void;
}) {
  const [kind, setKind] = useState<RondaKind>("lead_sem_contato");
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [param, setParam] = useState<number | "">("");
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState<"every" | "daily">("every");
  const [every, setEvery] = useState(30);
  const [runAt, setRunAt] = useState("10:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [maxPerRun, setMaxPerRun] = useState(5);
  const [saving, setSaving] = useState(false);

  const preset = rondaPreset(kind);

  // Reset whenever the dialog opens, from the round being edited or a preset.
  useEffect(() => {
    if (!open) return;
    if (ronda) {
      const p = rondaPreset(ronda.check_kind);
      setKind(ronda.check_kind as RondaKind);
      setAgentId(ronda.agent_id);
      setName(ronda.name);
      setParam(p?.param ? Number(ronda.params?.[p.param.key] ?? p.param.default) : "");
      setInstruction(ronda.instruction);
      setMode(ronda.every_minutes ? "every" : "daily");
      setEvery(ronda.every_minutes ?? 30);
      setRunAt(String(ronda.run_at ?? "10:00").slice(0, 5));
      setDays(ronda.run_days ?? [1, 2, 3, 4, 5]);
      setMaxPerRun(ronda.max_per_run);
    } else {
      applyPreset("lead_sem_contato");
      setAgentId(agents[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ronda]);

  function applyPreset(next: RondaKind) {
    const p = rondaPreset(next);
    setKind(next);
    if (!p) return;
    setName(p.name);
    setParam(p.param ? p.param.default : "");
    setInstruction(p.instruction);
    setMode(p.everyMinutes ? "every" : "daily");
    setEvery(p.everyMinutes ?? 30);
    setRunAt(p.runAt ?? "10:00");
    // Suggest an agent whose function fits.
    const fit = agents.find((a) => p.roles.includes(a.role));
    if (fit) setAgentId(fit.id);
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        instruction,
        maxPerRun,
        runDays: days,
        everyMinutes: mode === "every" ? every : null,
        runAt: mode === "daily" ? runAt : null,
      };
      if (preset?.param && param !== "") body.param = param;
      if (!ronda) {
        body.agentId = agentId;
        body.checkKind = kind;
      } else if (agentId !== ronda.agent_id) {
        body.agentId = agentId;
      }
      const res = await fetch(ronda ? `/api/agents/rondas/${ronda.id}` : "/api/agents/rondas", {
        method: ronda ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      onSaved(data.ronda as RondaRow);
      toast.success(ronda ? "Ronda salva" : "Ronda criada. Ela roda no próximo ciclo do agendador.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{ronda ? "Editar ronda" : "Nova ronda"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {preset?.description ?? "O que o agente procura e quando."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!ronda ? (
            <div className="space-y-1.5">
              <Label htmlFor="ronda-kind">O que procurar</Label>
              <select
                id="ronda-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => applyPreset(e.target.value as RondaKind)}
              >
                {RONDA_PRESETS.map((p) => (
                  <option key={p.kind} value={p.kind}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ronda-agent">Agente</Label>
              <select id="ronda-agent" className={selectClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.isActive ? "" : " (desligado)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ronda-name">Nome</Label>
              <Input id="ronda-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          {preset?.param ? (
            <div className="space-y-1.5">
              <Label htmlFor="ronda-param">{preset.param.label}</Label>
              <Input
                id="ronda-param"
                type="number"
                min={preset.param.min}
                max={preset.param.max}
                value={param}
                onChange={(e) => setParam(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="ronda-instruction">O que o agente deve fazer com cada caso</Label>
            <Textarea
              id="ronda-instruction"
              rows={4}
              maxLength={2000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Quando roda</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={mode === "every" ? "default" : "outline"} onClick={() => setMode("every")}>
                De tempos em tempos
              </Button>
              <Button type="button" size="sm" variant={mode === "daily" ? "default" : "outline"} onClick={() => setMode("daily")}>
                Num horário
              </Button>
            </div>
            {mode === "every" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                A cada
                <Input
                  type="number"
                  min={15}
                  max={1440}
                  className="w-24"
                  value={every}
                  onChange={(e) => setEvery(Number(e.target.value))}
                  aria-label="Minutos entre as rondas"
                />
                minutos, no expediente do agente
              </div>
            ) : (
              <div className="space-y-2">
                <Input type="time" className="w-32" value={runAt} onChange={(e) => setRunAt(e.target.value)} aria-label="Horário" />
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d) => {
                    const on = days.includes(d.iso);
                    return (
                      <Button
                        key={d.iso}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== d.iso) : [...prev, d.iso]))}
                      >
                        {d.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ronda-max">Casos por ronda (o resto fica para a próxima)</Label>
            <Input
              id="ronda-max"
              type="number"
              min={1}
              max={20}
              className="w-24"
              value={maxPerRun}
              onChange={(e) => setMaxPerRun(Number(e.target.value))}
            />
          </div>

          {!ronda ? (
            <p className="rounded-xl bg-foreground/5 p-3 text-xs text-muted-foreground">
              As mensagens desta ronda vão pedir o seu OK em Aprovações. Quando você confiar nela, dá para liberar no
              cartão da ronda.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={saving || !agentId || !name.trim()}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {ronda ? "Salvar" : "Criar ronda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
