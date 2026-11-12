"use client";

// ============================================================
// Resultados: the screens a visit can end in, the rules that decide
// which one, and the extra tags an answer earns.
//
// A result is marked qualified, warm or not a fit — the route A, B or
// C the CRM already filters by. The rules are read top to bottom and
// the first one that matches decides; everyone else gets the default.
// ============================================================

import { useState } from "react";
import { ArrowDown, ArrowUp, CopyPlus, Plus, Trash2, X } from "lucide-react";

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

import { ConditionEditor } from "./condition-editor";
import {
  Collapsible,
  Field,
  Section,
  SelectBox,
  TagsInput,
  type PreviewTarget,
  type TabProps,
} from "./ui";

interface ResultsTabProps extends TabProps {
  onFocus: (target: PreviewTarget) => void;
}

const ICON_LABEL: Record<ResultIcon, string> = {
  check: "Confirmado",
  bulb: "Ideia",
  gift: "Presente",
  message: "Conversa",
};

/** Meta's standard events that make sense at the end of a quiz. */
const STANDARD_EVENTS = [
  "Lead",
  "CompleteRegistration",
  "Contact",
  "Schedule",
  "SubmitApplication",
  "ViewContent",
];

export function RouteBadge({ route }: { route: QuizRoute }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        route === "A" && "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        route === "B" && "bg-amber-500/12 text-amber-600 dark:text-amber-400",
        route === "C" && "bg-foreground/8 text-muted-foreground",
      )}
    >
      {ROUTE_LABEL[route]}
    </span>
  );
}

export function ResultsTab({ draft, update, canEdit, onFocus }: ResultsTabProps) {
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
    <div className="grid gap-4">
      {/* ---- Result screens ---- */}
      <Section
        title="Telas de resultado"
        hint="O que a pessoa vê ao terminar. Cada resultado leva a própria classificação, etiquetas e evento do Pixel."
      >
        <div className="space-y-3">
          {draft.results.map((result) => (
            <Collapsible
              key={result.id}
              open={open === result.id}
              onToggle={() => toggle(result.id)}
              header={
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{result.name}</span>
                  <RouteBadge route={result.route} />
                  {result.id === draft.defaultResultId ? (
                    <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] text-muted-foreground">
                      padrão
                    </span>
                  ) : null}
                </span>
              }
            >
              <ResultEditor
                result={result}
                choices={choices}
                canEdit={canEdit}
                onChange={(change) => update((d) => updateResult(d, result.id, change))}
              />
              {canEdit ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
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
            </Collapsible>
          ))}

          {canEdit && draft.results.length < LIMITS.results ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
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
      </Section>

      {/* ---- Rules ---- */}
      <Section
        title="Quem cai em qual resultado"
        hint="As regras são lidas de cima para baixo. A primeira que bater decide o resultado; quem não cair em nenhuma vai para o resultado padrão."
      >
        <div className="space-y-3">
          {draft.rules.map((rule, index) => (
            <div key={rule.id} className="rounded-2xl border border-border p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span>Se</span>
                <SelectBox
                  className="w-44"
                  value={rule.match}
                  disabled={!canEdit}
                  aria-label={`Regra ${index + 1}: quantas condições`}
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      rules: d.rules.map((r) =>
                        r.id === rule.id ? { ...r, match: e.target.value === "all" ? "all" : "any" } : r,
                      ),
                    }))
                  }
                >
                  <option value="any">qualquer uma</option>
                  <option value="all">todas</option>
                </SelectBox>
                <span>destas for verdade:</span>
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
              <div className="mt-3 pl-0 sm:pl-7">
                <ConditionEditor
                  conditions={rule.conditions}
                  choices={choices}
                  disabled={!canEdit}
                  onChange={(conditions) =>
                    update((d) => ({
                      ...d,
                      rules: d.rules.map((r) => (r.id === rule.id ? { ...r, conditions } : r)),
                    }))
                  }
                />
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span>então o resultado é</span>
                  <SelectBox
                    className="w-auto min-w-48"
                    value={rule.resultId}
                    disabled={!canEdit}
                    aria-label={`Regra ${index + 1}: resultado`}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        rules: d.rules.map((r) => (r.id === rule.id ? { ...r, resultId: e.target.value } : r)),
                      }))
                    }
                  >
                    {draft.results.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </SelectBox>
                </div>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-foreground/5 px-4 py-3 text-sm text-foreground">
            <span>{draft.rules.length > 0 ? "Em qualquer outro caso, o resultado é" : "Todo mundo cai no resultado"}</span>
            <SelectBox
              className="w-auto min-w-48"
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
          </div>

          {canEdit && draft.rules.length < LIMITS.rules && draft.results.length > 1 ? (
            <Button type="button" variant="outline" className="w-full" onClick={() => update(addRule)}>
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
      </Section>

      {/* ---- Tags by answer ---- */}
      <Section
        title="Etiquetas por resposta"
        hint="Uma etiqueta a mais no lead quando as respostas atendem às condições. Ex.: quem respondeu que é o dono recebe “decisor:sim”."
      >
        <div className="space-y-3">
          {draft.tagRules.map((tagRule, index) => {
            const patch = (change: Partial<typeof tagRule>) =>
              update((d) => ({
                ...d,
                tagRules: d.tagRules.map((t) => (t.id === tagRule.id ? { ...t, ...change } : t)),
              }));
            return (
              <div key={tagRule.id} className="rounded-2xl border border-border p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span>Etiqueta</span>
                  <Input
                    value={tagRule.tag}
                    disabled={!canEdit}
                    maxLength={60}
                    placeholder="ex.: decisor:sim"
                    aria-label={`Etiqueta ${index + 1}`}
                    className="w-52"
                    onChange={(e) => patch({ tag: e.target.value })}
                    onBlur={(e) => patch({ tag: cleanTag(e.target.value) })}
                  />
                  <span>quando</span>
                  <SelectBox
                    className="w-40"
                    value={tagRule.match}
                    disabled={!canEdit}
                    aria-label={`Etiqueta ${index + 1}: quantas condições`}
                    onChange={(e) => patch({ match: e.target.value === "any" ? "any" : "all" })}
                  >
                    <option value="all">todas</option>
                    <option value="any">qualquer uma</option>
                  </SelectBox>
                  <span>destas for verdade:</span>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label={`Apagar a etiqueta ${index + 1}`}
                      onClick={() =>
                        update((d) => ({ ...d, tagRules: d.tagRules.filter((t) => t.id !== tagRule.id) }))
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3">
                  <ConditionEditor
                    conditions={tagRule.conditions}
                    choices={choices}
                    disabled={!canEdit}
                    onChange={(conditions) => patch({ conditions })}
                  />
                </div>
                {draft.results.length > 1 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="mr-1">Só quando o resultado for:</span>
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
                            "rounded-full border px-2.5 py-1 transition-colors disabled:opacity-50",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:border-foreground/40 hover:text-foreground",
                          )}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                    {!tagRule.resultIds?.length ? <span>(qualquer resultado)</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {canEdit && draft.tagRules.length < LIMITS.tagRules ? (
            <Button type="button" variant="outline" className="w-full" onClick={() => update(addTagRule)}>
              <Plus />
              Adicionar etiqueta por resposta
            </Button>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------
// One result
// ------------------------------------------------------------

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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome (só a equipe vê)" htmlFor={id("name")}>
          <Input
            id={id("name")}
            value={result.name}
            disabled={!canEdit}
            maxLength={80}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field
          label="Classificação do lead"
          htmlFor={id("route")}
          hint="Vira a rota A, B ou C do lead no CRM."
        >
          <SelectBox
            id={id("route")}
            value={result.route}
            disabled={!canEdit}
            onChange={(e) => set({ route: e.target.value as QuizRoute })}
          >
            <option value="A">Qualificado (rota A)</option>
            <option value="B">Morno (rota B)</option>
            <option value="C">Desqualificado (rota C)</option>
          </SelectBox>
        </Field>
        <Field label="Etiquetas deste resultado" htmlFor={id("tags")}>
          <TagsInput
            id={id("tags")}
            value={result.tags}
            disabled={!canEdit}
            placeholder="ex.: raio-x, morno"
            onChange={(tags) => set({ tags })}
          />
        </Field>
        <Field
          label="Evento do Pixel"
          htmlFor={id("pixel")}
          hint="Use o evento padrão Lead só no resultado que deve otimizar a campanha."
        >
          <div className="flex gap-2">
            <SelectBox
              id={id("pixel")}
              className="w-44 shrink-0"
              value={result.pixel.kind}
              disabled={!canEdit}
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
                onChange={(e) =>
                  set({ pixel: { kind: "custom", name: e.target.value.replace(/[^A-Za-z0-9_]/g, "") } })
                }
              />
            ) : null}
          </div>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field label="Ícone" htmlFor={id("icon")}>
          <SelectBox
            id={id("icon")}
            value={result.icon}
            disabled={!canEdit}
            onChange={(e) => set({ icon: e.target.value as ResultIcon })}
          >
            {RESULT_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {ICON_LABEL[icon]}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field
          label="Título"
          htmlFor={id("title")}
          hint="Variáveis: {nome}, {empresa}, {whatsapp}, {email}, {cidade}."
        >
          <Textarea
            id={id("title")}
            value={result.title}
            disabled={!canEdit}
            maxLength={300}
            rows={2}
            onChange={(e) => set({ title: e.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Conteúdo da tela"
        hint="Blocos na ordem em que aparecem. Use **negrito** e as mesmas variáveis do título. Um bloco com condição só aparece para quem deu aquela resposta."
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
              <DropdownMenuContent className="w-40">
                {BLOCK_KINDS.map((kind) => (
                  <DropdownMenuItem
                    key={kind.type}
                    onClick={() => onChange((r) => ({ ...r, blocks: [...r.blocks, newBlock(kind.type)] }))}
                  >
                    {kind.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </Field>
    </>
  );
}

const BLOCK_LABEL: Record<ResultBlock["type"], string> = {
  text: "Texto",
  bullets: "Lista",
  highlight: "Destaque",
  button: "Botão",
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
  const label = `${BLOCK_LABEL[block.type]} ${index + 1}`;

  return (
    <div className="rounded-xl border border-border bg-background/40 p-2.5">
      <div className="mb-2 flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">{BLOCK_LABEL[block.type]}</span>
        {block.showIf?.length ? (
          <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            condicional
          </span>
        ) : null}
        {canEdit ? (
          <span className="ml-auto flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={index === 0}
              aria-label={`Subir: ${label}`}
              onClick={() => onMove(index - 1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={index === count - 1}
              aria-label={`Descer: ${label}`}
              onClick={() => onMove(index + 1)}
            >
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
            onChange((b) =>
              b.type === "bullets"
                ? { ...b, items: e.target.value.split("\n").slice(0, LIMITS.bullets) }
                : b,
            )
          }
        />
      ) : null}

      {block.type === "highlight" ? (
        <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
          <SelectBox
            value={block.icon}
            disabled={!canEdit}
            aria-label={`${label}: ícone`}
            onChange={(e) =>
              onChange((b) => (b.type === "highlight" ? { ...b, icon: e.target.value as ResultIcon } : b))
            }
          >
            {RESULT_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {ICON_LABEL[icon]}
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
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr]">
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
                b.type === "button"
                  ? { ...b, kind: e.target.value === "whatsapp" ? "whatsapp" : "link", url: "" }
                  : b,
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
            placeholder={block.kind === "whatsapp" ? "5511912345678 (com DDI e DDD)" : "https://…"}
            aria-label={`${label}: ${block.kind === "whatsapp" ? "número" : "link"}`}
            onChange={(e) =>
              onChange((b) =>
                b.type === "button"
                  ? {
                      ...b,
                      url: b.kind === "whatsapp" ? e.target.value.replace(/\D/g, "") : e.target.value.trim(),
                    }
                  : b,
              )
            }
          />
        </div>
      ) : null}

      {showCondition || block.showIf?.length ? (
        <div className="mt-2.5">
          <p className="mb-1.5 text-xs text-muted-foreground">Mostrar este bloco só para quem…</p>
          <ConditionEditor
            conditions={block.showIf ?? []}
            choices={choices}
            disabled={!canEdit}
            onChange={(showIf) =>
              onChange((b) => ({ ...b, showIf: showIf.length ? showIf : undefined }))
            }
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
