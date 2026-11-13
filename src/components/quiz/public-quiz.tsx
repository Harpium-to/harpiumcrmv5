"use client";

// ============================================================
// The public page of a quiz (/q/<slug>): loads the published
// definition, starts the Pixel and the visit's record, and plays it.
//
// The definition is fetched here, without cache, rather than rendered
// on the server: the CRM's pages may sit at the edge for a few
// minutes, and an edit that was just published has to show at once.
//
// With `?embed=1` the page is inside an <iframe> on someone's site: it
// tells the parent its height, so the frame can grow with the screen
// instead of scrolling inside itself.
// ============================================================

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { PublicQuiz as PublicQuizData } from "@/lib/quiz/public";

import { QuizPlayer } from "./quiz-player";
import { createReporter, startPixel, type VisitReporter } from "./quiz-tracking";

import "./quiz-player.css";

/** True when the page was opened with `?embed=1` (inside an <iframe>). */
function isFramed(): boolean {
  return new URLSearchParams(window.location.search).get("embed") === "1";
}
const never = () => () => {};

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; quiz: PublicQuizData; reporter: VisitReporter };

export function PublicQuiz({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const root = useRef<HTMLDivElement>(null);
  // The server cannot know it, so it renders "not framed" and the
  // browser corrects it after hydration, without a mismatch.
  const embed = useSyncExternalStore(never, isFramed, () => false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/quiz/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setState({ status: "missing" });
        const quiz = (await res.json()) as PublicQuizData;
        if (cancelled) return;
        startPixel(quiz.definition.settings.pixelId);
        setState({
          status: "ready",
          quiz,
          reporter: createReporter(slug, { embed: isFramed() }),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Inside an iframe: keep the parent informed of how tall this is.
  useEffect(() => {
    if (!embed || !root.current || window.parent === window) return;
    const node = root.current;
    const send = () =>
      window.parent.postMessage(
        { type: "harpium-quiz:height", slug, height: Math.ceil(node.scrollHeight) },
        "*",
      );
    const observer = new ResizeObserver(send);
    observer.observe(node);
    send();
    return () => observer.disconnect();
  }, [embed, slug, state.status]);

  return (
    <div ref={root}>
      {state.status === "ready" ? (
        <QuizPlayer
          definition={state.quiz.definition}
          business={state.quiz.business}
          slug={slug}
          reporter={state.reporter}
          live
          fill={embed ? "box" : "page"}
        />
      ) : (
        <div className="qz" data-fill={embed ? "box" : "page"}>
          <div className="qz-wrap">
            <div className="qz-center" style={{ minHeight: embed ? 320 : "80dvh" }}>
              {state.status === "loading" ? (
                <span className="qz-spinner" role="status" aria-label="Carregando" />
              ) : (
                <p>Este link não está disponível.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
