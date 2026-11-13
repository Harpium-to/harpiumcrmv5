"use client";

// ============================================================
// Perguntas: the screens of the quiz, drawn as the path a visitor
// walks — a line from the entry screen to the result, with one node
// per screen. Each kind of screen has its colour and icon (ui.tsx), so
// a question, a contact form and a message never look alike.
//
// One card is open at a time; the phone preview follows it. Inside a
// card, every setting is a row: what it is on the left, the control on
// the right.
// ============================================================

import { useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  CopyPlus,
  GitBranch,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import {
  addStep,
  choicesBefore,
  duplicateStep,
  moveItem,
  moveStep,
  newField,
  removeOption,
  removeStep,
  STEP_KINDS,
  stepKindLabel,
  updateStep,
  type StepKind,
} from "@/lib/quiz/builder";
import {
  FIELD_KINDS,
  type ChoiceStep,
  type FieldKind,
  type FieldsStep,
  type MessageStep,
  type QuizStep,
} from "@/lib/quiz/types";
import { FIELD_LABEL, LIMITS, newId } from "@/lib/quiz/validate";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { ConditionEditor, describeConditions } from "./condition-editor";
import {
  Field,
  FormRow,
  MoreOptions,
  RouteBadge,
  SCREEN_STYLE,
  ScreenIcon,
  SelectBox,
  type PreviewTarget,
  type ScreenKind,
  type TabProps,
} from "./ui";

interface StepsTabProps extends TabProps {
  onFocus: (target: PreviewTarget) => void;
  onGoToResults: () => void;
}

const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  ...FIELD_LABEL,
  company: "Empresa",
  city: "Cidade / UF",
  instagram: "Instagram",
  text: "Texto curto",
  longtext: "Texto longo",
  number: "Número",
};

/** "Adicionar tela", grouped the way people think about screens. */
const ADD_GROUPS: { label: string; kinds: StepKind[] }[] = [
  { label: "Perguntas de escolha", kinds: ["choice", "multi"] },
  { label: "Respostas digitadas", kinds: ["text", "longtext", "number"] },
  { label: "Dados de contato", kinds: ["name", "phone", "email", "contact"] },
  { label: "Outros", kinds: ["message"] },
];

function kindOfNew(kind: StepKind): ScreenKind {
  if (kind === "choice" || kind === "multi") return "choice";
  if (kind === "message") return "message";
  return "fields";
}

export function StepsTab({ draft, update, canEdit, onFocus, onGoToResults }: StepsTabProps) {
  const [open, setOpen] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) onFocus(next === "intro" ? { kind: "intro" } : { kind: "step", id: next });
  };

  const openNew = (id: string) => {
    setOpen(id);
    onFocus({ kind: "step", id });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    update((d) =>
      moveStep(
        d,
        d.steps.findIndex((s) => s.id === active.id),
        d.steps.findIndex((s) => s.id === over.id),
      ),
    );
  };

  const add = (kind: StepKind) => {
    const id = newId("s");
    update((d) => {
      const made = addStep(d, kind, open && open !== "intro" ? open : undefined);
      // Keep the id chosen here, so the new card can be opened at once.
      return { ...made.def, steps: made.def.steps.map((s) => (s.id === made.id ? { ...s, id } : s)) };
    });
    openNew(id);
  };

  const intro = draft.intro;
  const setIntro = (patch: Partial<typeof intro>) =>
    update((d) => ({ ...d, intro: { ...d.intro, ...patch } }));

  return (
    <div className="space-y-4">
      <Legend canEdit={canEdit} />

      <ol className="relative space-y-3">
        {/* The path the visitor walks, from the entry to the result. */}
        <span
          aria-hidden
          className="absolute top-5 bottom-5 left-[calc(1.125rem-1px)] w-0.5 rounded-full bg-foreground/15"
        />

        {/* ---- Entry screen ---- */}
        <TimelineItem kind="intro" muted={!intro.enabled}>
          <ScreenCard
            kind="intro"
            caption={intro.enabled ? "Tela de entrada" : "Tela de entrada · desligada"}
            title={intro.headline || "Sem título"}
            open={open === "intro"}
            onToggle={() => toggle("intro")}
          >
            <FormRow title="Exibir" hint="A primeira coisa que a pessoa vê ao abrir o link.">
              <label className="flex items-center gap-3 text-sm text-foreground">
                <Switch
                  checked={intro.enabled}
                  disabled={!canEdit}
                  onCheckedChange={(enabled) => setIntro({ enabled })}
                />
                Mostrar a tela de entrada antes da primeira pergunta
              </label>
            </FormRow>
            <FormRow title="Chamada" hint="O título é a promessa do quiz: o que a pessoa ganha ao responder.">
              <Field label="Linha acima do título" htmlFor="intro-tag">
                <Input
                  id="intro-tag"
                  value={intro.tag ?? ""}
                  disabled={!canEdit}
                  maxLength={80}
                  placeholder="ex.: Diagnóstico gratuito"
                  onChange={(e) => setIntro({ tag: e.target.value })}
                />
              </Field>
              <Field label="Título" htmlFor="intro-headline">
                <Textarea
                  id="intro-headline"
                  value={intro.headline}
                  disabled={!canEdit}
                  maxLength={200}
                  rows={2}
                  onChange={(e) => setIntro({ headline: e.target.value })}
                />
              </Field>
              <Field label="Subtítulo" htmlFor="intro-sub">
                <Textarea
                  id="intro-sub"
                  value={intro.sub ?? ""}
                  disabled={!canEdit}
                  maxLength={400}
                  rows={2}
                  onChange={(e) => setIntro({ sub: e.target.value })}
                />
              </Field>
            </FormRow>
            <FormRow title="Botão">
              <Input
                aria-label="Texto do botão da entrada"
                value={intro.cta}
                disabled={!canEdit}
                maxLength={60}
                className="max-w-sm"
                onChange={(e) => setIntro({ cta: e.target.value })}
              />
            </FormRow>
            <FormRow
              title="Provas e garantias"
              hint="Aparecem abaixo do botão. A primeira parte sai em negrito."
            >
              <div className="space-y-2">
                {intro.bullets.map((bullet, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={bullet.strong}
                      disabled={!canEdit}
                      maxLength={160}
                      placeholder="Em negrito"
                      aria-label={`Prova ${i + 1}, parte em negrito`}
                      className="min-w-0 flex-1 basis-40 font-medium"
                      onChange={(e) =>
                        setIntro({
                          bullets: intro.bullets.map((b, j) => (j === i ? { ...b, strong: e.target.value } : b)),
                        })
                      }
                    />
                    <Input
                      value={bullet.text}
                      disabled={!canEdit}
                      maxLength={200}
                      placeholder="Complemento"
                      aria-label={`Prova ${i + 1}, complemento`}
                      className="min-w-0 flex-1 basis-40"
                      onChange={(e) =>
                        setIntro({
                          bullets: intro.bullets.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)),
                        })
                      }
                    />
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remover prova ${i + 1}`}
                        onClick={() => setIntro({ bullets: intro.bullets.filter((_, j) => j !== i) })}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {canEdit && intro.bullets.length < 6 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIntro({ bullets: [...intro.bullets, { strong: "", text: "" }] })}
                  >
                    <Plus />
                    Adicionar linha
                  </Button>
                ) : null}
              </div>
            </FormRow>
          </ScreenCard>
        </TimelineItem>

        {/* ---- Questions ---- */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={draft.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {draft.steps.map((step, index) => {
              const choices = choicesBefore(draft, step.id);
              return (
                <SortableStep key={step.id} step={step} canEdit={canEdit}>
                  {(handle) => (
                    <ScreenCard
                      kind={step.type}
                      caption={`Tela ${index + 1} · ${stepKindLabel(step)}`}
                      title={step.title || "Sem título"}
                      meta={<StepMeta step={step} choices={choices} />}
                      open={open === step.id}
                      onToggle={() => toggle(step.id)}
                      handle={handle}
                    >
                      <StepEditor
                        step={step}
                        canEdit={canEdit}
                        choices={choices}
                        onChange={(change) => update((d) => updateStep(d, step.id, change))}
                        onRemoveOption={(optionId) => update((d) => removeOption(d, step.id, optionId))}
                      />
                      {canEdit ? (
                        <div className="flex flex-wrap justify-end gap-2 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const id = newId("s");
                              update((d) => {
                                const copy = duplicateStep(d, step.id);
                                if (!copy) return d;
                                return {
                                  ...copy.def,
                                  steps: copy.def.steps.map((s) => (s.id === copy.id ? { ...s, id } : s)),
                                };
                              });
                              openNew(id);
                            }}
                          >
                            <CopyPlus />
                            Duplicar
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Apagar a tela "${step.label}"? As condições e regras que usam a resposta dela são removidas junto.`,
                                )
                              ) {
                                return;
                              }
                              update((d) => removeStep(d, step.id));
                              setOpen(null);
                            }}
                          >
                            <Trash2 />
                            Apagar tela
                          </Button>
                        </div>
                      ) : null}
                    </ScreenCard>
                  )}
                </SortableStep>
              );
            })}
          </SortableContext>
        </DndContext>

        {/* ---- Add a screen ---- */}
        {canEdit && draft.steps.length < LIMITS.steps ? (
          <li className="relative flex gap-3">
            <span
              aria-hidden
              className="relative z-10 mt-1.5 flex size-9 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border bg-background text-muted-foreground"
            >
              <Plus className="size-4" />
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({
                  variant: "outline",
                  className: "h-12 flex-1 justify-start rounded-2xl border-dashed",
                })}
              >
                <Plus />
                Adicionar tela
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {open && open !== "intro" ? "depois da tela aberta" : "no fim"}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-80" align="start">
                {ADD_GROUPS.map((group, gi) => (
                  <div key={group.label}>
                    {gi > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {group.label}
                      </DropdownMenuLabel>
                      {group.kinds.map((kind) => {
                        const item = STEP_KINDS.find((k) => k.kind === kind)!;
                        return (
                          <DropdownMenuItem key={kind} onClick={() => add(kind)} className="items-center gap-3 py-2">
                            <ScreenIcon kind={kindOfNew(kind)} className="size-7 rounded-lg" />
                            <span className="min-w-0">
                              <span className="block text-sm">{item.label}</span>
                              <span className="block text-xs text-muted-foreground">{item.hint}</span>
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuGroup>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ) : null}

        {/* ---- The end of the path ---- */}
        <TimelineItem kind="result">
          <div className="surface rounded-2xl px-4 py-3.5">
            <p className={cn("text-[11px] font-semibold tracking-wider uppercase", SCREEN_STYLE.result.text)}>
              Fim · Resultado
            </p>
            <p className="mt-0.5 text-sm text-foreground">
              Depois da última tela, a pessoa vê um destes resultados, escolhido pelas regras.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {draft.results.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RouteBadge route={r.route} />
                  {r.name}
                </span>
              ))}
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onGoToResults}>
                Configurar resultados
                <ArrowRight />
              </Button>
            </div>
          </div>
        </TimelineItem>
      </ol>
    </div>
  );
}

// ------------------------------------------------------------
// Pieces of the path
// ------------------------------------------------------------

function Legend({ canEdit }: { canEdit: boolean }) {
  const kinds: ScreenKind[] = ["intro", "choice", "fields", "message", "result"];
  return (
    <div className="surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-xs text-muted-foreground">
      <span className="text-foreground">
        As telas na ordem em que a pessoa vê.{" "}
        {canEdit ? "Clique para editar e arraste pela alça para mudar a ordem." : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {kinds.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-full", SCREEN_STYLE[kind].node)} />
            {SCREEN_STYLE[kind].label}
          </span>
        ))}
      </span>
    </div>
  );
}

function TimelineItem({
  kind,
  muted = false,
  children,
}: {
  kind: ScreenKind;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-3">
      <ScreenIcon
        kind={kind}
        className={cn("relative z-10 mt-2.5 ring-4 ring-background", muted && "opacity-40 grayscale")}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function ScreenCard({
  kind,
  caption,
  title,
  meta,
  open,
  onToggle,
  handle,
  children,
}: {
  kind: ScreenKind;
  caption: string;
  title: string;
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  handle?: ReactNode;
  children: ReactNode;
}) {
  const style = SCREEN_STYLE[kind];
  return (
    <div
      className={cn(
        "surface overflow-hidden rounded-2xl transition-shadow",
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
        <div className="min-w-0 flex-1">
          <p className={cn("text-[11px] font-semibold tracking-wider uppercase", style.text)}>{caption}</p>
          <p className="mt-0.5 line-clamp-2 text-[15px] font-medium text-foreground">{title}</p>
          {meta ? <div className="mt-1.5 flex flex-wrap gap-1.5">{meta}</div> : null}
        </div>
        {handle}
        <ChevronDown
          className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </div>
      {open ? (
        <div className="divide-y divide-border border-t border-border px-4 pb-4 sm:px-5">{children}</div>
      ) : null}
    </div>
  );
}

function MetaChip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "logic" }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px]",
        tone === "logic"
          ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
          : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function StepMeta({ step, choices }: { step: QuizStep; choices: ChoiceStep[] }) {
  const condition = step.showIf?.length ? describeConditions(step.showIf, choices, "all") : "";
  return (
    <>
      {step.type === "choice" ? (
        <MetaChip>
          {step.options.length} {step.options.length === 1 ? "opção" : "opções"}
          {step.multiple ? " · várias respostas" : ""}
        </MetaChip>
      ) : null}
      {step.type === "fields" ? (
        <MetaChip>{step.fields.map((f) => f.label).join(" · ") || "sem campos"}</MetaChip>
      ) : null}
      {step.type === "message" ? <MetaChip>Botão: {step.cta}</MetaChip> : null}
      {condition ? (
        <MetaChip tone="logic">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">Só se {condition}</span>
        </MetaChip>
      ) : null}
    </>
  );
}

function SortableStep({
  step,
  canEdit,
  children,
}: {
  step: QuizStep;
  canEdit: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !canEdit,
  });

  const handle = canEdit ? (
    <button
      type="button"
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Mover a tela "${step.label}"`}
      title="Arraste para mudar a ordem"
      className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/8 active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  ) : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative flex gap-3", isDragging && "z-20 opacity-90")}
    >
      <ScreenIcon kind={step.type} className="relative z-10 mt-2.5 ring-4 ring-background" />
      <div className="min-w-0 flex-1">{children(handle)}</div>
    </li>
  );
}

// ------------------------------------------------------------
// Editing one screen
// ------------------------------------------------------------

type Change = (change: (step: QuizStep) => QuizStep) => void;

function StepEditor({
  step,
  canEdit,
  choices,
  onChange,
  onRemoveOption,
}: {
  step: QuizStep;
  canEdit: boolean;
  choices: ChoiceStep[];
  onChange: Change;
  onRemoveOption: (optionId: string) => void;
}) {
  const set = (patch: Partial<QuizStep>) => onChange((s) => ({ ...s, ...patch }) as QuizStep);
  const id = (name: string) => `${step.id}-${name}`;

  return (
    <>
      <FormRow
        title={step.type === "choice" ? "Pergunta" : "Título da tela"}
        hint="Use {nome} para chamar a pessoa pelo primeiro nome, depois da tela que pergunta o nome."
      >
        <Textarea
          id={id("title")}
          aria-label={step.type === "choice" ? "Pergunta" : "Título da tela"}
          value={step.title}
          disabled={!canEdit}
          maxLength={300}
          rows={2}
          className="text-base"
          onChange={(e) => set({ title: e.target.value })}
        />
        <Field
          label="Nome curto"
          htmlFor={id("label")}
          hint="Como esta tela aparece no CRM, no relatório e no CSV."
          className="max-w-sm"
        >
          <Input
            id={id("label")}
            value={step.label}
            disabled={!canEdit}
            maxLength={80}
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>
        {step.type === "choice" ? (
          <MoreOptions label="Texto acima da pergunta e observação">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Texto acima da pergunta" htmlFor={id("context")}>
                <Input
                  id={id("context")}
                  value={step.context ?? ""}
                  disabled={!canEdit}
                  maxLength={400}
                  onChange={(e) => set({ context: e.target.value || undefined })}
                />
              </Field>
              <Field label="Observação abaixo" htmlFor={id("note")}>
                <Input
                  id={id("note")}
                  value={step.note ?? ""}
                  disabled={!canEdit}
                  maxLength={300}
                  placeholder="ex.: Essa informação é confidencial."
                  onChange={(e) => set({ note: e.target.value || undefined })}
                />
              </Field>
            </div>
          </MoreOptions>
        ) : null}
        {step.type === "fields" ? (
          <MoreOptions label="Observação abaixo do título">
            <Input
              aria-label="Observação abaixo do título"
              value={step.note ?? ""}
              disabled={!canEdit}
              maxLength={300}
              onChange={(e) => set({ note: e.target.value || undefined })}
            />
          </MoreOptions>
        ) : null}
      </FormRow>

      {step.type === "choice" ? (
        <ChoiceRows step={step} canEdit={canEdit} onChange={onChange} onRemoveOption={onRemoveOption} />
      ) : null}
      {step.type === "fields" ? <FieldsRows step={step} canEdit={canEdit} onChange={onChange} /> : null}
      {step.type === "message" ? <MessageRows step={step} canEdit={canEdit} onChange={onChange} /> : null}

      <FormRow
        title="Quem vê esta tela"
        hint={
          step.showIf?.length
            ? "Só quem atende a todas as condições. Os outros pulam esta tela."
            : "Todo mundo. Para mostrar só a quem deu certa resposta antes, adicione uma condição."
        }
      >
        <ConditionEditor
          conditions={step.showIf ?? []}
          choices={choices}
          match="all"
          disabled={!canEdit}
          addLabel="Mostrar só para quem…"
          emptyHint="Só perguntas de escolha feitas antes desta tela podem virar condição."
          onChange={(showIf) => set({ showIf: showIf.length ? showIf : undefined })}
        />
      </FormRow>
    </>
  );
}

function ChoiceRows({
  step,
  canEdit,
  onChange,
  onRemoveOption,
}: {
  step: ChoiceStep;
  canEdit: boolean;
  onChange: Change;
  onRemoveOption: (optionId: string) => void;
}) {
  const set = (patch: Partial<ChoiceStep>) => onChange((s) => (s.type === "choice" ? { ...s, ...patch } : s));

  return (
    <FormRow
      title="Opções"
      hint={
        step.multiple
          ? "A pessoa marca quantas quiser e clica em Continuar."
          : "Um toque escolhe e já avança para a próxima tela."
      }
    >
      <div className="space-y-2">
        {step.options.map((option, i) => (
          <div key={option.id} className="flex items-center gap-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-xs font-medium text-muted-foreground">
              {"ABCDEFGHIJKLMNOPQRST"[i]}
            </span>
            <Input
              value={option.label}
              disabled={!canEdit}
              maxLength={160}
              aria-label={`Opção ${i + 1}`}
              onChange={(e) =>
                set({ options: step.options.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)) })
              }
            />
            {canEdit ? (
              <span className="flex shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === 0}
                  aria-label={`Subir a opção ${i + 1}`}
                  onClick={() => set({ options: moveItem(step.options, i, i - 1) })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === step.options.length - 1}
                  aria-label={`Descer a opção ${i + 1}`}
                  onClick={() => set({ options: moveItem(step.options, i, i + 1) })}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={step.options.length <= 1}
                  aria-label={`Remover a opção ${i + 1}`}
                  onClick={() => onRemoveOption(option.id)}
                >
                  <X />
                </Button>
              </span>
            ) : null}
          </div>
        ))}
        {canEdit && step.options.length < LIMITS.options ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => set({ options: [...step.options, { id: newId("o"), label: "Nova opção" }] })}
          >
            <Plus />
            Adicionar opção
          </Button>
        ) : null}
      </div>
      <label className="flex items-center gap-3 border-t border-dashed border-border pt-3 text-sm text-foreground">
        <Switch
          checked={step.multiple === true}
          disabled={!canEdit}
          onCheckedChange={(on) => set({ multiple: on ? true : undefined })}
        />
        Permitir mais de uma resposta
      </label>
    </FormRow>
  );
}

function FieldsRows({ step, canEdit, onChange }: { step: FieldsStep; canEdit: boolean; onChange: Change }) {
  const set = (patch: Partial<FieldsStep>) => onChange((s) => (s.type === "fields" ? { ...s, ...patch } : s));
  const setField = (fieldId: string, patch: Partial<FieldsStep["fields"][number]>) =>
    set({ fields: step.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) });

  return (
    <>
      <FormRow
        title="Campos"
        hint="Nome, WhatsApp, e-mail, empresa, cidade e Instagram preenchem o contato no CRM. Os outros viram respostas do lead."
      >
        <div className="space-y-2">
          {step.fields.map((field, i) => (
            <div key={field.id} className="rounded-xl border border-border bg-background/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SelectBox
                  className="w-36 shrink-0"
                  value={field.kind}
                  disabled={!canEdit}
                  aria-label={`Tipo do campo ${i + 1}`}
                  onChange={(e) => setField(field.id, { kind: e.target.value as FieldKind })}
                >
                  {FIELD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {FIELD_KIND_LABEL[kind]}
                    </option>
                  ))}
                </SelectBox>
                <Input
                  value={field.label}
                  disabled={!canEdit}
                  maxLength={120}
                  placeholder="Rótulo"
                  aria-label={`Rótulo do campo ${i + 1}`}
                  className="min-w-0 flex-1 basis-40"
                  onChange={(e) => setField(field.id, { label: e.target.value })}
                />
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={step.fields.length <= 1}
                    aria-label={`Remover o campo ${i + 1}`}
                    onClick={() => set({ fields: step.fields.filter((f) => f.id !== field.id) })}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Input
                  value={field.placeholder ?? ""}
                  disabled={!canEdit}
                  maxLength={120}
                  placeholder="Exemplo dentro do campo (opcional)"
                  aria-label={`Exemplo do campo ${i + 1}`}
                  className="min-w-0 flex-1 basis-48"
                  onChange={(e) => setField(field.id, { placeholder: e.target.value || undefined })}
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={field.required}
                    disabled={!canEdit}
                    onCheckedChange={(required) => setField(field.id, { required })}
                  />
                  Obrigatório
                </label>
              </div>
            </div>
          ))}
          {canEdit && step.fields.length < LIMITS.fields ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <Plus />
                Adicionar campo
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-48">
                {FIELD_KINDS.map((kind) => (
                  <DropdownMenuItem
                    key={kind}
                    onClick={() => set({ fields: [...step.fields, newField(kind, kind !== "instagram")] })}
                  >
                    {FIELD_KIND_LABEL[kind]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </FormRow>
      <FormRow title="Botão">
        <Input
          aria-label="Texto do botão"
          value={step.cta}
          disabled={!canEdit}
          maxLength={60}
          className="max-w-sm"
          onChange={(e) => set({ cta: e.target.value })}
        />
      </FormRow>
    </>
  );
}

function MessageRows({ step, canEdit, onChange }: { step: MessageStep; canEdit: boolean; onChange: Change }) {
  const set = (patch: Partial<MessageStep>) => onChange((s) => (s.type === "message" ? { ...s, ...patch } : s));
  return (
    <>
      <FormRow title="Texto" hint="Use **negrito** para destacar um trecho.">
        <Textarea
          aria-label="Texto da mensagem"
          value={step.text ?? ""}
          disabled={!canEdit}
          maxLength={1200}
          rows={4}
          onChange={(e) => set({ text: e.target.value || undefined })}
        />
      </FormRow>
      <FormRow title="Botão">
        <Input
          aria-label="Texto do botão"
          value={step.cta}
          disabled={!canEdit}
          maxLength={60}
          className="max-w-sm"
          onChange={(e) => set({ cta: e.target.value })}
        />
      </FormRow>
    </>
  );
}
