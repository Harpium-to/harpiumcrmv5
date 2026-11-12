"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ListChecks, Sparkles } from "lucide-react";

import { DisplayHeading } from "@/components/ui/display-heading";

interface QuizNumbers {
  count: number;
  published: number;
  leads: number;
}

/**
 * Ferramentas: the extra tools of the CRM, one card each. Quiz e
 * formulários is the first; the next ones land on this same screen, so
 * the top bar keeps a single button however many there are.
 */
export default function ToolsPage() {
  const [numbers, setNumbers] = useState<QuizNumbers | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quiz")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.quizzes) return;
        const quizzes = json.quizzes as { status: string; totals: { leads: number } }[];
        setNumbers({
          count: quizzes.length,
          published: quizzes.filter((q) => q.status === "published").length,
          leads: quizzes.reduce((sum, q) => sum + q.totals.leads, 0),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <DisplayHeading title="Ferramentas" subtitle="para trazer mais leads" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/ferramentas/quiz"
          className="surface fx-lift group flex flex-col rounded-3xl p-6 transition-colors"
        >
          <div className="flex items-start justify-between">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <ListChecks className="size-5" />
            </span>
            <ArrowUpRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
          </div>
          <h2 className="mt-5 text-lg font-medium text-foreground">Quiz e formulários</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Páginas de perguntas, uma por tela, para divulgar em anúncios e na bio. Quem
            conclui vira lead no CRM, com as respostas e a rota de qualificação.
          </p>
          <p className="mt-5 text-xs text-muted-foreground tabular-nums">
            {numbers === null
              ? " "
              : numbers.count === 0
                ? "Nenhum quiz ainda"
                : `${numbers.count} ${numbers.count === 1 ? "quiz" : "quizzes"} · ${numbers.published} no ar · ${numbers.leads} ${numbers.leads === 1 ? "lead" : "leads"}`}
          </p>
        </Link>

        <div className="flex flex-col justify-center rounded-3xl border border-dashed border-foreground/15 p-6">
          <Sparkles className="size-5 text-muted-foreground" />
          <p className="mt-4 text-sm font-medium text-foreground">Mais ferramentas em breve</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            As próximas ferramentas do CRM aparecem aqui.
          </p>
        </div>
      </div>
    </div>
  );
}
