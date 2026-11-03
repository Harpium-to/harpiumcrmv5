"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AnalystPanelProps {
  /** Query string for the window being looked at. */
  query: string;
  /** False for members who may read reports but not spend AI credit. */
  canAsk: boolean;
}

const SUGGESTION_KEYS = [
  "suggestWhyLost",
  "suggestBestSource",
  "suggestAgentCost",
  "suggestForecast",
] as const;

/**
 * Ask a question about the window on screen.
 *
 * The answer is generated from figures the *server* recomputes for the
 * same window — the page never posts its numbers back. That is a
 * security property, not an optimisation: a caller who could supply
 * the figures could have the analyst restate them as fact in fluent
 * prose, and a fabricated number wrapped in analysis is far more
 * convincing than a fabricated spreadsheet.
 *
 * The note under the box says the answer only covers the selected
 * period. People ask "como estamos?" and read the answer as being
 * about the business, not about the thirty days the filter happens to
 * be on.
 */
export function AnalystPanel({ query, canAsk }: AnalystPanelProps) {
  const t = useTranslations("Reports");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (asking || trimmed.length < 3) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch(`/api/reports/ask?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? t("askFailed"));
      setAnswer(data.answer ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("askFailed"));
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="surface rounded-2xl p-5">
      <header className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            {t("analystTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("analystHint")}
          </p>
        </div>
      </header>

      {canAsk ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTION_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="chip"
                disabled={asking}
                onClick={() => {
                  setQuestion(t(key));
                  void ask(t(key));
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>

          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={t("analystPlaceholder")}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line: this is a
                // question box, not a document.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("analystScope")}
              </p>
              <Button
                type="submit"
                size="sm"
                disabled={asking || question.trim().length < 3}
              >
                {asking ? <Loader2 className="animate-spin" /> : <Send />}
                {t("ask")}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("analystNoPermission")}
        </p>
      )}

      {answer ? (
        <div className="mt-4 rounded-2xl bg-foreground/5 p-4">
          {/* Plain paragraphs, not markdown: nothing here renders a
              model's formatting, so there is no path for its output to
              become markup on the page. */}
          {answer
            .split(/\n{2,}/)
            .filter((block) => block.trim())
            .map((block, i) => (
              <p
                key={i}
                className="text-sm leading-relaxed whitespace-pre-line text-foreground not-first:mt-3"
              >
                {block.trim()}
              </p>
            ))}
        </div>
      ) : null}
    </section>
  );
}
