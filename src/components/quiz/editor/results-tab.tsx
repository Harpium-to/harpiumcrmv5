"use client";

// ============================================================
// Resultados: how a visit ends. Three parts, each behind its own
// sub-tab so they never blur into one long page:
//
//   Telas de resultado   what the person sees, coloured by the route
//                        it gives the lead (qualified, warm, not a fit);
//   Regras               "SE … ENTÃO …" sentences, read top to bottom,
//                        and the default for who matches none;
//   Etiquetas            the extra tags an answer earns in the CRM.
// ============================================================

import { useState, type ReactNode } from "react";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CopyPlus,
  Gift,
  Lightbulb,
  List,
  MessageCircle,
  MousePointerClick,
  Plus,
  Check,
  Split,
  Tag,
  Trash2,
  Trophy,
  X,
} from "lucide-react";

import {
  addResult,
  addRule,
  addTagRule,
  allChoices,
  BLOCK_KINDS,
  duplicateResult,
  moveItem,
  newBlock,
  removeResult,
  ROUTE_LABEL,
  updateResult,
} from "@/lib/quiz/builder";
import {
  RESULT_ICONS,
  type ChoiceStep,
  type QuizResult,
  type QuizRoute,
  type ResultBlock,
  type ResultIcon,
} from "@/lib/quiz/types";
import { cleanTag, LIMITS, newId } from "@/lib/quiz/validate";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { ConditionEditor, describeConditions } from "./condition-editor";
import {
  Field,
  FormRow,
  LogicWord,
  ROUTE_STYLE,
  RouteBadge,
  SelectBox,
  SubTabs,
  TagsInput,
  type PreviewTarget,
  type TabProps,
} from "./ui";

/** Kept here too: the report and older imports read it from this module. */
export { RouteBadge };

interface ResultsTabProps extends TabProps {
  onFocus: (target: PreviewTarget) => void;
}

type Part = "telas" | "regras" | "etiquetas";

const ICON_LABEL: Record<ResultIcon, string> = {
  check: "Confirmado",
  bulb: "Ideia",
  gift: "Presente",
  message: "Conversa",
};

const ICON: Record<ResultIcon, typeof Check> = {
  check: Check,
  bulb: Lightbulb,
  gift: Gift,
  message: MessageCircle,
};

/** Meta's standard events that make sense at the end of a quiz. */
const STANDARD_EVENTS = ["Lead", "CompleteRegistration", "Contact", "Schedule", "SubmitApplication", "ViewContent"];

const ROUTE_HINT: Record<QuizRoute, string> = {
  A: "Pronto para comprar",
  B: "Interessado, ainda não pronto",
  C: "Fora do perfil",
};

export function ResultsTab({ draft, update, canEdit, onFocus }: ResultsTabProps) {
  const [part, setPart] = useState<Part>("telas");
  const [open, setOpen] = useState<string | null>(null);
  const choices = allChoices(draft);

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) onFocus({ kind: "result", id: next });
  };

  const openNew = (make: (id: string) => void) => {
    const id = newId("r");
    make(id);
    setOpen(id);
    onFocus({ kind: "result", id });
  };

  return (
    <div className="space-y-4">
      <HowItWorks />

      <SubTabs
        ariaLabel="Partes dos resultados"
        value={part}
        onChange={setPart}
        items={[
          { value: "telas", label: "Telas de resultado", count: draft.results.length, icon: Trophy },
          { value: "regras", label: "Regras", count: draft.rules.length, icon: Split },
          { value: "etiquetas", label: "Etiquetas por resposta", count: draft.tagRules.length, icon: Tag },
        ]}
      />

      {/* ---- Result screens ---- */}
      {part === "telas" ? (
        <div className="space-y-3">
          {draft.results.map((result) => (
            <ResultCard
              key={result.id}
              result={result}
              isDefault={result.id === draft.defaultResultId}
              open={open === result.id}
              onToggle={() => toggle(result.id)}
            >
              <ResultEditor
                result={result}
                choices={choices}
                canEdit={canEdit}
                onChange={(change) => update((d) => updateResult(d, result.id, change))}
              />
              {canEdit ? (
                <div className="flex flex-wrap justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openNew((id) =>
                        update((d) => {
                          const copy = duplicateResult(d, result.id);
                          if (!copy) return d;
                          return {
                            ...copy.def,
                            results: copy.def.results.map((r) => (r.id === copy.id ? { ...r, id } : r)),
                          };
                        }),
                      )
                    }
                  >
                    <CopyPlus />
                    Duplicar
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={draft.results.length <= 1}
                    title={draft.results.length <= 1 ? "Um quiz precisa de pelo menos um resultado" : undefined}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Apagar o resultado "${result.name}"? As regras que levam a ele são removidas junto.`,
                        )
                      ) {
                        return;
                      }
                      update((d) => removeResult(d, result.id));
                      setOpen(null);
                    }}
                  >
                    <Trash2 />
                    Apagar resultado
                  </Button>
                </div>
              ) : null}
            </ResultCard>
          ))}

          {canEdit && draft.results.length < LIMITS.results ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-2xl border-dashed"
              onClick={() =>
                openNew((id) =>
                  update((d) => {
                    const made = addResult(d);
                    return {
                      ...made.def,
                      results: made.def.results.map((r) => (r.id === made.id ? { ...r, id } : r)),
                    };
                  }),
                )
              }
            >
              <Plus />
              Adicionar resultado
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ---- Rules ---- */}
      {part === "regras" ? (
        <div className="space-y-3">
          {draft.rules.length === 0 ? (
            <p className="surface rounded-2xl px-4 py-3 text-sm text-muted-foreground">
              Nenhuma regra ainda: todo mundo vê o resultado padrão, abaixo.
            </p>
          ) : null}

          {draft.rules.map((rule, index) => {
            const patch = (change: Partial<typeof rule>) =>
              update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === rule.id ? { ...r, ...change } : r)) }));
            const target = draft.results.find((r) => r.id === rule.resultId);
            return (
              <div
                key={rule.id}
                className={cn(
                  "surface rounded-2xl border-l-4 p-4",
                  target ? ROUTE_STYLE[target.route].border : "border-l-border",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Regra {index + 1}
                  </span>
                  {index === 0 ? (
                    <span className="text-xs text-muted-foreground">· lida primeiro</span>
                  ) : null}
                  {canEdit ? (
                    <span className="ml-auto flex items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={index === 0}
                        aria-label={`Subir a regra ${index + 1}`}
                        onClick={() => update((d) => ({ ...d, rules: moveItem(d.rules, index, index - 1) }))}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={index === draft.rules.length - 1}
                        aria-label={`Descer a regra ${index + 1}`}
                        onClick={() => update((d) => ({ ...d, rules: moveItem(d.rules, index, index + 1) }))}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Apagar a regra ${index + 1}`}
                        onClick={() => update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== rule.id) }))}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                  <LogicWord className="sm:justify-self-start">SE</LogicWord>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                      <SelectBox
                        className="w-44"
                        value={rule.match}
                        disabled={!canEdit}
                        aria-label={`Regra ${index + 1}: quantas condições`}
                        onChange={(e) => patch({ match: e.target.value === "all" ? "all" : "any" })}
                      >
                        <option value="any">qualquer uma</option>
                        <option value="all">todas</option>
                      </SelectBox>
                      <span className="text-muted-foreground">destas for verdade:</span>
                    </div>
                    <ConditionEditor
                      conditions={rule.conditions}
                      choices={choices}
                      match={rule.match}
                      disabled={!canEdit}
                      onChange={(conditions) => patch({ conditions })}
                    />
                  </div>

                  <LogicWord className="bg-primary-soft-2 text-foreground sm:justify-self-start">ENTÃO</LogicWord>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="text-muted-foreground">mostra o resultado</span>
                    <SelectBox
                      className="w-auto min-w-52"
                      value={rule.resultId}
                      disabled={!canEdit}
                      aria-label={`Regra ${index + 1}: resultado`}
                      onChange={(e) => patch({ resultId: e.target.value })}
                    >
                      {draft.results.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </SelectBox>
                    {target ? <RouteBadge route={target.route} /> : null}
                  </div>
                </div>
              </div>
            );
          })}

          {/* ---- Default ---- */}
          {(() => {
            const fallback = draft.results.find((r) => r.id === draft.defaultResultId);
            return (
              <div className="rounded-2xl border-2 border-dashed border-border p-4">
                <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                  <LogicWord className="sm:justify-self-start">SENÃO</LogicWord>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="text-muted-foreground">
                      {draft.rules.length > 0 ? "quem não cair em nenhuma regra vê" : "todo mundo vê"}
                    </span>
                    <SelectBox
                      className="w-auto min-w-52"
                      value={draft.defaultResultId}
                      disabled={!canEdit}
                      aria-label="Resultado padrão"
                      onChange={(e) => update((d) => ({ ...d, defaultResultId: e.target.value }))}
                    >
                      {draft.results.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </SelectBox>
                    {fallback ? <RouteBadge route={fallback.route} /> : null}
                  </div>
                </div>
              </div>
            );
          })()}

          {canEdit && draft.rules.length < LIMITS.rules && draft.results.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-2xl border-dashed"
              onClick={() => update(addRule)}
            >
              <Plus />
              Adicionar regra
            </Button>
          ) : null}
          {draft.results.length === 1 ? (
            <p className="text-xs text-muted-foreground">
              Com um resultado só não há o que decidir. Adicione outro resultado para criar regras.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ---- Tags by answer ---- */}
      {part === "etiquetas" ? (
        <div className="space-y-3">
          <p className="surface rounded-2xl px-4 py-3 text-sm text-muted-foreground">
            Etiquetas a mais no lead, conforme as respostas. Ex.: quem respondeu que é o dono recebe{" "}
            <code className="font-mono text-foreground">decisor:sim</code>. Servem para filtrar contatos e disparar
            automações.
          </p>
          {draft.tagRules.map((tagRule, index) => {
            const patch = (change: Partial<typeof tagRule>) =>
              update((d) => ({
                ...d,
                tagRules: d.tagRules.map((t) => (t.id === tagRule.id ? { ...t, ...change } : t)),
              }));
            return (
              <div key={tagRule.id} className="surface rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Tag className="size-4" />
                  </span>
                  <Input
                    value={tagRule.tag}
                    disabled={!canEdit}
                    maxLength={60}
                    placeholder="ex.: decisor:sim"
                    aria-label={`Etiqueta ${index + 1}`}
                    className="w-56 font-mono"
                    onChange={(e) => patch({ tag: e.target.value })}
                    onBlur={(e) => patch({ tag: cleanTag(e.target.value) })}
                  />
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label={`Apagar a etiqueta ${index + 1}`}
                      onClick={() => update((d) => ({ ...d, tagRules: d.tagRules.filter((t) => t.id !== tagRule.id) }))}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                  <LogicWord className="sm:justify-self-start">QUANDO</LogicWord>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <SelectBox
                        className="w-44"
                        value={tagRule.match}
                        disabled={!canEdit}
                        aria-label={`Etiqueta ${index + 1}: quantas condições`}
                        onChange={(e) => patch({ match: e.target.value === "any" ? "any" : "all" })}
                      >
                        <option value="all">todas</option>
                        <option value="any">qualquer uma</option>
                      </SelectBox>
                      <span className="text-muted-foreground">destas for verdade:</span>
                    </div>
                    <ConditionEditor
                      conditions={tagRule.conditions}
                      choices={choices}
                      match={tagRule.match}
                      disabled={!canEdit}
                      onChange={(conditions) => patch({ conditions })}
                    />
                  </div>

                  {draft.results.length > 1 ? (
                    <>
                      <LogicWord className="sm:justify-self-start">SÓ EM</LogicWord>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {draft.results.map((r) => {
                          const on = tagRule.resultIds?.includes(r.id) ?? false;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              disabled={!canEdit}
                              aria-pressed={on}
                              onClick={() => {
                                const now = tagRule.resultIds ?? [];
                                const next = on ? now.filter((id) => id !== r.id) : [...now, r.id];
                                patch({ resultIds: next.length ? next : undefined });
                              }}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-50",
                                on
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border hover:border-foreground/40 hover:text-foreground",
                              )}
                            >
                              <span aria-hidden className={cn("size-1.5 rounded-full", ROUTE_STYLE[r.route].dot)} />
                              {r.name}
                            </button>
                          );
                        })}
                        {!tagRule.resultIds?.length ? <span className="ml-1">(em qualquer resultado)</span> : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
          {canEdit && draft.tagRules.length < LIMITS.tagRules ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-2xl border-dashed"
              onClick={() => update(addTagRule)}
            >
              <Plus />
              Adicionar etiqueta por resposta
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// How it works, in three steps
// ------------------------------------------------------------

function HowItWorks() {
  const steps = [
    "A pessoa responde a última tela",
    "As regras são lidas de cima para baixo",
    "A primeira que bater mostra o resultado; se nenhuma bater, vale o padrão",
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {steps.map((text, i) => (
        <li key={text} className="surface flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-xs text-muted-foreground">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft-2 text-[11px] font-semibold text-foreground">
            {i + 1}
          </span>
          {text}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------
// One result
// ------------------------------------------------------------

function ResultCard({
  result,
  isDefault,
  open,
  onToggle,
  children,
}: {
  result: QuizResult;
  isDefault: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const style = ROUTE_STYLE[result.route];
  const Icon = ICON[result.icon];
  return (
    <div
      className={cn(
        "surface overflow-hidden rounded-2xl border-l-4 transition-shadow",
        style.border,
        open && "ring-2 ring-primary/50",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-start gap-3 px-4 py-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", style.soft, style.text)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-medium text-foreground">{result.name}</span>
            <RouteBadge route={result.route} />
            {isDefault ? (
              <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] text-muted-foreground">padrão</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{result.title || "Sem título"}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-md bg-foreground/6 px-1.5 py-0.5">
              {result.pixel.kind === "none" ? "Sem evento do Pixel" : `Pixel: ${result.pixel.name}`}
            </span>
            {result.tags.length > 0 ? (
              <span className="rounded-md bg-foreground/6 px-1.5 py-0.5">
                {result.tags.length} {result.tags.length === 1 ? "etiqueta" : "etiquetas"}
              </span>
            ) : null}
            <span className="rounded-md bg-foreground/6 px-1.5 py-0.5">
              {result.blocks.length} {result.blocks.length === 1 ? "bloco" : "blocos"}
            </span>
          </div>
        </div>
        <ChevronDown
          className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </div>
      {open ? <div className="divide-y divide-border border-t border-border px-4 pb-4 sm:px-5">{children}</div> : null}
    </div>
  );
}

function ResultEditor({
  result,
  choices,
  canEdit,
  onChange,
}: {
  result: QuizResult;
  choices: ChoiceStep[];
  canEdit: boolean;
  onChange: (change: (result: QuizResult) => QuizResult) => void;
}) {
  const set = (patch: Partial<QuizResult>) => onChange((r) => ({ ...r, ...patch }));
  const id = (name: string) => `${result.id}-${name}`;
  const setBlock = (blockId: string, change: (block: ResultBlock) => ResultBlock) =>
    onChange((r) => ({ ...r, blocks: r.blocks.map((b) => (b.id === blockId ? change(b) : b)) }));

  return (
    <>
      <FormRow title="Classificação do lead" hint="Vira a rota A, B ou C do lead no CRM, que as automações e os agentes já filtram.">
        <div role="radiogroup" aria-label="Classificação do lead" className="grid gap-2 sm:grid-cols-3">
          {(["A", "B", "C"] as QuizRoute[]).map((route) => {
            const on = result.route === route;
            return (
              <button
                key={route}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canEdit}
                onClick={() => set({ route })}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                  on ? cn("ring-2", ROUTE_STYLE[route].ring, ROUTE_STYLE[route].soft, "border-transparent") : "border-border hover:border-foreground/30",
                )}
              >
                <span className={cn("flex items-center gap-1.5 text-sm font-medium", on ? ROUTE_STYLE[route].text : "text-foreground")}>
                  <span aria-hidden className={cn("size-2 rounded-full", ROUTE_STYLE[route].dot)} />
                  {ROUTE_LABEL[route]} · rota {route}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{ROUTE_HINT[route]}</span>
              </button>
            );
          })}
        </div>
      </FormRow>

      <FormRow title="Nome interno" hint="Só a equipe vê: no relatório, nas regras e no lead.">
        <Input
          id={id("name")}
          aria-label="Nome interno do resultado"
          value={result.name}
          disabled={!canEdit}
          maxLength={80}
          className="max-w-md"
          onChange={(e) => set({ name: e.target.value })}
        />
      </FormRow>

      <FormRow title="Título da tela" hint="Variáveis: {nome}, {empresa}, {whatsapp}, {email}, {cidade}.">
        <div className="grid gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
          <SelectBox
            value={result.icon}
            disabled={!canEdit}
            aria-label="Ícone do resultado"
            onChange={(e) => set({ icon: e.target.value as ResultIcon })}
          >
            {RESULT_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                Ícone: {ICON_LABEL[icon]}
              </option>
            ))}
          </SelectBox>
          <Textarea
            id={id("title")}
            aria-label="Título do resultado"
            value={result.title}
            disabled={!canEdit}
            maxLength={300}
            rows={2}
            className="text-base"
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>
      </FormRow>

      <FormRow
        title="Conteúdo"
        hint="Blocos na ordem em que aparecem. Use **negrito** e as variáveis do título. Um bloco com condição só aparece para quem deu aquela resposta."
      >
        <div className="space-y-2">
          {result.blocks.map((block, index) => (
            <BlockEditor
              key={block.id}
              block={block}
              index={index}
              count={result.blocks.length}
              choices={choices}
              canEdit={canEdit}
              onChange={(change) => setBlock(block.id, change)}
              onMove={(to) => onChange((r) => ({ ...r, blocks: moveItem(r.blocks, index, to) }))}
              onRemove={() => onChange((r) => ({ ...r, blocks: r.blocks.filter((b) => b.id !== block.id) }))}
            />
          ))}
          {canEdit && result.blocks.length < LIMITS.blocks ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <Plus />
                Adicionar bloco
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-44">
                {BLOCK_KINDS.map((kind) => {
                  const Icon = BLOCK_STYLE[kind.type].icon;
                  return (
                    <DropdownMenuItem
                      key={kind.type}
                      onClick={() => onChange((r) => ({ ...r, blocks: [...r.blocks, newBlock(kind.type)] }))}
                    >
                      <Icon className={BLOCK_STYLE[kind.type].text} />
                      {kind.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </FormRow>

      <FormRow title="No CRM e no Pixel" hint="As etiquetas vão para o lead. O evento do Pixel avisa a Meta que o resultado aconteceu.">
        <Field label="Etiquetas deste resultado" htmlFor={id("tags")}>
          <TagsInput
            id={id("tags")}
            value={result.tags}
            disabled={!canEdit}
            placeholder="ex.: raio-x, morno"
            onChange={(tags) => set({ tags })}
          />
        </Field>
        <Field label="Evento do Pixel" hint="Use o evento padrão Lead só no resultado que deve otimizar a campanha.">
          <div className="flex flex-wrap gap-2">
            <SelectBox
              className="w-44 shrink-0"
              value={result.pixel.kind}
              disabled={!canEdit}
              aria-label="Tipo do evento do Pixel"
              onChange={(e) => {
                const kind = e.target.value as QuizResult["pixel"]["kind"];
                set({
                  pixel:
                    kind === "none"
                      ? { kind, name: "" }
                      : kind === "standard"
                        ? { kind, name: "Lead" }
                        : { kind, name: result.pixel.kind === "custom" ? result.pixel.name : "QuizConcluido" },
                });
              }}
            >
              <option value="none">Não enviar</option>
              <option value="standard">Evento padrão</option>
              <option value="custom">Personalizado</option>
            </SelectBox>
            {result.pixel.kind === "standard" ? (
              <SelectBox
                className="w-auto min-w-48 flex-1"
                value={result.pixel.name}
                disabled={!canEdit}
                aria-label="Evento padrão"
                onChange={(e) => set({ pixel: { kind: "standard", name: e.target.value } })}
              >
                {[...new Set([...STANDARD_EVENTS, result.pixel.name])].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </SelectBox>
            ) : null}
            {result.pixel.kind === "custom" ? (
              <Input
                value={result.pixel.name}
                disabled={!canEdit}
                maxLength={40}
                placeholder="ex.: QuizMorno"
                aria-label="Nome do evento personalizado"
                className="min-w-48 flex-1"
                onChange={(e) => set({ pixel: { kind: "custom", name: e.target.value.replace(/[^A-Za-z0-9_]/g, "") } })}
              />
            ) : null}
          </div>
        </Field>
      </FormRow>
    </>
  );
}

const BLOCK_STYLE: Record<ResultBlock["type"], { label: string; icon: typeof AlignLeft; text: string; strip: string }> = {
  text: { label: "Texto", icon: AlignLeft, text: "text-foreground/70", strip: "bg-foreground/20" },
  bullets: { label: "Lista", icon: List, text: "text-sky-600 dark:text-sky-300", strip: "bg-sky-500" },
  highlight: { label: "Destaque", icon: Lightbulb, text: "text-amber-600 dark:text-amber-300", strip: "bg-amber-500" },
  button: { label: "Botão", icon: MousePointerClick, text: "text-primary", strip: "bg-primary" },
};

function BlockEditor({
  block,
  index,
  count,
  choices,
  canEdit,
  onChange,
  onMove,
  onRemove,
}: {
  block: ResultBlock;
  index: number;
  count: number;
  choices: ChoiceStep[];
  canEdit: boolean;
  onChange: (change: (block: ResultBlock) => ResultBlock) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const [showCondition, setShowCondition] = useState(Boolean(block.showIf?.length));
  const style = BLOCK_STYLE[block.type];
  const Icon = style.icon;
  const label = `${style.label} ${index + 1}`;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-background/50 py-2.5 pr-2.5 pl-4">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", style.strip)} />
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className={cn("size-3.5", style.text)} />
        <span className={cn("text-xs font-medium", style.text)}>{style.label}</span>
        {block.showIf?.length ? (
          <span className="truncate rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
            só se {describeConditions(block.showIf, choices, "all")}
          </span>
        ) : null}
        {canEdit ? (
          <span className="ml-auto flex shrink-0 items-center">
            <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} aria-label={`Subir: ${label}`} onClick={() => onMove(index - 1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" disabled={index === count - 1} aria-label={`Descer: ${label}`} onClick={() => onMove(index + 1)}>
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remover: ${label}`} onClick={onRemove}>
              <X />
            </Button>
          </span>
        ) : null}
      </div>

      {block.type === "text" ? (
        <Textarea
          value={block.text}
          disabled={!canEdit}
          maxLength={1500}
          rows={3}
          aria-label={label}
          onChange={(e) => onChange((b) => (b.type === "text" ? { ...b, text: e.target.value } : b))}
        />
      ) : null}

      {block.type === "bullets" ? (
        <Textarea
          value={block.items.join("\n")}
          disabled={!canEdit}
          rows={4}
          aria-label={`${label} (um item por linha)`}
          placeholder="Um item por linha"
          onChange={(e) =>
            onChange((b) => (b.type === "bullets" ? { ...b, items: e.target.value.split("\n").slice(0, LIMITS.bullets) } : b))
          }
        />
      ) : null}

      {block.type === "highlight" ? (
        <div className="grid gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
          <SelectBox
            value={block.icon}
            disabled={!canEdit}
            aria-label={`${label}: ícone`}
            onChange={(e) => onChange((b) => (b.type === "highlight" ? { ...b, icon: e.target.value as ResultIcon } : b))}
          >
            {RESULT_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                Ícone: {ICON_LABEL[icon]}
              </option>
            ))}
          </SelectBox>
          <Textarea
            value={block.text}
            disabled={!canEdit}
            maxLength={800}
            rows={3}
            aria-label={label}
            onChange={(e) => onChange((b) => (b.type === "highlight" ? { ...b, text: e.target.value } : b))}
          />
        </div>
      ) : null}

      {block.type === "button" ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Input
            value={block.label}
            disabled={!canEdit}
            maxLength={80}
            placeholder="Texto do botão"
            aria-label={`${label}: texto`}
            onChange={(e) => onChange((b) => (b.type === "button" ? { ...b, label: e.target.value } : b))}
          />
          <SelectBox
            value={block.kind}
            disabled={!canEdit}
            aria-label={`${label}: destino`}
            onChange={(e) =>
              onChange((b) =>
                b.type === "button" ? { ...b, kind: e.target.value === "whatsapp" ? "whatsapp" : "link", url: "" } : b,
              )
            }
          >
            <option value="link">Abre um link</option>
            <option value="whatsapp">Abre o WhatsApp</option>
          </SelectBox>
          <Input
            value={block.url}
            disabled={!canEdit}
            maxLength={block.kind === "whatsapp" ? 20 : 500}
            inputMode={block.kind === "whatsapp" ? "tel" : "url"}
            placeholder={block.kind === "whatsapp" ? "Número com DDI e DDD: 5511912345678" : "https://…"}
            aria-label={`${label}: ${block.kind === "whatsapp" ? "número" : "link"}`}
            aria-invalid={!block.url ? true : undefined}
            className="sm:col-span-2"
            onChange={(e) =>
              onChange((b) =>
                b.type === "button"
                  ? { ...b, url: b.kind === "whatsapp" ? e.target.value.replace(/\D/g, "") : e.target.value.trim() }
                  : b,
              )
            }
          />
          {!block.url ? (
            <p className="text-xs text-amber-600 sm:col-span-2 dark:text-amber-400">
              Sem {block.kind === "whatsapp" ? "número" : "link"}, o botão não aparece para o visitante.
            </p>
          ) : null}
        </div>
      ) : null}

      {showCondition || block.showIf?.length ? (
        <div className="mt-2.5">
          <p className="mb-1.5 text-xs font-medium text-foreground/75">Mostrar este bloco só para quem…</p>
          <ConditionEditor
            conditions={block.showIf ?? []}
            choices={choices}
            match="all"
            disabled={!canEdit}
            onChange={(showIf) => onChange((b) => ({ ...b, showIf: showIf.length ? showIf : undefined }))}
          />
        </div>
      ) : canEdit && choices.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowCondition(true)}
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Mostrar só para algumas respostas
        </button>
      ) : null}
    </div>
  );
}
