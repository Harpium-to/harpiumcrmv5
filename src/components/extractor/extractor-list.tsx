"use client";

// ============================================================
// Ferramentas › Extrator de leads: the CRM's extractions, the month's
// usage against the ceiling, and "Nova extração".
//
// Everyone in the CRM sees the list; only admins extract (the API
// enforces it — the buttons just follow). The first time, the admin
// reads and accepts the terms of use of the tool.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Plus, ScanSearch, ShieldCheck, Trash2 } from "lucide-react";

import { useCan } from "@/hooks/use-can";

import { Button, buttonVariants } from "@/components/ui/button";
import { DisplayHeading } from "@/components/ui/display-heading";

import {
  api,
  day,
  JobBadge,
  num,
  SOURCE_NAME,
  SourceIcon,
  type ExtractionItem,
  type SourceAvailability,
} from "./shared";

interface ListAnswer {
  available: boolean;
  error?: string;
  extractions: ExtractionItem[];
  sources: SourceAvailability;
  usage?: { used: number; limit: number };
  termsAcceptedAt?: string | null;
  cnpjBaseMonth?: string | null;
  keepDays?: number;
}

export function TermsPanel({ onAccepted }: { onAccepted: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await api("/api/extrator/terms", { method: "POST" });
      onAccepted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui registrar o aceite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface space-y-4 rounded-3xl p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <ShieldCheck className="size-5" />
        </span>
        <h2 className="text-lg font-medium text-foreground">Antes da primeira extração</h2>
      </div>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
        <li>
          O extrator traz <strong className="text-foreground">dados de empresas</strong>: da base pública de CNPJ da
          Receita Federal e de perfis de empresa no Google Maps. Ele não traz lista de consumidores.
        </li>
        <li>
          MEI e autônomos aparecem com o selo <strong className="text-foreground">contém dado pessoal</strong>: o nome
          e o telefone são de uma pessoa. Para eles, a oferta precisa ser sobre a atividade profissional.
        </li>
        <li>
          Quem decide prospectar é a sua empresa, e é ela que responde por esse contato. Em toda mensagem: diga quem é,
          por que está escrevendo e como sair.
        </li>
        <li>
          Quem responder <strong className="text-foreground">SAIR</strong> entra na lista de bloqueio deste CRM e não
          volta em nenhuma extração nem recebe disparo.
        </li>
        <li>
          Cada lead guarda de onde veio e quando. Se alguém perguntar onde vocês conseguiram o número, a resposta está
          na nota do contato.
        </li>
        <li>O que for extraído e não for para o CRM é apagado depois de 90 dias.</li>
      </ul>
      <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        Li e concordo em usar o extrator dessa forma neste CRM.
      </label>
      <Button type="button" disabled={!checked || busy} onClick={() => void accept()}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        Aceitar e continuar
      </Button>
    </section>
  );
}

export function ExtractorList() {
  const canManage = useCan("edit-settings");
  const [data, setData] = useState<ListAnswer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ListAnswer>("/api/extrator"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar as extrações");
      setData({ available: true, extractions: [], sources: { cnpj: { available: false }, google_maps: { available: false } } });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Jobs nobody is watching advance with the scheduler: look again.
  const going = data?.extractions.some((e) => e.status === "queued" || e.status === "running") ?? false;
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [going, load]);

  const remove = async (item: ExtractionItem) => {
    const sent = item.totals.importados;
    const warning = sent
      ? `Apagar "${item.name}"? Os ${num(sent)} contatos que já foram para o CRM ficam. O que foi extraído continua contando no limite do mês.`
      : `Apagar "${item.name}"? O que foi extraído continua contando no limite do mês.`;
    if (!window.confirm(warning)) return;
    setBusy(item.id);
    try {
      await api(`/api/extrator/${item.id}`, { method: "DELETE" });
      toast.success(`"${item.name}" apagada`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao apagar");
    } finally {
      setBusy(null);
    }
  };

  const pending = data && !data.available ? data.error : null;
  const needsTerms = Boolean(data?.available && !data.termsAcceptedAt);
  const anySource = Boolean(data?.sources.cnpj.available || data?.sources.google_maps.available);
  const usage = data?.usage;
  const left = usage ? Math.max(0, usage.limit - usage.used) : 0;
  const shown = data?.extractions.filter((e) => !(e.status === "cancelled" && e.error === "Apagada.")) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/ferramentas"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Ferramentas
        </Link>
        <DisplayHeading title="Extrator" subtitle="de leads">
          {usage ? (
            <div>
              <p className="text-xs text-muted-foreground">Leads extraídos no mês</p>
              <p className="mt-0.5 text-base font-medium text-foreground tabular-nums">
                {num(usage.used)} <span className="text-muted-foreground">de {num(usage.limit)}</span>
              </p>
            </div>
          ) : null}
          {canManage && data?.available && !needsTerms ? (
            anySource && left > 0 ? (
              <Link href="/ferramentas/extrator/nova" className={buttonVariants({ size: "lg" })}>
                <Plus />
                Nova extração
              </Link>
            ) : (
              <Button type="button" size="lg" disabled title={left > 0 ? "Nenhuma fonte conectada" : "Limite do mês usado"}>
                <Plus />
                Nova extração
              </Button>
            )
          ) : null}
        </DisplayHeading>
      </div>

      {pending ? (
        <p className="surface rounded-2xl px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{pending}</p>
      ) : null}

      {data?.available && !anySource ? (
        <p className="surface rounded-2xl px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Nenhuma fonte está conectada a este CRM ainda (a base de CNPJ e o Google Maps). Fale com a Harpium.
        </p>
      ) : null}

      {data?.available && usage && left === 0 ? (
        <p className="surface rounded-2xl px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Este CRM já usou os {num(usage.limit)} leads do mês. O limite volta no dia 1º.
        </p>
      ) : null}

      {data === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : needsTerms ? (
        canManage ? (
          <TermsPanel onAccepted={() => void load()} />
        ) : (
          <p className="surface rounded-2xl px-4 py-3 text-sm text-muted-foreground">
            Um administrador deste CRM precisa aceitar o termo de uso do extrator antes da primeira extração.
          </p>
        )
      ) : shown.length === 0 ? (
        !pending && (
          <div className="surface rounded-3xl px-6 py-14 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <ScanSearch className="size-6" />
            </span>
            <h2 className="mt-5 text-lg font-medium text-foreground">Nenhuma extração ainda</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Escolha a atividade e a cidade, veja quantas empresas existem e monte a sua lista para prospectar. Nada
              é enviado a ninguém nesta etapa.
            </p>
            {canManage ? (
              anySource && left > 0 ? (
                <Link href="/ferramentas/extrator/nova" className={buttonVariants({ className: "mt-6" })}>
                  <Plus />
                  Fazer a primeira extração
                </Link>
              ) : null
            ) : (
              <p className="mt-5 text-xs text-muted-foreground">Só administradores fazem extrações.</p>
            )}
          </div>
        )
      ) : (
        <ul className="grid gap-3">
          {shown.map((item) => (
            <li key={item.id} className="surface flex flex-wrap items-center gap-x-6 gap-y-4 rounded-3xl p-5">
              <Link href={`/ferramentas/extrator/${item.id}`} className="group flex min-w-0 flex-1 basis-64 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <SourceIcon source={item.source} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-medium text-foreground group-hover:underline">
                      {item.name}
                    </span>
                    <JobBadge status={item.status} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {SOURCE_NAME[item.source]} · {day(item.createdAt)}
                    {item.error && item.status === "failed" ? ` · ${item.error}` : ""}
                  </span>
                </span>
              </Link>

              <dl className="flex gap-7 text-sm tabular-nums">
                <Stat label="Encontrados" value={num(item.found)} />
                <Stat label="Novos" value={num(item.totals.novos)} />
                <Stat label="No CRM" value={num(item.totals.importados)} />
              </dl>

              <div className="flex items-center gap-1">
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy !== null}
                    onClick={() => void remove(item)}
                    aria-label={`Apagar ${item.name}`}
                    title="Apagar"
                    className="text-muted-foreground hover:text-red-500"
                  >
                    {busy === item.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                ) : null}
                <Link
                  href={`/ferramentas/extrator/${item.id}`}
                  aria-label={`Abrir ${item.name}`}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                >
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data?.available && data.cnpjBaseMonth ? (
        <p className="text-xs text-muted-foreground">
          Base de CNPJ: dados públicos da Receita Federal de {data.cnpjBaseMonth.split("-").reverse().join("/")}.
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-medium text-foreground">{value}</dd>
    </div>
  );
}
