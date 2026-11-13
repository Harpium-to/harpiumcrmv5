"use client";

// ============================================================
// Divulgação: the public link and its address, a link builder for
// campaigns (UTMs), the Meta Pixel and the tags every lead of this
// quiz gets.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

import { embedQuizUrl, publicQuizUrl, slugProblem } from "@/lib/quiz/slug";
import type { QuizStatus } from "@/lib/quiz/types";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { Field, Section, TagsInput, type TabProps } from "./ui";

export interface ShareTabProps extends TabProps {
  quiz: { id: string; name: string; slug: string; status: QuizStatus; hasCapiToken: boolean };
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

/** What a client pastes into their site: the quiz in a frame that grows with it. */
function embedSnippet(url: string, slug: string): string {
  const id = `harpium-quiz-${slug}`;
  return [
    `<iframe id="${id}" title="Quiz" style="width:100%;border:0;min-height:640px" loading="lazy"></iframe>`,
    "<script>",
    "(function () {",
    `  var frame = document.getElementById(${JSON.stringify(id)});`,
    "  // Passa adiante as UTMs da página, para a campanha chegar ao lead.",
    `  frame.src = ${JSON.stringify(url)} + (location.search ? "&" + location.search.slice(1) : "");`,
    '  window.addEventListener("message", function (event) {',
    "    var data = event.data || {};",
    `    if (data.type === "harpium-quiz:height" && data.slug === ${JSON.stringify(slug)}) {`,
    '      frame.style.height = data.height + "px";',
    "    }",
    "  });",
    "})();",
    "</script>",
  ].join("\n");
}

export function ShareTab({
  draft,
  update,
  canEdit,
  quiz,
  onSaveSlug,
  onSaveCapiToken,
  isAgencia,
}: ShareTabProps) {
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

  const snippet = embedSnippet(embedQuizUrl(origin, quiz.slug), quiz.slug);

  const [capi, setCapi] = useState("");
  const [savingCapi, setSavingCapi] = useState(false);
  const saveCapi = async (token: string) => {
    setSavingCapi(true);
    try {
      await onSaveCapiToken(token);
      setCapi("");
      toast.success(token ? "Token salvo" : "Token removido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui salvar o token");
    } finally {
      setSavingCapi(false);
    }
  };

  const [modelName, setModelName] = useState(quiz.name);
  const [modelNote, setModelNote] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const saveModel = async () => {
    setSavingModel(true);
    try {
      const res = await fetch("/api/agencia/quiz-modelos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: quiz.id, name: modelName, description: modelNote }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não consegui salvar o modelo");
      toast.success(`Modelo "${modelName.trim()}" salvo. Já aparece no "Novo quiz" de todos os CRMs.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui salvar o modelo");
    } finally {
      setSavingModel(false);
    }
  };

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

      <Section
        title="Quem parou no meio"
        hint="Por padrão, só vira lead quem conclui o quiz. Com esta opção, quem deixou WhatsApp ou e-mail e parou também vai para o CRM."
      >
        <label className="flex max-w-2xl items-start gap-3 text-sm text-foreground">
          <Switch
            className="mt-0.5"
            checked={draft.settings.partialLead === true}
            disabled={!canEdit}
            onCheckedChange={(on) =>
              update((d) => ({ ...d, settings: { ...d.settings, partialLead: on ? true : undefined } }))
            }
          />
          <span>
            Enviar como lead parcial
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              O lead chega 30 minutos depois da última resposta, com a etiqueta{" "}
              <code className="font-mono">quiz-incompleto</code>, as respostas dadas até ali e sem
              rota. Só funciona se o contato for pedido antes do fim do quiz. Vale a partir da
              próxima publicação.
            </span>
          </span>
        </label>
      </Section>

      {canEdit ? (
        <Section
          title="API de Conversões da Meta"
          hint="Envia o evento do resultado também pelo servidor, com o mesmo ID do Pixel, para a Meta contar uma vez só e receber o evento mesmo quando o navegador bloqueia o Pixel. Precisa do ID do Pixel acima."
        >
          <div className="max-w-xl">
            <Field
              label="Token de acesso"
              htmlFor="quiz-capi"
              hint={
                quiz.hasCapiToken
                  ? "Há um token salvo. Ele fica cifrado e não é mostrado de novo; cole outro para trocar."
                  : "Gerado no Gerenciador de Eventos da Meta, em Configurações › API de Conversões. Fica cifrado e nunca vai ao navegador do visitante."
              }
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  id="quiz-capi"
                  type="password"
                  autoComplete="off"
                  value={capi}
                  maxLength={600}
                  placeholder={quiz.hasCapiToken ? "•••••••• (salvo)" : "Cole o token aqui"}
                  onChange={(e) => setCapi(e.target.value)}
                  className="min-w-0 flex-1 basis-56"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!capi.trim() || savingCapi}
                  onClick={() => void saveCapi(capi)}
                >
                  {savingCapi ? <Loader2 className="animate-spin" /> : null}
                  Salvar token
                </Button>
                {quiz.hasCapiToken ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={savingCapi}
                    onClick={() => {
                      if (window.confirm("Remover o token? Os eventos voltam a sair só pelo Pixel.")) {
                        void saveCapi("");
                      }
                    }}
                  >
                    Remover
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
        </Section>
      ) : null}

      <Section
        title="Incorporar em um site"
        hint="Cole este código na página do site onde o quiz deve aparecer. O quadro cresce junto com cada tela, e as UTMs da página vão junto para o lead."
      >
        <pre className="max-h-56 overflow-auto rounded-lg bg-foreground/6 p-3 font-mono text-xs leading-relaxed text-foreground">
          {snippet}
        </pre>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void copyText(snippet, "Código copiado")}
        >
          <Copy />
          Copiar código
        </Button>
      </Section>

      {isAgencia && canEdit ? (
        <Section
          title="Modelo da agência"
          hint="Salva este quiz como modelo. Ele passa a aparecer no “Novo quiz” de todos os CRMs. Vão as telas, as regras e os textos; não vão as visitas, os leads, o Pixel nem o logo."
        >
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <Field label="Nome do modelo" htmlFor="quiz-model-name">
              <Input
                id="quiz-model-name"
                value={modelName}
                maxLength={120}
                onChange={(e) => setModelName(e.target.value)}
              />
            </Field>
            <Field label="Descrição (opcional)" htmlFor="quiz-model-note">
              <Input
                id="quiz-model-note"
                value={modelNote}
                maxLength={300}
                placeholder="ex.: Qualificação para clínicas de estética"
                onChange={(e) => setModelNote(e.target.value)}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={!modelName.trim() || savingModel}
            onClick={() => void saveModel()}
          >
            {savingModel ? <Loader2 className="animate-spin" /> : null}
            Salvar como modelo da agência
          </Button>
        </Section>
      ) : null}
    </div>
  );
}
