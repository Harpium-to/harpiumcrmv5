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
// The tabs are numbered in the order a quiz is built (questions,
// results, look, sharing); the report sits apart, after a divider,
// because it is something to read, not a step to do. Admins edit;
// everyone else in the CRM gets the report and the link.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
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
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

interface TabDef {
  value: TabId;
  label: string;
  /** What the step is for, under its name. */
  hint: string;
  icon: ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

/** The steps of building a quiz, in order. */
const BUILD_TABS: TabDef[] = [
  { value: "steps", label: "Perguntas", hint: "as telas do quiz", icon: ListChecks, adminOnly: true },
  { value: "results", label: "Resultados", hint: "o final e as regras", icon: Trophy, adminOnly: true },
  { value: "look", label: "Aparência", hint: "logo e cor", icon: Palette, adminOnly: true },
  { value: "share", label: "Divulgação", hint: "link, Pixel e leads", icon: Share2 },
];
const REPORT_TAB: TabDef = { value: "report", label: "Relatório", hint: "visitas e leads", icon: ChartColumn };

/** The tabs that edit what the visitor sees, and so sit beside the preview. */
const WITH_PREVIEW: TabId[] = ["steps", "results", "look"];

function tabFromUrl(allowed: TabId[], fallback: TabId): TabId {
  if (typeof window === "undefined") return fallback;
  const tab = new URLSearchParams(window.location.search).get("tab") as TabId | null;
  return tab && allowed.includes(tab) ? tab : fallback;
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
  const buildTabs = BUILD_TABS.filter((t) => canEdit || !t.adminOnly);
  const allowed: TabId[] = [...buildTabs.map((t) => t.value), REPORT_TAB.value];
  const fallback: TabId = canEdit ? "steps" : "report";
  const activeTab = allowed.includes(tab) ? tab : fallback;

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
    setTab(tabFromUrl(allowed, fallback));
    // Only on mount and when the role resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const selectTab = (value: TabId) => {
    setTab(value);
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        <p className="mt-1.5 text-sm text-muted-foreground">Ele pode ter sido apagado, ou pertence a outro CRM.</p>
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
  const issues = problems.length > 0 ? problems : quiz.check.errors;

  return (
    <div className="space-y-5">
      {/* ---- Title and actions ---- */}
      <div>
        <Link
          href="/ferramentas/quiz"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Quiz e formulários
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
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
              title={canEdit ? "Clique para renomear" : undefined}
              className="display-sm -ml-1.5 w-full truncate rounded-lg bg-transparent px-1.5 text-foreground outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:hover:bg-transparent"
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <StatusBadge status={quiz.status} />
              {quiz.unpublishedChanges && saveState === "saved" ? (
                <span className="text-amber-600 dark:text-amber-400">Há alterações ainda não publicadas</span>
              ) : null}
              {canEdit ? <SaveIndicator state={saveState} onRetry={() => void saveDraft()} /> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quiz.status === "published" ? (
              <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                <ExternalLink />
                Abrir
              </a>
            ) : null}
            {canEdit && quiz.status === "published" ? (
              <Button
                type="button"
                variant="outline"
                disabled={acting !== null}
                onClick={() => void act("pause", { action: "pause" }, "Quiz pausado. O link saiu do ar.")}
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

      {canEdit ? (
        <Readiness errors={issues} warnings={quiz.check.warnings} rejected={problems.length > 0} />
      ) : null}

      {/* ---- Tabs: the build steps, then the report ---- */}
      <nav
        aria-label="Partes do quiz"
        className="surface flex max-w-full items-stretch gap-1 overflow-x-auto rounded-2xl p-1.5 [scrollbar-width:none]"
      >
        {buildTabs.map((t, i) => (
          <TabButton
            key={t.value}
            tab={t}
            number={canEdit ? i + 1 : undefined}
            active={activeTab === t.value}
            onClick={() => selectTab(t.value)}
          />
        ))}
        <span aria-hidden className="mx-1 my-2 w-px shrink-0 bg-border" />
        <TabButton tab={REPORT_TAB} active={activeTab === "report"} onClick={() => selectTab("report")} />
      </nav>

      {WITH_PREVIEW.includes(activeTab) ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0">
            {activeTab === "steps" ? (
              <StepsTab
                draft={draft}
                update={update}
                canEdit={canEdit}
                onFocus={setPreview}
                onGoToResults={() => selectTab("results")}
              />
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

function TabButton({
  tab,
  number,
  active,
  onClick,
}: {
  tab: TabDef;
  number?: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors sm:flex-1",
        active ? "surface-on" : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          active ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-foreground/70",
        )}
      >
        {number ?? <Icon className="size-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{tab.label}</span>
        <span className={cn("hidden truncate text-[11px] md:block", active ? "opacity-75" : "opacity-70")}>
          {tab.hint}
        </span>
      </span>
    </button>
  );
}

/**
 * Whether the quiz can be published, in one line, opening into the list
 * of what is missing. Errors block Publicar; warnings only advise.
 */
function Readiness({ errors, warnings, rejected }: { errors: string[]; warnings: string[]; rejected: boolean }) {
  // Opens by itself when a publish was refused, until the person toggles it.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? rejected;

  const blocking = errors.length > 0;
  const items = blocking ? errors : warnings;
  const tone = blocking ? "error" : warnings.length > 0 ? "warning" : "ok";

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-2.5",
        tone === "error" && "border-red-500/30 bg-red-500/8",
        tone === "warning" && "border-amber-500/30 bg-amber-500/8",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/8",
      )}
      role={blocking ? "alert" : "status"}
    >
      <button
        type="button"
        disabled={items.length === 0}
        aria-expanded={open}
        onClick={() => setChoice(!open)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-foreground disabled:cursor-default"
      >
        {tone === "error" ? <AlertTriangle className="size-4 shrink-0 text-red-500" /> : null}
        {tone === "warning" ? <CircleAlert className="size-4 shrink-0 text-amber-500" /> : null}
        {tone === "ok" ? <CircleCheck className="size-4 shrink-0 text-emerald-500" /> : null}
        <span className="flex-1">
          {tone === "error"
            ? `${errors.length} ${errors.length === 1 ? "ajuste" : "ajustes"} antes de publicar`
            : tone === "warning"
              ? `Pronto para publicar · ${warnings.length} ${warnings.length === 1 ? "ponto" : "pontos"} para conferir`
              : "Pronto para publicar"}
        </span>
        {items.length > 0 ? (
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            {open ? "Esconder" : "Ver"}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </span>
        ) : null}
      </button>
      {open && items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
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
