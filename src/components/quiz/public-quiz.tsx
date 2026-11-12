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

import { useEffect, useMemo, useRef, useState } from "react";

import type { PublicQuiz as PublicQuizData } from "@/lib/quiz/public";

import { QuizPlayer } from "./quiz-player";
import { createReporter, startPixel, type VisitReporter } from "./quiz-tracking";

import "./quiz-player.css";

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; quiz: PublicQuizData; reporter: VisitReporter };

export function PublicQuiz({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const root = useRef<HTMLDivElement>(null);
  const embed = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("embed") === "1",
    [],
  );

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
          reporter: createReporter(slug, {
            embed: new URLSearchParams(window.location.search).get("embed") === "1",
          }),
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
