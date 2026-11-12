"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { DealForm, type DealPrefill } from "@/components/pipelines/deal-form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Contact, Deal, PipelineStage } from "@/types";
import type { DealSuggestion } from "@/lib/ai/deal-suggestion";

interface PipelineOption {
  id: string;
  name: string;
}

type AiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "off"; message: string }
  | { kind: "error"; message: string };

interface NewDealButtonProps {
  contact: Contact;
  conversationId: string | null;
  /** The contact's open deals, to warn before creating a duplicate. */
  openDeals: Deal[];
  onCreated: () => void;
}

/**
 * "+" next to "Negócios" in the inbox sidebar. Picks the pipeline (a
 * menu when there is more than one), opens the pipeline's own deal
 * form with the contact and conversation linked, and asks the AI to
 * fill the rest from the conversation. Nothing is saved until the
 * person clicks "Criar negócio".
 */
export function NewDealButton({
  contact,
  conversationId,
  openDeals,
  onCreated,
}: NewDealButtonProps) {
  const t = useTranslations("Inbox.newDeal");
  const [pipelines, setPipelines] = useState<PipelineOption[] | null>(null);
  const [chosen, setChosen] = useState<{ pipeline: PipelineOption; stages: PipelineStage[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<DealPrefill | null>(null);
  const [ai, setAi] = useState<AiState>({ kind: "idle" });
  // Only the latest AI request may fill the form — a slow answer for a
  // closed sheet or an earlier click is dropped.
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("pipelines")
      .select("id, name")
      .order("created_at")
      .then(({ data }) => {
        if (!cancelled) setPipelines((data as PipelineOption[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const askAi = useCallback(
    async (pipelineId: string, replace: boolean) => {
      if (!conversationId) {
        setAi({ kind: "off", message: t("aiNoConversation") });
        return;
      }
      const seq = ++requestSeq.current;
      setAi({ kind: "loading" });
      try {
        const res = await fetch("/api/ai/deal-suggestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId, pipeline_id: pipelineId }),
        });
        const json = await res.json().catch(() => ({}));
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          if (json?.code === "ai_not_configured") {
            setAi({ kind: "off", message: t("aiOff") });
          } else if (json?.code === "no_messages") {
            setAi({ kind: "off", message: t("aiNoMessages") });
          } else {
            setAi({ kind: "error", message: json?.error ?? t("aiError") });
          }
          return;
        }
        const s = json.suggestion as DealSuggestion;
        setPrefill({
          title: s.title || undefined,
          value: s.value,
          stage_id: s.stage_id,
          expected_close_date: s.expected_close_date,
          notes: s.notes || undefined,
          replace,
        });
        setAi({ kind: "done" });
      } catch {
        if (seq === requestSeq.current) setAi({ kind: "error", message: t("aiError") });
      }
    },
    [conversationId, t],
  );

  const start = useCallback(
    async (pipeline: PipelineOption) => {
      const { data } = await createClient()
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipeline.id)
        .order("position");
      const stages = (data as PipelineStage[] | null) ?? [];
      if (stages.length === 0) {
        toast.error(t("noStages"));
        return;
      }
      setChosen({ pipeline, stages });
      setPrefill({
        contact_id: contact.id,
        title: contact.name || contact.phone || "",
      });
      setOpen(true);
      void askAi(pipeline.id, false);
    },
    [askAi, contact.id, contact.name, contact.phone, t],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      requestSeq.current++;
      setAi({ kind: "idle" });
    }
  }, []);

  const triggerClass =
    "ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium normal-case tracking-normal text-primary transition-colors hover:bg-primary/10 disabled:opacity-50";

  let trigger: React.ReactNode;
  if (!pipelines || pipelines.length <= 1) {
    trigger = (
      <button
        type="button"
        className={triggerClass}
        disabled={pipelines === null}
        onClick={() => {
          if (pipelines && pipelines.length === 1) void start(pipelines[0]);
          else toast.error(t("noPipelines"));
        }}
      >
        <Plus className="h-3 w-3" />
        {t("button")}
      </button>
    );
  } else {
    trigger = (
      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClass}>
          <Plus className="h-3 w-3" />
          {t("button")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 border-border bg-popover">
          <DropdownMenuLabel>{t("choosePipeline")}</DropdownMenuLabel>
          {pipelines.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => void start(p)}
              className="text-sm text-popover-foreground"
            >
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const header = chosen ? (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("pipeline", { name: chosen.pipeline.name })}
      </p>

      {openDeals.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("duplicate", { count: openDeals.length })}
            </p>
            <p className="truncate text-muted-foreground">
              {openDeals
                .map((d) => (d.stage?.name ? `${d.title} (${d.stage.name})` : d.title))
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {ai.kind === "loading" && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          {t("aiLoading")}
        </div>
      )}
      {ai.kind === "done" && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{t("aiDone")}</span>
          <button
            type="button"
            onClick={() => void askAi(chosen.pipeline.id, true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10"
          >
            <RefreshCw className="h-3 w-3" />
            {t("aiRefill")}
          </button>
        </div>
      )}
      {ai.kind === "off" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{ai.message}</p>
      )}
      {ai.kind === "error" && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-foreground">{ai.message}</span>
          <button
            type="button"
            onClick={() => void askAi(chosen.pipeline.id, false)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10"
          >
            <RefreshCw className="h-3 w-3" />
            {t("aiRetry")}
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      {trigger}
      {chosen && (
        <DealForm
          open={open}
          onOpenChange={handleOpenChange}
          deal={null}
          pipelineId={chosen.pipeline.id}
          stages={chosen.stages}
          onSaved={onCreated}
          prefill={prefill}
          conversationId={conversationId}
          headerSlot={header}
        />
      )}
    </>
  );
}
