"use client";

// ============================================================
// Conditions, written as sentences: "A resposta de <pergunta> é /
// não é uma destas: <opções>", joined by "E" or "OU".
//
// Shared by the three places a quiz has logic: showing a screen only
// to some people, the rule that leads to a result, and the blocks and
// tags that depend on an answer.
// ============================================================

import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChoiceStep, QuizCondition } from "@/lib/quiz/types";

import { Button } from "@/components/ui/button";

import { Connector, SelectBox } from "./ui";

interface ConditionEditorProps {
  conditions: QuizCondition[];
  onChange: (conditions: QuizCondition[]) => void;
  /** The questions a condition here may read. */
  choices: ChoiceStep[];
  /** How the conditions combine; drawn between them. */
  match?: "all" | "any";
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
  match = "all",
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
    <div>
      {conditions.map((condition, index) => {
        const step = choices.find((s) => s.id === condition.stepId);
        return (
          <div key={index}>
            {index > 0 ? <Connector match={match} /> : null}
            <div className="rounded-xl border border-border bg-background/50 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-foreground">
                <span className="text-muted-foreground">A resposta de</span>
                <SelectBox
                  className="w-auto min-w-0 flex-1 basis-44"
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
                  className="w-32 shrink-0"
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
                  className="ml-auto shrink-0 text-muted-foreground"
                >
                  <X />
                </Button>
              </div>
              {step ? (
                <>
                  <p className="mt-2.5 mb-1.5 text-xs text-muted-foreground">
                    {condition.op === "is" ? "uma destas opções:" : "nenhuma destas opções:"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
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
                  </div>
                  {condition.optionIds.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Marque pelo menos uma opção: sem ela, esta condição é descartada ao salvar.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      {!disabled && choices.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={conditions.length > 0 ? "mt-2" : undefined}
          onClick={() =>
            onChange([...conditions, { stepId: choices[0].id, op: "is", optionIds: [] }])
          }
        >
          <Plus />
          {conditions.length > 0 ? (match === "all" ? "E também…" : "Ou então…") : addLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** A condition in words, for a closed card ("Cargo é Gerente"). */
export function describeConditions(conditions: QuizCondition[], choices: ChoiceStep[], match: "all" | "any") {
  const parts = conditions
    .map((c) => {
      const step = choices.find((s) => s.id === c.stepId);
      if (!step) return "";
      const said = c.optionIds
        .map((id) => step.options.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(" ou ");
      return `${step.label} ${c.op === "is" ? "é" : "não é"} ${said || "…"}`;
    })
    .filter(Boolean);
  return parts.join(match === "all" ? " e " : " ou ");
}
