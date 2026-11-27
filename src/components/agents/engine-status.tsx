"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { compactAgo } from "@/components/agents/format";

/** Past this, the scheduler is late enough that work is visibly waiting. */
const STALE_MS = 10 * 60_000;

/**
 * A warning when the agents' engine stopped (082). Rounds, the work
 * queue and approved actions all wait for it; without this, a stopped
 * scheduler looked exactly like agents with nothing to do.
 * Renders nothing while it is healthy, or before 082 exists.
 */
export function EngineStatus() {
  // undefined: not known yet (or 082 missing) — render nothing.
  const [state, setState] = useState<{ lastTick: string | null; stale: boolean } | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await createClient()
        .from("agent_engine_state")
        .select("last_tick_at")
        .eq("id", 1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const lastTick = (data as { last_tick_at: string | null }).last_tick_at;
      setState({
        lastTick,
        stale: !lastTick || Date.now() - new Date(lastTick).getTime() > STALE_MS,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || !state.stale) return null;
  const { lastTick } = state;

  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <p className="text-foreground">
        {lastTick
          ? `O motor dos agentes não roda há ${compactAgo(lastTick)}.`
          : "O motor dos agentes ainda não rodou."}{" "}
        Rondas, tarefas e ações aprovadas ficam esperando até ele voltar. Ele roda junto com o agendador das
        automações (/api/automations/cron); confira se ele está sendo chamado.
      </p>
    </div>
  );
}
