"use client";

// ============================================================
// Perguntas: the screens of the quiz, in the order a visitor meets
// them — the entry screen first, then the questions, dragged into
// place. One card is open at a time, and the phone preview beside the
// editor follows it.
// ============================================================

import { useState } from "react";
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
  ArrowUp,
  CopyPlus,
  DoorOpen,
  GitBranch,
  GripVertical,
  ListChecks,
  MessageSquareText,
  Plus,
  TextCursorInput,
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { ConditionEditor } from "./condition-editor";
import { Collapsible, Field, SelectBox, type PreviewTarget, type TabProps } from "./ui";

interface StepsTabProps extends TabProps {
  onFocus: (target: PreviewTarget) => void;
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

function StepIcon({ step }: { step: QuizStep }) {
  const Icon =
    step.type === "choice" ? ListChecks : step.type === "message" ? MessageSquareText : TextCursorInput;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

export function StepsTab({ draft, update, canEdit, onFocus }: StepsTabProps) {
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

  const add = (kind: (typeof STEP_KINDS)[number]["kind"]) => {
    const id = newId("s");
    update((d) => {
      const made = addStep(d, kind, open && open !== "intro" ? open : undefined);
      // Keep the id chosen here, so the new card can be opened at once.
      return {
        ...made.def,
        steps: made.def.steps.map((s) => (s.id === made.id ? { ...s, id } : s)),
      };
    });
    setOpen(id);
    onFocus({ kind: "step", id });
  };

  const intro = draft.intro;
  const setIntro = (patch: Partial<typeof intro>) =>
    update((d) => ({ ...d, intro: { ...d.intro, ...patch } }));

  return (
    <div className="space-y-3">
      {/* ---- Entry screen ---- */}
      <Collapsible
        open={open === "intro"}
        onToggle={() => toggle("intro")}
        header={
          <>
            <DoorOpen className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">
                Tela de entrada{intro.enabled ? "" : " · desligada"}
              </span>
              <span className="block truncate text-sm text-foreground">
                {intro.headline || "Sem título"}
              </span>
            </span>
          </>
        }
      >
        <label className="flex items-center gap-3 text-sm text-foreground">
          <Switch
            checked={intro.enabled}
            disabled={!canEdit}
            onCheckedChange={(enabled) => setIntro({ enabled })}
          />
          Mostrar a tela de entrada antes da primeira pergunta
        </label>
        <Field label="Linha acima do título" htmlFor="intro-tag">
          <Input
            id="intro-tag"
            value={intro.tag ?? ""}
            disabled={!canEdit}
            maxLength={80}
            placeholder="ex.: Diagnóstico gratuito · Móveis planejados"
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
        <Field label="Texto do botão" htmlFor="intro-cta" className="max-w-sm">
          <Input
            id="intro-cta"
            value={intro.cta}
            disabled={!canEdit}
            maxLength={60}
            onChange={(e) => setIntro({ cta: e.target.value })}
          />
        </Field>
        <Field
          label="Provas e garantias (abaixo do botão)"
          hint="A primeira parte sai em negrito. Ex.: “R$ 358 mil em vendas” + “em 9 meses”."
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
                  className="min-w-0 flex-1 basis-48"
                  onChange={(e) =>
                    setIntro({
                      bullets: intro.bullets.map((b, j) =>
                        j === i ? { ...b, strong: e.target.value } : b,
                      ),
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
                      bullets: intro.bullets.map((b, j) =>
                        j === i ? { ...b, text: e.target.value } : b,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit}
                  aria-label={`Remover prova ${i + 1}`}
                  onClick={() => setIntro({ bullets: intro.bullets.filter((_, j) => j !== i) })}
                >
                  <X />
                </Button>
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
        </Field>
      </Collapsible>

      {/* ---- Questions ---- */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={draft.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {draft.steps.map((step, index) => (
            <SortableStep
              key={step.id}
              step={step}
              index={index}
              open={open === step.id}
              onToggle={() => toggle(step.id)}
              canEdit={canEdit}
            >
              <StepEditor
                step={step}
                canEdit={canEdit}
                choices={choicesBefore(draft, step.id)}
                onChange={(change) => update((d) => updateStep(d, step.id, change))}
                onRemoveOption={(optionId) => update((d) => removeOption(d, step.id, optionId))}
              />
              {canEdit ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
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
                      setOpen(id);
                      onFocus({ kind: "step", id });
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
            </SortableStep>
          ))}
        </SortableContext>
      </DndContext>

      {canEdit && draft.steps.length < LIMITS.steps ? (
        <DropdownMenu>
          <DropdownMenuTrigger className={buttonVariants({ variant: "outline", className: "w-full" })}>
            <Plus />
            Adicionar tela
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72">
            {STEP_KINDS.map((item) => (
              <DropdownMenuItem key={item.kind} onClick={() => add(item.kind)} className="items-start py-1.5">
                <span>
                  <span className="block text-sm">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// One screen in the list
// ------------------------------------------------------------

function SortableStep({
  step,
  index,
  open,
  onToggle,
  canEdit,
  children,
}: {
  step: QuizStep;
  index: number;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-80")}
    >
      <Collapsible
        open={open}
        onToggle={onToggle}
        header={
          <>
            {canEdit ? (
              <button
                type="button"
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Mover a tela ${index + 1}`}
                className="-ml-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/8 active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </button>
            ) : null}
            <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <StepIcon step={step} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {stepKindLabel(step)}
                {step.showIf?.length ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground/8 px-1.5 py-0.5 text-[11px]">
                    <GitBranch className="size-3" />
                    condicional
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-sm text-foreground">
                {step.title || "Sem título"}
              </span>
            </span>
          </>
        }
      >
        {children}
      </Collapsible>
    </div>
  );
}

// ------------------------------------------------------------
// Editing one screen
// ------------------------------------------------------------

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
  onChange: (change: (step: QuizStep) => QuizStep) => void;
  onRemoveOption: (optionId: string) => void;
}) {
  const set = (patch: Partial<QuizStep>) => onChange((s) => ({ ...s, ...patch }) as QuizStep);
  const id = (name: string) => `${step.id}-${name}`;

  return (
    <>
      <Field
        label="Pergunta"
        htmlFor={id("title")}
        hint="Use {nome} para chamar a pessoa pelo primeiro nome (depois da tela que pergunta o nome)."
      >
        <Textarea
          id={id("title")}
          value={step.title}
          disabled={!canEdit}
          maxLength={300}
          rows={2}
          onChange={(e) => set({ title: e.target.value })}
        />
      </Field>

      <Field
        label="Nome curto"
        htmlFor={id("label")}
        hint="Como esta pergunta aparece no CRM, no relatório e no CSV."
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
        <ChoiceFields step={step} canEdit={canEdit} onChange={onChange} onRemoveOption={onRemoveOption} id={id} />
      ) : null}
      {step.type === "fields" ? (
        <FieldsFields step={step} canEdit={canEdit} onChange={onChange} id={id} />
      ) : null}
      {step.type === "message" ? (
        <MessageFields step={step} canEdit={canEdit} onChange={onChange} id={id} />
      ) : null}

      <Field
        label="Mostrar esta tela só para quem…"
        hint={
          step.showIf?.length
            ? "Quem não atende a todas as condições pula esta tela."
            : "Sem condição, todo mundo vê esta tela."
        }
      >
        <ConditionEditor
          conditions={step.showIf ?? []}
          choices={choices}
          disabled={!canEdit}
          emptyHint="Só perguntas de escolha feitas antes desta tela podem ser usadas como condição."
          onChange={(showIf) => set({ showIf: showIf.length ? showIf : undefined })}
        />
      </Field>
    </>
  );
}

type Change = (change: (step: QuizStep) => QuizStep) => void;

function ChoiceFields({
  step,
  canEdit,
  onChange,
  onRemoveOption,
  id,
}: {
  step: ChoiceStep;
  canEdit: boolean;
  onChange: Change;
  onRemoveOption: (optionId: string) => void;
  id: (name: string) => string;
}) {
  const set = (patch: Partial<ChoiceStep>) =>
    onChange((s) => (s.type === "choice" ? { ...s, ...patch } : s));

  return (
    <>
      <Field label="Opções">
        <div className="space-y-2">
          {step.options.map((option, i) => (
            <div key={option.id} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">
                {"ABCDEFGHIJKLMNOPQRST"[i]}
              </span>
              <Input
                value={option.label}
                disabled={!canEdit}
                maxLength={160}
                aria-label={`Opção ${i + 1}`}
                onChange={(e) =>
                  set({
                    options: step.options.map((o) =>
                      o.id === option.id ? { ...o, label: e.target.value } : o,
                    ),
                  })
                }
              />
              {canEdit ? (
                <>
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
                </>
              ) : null}
            </div>
          ))}
          {canEdit && step.options.length < LIMITS.options ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                set({ options: [...step.options, { id: newId("o"), label: "Nova opção" }] })
              }
            >
              <Plus />
              Adicionar opção
            </Button>
          ) : null}
        </div>
      </Field>

      <label className="flex items-center gap-3 text-sm text-foreground">
        <Switch
          checked={step.multiple === true}
          disabled={!canEdit}
          onCheckedChange={(on) => set({ multiple: on ? true : undefined })}
        />
        A pessoa pode marcar mais de uma opção
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Texto acima da pergunta (opcional)" htmlFor={id("context")}>
          <Input
            id={id("context")}
            value={step.context ?? ""}
            disabled={!canEdit}
            maxLength={400}
            onChange={(e) => set({ context: e.target.value || undefined })}
          />
        </Field>
        <Field label="Observação abaixo (opcional)" htmlFor={id("note")}>
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
    </>
  );
}

function FieldsFields({
  step,
  canEdit,
  onChange,
  id,
}: {
  step: FieldsStep;
  canEdit: boolean;
  onChange: Change;
  id: (name: string) => string;
}) {
  const set = (patch: Partial<FieldsStep>) =>
    onChange((s) => (s.type === "fields" ? { ...s, ...patch } : s));
  const setField = (fieldId: string, patch: Partial<FieldsStep["fields"][number]>) =>
    set({ fields: step.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) });

  return (
    <>
      <Field
        label="Campos"
        hint="Nome, WhatsApp, e-mail, empresa, cidade e Instagram vão para o contato no CRM. Os outros viram respostas do lead."
      >
        <div className="space-y-2">
          {step.fields.map((field, i) => (
            <div key={field.id} className="rounded-xl border border-border bg-background/40 p-2.5">
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
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Texto do botão" htmlFor={id("cta")}>
          <Input
            id={id("cta")}
            value={step.cta}
            disabled={!canEdit}
            maxLength={60}
            onChange={(e) => set({ cta: e.target.value })}
          />
        </Field>
        <Field label="Observação abaixo do título (opcional)" htmlFor={id("note")}>
          <Input
            id={id("note")}
            value={step.note ?? ""}
            disabled={!canEdit}
            maxLength={300}
            onChange={(e) => set({ note: e.target.value || undefined })}
          />
        </Field>
      </div>
    </>
  );
}

function MessageFields({
  step,
  canEdit,
  onChange,
  id,
}: {
  step: MessageStep;
  canEdit: boolean;
  onChange: Change;
  id: (name: string) => string;
}) {
  const set = (patch: Partial<MessageStep>) =>
    onChange((s) => (s.type === "message" ? { ...s, ...patch } : s));
  return (
    <>
      <Field label="Texto" htmlFor={id("text")} hint="Use **negrito** para destacar um trecho.">
        <Textarea
          id={id("text")}
          value={step.text ?? ""}
          disabled={!canEdit}
          maxLength={1200}
          rows={4}
          onChange={(e) => set({ text: e.target.value || undefined })}
        />
      </Field>
      <Field label="Texto do botão" htmlFor={id("cta")} className="max-w-sm">
        <Input
          id={id("cta")}
          value={step.cta}
          disabled={!canEdit}
          maxLength={60}
          onChange={(e) => set({ cta: e.target.value })}
        />
      </Field>
    </>
  );
}
