"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Radar } from "lucide-react";

import type { RadarPanel } from "@/lib/radar/painel";
import { cn } from "@/lib/utils";

/**
 * The Radar on the Painel: how many alerts and who is cooling down,
 * with the worst news in one line. Hidden until the Radar exists and is on.
 */
export function RadarCard() {
  const [panel, setPanel] = useState<RadarPanel | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/radar", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: RadarPanel | null) => {
        if (!cancelled) setPanel(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!panel?.available || !panel.enabled) return null;
  const open = panel.alerts.filter((a) => a.status === "aberto");
  const bad = open.filter((a) => a.tone !== "bom");
  const cooling = panel.cooling.length + panel.stalled.length;
  const top = bad[0] ?? open[0] ?? null;

  return (
    <Link
      href="/radar"
      className="group flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Radar className={cn("h-4 w-4", bad.length > 0 ? "text-red-500" : "text-primary")} />
        Radar
      </span>
      <span className="text-sm text-muted-foreground">
        {panel.learning && open.length === 0
          ? "Aprendendo o normal deste CRM"
          : `${open.length} ${open.length === 1 ? "alerta" : "alertas"} · ${cooling} esfriando`}
      </span>
      {top && <span className="min-w-0 flex-1 truncate text-sm text-foreground">{top.title}</span>}
      <span className="ml-auto hidden items-center gap-1 text-xs text-primary sm:flex">
        Abrir <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
