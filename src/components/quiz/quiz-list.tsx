"use client";

// ============================================================
// Ferramentas › Quiz e formulários: the CRM's quizzes, with the
// numbers that say how each one is doing, and "Novo quiz".
//
// Everyone in the CRM sees the list; only admins create, duplicate and
// delete (the API enforces it — the buttons just follow).
// ============================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, CopyPlus, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";

import { useCan } from "@/hooks/use-can";
import type { QuizModelSummary } from "@/lib/quiz/model-meta";
import { publicQuizUrl } from "@/lib/quiz/slug";
import type { QuizStatus } from "@/lib/quiz/types";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { DisplayHeading } from "@/components/ui/display-heading";

import { NewQuizDialog, type AgencyModelOption } from "./new-quiz-dialog";

interface QuizItem {
  id: string;
  name: string;
  slug: string;
  status: QuizStatus;
  unpublishedChanges: boolean;
  totals: { visits: number; started: number; completed: number; leads: number };
}

export const STATUS_LABEL: Record<QuizStatus, string> = {
  draft: "Rascunho",
  published: "No ar",
  paused: "Pausado",
};

export function StatusBadge({ status }: { status: QuizStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "published" && "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        status === "paused" && "bg-amber-500/12 text-amber-600 dark:text-amber-400",
        status === "draft" && "bg-foreground/8 text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "published" && "bg-emerald-500",
          status === "paused" && "bg-amber-500",
          status === "draft" && "bg-muted-foreground",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

export function QuizList() {
  const router = useRouter();
  const canManage = useCan("edit-settings");
  const [quizzes, setQuizzes] = useState<QuizItem[] | null>(null);
  const [models, setModels] = useState<QuizModelSummary[]>([]);
  const [agencyModels, setAgencyModels] = useState<AgencyModelOption[]>([]);
  const [niche, setNiche] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quiz");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar os quizzes");
      setPending(json.available === false ? json.error : null);
      setQuizzes(json.quizzes ?? []);
      setModels(json.models ?? []);
      setAgencyModels(json.agencyModels ?? []);
      setNiche(typeof json.niche === "string" ? json.niche : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar os quizzes");
      setQuizzes([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDialog = () => {
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao criar o quiz");
      router.push(`/ferramentas/quiz/${json.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar o quiz");
      setBusy(null);
    }
  };

  const remove = async (quiz: QuizItem) => {
    const warning =
      quiz.totals.visits > 0
        ? `Apagar "${quiz.name}"? O link para de funcionar e o relatório das ${quiz.totals.visits} visitas é apagado junto. Os contatos e leads que já estão no CRM ficam.`
        : `Apagar "${quiz.name}"? O link para de funcionar.`;
    if (!window.confirm(warning)) return;
    setBusy(quiz.id);
    try {
      const res = await fetch(`/api/quiz/${quiz.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao apagar");
      toast.success(`"${quiz.name}" apagado`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao apagar");
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (quiz: QuizItem) => {
    try {
      await navigator.clipboard.writeText(publicQuizUrl(window.location.origin, quiz.slug));
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar. Copie pelo endereço do quiz.");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/ferramentas"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Ferramentas
        </Link>
        <DisplayHeading title="Quiz" subtitle="e formulários">
          {canManage && !pending ? (
            <Button type="button" size="lg" onClick={openDialog}>
              <Plus />
              Novo quiz
            </Button>
          ) : null}
        </DisplayHeading>
      </div>

      {pending ? (
        <p className="surface rounded-2xl px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{pending}</p>
      ) : null}

      {quizzes === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : quizzes.length === 0 ? (
        !pending && (
          <div className="surface rounded-3xl px-6 py-14 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <ListChecks className="size-6" />
            </span>
            <h2 className="mt-5 text-lg font-medium text-foreground">Nenhum quiz ainda</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Comece por um dos {models.length} modelos prontos (clínicas, academias, imobiliárias, cursos e
              outros), divulgue o link e receba os leads aqui no CRM.
            </p>
            {canManage ? (
              <Button type="button" className="mt-6" onClick={openDialog}>
                <Plus />
                Escolher um modelo
              </Button>
            ) : (
              <p className="mt-5 text-xs text-muted-foreground">Só administradores criam quizzes.</p>
            )}
          </div>
        )
      ) : (
        <ul className="grid gap-3">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="surface flex flex-wrap items-center gap-x-6 gap-y-4 rounded-3xl p-5">
              <Link href={`/ferramentas/quiz/${quiz.id}`} className="group flex min-w-0 flex-1 basis-64 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <ListChecks className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-medium text-foreground group-hover:underline">
                      {quiz.name}
                    </span>
                    <StatusBadge status={quiz.status} />
                    {quiz.unpublishedChanges ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">alterações não publicadas</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">/q/{quiz.slug}</span>
                </span>
              </Link>

              <dl className="flex gap-7 text-sm tabular-nums">
                <Stat label="Visitas" value={quiz.totals.visits} />
                <Stat label="Leads" value={quiz.totals.leads} />
                <Stat label="Conclusão" value={percent(quiz.totals.completed, quiz.totals.visits)} />
              </dl>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyLink(quiz)}
                  disabled={quiz.status !== "published"}
                  title={quiz.status === "published" ? "Copiar o link público" : "Publique para ter o link"}
                >
                  <Copy />
                  Link
                </Button>
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy !== null}
                      onClick={() => void post({ duplicateOf: quiz.id }, quiz.id)}
                      aria-label={`Duplicar ${quiz.name}`}
                      title="Duplicar"
                    >
                      {busy === quiz.id ? <Loader2 className="animate-spin" /> : <CopyPlus />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy !== null}
                      onClick={() => void remove(quiz)}
                      aria-label={`Apagar ${quiz.name}`}
                      title="Apagar"
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : null}
                <Link
                  href={`/ferramentas/quiz/${quiz.id}`}
                  aria-label={`Abrir ${quiz.name}`}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                >
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewQuizDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        models={models}
        agencyModels={agencyModels}
        niche={niche}
        busy={busy === "create"}
        onCreate={(body) => void post(body, "create")}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-medium text-foreground">{value}</dd>
    </div>
  );
}
