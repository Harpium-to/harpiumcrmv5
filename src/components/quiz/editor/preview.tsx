"use client";

// ============================================================
// The phone beside the editor.
//
// It shows the screen being edited — the same components the public
// page uses, fed with the draft — or the whole quiz played from the
// start, with a reporter that sends nothing. No visit is recorded and
// no Pixel fires from here.
//
// A result screen is shown with every block, including the ones a
// condition would hide: while writing, the author needs to see them
// all.
// ============================================================

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";

import { findStep } from "@/lib/quiz/engine";
import type { QuizDefinition } from "@/lib/quiz/types";

import { Button } from "@/components/ui/button";

import { QuizPlayer } from "../quiz-player";
import {
  ChoiceScreen,
  FieldsScreen,
  IntroScreen,
  MessageScreen,
  QuizFrame,
  ResultScreen,
} from "../quiz-screens";
import { SILENT_REPORTER } from "../quiz-tracking";
import type { PreviewTarget } from "./ui";

/** A person to fill the variables with while editing. */
const SAMPLE = {
  nome: "Ana",
  empresa: "Planejados Silva",
  whatsapp: "(11) 91234-5678",
  email: "ana@email.com",
  cidade: "Palmas",
};

const noop = () => {};

interface QuizPreviewProps {
  definition: QuizDefinition;
  business: string;
  target: PreviewTarget;
  onTarget: (target: PreviewTarget) => void;
}

export function QuizPreview({ definition, business, target, onTarget }: QuizPreviewProps) {
  // Bumped to start the test run over.
  const [run, setRun] = useState(0);
  const running = target.kind === "run";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-[390px] items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {running
            ? "Teste do início ao fim. Nada é enviado."
            : target.kind === "result"
              ? "Prévia do resultado, com todos os blocos condicionais"
              : "Prévia da tela em edição"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRun((n) => n + 1);
            onTarget({ kind: "run" });
          }}
        >
          {running ? <RotateCcw /> : <Play />}
          {running ? "Recomeçar" : "Testar do início"}
        </Button>
      </div>

      {/* The frame is a phone's width, so the quiz lays out as on a phone. */}
      <div className="h-[min(720px,calc(100vh-11rem))] w-full max-w-[390px] overflow-hidden rounded-[2rem] border border-foreground/15 bg-[#fafafb] shadow-xl">
        <div className="h-full overflow-y-auto">
          {running ? (
            <QuizPlayer
              key={run}
              definition={definition}
              business={business}
              slug="previa"
              reporter={SILENT_REPORTER}
              live={false}
              fill="box"
            />
          ) : (
            <StaticScreen definition={definition} business={business} target={target} />
          )}
        </div>
      </div>
    </div>
  );
}

function StaticScreen({
  definition: def,
  business,
  target,
}: {
  definition: QuizDefinition;
  business: string;
  target: Exclude<PreviewTarget, { kind: "run" }>;
}) {
  if (target.kind === "result") {
    const result = def.results.find((r) => r.id === target.id) ?? def.results[0];
    return (
      <QuizFrame definition={def} business={business} progress={1} fill="box">
        <ResultScreen key={result.id} result={result} blocks={result.blocks} vars={SAMPLE} showEmptyButtons />
      </QuizFrame>
    );
  }

  const step = target.kind === "step" ? findStep(def, target.id) : undefined;
  if (!step) {
    return (
      <QuizFrame definition={def} business={business} fill="box">
        {def.intro.enabled ? (
          <IntroScreen intro={def.intro} onStart={noop} autoFocus={false} />
        ) : (
          <div className="qz-center">A tela de entrada está desligada.</div>
        )}
      </QuizFrame>
    );
  }

  const index = def.steps.findIndex((s) => s.id === step.id);
  const last = index === def.steps.length - 1;
  return (
    <QuizFrame
      definition={def}
      business={business}
      counter={{ current: index + 1, total: def.steps.length }}
      progress={index / Math.max(def.steps.length, 1)}
      fill="box"
    >
      {/* Remounted when the shape of the step changes, so the screen's
          own state (typed text, marked option) never outlives an edit. */}
      <div key={`${step.id}:${step.type === "fields" ? step.fields.map((f) => f.id + f.kind).join() : ""}`}>
        {step.type === "choice" ? (
          <ChoiceScreen step={step} vars={SAMPLE} selected={[]} onAnswer={noop} />
        ) : step.type === "fields" ? (
          <FieldsScreen
            step={step}
            vars={SAMPLE}
            initial={{}}
            autoFocus={false}
            extras={
              last
                ? {
                    privacyNote: def.settings.privacyNote,
                    consentText: def.settings.consentText,
                    privacyUrl: def.settings.privacyUrl,
                  }
                : undefined
            }
            onSubmit={noop}
          />
        ) : (
          <MessageScreen step={step} vars={SAMPLE} onContinue={noop} autoFocus={false} />
        )}
      </div>
    </QuizFrame>
  );
}
