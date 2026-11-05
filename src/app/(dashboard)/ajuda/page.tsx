"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Lightbulb, Search } from "lucide-react";

import { DisplayHeading } from "@/components/ui/display-heading";
import { Input } from "@/components/ui/input";
import { HELP_TOPICS, searchTopics } from "@/lib/help/topics";

/**
 * The tutorial: every screen explained step by step, plus the setup
 * guides that span several screens. The "?" in the top bar and each ⓘ
 * link here by anchor (`/ajuda#funis`), so each topic is a section
 * with its own id rather than a page of its own.
 */
export default function HelpPage() {
  const [query, setQuery] = useState("");
  const topics = useMemo(() => searchTopics(query), [query]);

  return (
    <div className="space-y-8">
      <DisplayHeading title="Ajuda" subtitle="e tutoriais" />

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        O passo a passo de cada tela do sistema. Em qualquer tela, o botão ? no topo abre o
        resumo daquela tela, e o ícone ⓘ ao lado de um campo explica o que preencher.
      </p>

      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar na ajuda…"
              aria-label="Buscar na ajuda"
              className="pl-9"
            />
          </div>
          <nav aria-label="Tutoriais" className="hidden lg:block">
            <ul className="space-y-0.5 text-sm">
              {HELP_TOPICS.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
                  >
                    {t.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="space-y-6">
          {topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada encontrado para “{query}”. Tente outra palavra.
            </p>
          ) : null}

          {topics.map((t) => (
            <section
              key={t.id}
              id={t.id}
              className="surface scroll-mt-24 space-y-4 rounded-2xl p-5 sm:p-6"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">{t.title}</h2>
                {t.route ? (
                  <Link href={t.route} className="text-xs font-medium text-primary hover:underline">
                    Abrir a tela →
                  </Link>
                ) : null}
              </header>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.summary}</p>

              <ol className="space-y-2.5">
                {t.steps.map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary tabular-nums">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>

              {t.tips && t.tips.length > 0 ? (
                <div className="space-y-1.5 rounded-xl bg-foreground/5 p-3.5">
                  {t.tips.map((tip) => (
                    <p key={tip} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{tip}</span>
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ))}

          <p className="text-sm text-muted-foreground">
            Não achou o que procurava? Fale com o suporte da Harpium.
          </p>
        </div>
      </div>
    </div>
  );
}
