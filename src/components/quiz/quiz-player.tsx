"use client";

// ============================================================
// Playing a quiz from the first screen to the result.
//
// Holds the visit: which screen is showing and what was answered. The
// list of screens is recomputed from the answers at every step, so a
// question that depends on an earlier answer appears or disappears as
// the person goes back and forth.
//
// At the end the result is worked out here, so it shows without
// waiting, and the visit is reported as done. The server works the
// result out again on its own; if the two ever disagree, the server's
// is the one shown and the one that reached the CRM.
//
// The same component runs the public page and the builder's "Testar
// do início" — there with a reporter that sends nothing.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

import {
  contactFrom,
  evaluate,
  varsFrom,
  visibleBlocks,
  visibleSteps,
} from "@/lib/quiz/engine";
import {
  INTRO_STEP,
  RESULT_STEP,
  type QuizAnswer,
  type QuizAnswers,
  type QuizDefinition,
  type QuizResult,
} from "@/lib/quiz/types";

import {
  BackButton,
  ChoiceScreen,
  FieldsScreen,
  IntroScreen,
  MessageScreen,
  QuizFrame,
  ResultScreen,
} from "./quiz-screens";
import { pushStage, randomId, trackResult, type VisitReporter } from "./quiz-tracking";

/** How long the result waits for the server before showing anyway. */
const RESULT_WAIT_MS = 4000;

interface QuizPlayerProps {
  definition: QuizDefinition;
  /** The business's name, for the header of a quiz with no logo. */
  business: string;
  slug: string;
  reporter: VisitReporter;
  /** Fire the Pixel and the dataLayer events. Off in the builder. */
  live: boolean;
  fill?: "page" | "box";
}

export function QuizPlayer({
  definition: def,
  business,
  slug,
  reporter,
  live,
  fill = "page",
}: QuizPlayerProps) {
  const [started, setStarted] = useState(!def.intro.enabled);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const consented = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => visibleSteps(def, answers), [def, answers]);
  const position = Math.min(index, Math.max(steps.length - 1, 0));
  const step = steps[position];
  const vars = useMemo(() => varsFrom(contactFrom(def, answers)), [def, answers]);

  // Every screen change is recorded: this is what the report's funnel
  // is made of. The answers go along, so who stops here is still seen.
  const screen = result ? RESULT_STEP : started ? step?.id : INTRO_STEP;
  useEffect(() => {
    if (!screen || screen === RESULT_STEP) return;
    if (screen !== INTRO_STEP) top.current?.scrollIntoView({ block: "start" });
    if (live) pushStage(screen);
    void reporter.report(screen, { answers });
    // The answers are read as they are when the screen changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const finish = async (final: QuizAnswers, trap = "") => {
    const outcome = evaluate(def, final);
    if (!outcome) return;
    setSending(true);
    const eventId = randomId();
    if (live) {
      trackResult(outcome.result.pixel, slug, eventId);
      pushStage(`resultado_${outcome.result.id}`);
    }
    const reported = await Promise.race([
      reporter.report(RESULT_STEP, {
        answers: final,
        eventId,
        done: true,
        consent: consented.current,
        website: trap,
      }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), RESULT_WAIT_MS)),
    ]);
    const decided = def.results.find((r) => r.id === reported?.result) ?? outcome.result;
    setSending(false);
    setResult(decided);
    top.current?.scrollIntoView({ block: "start" });
  };

  /** Store an answer and move to the next screen it leads to. */
  const advance = (patch: Record<string, QuizAnswer>, trap?: string) => {
    if (!step) return;
    const next = { ...answers, ...patch };
    const nextSteps = visibleSteps(def, next);
    const here = nextSteps.findIndex((s) => s.id === step.id);
    setAnswers(next);
    if (here === -1 || here >= nextSteps.length - 1) {
      void finish(next, trap);
    } else {
      setIndex(here + 1);
    }
  };

  const back = () => {
    if (position === 0) setStarted(false);
    else setIndex(position - 1);
  };

  const total = steps.length;
  const lastStep = position === total - 1;
  const frame = { definition: def, business, fill };

  let body: React.ReactNode;
  let chrome: { counter?: { current: number; total: number }; progress?: number } = {};

  if (!started) {
    body = (
      <IntroScreen
        intro={def.intro}
        onStart={() => {
          setIndex(0);
          setStarted(true);
        }}
      />
    );
  } else if (result) {
    chrome = { progress: 1 };
    body = (
      <ResultScreen
        result={result}
        blocks={visibleBlocks(result, def, answers)}
        vars={vars}
        onButtonClick={() => void reporter.report(null, { cta: true })}
      />
    );
  } else if (!step) {
    body = <div className="qz-center">Este quiz ainda não tem perguntas.</div>;
  } else if (sending && step.type !== "fields") {
    chrome = { counter: { current: position + 1, total }, progress: position / total };
    body = (
      <div className="qz-center">
        <span className="qz-spinner" aria-hidden />
        <p>{def.settings.submittingText || "Montando seu resultado…"}</p>
      </div>
    );
  } else {
    chrome = { counter: { current: position + 1, total }, progress: position / total };
    const saved = answers[step.id];
    body = (
      // Keyed by step: each screen starts fresh and eases in.
      <div key={step.id}>
        {step.type === "choice" ? (
          <ChoiceScreen
            step={step}
            vars={vars}
            selected={saved === undefined ? [] : Array.isArray(saved) ? saved : [saved]}
            onAnswer={(value) => advance({ [step.id]: value })}
          />
        ) : step.type === "fields" ? (
          <FieldsScreen
            step={step}
            vars={vars}
            initial={answers}
            sending={sending}
            extras={
              lastStep
                ? {
                    privacyNote: def.settings.privacyNote,
                    consentText: def.settings.consentText,
                    privacyUrl: def.settings.privacyUrl,
                    submittingText: def.settings.submittingText,
                  }
                : undefined
            }
            onSubmit={(values, trap) => {
              if (lastStep && def.settings.consentText) consented.current = true;
              advance(values, trap);
            }}
          />
        ) : (
          <MessageScreen step={step} vars={vars} onContinue={() => advance({})} />
        )}

        {!sending && (position > 0 || def.intro.enabled) ? <BackButton onClick={back} /> : null}
      </div>
    );
  }

  return (
    // The anchor every screen change scrolls back to.
    <div ref={top}>
      <QuizFrame {...frame} {...chrome}>
        {body}
      </QuizFrame>
    </div>
  );
}
