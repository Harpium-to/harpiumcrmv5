"use client";

// ============================================================
// Divulgação: everything about getting the quiz in front of people and
// following up, split by purpose so similar-looking settings never sit
// side by side:
//
//   Link            the public address, its slug and the campaign link;
//   Rastreamento    Meta Pixel and the Conversions API;
//   Leads no CRM    the tags of every lead and who stopped halfway;
//   Incorporar      the code for a client's own site;
//   Modelo          (agency only) save this quiz as an agency model.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Code,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Radar,
  ShieldCheck,
  Users,
} from "lucide-react";

import { embedQuizUrl, publicQuizUrl, slugProblem } from "@/lib/quiz/slug";
import type { QuizStatus } from "@/lib/quiz/types";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { Field, FormRow, RouteBadge, Section, SubTabs, TagsInput, type TabProps } from "./ui";

export interface ShareTabProps extends TabProps {
  quiz: { id: string; name: string; slug: string; status: QuizStatus; hasCapiToken: boolean };
  /** Change the public address. Rejects with the reason in words. */
  onSaveSlug: (slug: string) => Promise<void>;
  /** Save (or, empty, remove) the Conversions API token. */
  onSaveCapiToken: (token: string) => Promise<void>;
  /** The signed-in person is from the agency. */
  isAgencia: boolean;
}

type Part = "link" | "rastreamento" | "leads" | "incorporar" | "modelo";

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

/** A value to copy, in a box that reads as "this is the thing to use". */
function CopyBox({ value, done, small = false }: { value: string; done: string; small?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        className={cn(
          "min-w-0 flex-1 basis-64 truncate rounded-xl border border-border bg-background/60 px-3 py-2.5 font-mono text-foreground",
          small ? "text-xs" : "text-sm",
        )}
      >
        {value}
      </code>
      <Button type="button" variant="outline" onClick={() => void copyText(value, done)}>
        <Copy />
        Copiar
      </Button>
    </div>
  );
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
  const [part, setPart] = useState<Part>("link");
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

  const parts: { value: Part; label: string; icon: typeof Link2 }[] = [
    { value: "link", label: "Link", icon: Link2 },
    { value: "rastreamento", label: "Rastreamento", icon: Radar },
    { value: "leads", label: "Leads no CRM", icon: Users },
    { value: "incorporar", label: "Incorporar no site", icon: Code },
    ...(isAgencia && canEdit ? [{ value: "modelo" as Part, label: "Modelo da agência", icon: Building2 }] : []),
  ];

  return (
    <div className="space-y-4">
      <SubTabs ariaLabel="Partes da divulgação" value={part} onChange={setPart} items={parts} />

      {part === "link" ? (
        <div className="grid gap-4">
          <Section
            icon={Link2}
            title="Link público"
            hint={
              live
                ? "O endereço que vai no anúncio, na bio e no WhatsApp. Abre sem login."
                : "O link começa a funcionar quando o quiz é publicado."
            }
            action={
              live ? (
                <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                  <ExternalLink />
                  Abrir
                </a>
              ) : null
            }
          >
            <div className="py-4">
              <CopyBox value={url} done="Link copiado" />
            </div>
            {canEdit ? (
              <FormRow
                title="Endereço"
                hint="Mudar o endereço faz o link antigo parar de funcionar: troque também nos anúncios."
              >
                <div className="flex flex-wrap gap-2">
                  <div className="flex min-w-0 flex-1 basis-56 items-center rounded-lg border border-input pl-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                    <span className="shrink-0 font-mono text-sm text-muted-foreground">/q/</span>
                    <input
                      aria-label="Endereço do quiz"
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
                <p className={cn("text-xs", slugIssue ? "text-red-500" : "text-muted-foreground")}>
                  {slugIssue ?? "Letras minúsculas, números e hífens."}
                </p>
              </FormRow>
            ) : null}
          </Section>

          <Section
            title="Link de campanha"
            hint="Preencha o que quiser medir e use o link gerado no anúncio. A campanha e o criativo aparecem no relatório e no lead."
          >
            <div className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <div className="pt-4">
              <CopyBox value={campaignUrl} done="Link de campanha copiado" small />
            </div>
          </Section>
        </div>
      ) : null}

      {part === "rastreamento" ? (
        <div className="grid gap-4">
          <Section
            icon={Radar}
            title="Pixel da Meta"
            hint="Com o ID do Pixel, a página registra a visita e dispara um evento quando a pessoa chega a um resultado."
          >
            <FormRow title="ID do Pixel" hint="Só números. Vazio = Pixel desligado.">
              <Input
                aria-label="ID do Pixel"
                inputMode="numeric"
                value={draft.settings.pixelId ?? ""}
                disabled={!canEdit}
                placeholder="ex.: 1234567890123456"
                maxLength={30}
                className="max-w-xs font-mono"
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    settings: { ...d.settings, pixelId: e.target.value.replace(/\D/g, "") || undefined },
                  }))
                }
              />
            </FormRow>
            <FormRow title="Evento de cada resultado" hint="Escolhido em Resultados, em cada tela de resultado.">
              <ul className="divide-y divide-border rounded-xl border border-border">
                {draft.results.map((result) => (
                  <li key={result.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <RouteBadge route={result.route} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{result.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {result.pixel.kind === "none"
                        ? "não envia"
                        : `${result.pixel.name} · ${result.pixel.kind === "standard" ? "padrão" : "personalizado"}`}
                    </span>
                  </li>
                ))}
              </ul>
            </FormRow>
          </Section>

          {canEdit ? (
            <Section
              icon={ShieldCheck}
              title="API de Conversões da Meta"
              hint="Envia o mesmo evento também pelo servidor, com o mesmo ID, para a Meta contar uma vez só e receber o evento mesmo quando o navegador bloqueia o Pixel."
            >
              <FormRow
                title="Token de acesso"
                hint={
                  quiz.hasCapiToken
                    ? "Há um token salvo. Ele fica cifrado e não é mostrado de novo; cole outro para trocar."
                    : "Gerado no Gerenciador de Eventos da Meta, em Configurações › API de Conversões. Precisa do ID do Pixel."
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    aria-label="Token da API de Conversões"
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
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", quiz.hasCapiToken ? "bg-emerald-500" : "bg-foreground/25")}
                  />
                  {quiz.hasCapiToken ? "Ligada" : "Desligada"}
                </p>
              </FormRow>
            </Section>
          ) : null}
        </div>
      ) : null}

      {part === "leads" ? (
        <Section icon={Users} title="Leads no CRM" hint="O que acompanha cada lead deste quiz quando ele chega ao CRM.">
          <FormRow
            title="Etiquetas de todo lead"
            hint="Vão em todos os leads deste quiz, além das etiquetas de cada resultado e das etiquetas por resposta."
          >
            <TagsInput
              value={draft.settings.tags}
              disabled={!canEdit}
              onChange={(tags) => update((d) => ({ ...d, settings: { ...d.settings, tags } }))}
            />
          </FormRow>
          <FormRow
            title="Quem parou no meio"
            hint="Por padrão, só vira lead quem conclui. Vale a partir da próxima publicação."
          >
            <label className="flex items-start gap-3 text-sm text-foreground">
              <Switch
                className="mt-0.5"
                checked={draft.settings.partialLead === true}
                disabled={!canEdit}
                onCheckedChange={(on) =>
                  update((d) => ({ ...d, settings: { ...d.settings, partialLead: on ? true : undefined } }))
                }
              />
              <span>
                Enviar como lead parcial quem deixou WhatsApp ou e-mail e parou
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  O lead chega 30 minutos depois da última resposta, com a etiqueta{" "}
                  <code className="font-mono">quiz-incompleto</code>, as respostas até ali e sem rota. Só funciona
                  se o contato for pedido antes do fim do quiz.
                </span>
              </span>
            </label>
          </FormRow>
        </Section>
      ) : null}

      {part === "incorporar" ? (
        <Section
          icon={Code}
          title="Incorporar no site"
          hint="Cole este código na página do site onde o quiz deve aparecer. O quadro cresce junto com cada tela, e as UTMs da página vão junto para o lead."
        >
          <div className="space-y-3 pt-4">
            <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground">
              {snippet}
            </pre>
            <Button type="button" variant="outline" onClick={() => void copyText(snippet, "Código copiado")}>
              <Copy />
              Copiar código
            </Button>
          </div>
        </Section>
      ) : null}

      {part === "modelo" && isAgencia && canEdit ? (
        <Section
          icon={Building2}
          title="Salvar como modelo da agência"
          hint="O modelo aparece no “Novo quiz” de todos os CRMs. Vão as telas, as regras e os textos; não vão as visitas, os leads, o Pixel nem o logo."
        >
          <FormRow title="Nome do modelo">
            <Input
              aria-label="Nome do modelo"
              value={modelName}
              maxLength={120}
              onChange={(e) => setModelName(e.target.value)}
              className="max-w-md"
            />
          </FormRow>
          <FormRow title="Descrição" hint="Opcional. Ajuda a escolher o modelo certo.">
            <Input
              aria-label="Descrição do modelo"
              value={modelNote}
              maxLength={300}
              placeholder="ex.: Qualificação para clínicas de estética"
              onChange={(e) => setModelNote(e.target.value)}
            />
            <Button type="button" disabled={!modelName.trim() || savingModel} onClick={() => void saveModel()}>
              {savingModel ? <Loader2 className="animate-spin" /> : <Building2 />}
              Salvar como modelo da agência
            </Button>
          </FormRow>
        </Section>
      ) : null}
    </div>
  );
}
