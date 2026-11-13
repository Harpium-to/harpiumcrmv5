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
import { ChevronLeft, Copy, CopyPlus, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";

import { useCan } from "@/hooks/use-can";
import { publicQuizUrl } from "@/lib/quiz/slug";
import type { QuizStatus } from "@/lib/quiz/types";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DisplayHeading } from "@/components/ui/display-heading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface QuizItem {
  id: string;
  name: string;
  slug: string;
  status: QuizStatus;
  unpublishedChanges: boolean;
  totals: { visits: number; started: number; completed: number; leads: number };
}

interface ModelOption {
  /** "model:<key>" for a built-in one, "agency:<id>" for the agency's. */
  value: string;
  name: string;
  description: string | null;
  fromAgency: boolean;
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
  const [models, setModels] = useState<ModelOption[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quiz");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar os quizzes");
      setPending(json.available === false ? json.error : null);
      setQuizzes(json.quizzes ?? []);
      const builtIn = ((json.models ?? []) as { key: string; name: string; description: string }[]).map(
        (m): ModelOption => ({
          value: `model:${m.key}`,
          name: m.name,
          description: m.description,
          fromAgency: false,
        }),
      );
      const agency = ((json.agencyModels ?? []) as { id: string; name: string; description: string | null }[]).map(
        (m): ModelOption => ({
          value: `agency:${m.id}`,
          name: m.name,
          description: m.description,
          fromAgency: true,
        }),
      );
      setModels([...agency, ...builtIn]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar os quizzes");
      setQuizzes([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDialog = () => {
    setName("");
    setModel(models[0]?.value ?? "model:em-branco");
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

  const create = () => {
    const [kind, id] = model.split(":");
    void post(
      kind === "agency" ? { name, agencyModelId: id } : { name, model: id },
      "create",
    );
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

  const chosen = models.find((m) => m.value === model);

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
        <p className="surface rounded-2xl px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          {pending}
        </p>
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
              Crie um quiz ou um formulário, divulgue o link e receba os leads aqui no CRM, com
              as respostas de cada pessoa.
            </p>
            {canManage ? (
              <Button type="button" className="mt-6" onClick={openDialog}>
                <Plus />
                Criar o primeiro
              </Button>
            ) : (
              <p className="mt-5 text-xs text-muted-foreground">
                Só administradores criam quizzes.
              </p>
            )}
          </div>
        )
      ) : (
        <ul className="grid gap-3">
          {quizzes.map((quiz) => (
            <li
              key={quiz.id}
              className="surface flex flex-wrap items-center gap-x-6 gap-y-4 rounded-3xl p-5"
            >
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    href={`/ferramentas/quiz/${quiz.id}`}
                    className="truncate text-base font-medium text-foreground hover:underline"
                  >
                    {quiz.name}
                  </Link>
                  <StatusBadge status={quiz.status} />
                  {quiz.unpublishedChanges ? (
                    <span className="text-xs text-muted-foreground">
                      alterações não publicadas
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  /q/{quiz.slug}
                </p>
              </div>

              <dl className="flex gap-7 text-sm tabular-nums">
                <Stat label="Visitas" value={quiz.totals.visits} />
                <Stat label="Leads" value={quiz.totals.leads} />
                <Stat
                  label="Conclusão"
                  value={percent(quiz.totals.completed, quiz.totals.visits)}
                />
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
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Novo quiz</DialogTitle>
            <DialogDescription>
              Escolha por onde começar. Tudo pode ser mudado depois, e nada vai ao ar antes de
              você publicar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1">
            {models.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setModel(m.value)}
                aria-pressed={model === m.value}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-colors",
                  model === m.value
                    ? "border-primary bg-primary-soft"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {m.name}
                  {m.fromAgency ? (
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                      modelo da agência
                    </span>
                  ) : null}
                </span>
                {m.description ? (
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {m.description}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-name">Nome do quiz</Label>
            <Input
              id="quiz-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={chosen && chosen.value !== "model:em-branco" ? chosen.name : "Ex.: Diagnóstico gratuito"}
              maxLength={120}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Só a equipe vê. É também a origem com que os leads chegam no CRM.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={create}
              disabled={busy !== null || (!name.trim() && model === "model:em-branco")}
            >
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
              Criar quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
