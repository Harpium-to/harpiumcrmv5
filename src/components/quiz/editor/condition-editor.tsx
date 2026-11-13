"use client";

// ============================================================
// "The answer to <question> is / is not <options>", as many times as
// needed. Shared by the three places a quiz has logic: showing a
// screen only to some people, the rule that leads to a result, and the
// blocks and tags that depend on an answer.
// ============================================================

import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChoiceStep, QuizCondition } from "@/lib/quiz/types";

import { Button } from "@/components/ui/button";

import { SelectBox } from "./ui";

interface ConditionEditorProps {
  conditions: QuizCondition[];
  onChange: (conditions: QuizCondition[]) => void;
  /** The questions a condition here may read. */
  choices: ChoiceStep[];
  disabled?: boolean;
  /** Text of the "add" button. */
  addLabel?: string;
  /** Shown when there is no question to read yet. */
  emptyHint?: string;
}

export function ConditionEditor({
  conditions,
  onChange,
  choices,
  disabled,
  addLabel = "Adicionar condição",
  emptyHint = "Adicione antes uma pergunta de escolha para poder criar condições.",
}: ConditionEditorProps) {
  if (choices.length === 0 && conditions.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyHint}</p>;
  }

  const set = (index: number, next: QuizCondition) =>
    onChange(conditions.map((c, i) => (i === index ? next : c)));

  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => {
        const step = choices.find((s) => s.id === condition.stepId);
        return (
          <div
            key={index}
            className="rounded-xl border border-border bg-background/40 p-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <SelectBox
                className="min-w-0 flex-1 basis-48"
                value={step ? condition.stepId : ""}
                disabled={disabled}
                aria-label="Pergunta"
                onChange={(e) =>
                  set(index, { stepId: e.target.value, op: condition.op, optionIds: [] })
                }
              >
                {!step ? <option value="">Escolha a pergunta…</option> : null}
                {choices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </SelectBox>
              <SelectBox
                className="w-28 shrink-0"
                value={condition.op}
                disabled={disabled}
                aria-label="Comparação"
                onChange={(e) =>
                  set(index, { ...condition, op: e.target.value === "is_not" ? "is_not" : "is" })
                }
              >
                <option value="is">é</option>
                <option value="is_not">não é</option>
              </SelectBox>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={() => onChange(conditions.filter((_, i) => i !== index))}
                aria-label="Remover condição"
                className="shrink-0 text-muted-foreground"
              >
                <X />
              </Button>
            </div>
            {step ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {step.options.map((option) => {
                  const on = condition.optionIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={on}
                      onClick={() =>
                        set(index, {
                          ...condition,
                          optionIds: on
                            ? condition.optionIds.filter((id) => id !== option.id)
                            : [...condition.optionIds, option.id],
                        })
                      }
                      className={cn(
                        "max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
                {condition.optionIds.length === 0 ? (
                  <span className="self-center text-xs text-amber-600 dark:text-amber-400">
                    Marque pelo menos uma opção.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {!disabled && choices.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...conditions, { stepId: choices[0].id, op: "is", optionIds: [] }])
          }
        >
          <Plus />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}
