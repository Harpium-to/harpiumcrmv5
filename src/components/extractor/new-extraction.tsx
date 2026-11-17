"use client";

// ============================================================
// Ferramentas › Extrator de leads › Nova extração.
//
// Pick the source, fill in the filters, see how many companies they
// bring (and what it costs), then extract. Nothing is sent to anyone
// here: the result is a list to look at.
// ============================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Search, X } from "lucide-react";

import type { ExtractionSource } from "@/lib/extractor/types";
import { MAX_PER_EXTRACTION, UFS } from "@/lib/extractor/types";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { DisplayHeading } from "@/components/ui/display-heading";

import { api, checkClass, fieldClass, num, postJson, SourceIcon, usd, type SourceAvailability } from "./shared";

interface Setup {
  available: boolean;
  error?: string;
  sources: SourceAvailability;
  usage?: { used: number; limit: number };
  termsAcceptedAt?: string | null;
  maxPerExtraction?: Record<ExtractionSource, number>;
}

interface Option {
  key: string;
  label: string;
}

interface Preview {
  count: number | null;
  more?: boolean;
  costUsd: number;
  searches?: number;
  upTo?: number;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="surface space-y-4 rounded-3xl p-6">
      <div>
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
      <input type="checkbox" className={checkClass} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Type to search, click to add; what was picked shows as chips. */
function Picker({
  placeholder,
  picked,
  onChange,
  search,
  disabled,
}: {
  placeholder: string;
  picked: Option[];
  onChange: (next: Option[]) => void;
  search: (q: string) => Promise<Option[]>;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const short = query.trim().length < 2;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      seq.current += 1;
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      search(q)
        .then((found) => {
          if (seq.current === mine) setOptions(found);
        })
        .catch((err) => {
          if (seq.current === mine) {
            setOptions([]);
            toast.error(err instanceof Error ? err.message : "A busca falhou.");
          }
        })
        .finally(() => {
          if (seq.current === mine) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const shown = short ? [] : options;
  const chosen = new Set(picked.map((p) => p.key));
  const add = (option: Option) => {
    if (!chosen.has(option.key)) onChange([...picked, option]);
    setQuery("");
    setOptions([]);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className={cn(fieldClass, "pl-9")}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {loading && !short ? (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
        {open && shown.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-input bg-popover p-1 shadow-lg">
            {shown.map((option) => (
              <li key={option.key}>
                <button
                  type="button"
                  disabled={chosen.has(option.key)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(option)}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-foreground/8 disabled:opacity-40"
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {picked.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <li
              key={p.key}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-xs font-medium text-primary"
            >
              <span className="truncate">{p.label}</span>
              <button
                type="button"
                aria-label={`Tirar ${p.label}`}
                onClick={() => onChange(picked.filter((x) => x.key !== p.key))}
                className="flex size-5 items-center justify-center rounded-full hover:bg-primary/15"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const cnaeLabel = (codigo: string, descricao: string) =>
  `${descricao} (${codigo.slice(0, 4)}-${codigo.slice(4, 5)}/${codigo.slice(5)})`;

const OPENED = [
  { value: "", label: "Qualquer data" },
  { value: "30", label: "Nos últimos 30 dias" },
  { value: "90", label: "Nos últimos 90 dias" },
  { value: "365", label: "No último ano" },
];

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function NewExtraction() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [source, setSource] = useState<ExtractionSource>("cnpj");
  const [name, setName] = useState("");
  const [requested, setRequested] = useState("200");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);

  // CNPJ
  const [cnaes, setCnaes] = useState<Option[]>([]);
  const [uf, setUf] = useState("");
  const [cities, setCities] = useState<Option[]>([]);
  const [bairro, setBairro] = useState("");
  const [tipo, setTipo] = useState<"empresas" | "mei" | "todos">("empresas");
  const [portes, setPortes] = useState<string[]>([]);
  const [opened, setOpened] = useState("");
  const [capitalMin, setCapitalMin] = useState("");
  const [unidade, setUnidade] = useState("");
  const [onlyMobile, setOnlyMobile] = useState(true);
  const [withPhone, setWithPhone] = useState(true);
  const [withEmail, setWithEmail] = useState(false);

  // Google Maps
  const [termo, setTermo] = useState("");
  const [cidade, setCidade] = useState("");
  const [mapsUf, setMapsUf] = useState("");
  const [bairros, setBairros] = useState("");
  const [notaMin, setNotaMin] = useState("");
  const [avaliacoesMin, setAvaliacoesMin] = useState("");
  const [site, setSite] = useState("todos");
  const [mapsMobile, setMapsMobile] = useState(false);
  const [mapsPhone, setMapsPhone] = useState(true);

  useEffect(() => {
    api<Setup>("/api/extrator")
      .then((s) => {
        setSetup(s);
        if (!s.sources.cnpj.available && s.sources.google_maps.available) setSource("google_maps");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao carregar"));
  }, []);

  const filters = useMemo(() => {
    if (source === "google_maps") {
      return {
        termo,
        cidade,
        uf: mapsUf,
        bairros: bairros
          .split(/[\n,;]+/)
          .map((b) => b.trim())
          .filter(Boolean),
        nota_min: notaMin,
        avaliacoes_min: avaliacoesMin,
        site,
        com_telefone: mapsPhone,
        so_celular: mapsMobile,
      };
    }
    return {
      cnaes: cnaes.map((c) => c.key),
      // The state alone narrows nothing the cities do not already.
      ufs: cities.length === 0 && uf ? [uf] : [],
      municipios: cities.map((c) => Number(c.key)),
      bairro,
      tipo,
      portes,
      abertura_de: opened ? daysAgo(Number(opened)) : undefined,
      capital_min: capitalMin,
      unidade,
      com_telefone: withPhone,
      so_celular: onlyMobile,
      com_email: withEmail,
      rotulos: { cnaes: cnaes.map((c) => c.label.replace(/\s*\(\d{4}-\d\/\d{2}\)$/, "")), municipios: cities.map((c) => c.label) },
    };
  }, [
    source, termo, cidade, mapsUf, bairros, notaMin, avaliacoesMin, site, mapsPhone, mapsMobile,
    cnaes, uf, cities, bairro, tipo, portes, opened, capitalMin, unidade, withPhone, onlyMobile, withEmail,
  ]);

  // Any change makes the last count stale.
  useEffect(() => setPreview(null), [filters, requested]);

  const searchCnaes = useMemo(
    () => async (q: string) => {
      const { items } = await api<{ items: { codigo: string; descricao: string }[] }>(
        `/api/extrator/lookup?tipo=cnae&q=${encodeURIComponent(q)}`,
      );
      return items.map((i) => ({ key: i.codigo, label: cnaeLabel(i.codigo, i.descricao) }));
    },
    [],
  );
  const searchCities = useMemo(
    () => async (q: string) => {
      const { items } = await api<{ items: { codigo: number; nome: string; uf: string | null }[] }>(
        `/api/extrator/lookup?tipo=cidade&uf=${uf}&q=${encodeURIComponent(q)}`,
      );
      return items.map((i) => ({ key: String(i.codigo), label: `${i.nome}/${i.uf ?? uf}` }));
    },
    [uf],
  );

  const max = setup?.maxPerExtraction?.[source] ?? MAX_PER_EXTRACTION[source];
  const left = setup?.usage ? Math.max(0, setup.usage.limit - setup.usage.used) : max;
  const ceiling = Math.min(max, left);

  const runPreview = async () => {
    setBusy("preview");
    try {
      setPreview(await api<Preview>("/api/extrator/preview", postJson({ source, filters, requested: Number(requested) })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui contar.");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy("create");
    try {
      const { id } = await api<{ id: string }>(
        "/api/extrator",
        postJson({ source, name, filters, requested: Math.min(Number(requested) || 0, ceiling) }),
      );
      router.push(`/ferramentas/extrator/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui começar a extração.");
      setBusy(null);
    }
  };

  const togglePorte = (code: string, on: boolean) =>
    setPortes((current) => (on ? [...new Set([...current, code])] : current.filter((c) => c !== code)));

  if (setup === null) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const blocked = !setup.available
    ? setup.error
    : !setup.termsAcceptedAt
      ? "Aceite o termo de uso do extrator antes da primeira extração."
      : left === 0
        ? "Este CRM já usou os leads do mês."
        : null;
  const sourceState = setup.sources[source];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/ferramentas/extrator"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Extrator de leads
        </Link>
        <DisplayHeading title="Nova" subtitle="extração" />
      </div>

      {blocked ? (
        <p className="surface rounded-2xl px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{blocked}</p>
      ) : null}

      <Section title="1. De onde extrair">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                key: "cnpj" as const,
                title: "CNPJ (Receita Federal)",
                text: "A base pública de empresas. Filtra por atividade, cidade, porte e data de abertura. Sem custo por extração.",
              },
              {
                key: "google_maps" as const,
                title: "Google Maps",
                text: "Os perfis de empresa do Maps. Traz o telefone que a empresa atende hoje, a nota e o site. Tem custo por extração.",
              },
            ]
          ).map((option) => {
            const state = setup.sources[option.key];
            return (
              <button
                key={option.key}
                type="button"
                disabled={!state.available}
                onClick={() => setSource(option.key)}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                  source === option.key ? "border-primary bg-primary-soft" : "border-input hover:bg-foreground/5",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <SourceIcon source={option.key} className="size-4" />
                  {option.title}
                </span>
                <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                  {state.available ? option.text : state.reason}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {source === "cnpj" ? (
        <>
          <Section title="2. O que procurar" hint="Escolha pelo menos uma atividade ou uma cidade.">
            <Field label="Atividade (CNAE)" hint='Digite uma palavra, como "odontológica", "móveis" ou "contabilidade", ou o código.'>
              <Picker placeholder="Buscar atividade" picked={cnaes} onChange={setCnaes} search={searchCnaes} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
              <Field label="Estado">
                <select
                  className={fieldClass}
                  value={uf}
                  onChange={(e) => {
                    setUf(e.target.value);
                    setCities([]);
                  }}
                >
                  <option value="">Todos</option>
                  {UFS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cidade" hint={uf ? undefined : "Escolha o estado para buscar a cidade."}>
                <Picker
                  placeholder={uf ? "Buscar cidade" : "Escolha o estado primeiro"}
                  picked={cities}
                  onChange={setCities}
                  search={searchCities}
                  disabled={!uf}
                />
              </Field>
            </div>
            <Field label="Bairro (opcional)" hint="O começo do nome, como está no cadastro da empresa.">
              <input className={fieldClass} value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Setor Bueno" />
            </Field>
          </Section>

          <Section title="3. Que tipo de empresa">
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { key: "empresas" as const, title: "Empresas", text: "Sem MEI." },
                  { key: "mei" as const, title: "MEI e autônomos", text: "Contém dado pessoal." },
                  { key: "todos" as const, title: "Todos", text: "Empresas e MEI." },
                ]
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTipo(option.key)}
                  className={cn(
                    "rounded-2xl border p-3 text-left transition-colors",
                    tipo === option.key ? "border-primary bg-primary-soft" : "border-input hover:bg-foreground/5",
                  )}
                >
                  <span className="block text-sm font-medium text-foreground">{option.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{option.text}</span>
                </button>
              ))}
            </div>
            {tipo !== "empresas" ? (
              <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-700 dark:text-amber-300">
                No MEI e no autônomo, o nome e o telefone são de uma pessoa. A oferta precisa ser sobre a atividade
                profissional dela, com identificação de quem envia e a opção de sair. Esses leads levam o selo
                &quot;contém dado pessoal&quot;.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Porte">
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                  <Check label="Microempresa" checked={portes.includes("01")} onChange={(v) => togglePorte("01", v)} />
                  <Check label="Pequeno porte" checked={portes.includes("03")} onChange={(v) => togglePorte("03", v)} />
                  <Check label="Demais" checked={portes.includes("05")} onChange={(v) => togglePorte("05", v)} />
                </div>
              </Field>
              <Field label="Data de abertura">
                <select className={fieldClass} value={opened} onChange={(e) => setOpened(e.target.value)}>
                  {OPENED.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capital social a partir de (R$)">
                <input
                  className={fieldClass}
                  inputMode="numeric"
                  value={capitalMin}
                  onChange={(e) => setCapitalMin(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Qualquer valor"
                />
              </Field>
              <Field label="Matriz ou filial">
                <select className={fieldClass} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                  <option value="">As duas</option>
                  <option value="matriz">Só matriz</option>
                  <option value="filial">Só filial</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="4. Contato" hint="Fixo quase nunca tem WhatsApp. Para prospectar por WhatsApp, deixe só celular.">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Check label="Só com telefone" checked={withPhone} onChange={setWithPhone} />
              <Check label="Só celular" checked={onlyMobile} onChange={setOnlyMobile} />
              <Check label="Só com e-mail" checked={withEmail} onChange={setWithEmail} />
            </div>
          </Section>
        </>
      ) : (
        <>
          <Section title="2. O que procurar">
            <Field label="O que" hint='Como você digitaria no Google Maps: "dentista", "loja de móveis planejados".'>
              <input className={fieldClass} value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="dentista" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <Field label="Cidade">
                <input className={fieldClass} value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Goiânia" />
              </Field>
              <Field label="Estado">
                <select className={fieldClass} value={mapsUf} onChange={(e) => setMapsUf(e.target.value)}>
                  <option value="">Escolha</option>
                  {UFS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Bairros (opcional)"
              hint="Um por linha. Cada bairro vira uma busca: é assim que se passa do teto de uma busca só numa cidade grande."
            >
              <textarea
                className={cn(fieldClass, "h-24 py-2")}
                value={bairros}
                onChange={(e) => setBairros(e.target.value)}
                placeholder={"Setor Bueno\nSetor Marista"}
              />
            </Field>
          </Section>

          <Section title="3. Filtros" hint="Aplicados depois da busca: o custo é pelo que o Maps trouxer, e ficam só os que passarem.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nota a partir de">
                <select className={fieldClass} value={notaMin} onChange={(e) => setNotaMin(e.target.value)}>
                  <option value="">Qualquer nota</option>
                  {["3", "3.5", "4", "4.5"].map((n) => (
                    <option key={n} value={n}>
                      {n.replace(".", ",")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Avaliações a partir de">
                <input
                  className={fieldClass}
                  inputMode="numeric"
                  value={avaliacoesMin}
                  onChange={(e) => setAvaliacoesMin(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Qualquer número"
                />
              </Field>
              <Field label="Site">
                <select className={fieldClass} value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="todos">Com ou sem site</option>
                  <option value="com">Só com site</option>
                  <option value="sem">Só sem site</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Check label="Só com telefone" checked={mapsPhone} onChange={setMapsPhone} />
              <Check label="Só celular" checked={mapsMobile} onChange={setMapsMobile} />
            </div>
          </Section>
        </>
      )}

      <Section title={source === "cnpj" ? "5. Quantos e o nome" : "4. Quantos e o nome"}>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="Nome da extração" hint="Para você achar depois.">
            <input
              className={fieldClass}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dentistas Goiânia"
            />
          </Field>
          <Field label="Quantos leads" hint={`Até ${num(ceiling)} nesta extração.`}>
            <input
              className={fieldClass}
              inputMode="numeric"
              value={requested}
              onChange={(e) => setRequested(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
        </div>

        {preview ? (
          <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm leading-relaxed text-foreground">
            {preview.count !== null ? (
              <>
                Essa busca traz{" "}
                <strong>
                  {preview.more ? "mais de " : ""}
                  {num(preview.count)} {preview.count === 1 ? "empresa" : "empresas"}
                </strong>
                . Sem custo por extração.
              </>
            ) : (
              <>
                {preview.searches === 1 ? "Uma busca" : `${num(preview.searches ?? 1)} buscas`} no Maps, trazendo até{" "}
                <strong>{num(preview.upTo ?? 0)} locais</strong>. Custo estimado: até{" "}
                <strong>{usd(preview.costUsd)}</strong>. O Maps não diz antes quantos existem.
              </>
            )}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || !sourceState.available}
            onClick={() => void runPreview()}
          >
            {busy === "preview" ? <Loader2 className="animate-spin" /> : <Search />}
            {source === "cnpj" ? "Ver quantas existem" : "Ver o custo"}
          </Button>
          <Button
            type="button"
            disabled={busy !== null || Boolean(blocked) || !sourceState.available || !name.trim() || !Number(requested)}
            onClick={() => void create()}
          >
            {busy === "create" ? <Loader2 className="animate-spin" /> : null}
            Extrair
          </Button>
          <span className="text-xs text-muted-foreground">Nada é enviado a ninguém nesta etapa.</span>
        </div>
      </Section>
    </div>
  );
}
