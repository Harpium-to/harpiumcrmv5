"use client";

// ============================================================
// Relatório: the period and the campaign filters, the CSV, and the
// numbers themselves (report-view.tsx). Everyone in the CRM sees it.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw } from "lucide-react";

import {
  NO_CAMPAIGN,
  NO_CREATIVE,
  type PersonRow,
  type QuizReport,
  type ReportPeriod,
} from "@/lib/quiz/report";

import { Button, buttonVariants } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/pill-nav";

import { ReportView } from "./report-view";
import { SelectBox } from "./ui";

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "all", label: "Tudo" },
];

/** Where the period starts, in the viewer's own time zone. */
function since(period: ReportPeriod): string | null {
  if (period === "all") return null;
  const start = new Date();
  if (period === "today") start.setHours(0, 0, 0, 0);
  else start.setTime(start.getTime() - Number(period) * 86_400_000);
  return start.toISOString();
}

interface ReportData {
  report: QuizReport;
  people: PersonRow[];
  peopleTotal: number;
}

export function ReportTab({ quizId }: { quizId: string }) {
  const [period, setPeriod] = useState<ReportPeriod>("30");
  const [campaign, setCampaign] = useState("");
  const [creative, setCreative] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useCallback(() => {
    const params = new URLSearchParams();
    const start = since(period);
    if (start) params.set("since", start);
    if (campaign) params.set("campaign", campaign);
    if (creative) params.set("creative", creative);
    return params.toString();
  }, [period, campaign, creative]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quiz/${quizId}/report?${query()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não consegui carregar o relatório");
      setData(json as ReportData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui carregar o relatório");
    } finally {
      setLoading(false);
    }
  }, [quizId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const choices = data?.report.choices;
  const label = (value: string, none: string, empty: string) => (value === none ? empty : value);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            items={PERIODS}
            value={period}
            onChange={(value) => setPeriod(value as ReportPeriod)}
            ariaLabel="Período"
          />
          {choices && choices.campaigns.length > 1 ? (
            <SelectBox
              className="w-52"
              value={campaign}
              aria-label="Campanha"
              onChange={(e) => setCampaign(e.target.value)}
            >
              <option value="">Todas as campanhas</option>
              {choices.campaigns.map((c) => (
                <option key={c} value={c}>
                  {label(c, NO_CAMPAIGN, "Sem campanha no link")}
                </option>
              ))}
            </SelectBox>
          ) : null}
          {choices && choices.creatives.length > 1 ? (
            <SelectBox
              className="w-52"
              value={creative}
              aria-label="Criativo"
              onChange={(e) => setCreative(e.target.value)}
            >
              <option value="">Todos os criativos</option>
              {choices.creatives.map((c) => (
                <option key={c} value={c}>
                  {label(c, NO_CREATIVE, "Sem criativo no link")}
                </option>
              ))}
            </SelectBox>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Atualizar
          </Button>
          <a
            href={`/api/quiz/${quizId}/export?${query()}`}
            className={buttonVariants({ variant: "outline" })}
            download
          >
            <Download />
            CSV
          </a>
        </div>
      </div>

      {data ? (
        <ReportView report={data.report} people={data.people} peopleTotal={data.peopleTotal} />
      ) : (
        <div className="flex h-40 items-center justify-center">
          {loading ? (
            <Loader2 className="size-6 animate-spin text-primary" />
          ) : (
            <p className="text-sm text-muted-foreground">Não consegui carregar o relatório.</p>
          )}
        </div>
      )}
    </div>
  );
}
