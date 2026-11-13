"use client";

// ============================================================
// One quiz, edited: the frame around the tabs.
//
// The draft lives here. Every tab changes it through `update`, and it
// is saved by itself a moment after the last change — safe, because a
// draft is not what the public link serves. Publicar copies the draft
// to the live definition; until then visitors keep seeing the last
// published version.
//
// Admins edit. Everyone else in the CRM gets the tabs that only show
// (report, link), with the fields locked.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChartColumn,
  Check,
  ChevronLeft,
  CircleAlert,
  ExternalLink,
  ListChecks,
  Loader2,
  Palette,
  Pause,
  Play,
  Rocket,
  Share2,
  Smartphone,
  Trophy,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { publicQuizUrl } from "@/lib/quiz/slug";
import type { QuizDefinition, QuizStatus } from "@/lib/quiz/types";
import type { DefinitionCheck } from "@/lib/quiz/validate";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PillNav, type PillItem } from "@/components/ui/pill-nav";

import { AppearanceTab } from "./editor/appearance-tab";
import { QuizPreview } from "./editor/preview";
import { ReportTab } from "./editor/report-tab";
import { ResultsTab } from "./editor/results-tab";
import { ShareTab } from "./editor/share-tab";
import { StepsTab } from "./editor/steps-tab";
import type { DraftUpdater, PreviewTarget } from "./editor/ui";
import { StatusBadge } from "./quiz-list";

interface EditorQuiz {
  id: string;
  name: string;
  slug: string;
  status: QuizStatus;
  publishedAt: string | null;
  unpublishedChanges: boolean;
  check: DefinitionCheck;
  hasCapiToken: boolean;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

/** How long after the last change the draft is saved. */
const AUTOSAVE_MS = 1200;

type TabId = "steps" | "results" | "look" | "share" | "report";

const TABS: (PillItem & { value: TabId; adminOnly?: boolean })[] = [
  { value: "steps", label: "Perguntas", icon: ListChecks, adminOnly: true },
  { value: "results", label: "Resultados", icon: Trophy, adminOnly: true },
  { value: "look", label: "Aparência", icon: Palette, adminOnly: true },
  { value: "share", label: "Divulgação", icon: Share2 },
  { value: "report", label: "Relatório", icon: ChartColumn },
];

/** The tabs that edit what the visitor sees, and so sit beside the preview. */
const WITH_PREVIEW: TabId[] = ["steps", "results", "look"];

function tabFromUrl(allowed: TabId[]): TabId {
  if (typeof window === "undefined") return allowed[0];
  const tab = new URLSearchParams(window.location.search).get("tab") as TabId | null;
  return tab && allowed.includes(tab) ? tab : allowed[0];
}

export function QuizEditor({ id }: { id: string }) {
  const canEdit = useCan("edit-settings");
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [draft, setDraft] = useState<QuizDefinition | null>(null);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [acting, setActing] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [isAgencia, setIsAgencia] = useState(false);
  const [tab, setTab] = useState<TabId>("steps");
  const [preview, setPreview] = useState<PreviewTarget>({ kind: "intro" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const { account } = useAuth();

  // Who cannot edit lands on what they came for: the report.
  const tabs = canEdit
    ? TABS
    : TABS.filter((t) => !t.adminOnly).reverse();
  const allowed = tabs.map((t) => t.value);
  const activeTab = allowed.includes(tab) ? tab : allowed[0];

  // The newest draft, for the save that is about to go out.
  const latest = useRef<QuizDefinition | null>(null);
  const version = useRef(0);

  const adopt = useCallback((json: { quiz: EditorQuiz & { draft: QuizDefinition } }) => {
    const { draft: _serverDraft, ...meta } = json.quiz;
    void _serverDraft;
    setQuiz(meta);
    return json.quiz;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quiz/${id}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setMissing(true);
        const loaded = adopt(await res.json());
        setDraft(loaded.draft);
        latest.current = loaded.draft;
        setName(loaded.name);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    fetch("/api/account/mine")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.isAgencia === true) setIsAgencia(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, adopt]);

  // Open on the tab the address names (?tab=report), once.
  useEffect(() => {
    setTab(tabFromUrl(allowed));
    // Only on mount and when the role resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const selectTab = (value: string) => {
    setTab(value as TabId);
    // The preview follows the tab: a result screen on Resultados, a
    // question (or the entry) everywhere else. A test run is left alone.
    setPreview((now) => {
      if (now.kind === "run" || !draft) return now;
      if (value === "results") {
        return now.kind === "result" ? now : { kind: "result", id: draft.defaultResultId };
      }
      return now.kind === "result" ? { kind: "intro" } : now;
    });
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  };

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/quiz/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(json.error ?? "Não consegui salvar") as Error & {
          problems?: string[];
        };
        error.problems = json.problems;
        throw error;
      }
      return adopt(json);
    },
    [id, adopt],
  );

  const update: DraftUpdater = useCallback((change) => {
    setDraft((now) => {
      if (!now) return now;
      const next = change(now);
      latest.current = next;
      version.current += 1;
      return next;
    });
    setSaveState("dirty");
  }, []);

  /** Save the draft as it is now. False when the save failed. */
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!latest.current) return true;
    const sent = version.current;
    setSaveState("saving");
    try {
      await patch({ draft: latest.current });
      // A change made while this was in flight still needs its own save.
      setSaveState(version.current === sent ? "saved" : "dirty");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, [patch]);

  useEffect(() => {
    if (saveState !== "dirty" || !canEdit) return;
    const timer = window.setTimeout(() => void saveDraft(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [saveState, draft, canEdit, saveDraft]);

  // Leaving with a change that has not reached the server yet.
  useEffect(() => {
    if (saveState === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setActing(key);
    setProblems([]);
    try {
      await patch(body);
      if (body.draft) setSaveState("saved");
      toast.success(done);
    } catch (err) {
      const failure = err as Error & { problems?: string[] };
      if (failure.problems?.length) setProblems(failure.problems);
      toast.error(failure.message);
    } finally {
      setActing(null);
    }
  };

  const saveName = async () => {
    const clean = name.trim();
    if (!quiz || !clean || clean === quiz.name) return setName(quiz?.name ?? "");
    try {
      await patch({ name: clean });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui renomear");
      setName(quiz.name);
    }
  };

  if (missing) {
    return (
      <div className="surface mx-auto mt-10 max-w-md rounded-3xl p-8 text-center">
        <p className="text-base font-medium text-foreground">Quiz não encontrado</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Ele pode ter sido apagado, ou pertence a outro CRM.
        </p>
        <Link href="/ferramentas/quiz" className={buttonVariants({ className: "mt-5" })}>
          Ver os quizzes
        </Link>
      </div>
    );
  }

  if (!quiz || !draft) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const url = publicQuizUrl(window.location.origin, quiz.slug);
  const neverPublished = quiz.publishedAt === null;
  const canPublish = neverPublished || quiz.unpublishedChanges || saveState !== "saved";
  const shown = problems.length > 0 ? problems : quiz.check.errors;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/ferramentas/quiz"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Quiz e formulários
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-72">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              disabled={!canEdit}
              maxLength={120}
              aria-label="Nome do quiz"
              className="display-sm w-full truncate rounded-lg bg-transparent text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <StatusBadge status={quiz.status} />
              {quiz.unpublishedChanges && saveState === "saved" ? (
                <span>Há alterações que ainda não foram publicadas</span>
              ) : null}
              {canEdit ? <SaveIndicator state={saveState} onRetry={() => void saveDraft()} /> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quiz.status === "published" ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                <ExternalLink />
                Abrir
              </a>
            ) : null}
            {canEdit && quiz.status === "published" ? (
              <Button
                type="button"
                variant="outline"
                disabled={acting !== null}
                onClick={() =>
                  void act("pause", { action: "pause" }, "Quiz pausado. O link saiu do ar.")
                }
              >
                {acting === "pause" ? <Loader2 className="animate-spin" /> : <Pause />}
                Pausar
              </Button>
            ) : null}
            {canEdit && quiz.status === "paused" ? (
              <Button
                type="button"
                variant="outline"
                disabled={acting !== null}
                onClick={() => void act("resume", { action: "resume" }, "Quiz de volta ao ar")}
              >
                {acting === "resume" ? <Loader2 className="animate-spin" /> : <Play />}
                Retomar
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                type="button"
                disabled={acting !== null || !canPublish}
                title={canPublish ? undefined : "O que está no ar já é a versão mais recente"}
                onClick={() =>
                  void act(
                    "publish",
                    { draft: latest.current, action: "publish" },
                    neverPublished ? "Quiz publicado. O link já funciona." : "Alterações publicadas",
                  )
                }
              >
                {acting === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />}
                {neverPublished ? "Publicar" : "Publicar alterações"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {canEdit && shown.length > 0 ? (
        <Notice
          tone="error"
          title={problems.length > 0 ? "Ainda falta ajustar antes de publicar" : "Falta para publicar"}
          items={shown}
        />
      ) : null}
      {canEdit && shown.length === 0 && quiz.check.warnings.length > 0 ? (
        <Notice tone="warning" title="Vale conferir" items={quiz.check.warnings} />
      ) : null}

      {tabs.length > 1 ? (
        <PillNav
          items={tabs}
          value={activeTab}
          onChange={selectTab}
          ariaLabel="Partes do quiz"
          className="max-w-full overflow-x-auto"
        />
      ) : null}

      {WITH_PREVIEW.includes(activeTab) ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0">
            {activeTab === "steps" ? (
              <StepsTab draft={draft} update={update} canEdit={canEdit} onFocus={setPreview} />
            ) : activeTab === "results" ? (
              <ResultsTab draft={draft} update={update} canEdit={canEdit} onFocus={setPreview} />
            ) : (
              <AppearanceTab draft={draft} update={update} canEdit={canEdit} />
            )}
          </div>
          {/* Beside the editor on a wide screen; behind a button on a narrow one. */}
          <div className="sticky top-24 hidden xl:block">
            <QuizPreview
              definition={draft}
              business={account?.name ?? ""}
              target={preview}
              onTarget={setPreview}
            />
          </div>
          <Button
            type="button"
            size="lg"
            onClick={() => setPreviewOpen(true)}
            className="fixed right-4 bottom-4 z-30 shadow-lg xl:hidden"
          >
            <Smartphone />
            Ver prévia
          </Button>
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Prévia</DialogTitle>
              </DialogHeader>
              {previewOpen ? (
                <QuizPreview
                  definition={draft}
                  business={account?.name ?? ""}
                  target={preview}
                  onTarget={setPreview}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {activeTab === "report" ? <ReportTab quizId={quiz.id} /> : null}

      {activeTab === "share" ? (
        <ShareTab
          draft={draft}
          update={update}
          canEdit={canEdit}
          quiz={quiz}
          isAgencia={isAgencia}
          onSaveSlug={async (slug) => {
            await patch({ slug });
          }}
          onSaveCapiToken={async (capiToken) => {
            await patch({ capiToken });
          }}
        />
      ) : null}
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> Salvando…
      </span>
    );
  }
  if (state === "dirty") return <span>Alterações por salvar…</span>;
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-red-500 underline underline-offset-2"
      >
        <CircleAlert className="size-3" /> Não salvou. Tentar de novo
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Check className="size-3" /> Rascunho salvo
    </span>
  );
}

function Notice({
  tone,
  title,
  items,
}: {
  tone: "error" | "warning";
  title: string;
  items: string[];
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-2xl border border-red-500/30 bg-red-500/8 px-4 py-3"
          : "rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3"
      }
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle
          className={tone === "error" ? "size-4 text-red-500" : "size-4 text-amber-500"}
        />
        {title}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-9 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
