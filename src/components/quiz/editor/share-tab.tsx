"use client";

// ============================================================
// Divulgação: the public link and its address, a link builder for
// campaigns (UTMs), the Meta Pixel and the tags every lead of this
// quiz gets.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

import { publicQuizUrl, slugProblem } from "@/lib/quiz/slug";
import type { QuizStatus } from "@/lib/quiz/types";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Field, Section, TagsInput, type TabProps } from "./ui";

export interface ShareTabProps extends TabProps {
  quiz: { id: string; slug: string; status: QuizStatus; hasCapiToken: boolean };
  /** Change the public address. Rejects with the reason in words. */
  onSaveSlug: (slug: string) => Promise<void>;
  /** Save (or, empty, remove) the Conversions API token. */
  onSaveCapiToken: (token: string) => Promise<void>;
  /** The signed-in person is from the agency. */
  isAgencia: boolean;
}

export async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie.");
  }
}

const UTM_FIELDS = [
  ["utm_source", "Origem", "ex.: facebook"],
  ["utm_medium", "Mídia", "ex.: cpc"],
  ["utm_campaign", "Campanha", "ex.: planejados-nov"],
  ["utm_content", "Criativo", "ex.: video-depoimento"],
] as const;

export function ShareTab({ draft, update, canEdit, quiz, onSaveSlug }: ShareTabProps) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = publicQuizUrl(origin, quiz.slug);
  const live = quiz.status === "published";

  const [slug, setSlug] = useState(quiz.slug);
  const [savingSlug, setSavingSlug] = useState(false);
  const slugIssue = slug === quiz.slug ? null : slugProblem(slug);

  const [utms, setUtms] = useState<Record<string, string>>({});
  const campaignUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key] of UTM_FIELDS) {
      const value = (utms[key] ?? "").trim();
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `${url}?${query}` : url;
  }, [url, utms]);

  const saveSlug = async () => {
    setSavingSlug(true);
    try {
      await onSaveSlug(slug);
      toast.success("Endereço alterado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui mudar o endereço");
    } finally {
      setSavingSlug(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Section
        title="Link público"
        hint={
          live
            ? "É este o endereço que vai no anúncio, na bio e no WhatsApp. Abre sem login."
            : "O link começa a funcionar quando o quiz é publicado."
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-64 truncate rounded-lg bg-foreground/6 px-3 py-2 font-mono text-sm text-foreground">
            {url}
          </code>
          <Button type="button" variant="outline" onClick={() => void copyText(url, "Link copiado")}>
            <Copy />
            Copiar
          </Button>
          {live ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              <ExternalLink />
              Abrir
            </a>
          ) : null}
        </div>

        {canEdit ? (
          <div className="mt-6 max-w-xl">
            <Field
              label="Endereço"
              htmlFor="quiz-slug"
              hint={
                slugIssue ??
                "Letras minúsculas, números e hífens. Mudar o endereço faz o link antigo parar de funcionar: troque também nos anúncios."
              }
            >
              <div className="flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-lg border border-input pl-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                  <span className="shrink-0 font-mono text-sm text-muted-foreground">/q/</span>
                  <input
                    id="quiz-slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                    maxLength={60}
                    aria-invalid={slugIssue ? true : undefined}
                    className="h-9 min-w-0 flex-1 bg-transparent pr-2.5 font-mono text-sm text-foreground outline-none"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={slug === quiz.slug || !!slugIssue || savingSlug}
                  onClick={() => void saveSlug()}
                >
                  {savingSlug ? <Loader2 className="animate-spin" /> : null}
                  Salvar endereço
                </Button>
              </div>
            </Field>
          </div>
        ) : null}
      </Section>

      <Section
        title="Link de campanha"
        hint="Preencha o que quiser medir e use o link gerado no anúncio. A campanha e o criativo aparecem no relatório e no lead."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {UTM_FIELDS.map(([key, label, placeholder]) => (
            <Field key={key} label={label} htmlFor={`utm-${key}`}>
              <Input
                id={`utm-${key}`}
                value={utms[key] ?? ""}
                placeholder={placeholder}
                maxLength={120}
                onChange={(e) => setUtms((now) => ({ ...now, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-64 truncate rounded-lg bg-foreground/6 px-3 py-2 font-mono text-xs text-foreground">
            {campaignUrl}
          </code>
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyText(campaignUrl, "Link de campanha copiado")}
          >
            <Copy />
            Copiar
          </Button>
        </div>
      </Section>

      <Section
        title="Pixel da Meta"
        hint="Com o ID do Pixel, a página registra a visita e dispara um evento quando a pessoa chega a um resultado. Qual evento cada resultado dispara é escolhido na aba Resultados."
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <Field label="ID do Pixel" htmlFor="quiz-pixel" hint="Só números. Vazio = Pixel desligado.">
            <Input
              id="quiz-pixel"
              inputMode="numeric"
              value={draft.settings.pixelId ?? ""}
              disabled={!canEdit}
              placeholder="ex.: 1234567890123456"
              maxLength={30}
              onChange={(e) =>
                update((d) => ({
                  ...d,
                  settings: { ...d.settings, pixelId: e.target.value.replace(/\D/g, "") || undefined },
                }))
              }
            />
          </Field>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Evento de cada resultado</p>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {draft.results.map((result) => (
                <li key={result.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-foreground">{result.name}</span>
                  <span className="text-muted-foreground">
                    {result.pixel.kind === "none"
                      ? "não envia evento"
                      : `${result.pixel.name} (${result.pixel.kind === "standard" ? "evento padrão" : "evento personalizado"})`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        title="Etiquetas de todo lead"
        hint="Aplicadas a todos os leads deste quiz, além das etiquetas de cada resultado. Servem para filtrar contatos e disparar automações."
      >
        <div className="max-w-xl">
          <TagsInput
            value={draft.settings.tags}
            disabled={!canEdit}
            onChange={(tags) => update((d) => ({ ...d, settings: { ...d.settings, tags } }))}
          />
        </div>
      </Section>
    </div>
  );
}
