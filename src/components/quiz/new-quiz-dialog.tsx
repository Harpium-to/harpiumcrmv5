"use client";

// ============================================================
// "Novo quiz": pick a model, name the quiz, create it.
//
// The list on the left is grouped — the model for this CRM's niche
// first, then the agency's own models, the niche models, the general
// ones and, last, the one Harpium uses for itself. The panel on the
// right says what the chosen model brings (how many screens, which
// results) before anything is created.
// ============================================================

import { useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";

import { MODEL_GROUP_LABEL, type QuizModelSummary } from "@/lib/quiz/model-meta";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { RouteBadge } from "./editor/ui";
import { ModelIcon } from "./model-icon";

export interface AgencyModelOption {
  id: string;
  name: string;
  description: string | null;
}

interface Option {
  /** "model:<key>" or "agency:<id>". */
  value: string;
  title: string;
  subtitle: string;
  description: string | null;
  icon: QuizModelSummary["icon"] | "agency";
  /** The quiz's name when created from it. */
  quizName: string;
  summary: QuizModelSummary | null;
}

interface Group {
  label: string;
  options: Option[];
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function fromModel(m: QuizModelSummary): Option {
  return {
    value: `model:${m.key}`,
    title: m.segment ?? m.name,
    subtitle: m.segment ? m.name : `${m.questions} ${m.questions === 1 ? "tela" : "telas"}`,
    description: m.description,
    icon: m.icon,
    quizName: m.key === "em-branco" ? "" : m.name,
    summary: m,
  };
}

function buildGroups(
  models: QuizModelSummary[],
  agencyModels: AgencyModelOption[],
  niche: string | null,
): Group[] {
  const suggested = niche ? models.filter((m) => m.niche === niche) : [];
  const rest = models.filter((m) => !suggested.includes(m));
  const groups: Group[] = [];
  if (suggested.length) groups.push({ label: "Sugeridos para este CRM", options: suggested.map(fromModel) });
  if (agencyModels.length) {
    groups.push({
      label: "Modelos da agência",
      options: agencyModels.map((a) => ({
        value: `agency:${a.id}`,
        title: a.name,
        subtitle: "Modelo da agência",
        description: a.description,
        icon: "agency",
        quizName: a.name,
        summary: null,
      })),
    });
  }
  for (const group of ["nicho", "geral", "interno"] as const) {
    const options = rest.filter((m) => m.group === group).map(fromModel);
    if (options.length) groups.push({ label: MODEL_GROUP_LABEL[group], options });
  }
  return groups;
}

export function NewQuizDialog({
  open,
  onOpenChange,
  models,
  agencyModels,
  niche,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: QuizModelSummary[];
  agencyModels: AgencyModelOption[];
  niche: string | null;
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const groups = useMemo(() => buildGroups(models, agencyModels, niche), [models, agencyModels, niche]);
  const all = groups.flatMap((g) => g.options);
  const [chosen, setChosen] = useState<string>("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");

  const selected = all.find((o) => o.value === chosen) ?? all[0];
  const q = fold(query.trim());
  const visible = groups
    .map((g) => ({
      ...g,
      options: q
        ? g.options.filter((o) => fold(`${o.title} ${o.subtitle} ${o.description ?? ""}`).includes(q))
        : g.options,
    }))
    .filter((g) => g.options.length > 0);

  const create = () => {
    if (!selected) return;
    const [kind, id] = selected.value.split(":");
    onCreate(kind === "agency" ? { name, agencyModelId: id } : { name, model: id });
  };
  const needsName = !name.trim() && !selected?.quizName;

  return (
    // The parent remounts this (a new key) each time it opens, so every
    // opening starts with no search, no name and the first model chosen.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
          <DialogTitle className="text-lg">Novo quiz</DialogTitle>
          <DialogDescription>
            Escolha um modelo pronto. Tudo pode ser mudado depois, e nada vai ao ar antes de você publicar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_19rem]">
          {/* ---- The models ---- */}
          <div className="flex min-h-0 flex-col border-border md:border-r">
            <div className="relative px-4 pt-4">
              <Search className="pointer-events-none absolute top-1/2 left-7 mt-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar modelo (ex.: clínica, imóvel, cupom)"
                aria-label="Buscar modelo"
                className="pl-9"
              />
            </div>
            <div className="max-h-[52vh] space-y-5 overflow-y-auto px-4 py-4 md:max-h-[58vh]">
              {visible.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum modelo com essa busca.</p>
              ) : null}
              {visible.map((group) => (
                <section key={group.label}>
                  <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {group.label}
                  </h3>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {group.options.map((option) => {
                      const on = selected?.value === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setChosen(option.value)}
                          aria-pressed={on}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                            on
                              ? "border-primary bg-primary-soft ring-1 ring-primary/40"
                              : "border-border hover:border-foreground/30 hover:bg-foreground/4",
                          )}
                        >
                          <ModelIcon icon={option.icon} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{option.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{option.subtitle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* ---- The chosen one ---- */}
          <div className="flex flex-col gap-4 border-t border-border bg-foreground/[0.02] px-5 py-5 md:border-t-0">
            {selected ? (
              <>
                <div className="flex items-start gap-3">
                  <ModelIcon icon={selected.icon} size="lg" />
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-foreground">{selected.title}</p>
                    <p className="text-sm text-muted-foreground">{selected.subtitle}</p>
                  </div>
                </div>
                {selected.description ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">{selected.description}</p>
                ) : null}
                {selected.summary ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground/75">
                      {selected.summary.questions} {selected.summary.questions === 1 ? "tela" : "telas"} ·{" "}
                      {selected.summary.results.length}{" "}
                      {selected.summary.results.length === 1 ? "resultado" : "resultados"}
                    </p>
                    <ul className="space-y-1.5">
                      {selected.summary.results.map((r) => (
                        <li key={r.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <RouteBadge route={r.route} />
                          <span className="truncate">{r.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="mt-auto space-y-2 border-t border-border pt-4">
              <label htmlFor="quiz-name" className="block text-xs font-medium text-foreground/75">
                Nome do quiz
              </label>
              <Input
                id="quiz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selected?.quizName || "Ex.: Diagnóstico gratuito"}
                maxLength={120}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !needsName && !busy) create();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Só a equipe vê. É também a origem com que os leads chegam no CRM.
              </p>
              <Button type="button" className="w-full" onClick={create} disabled={busy || needsName || !selected}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                Criar quiz
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
