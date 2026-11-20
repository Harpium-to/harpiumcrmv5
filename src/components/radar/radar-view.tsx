"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  ArrowRight,
  Check,
  EyeOff,
  Flame,
  Loader2,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import type { RadarAlertView, RadarPanel } from "@/lib/radar/painel";
import { cn } from "@/lib/utils";

const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

const TONE: Record<RadarAlertView["tone"], { card: string; icon: string; label: string }> = {
  ruim: { card: "border-red-500/30 bg-red-500/5", icon: "text-red-500", label: "Atenção" },
  neutro: { card: "border-amber-400/40 bg-amber-400/5", icon: "text-amber-500", label: "Fique de olho" },
  bom: { card: "border-emerald-500/30 bg-emerald-500/5", icon: "text-emerald-500", label: "Boa notícia" },
};

/** The Radar: what changed, what is coming, and what to do. */
export function RadarView() {
  const [panel, setPanel] = useState<RadarPanel | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radar", { cache: "no-store" });
      if (res.ok) setPanel((await res.json()) as RadarPanel);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (alert: RadarAlertView, status: "visto" | "ignorado") => {
    const res = await fetch(`/api/radar/alerts/${alert.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(status === "ignorado" ? { status, ignorar_dias: 7 } : { status }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(json.error ?? "Não deu certo");
      return;
    }
    toast.success(status === "ignorado" ? "Este alerta fica quieto por 7 dias" : "Marcado como visto");
    void load();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o Radar…
      </div>
    );
  }
  if (!panel?.available) {
    return <p className="py-16 text-sm text-muted-foreground">O Radar ainda não está ativo neste CRM.</p>;
  }

  return <RadarPanelView panel={panel} onAct={act} />;
}

/** The Radar screen itself, from a loaded panel (also used by tests and previews). */
export function RadarPanelView({
  panel,
  onAct,
}: {
  panel: RadarPanel;
  onAct: (alert: RadarAlertView, status: "visto" | "ignorado") => void | Promise<void>;
}) {
  const act = onAct;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Radar</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            O que mudou no CRM em relação ao normal dele, o que deve acontecer no mês e o que fazer agora.
          </p>
        </div>
        {panel.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Números atualizados há{" "}
            {formatDistanceToNow(new Date(panel.updatedAt), { locale: ptBR })}
          </p>
        )}
      </div>

      {!panel.enabled && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          O Radar está desligado. {panel.canManage ? "Ligue em Configurações › Radar." : "Peça a um administrador para ligar."}
        </p>
      )}
      {panel.enabled && panel.learning && (
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">
          Aprendendo o normal deste CRM: os alertas de mudança começam em {ddmm(panel.learning.readyOn)}. A previsão e o
          que está esfriando já funcionam.
        </p>
      )}

      {/* ---- Agora ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Agora</h2>
        {panel.alerts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nada fora do normal nos últimos dias.
          </p>
        ) : (
          <ul className="space-y-2">
            {panel.alerts.map((a) => {
              const tone = TONE[a.tone];
              const Icon = a.tone === "neutro" ? Activity : a.direction === "alta" ? TrendingUp : TrendingDown;
              return (
                <li key={a.id} className={cn("rounded-lg border p-3", tone.card, a.status === "visto" && "opacity-70")}>
                  <div className="flex items-start gap-3">
                    <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", tone.icon)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{a.title}</p>
                      {a.detail && <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {tone.label} · {a.period === "semana" ? `semana de ${ddmm(a.periodStart)}` : `dia ${ddmm(a.periodStart)}`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    {a.href && (
                      <Link href={a.href} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                        {a.href.startsWith("/agenda")
                          ? "Ver na agenda"
                          : a.href.startsWith("/relatorios")
                            ? "Ver nos relatórios"
                            : "Ver"}{" "}
                        <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                    {a.status === "aberto" && (
                      <Button size="sm" variant="ghost" onClick={() => void act(a, "visto")}>
                        <Check className="size-3.5" /> Visto
                      </Button>
                    )}
                    {panel.canManage && (
                      <Button size="sm" variant="ghost" onClick={() => void act(a, "ignorado")}>
                        <EyeOff className="size-3.5" /> Ignorar 7 dias
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Previsão ---- */}
      {panel.showChance && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Previsão do mês</h2>
          {panel.forecast && panel.forecast.deals > 0 ? (
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">Deve entrar em {monthName(panel.forecast.month)}</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {money(panel.forecast.low)} a {money(panel.forecast.high)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Esperado: {money(panel.forecast.expected)}, de {panel.forecast.deals}{" "}
                {panel.forecast.deals === 1 ? "negócio" : "negócios"} com data prevista no mês
                {panel.forecast.withoutDate > 0 ? ` (${panel.forecast.withoutDate} sem data prevista ficaram de fora)` : ""}.
                {panel.forecast.weak ? " Estimativa fraca: ainda há poucos negócios fechados para calibrar." : ""}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Sem negócios com data prevista para este mês, ou a chance de cada um ainda não foi calculada (sai de
              madrugada).
            </p>
          )}
        </section>
      )}

      {/* ---- Esfriando ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Esfriando</h2>
        {panel.cooling.length === 0 && panel.stalled.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Ninguém esfriando agora.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {panel.cooling.length > 0 && (
              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  Leads esperando resposta
                </p>
                <ul className="divide-y divide-border">
                  {panel.cooling.map((c) => (
                    <li key={c.conversationId}>
                      <Link
                        href={`/inbox?c=${c.conversationId}`}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                      >
                        {c.temperature === "hot" ? (
                          <Flame className="h-4 w-4 shrink-0 text-red-500" aria-label="Quente" />
                        ) : (
                          <Thermometer className="h-4 w-4 shrink-0 text-amber-500" aria-label="Morno" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          há {formatDistanceToNow(new Date(c.waitingSince), { locale: ptBR })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {panel.stalled.length > 0 && (
              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  Negócios com boa chance, parados
                </p>
                <ul className="divide-y divide-border">
                  {panel.stalled.map((d) => (
                    <li key={d.id}>
                      <Link href="/pipelines" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {d.title}
                          {d.stage ? <span className="text-muted-foreground"> · {d.stage}</span> : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {Math.round(d.chance * 100)}% · parado há {d.days} dias
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---- Resumo ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Resumo da semana</h2>
        {panel.digest ? (
          <div className="rounded-lg border border-border p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{panel.digest.text}</p>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {panel.digest.byAi ? "Escrito pela IA a partir dos números" : "Montado a partir dos números"} ·{" "}
              {new Date(panel.digest.createdAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            O primeiro resumo chega na próxima segunda de manhã.
          </p>
        )}
      </section>
    </div>
  );
}
