"use client";

// ============================================================
// One extraction: its results, and what to do with them.
//
// While the job is going this screen asks for the next slice, so the
// table fills up as the person watches. Each row says what it is
// against the CRM (new, already a contact, extracted before, asked not
// to be contacted, no phone); the person marks the ones to keep and
// sends them to the CRM as a list. Nothing is messaged from here.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Loader2,
  MessageCircle,
  PhoneCall,
  Search,
  Send,
  ShieldAlert,
  UserCheck,
} from "lucide-react";

import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  api,
  checkClass,
  day,
  fieldClass,
  formatPhone,
  JobBadge,
  num,
  postJson,
  ResultBadge,
  SOURCE_NAME,
  usd,
  type ExtractionItem,
  type ResultItem,
} from "./shared";

interface ViewAnswer {
  whatsapp: "meta" | "uazapi" | "evolution" | null;
  extraction: ExtractionItem;
  results: ResultItem[];
  total: number;
  pageSize: number;
}

type Filter = "" | "novo" | "contato" | "extraido" | "bloqueado" | "sem_telefone" | "importados";

interface ImportOutcome {
  imported: number;
  created: number;
  completed: number;
  skipped: { semTelefone: number; bloqueado: number; contato: number; jaEnviado: number; erro: number };
}

const IMPORT_BATCH = 25;

const extraOf = (row: ResultItem, key: string) => {
  const v = row.extras?.[key];
  return typeof v === "string" || typeof v === "number" ? v : null;
};

export function ExtractionView({ id }: { id: string }) {
  const canManage = useCan("edit-settings");
  const [data, setData] = useState<ViewAnswer | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [listName, setListName] = useState("");
  const [complete, setComplete] = useState(false);
  const [sent, setSent] = useState<{ list: string; outcome: ImportOutcome } | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filter) params.set("status", filter);
      if (query.trim()) params.set("q", query.trim());
      const answer = await api<ViewAnswer>(`/api/extrator/${id}?${params}`);
      if (!alive.current) return;
      setData(answer);
      setListName((current) => current || answer.extraction.name);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof Error && /não encontrada/i.test(err.message)) setMissing(true);
      else toast.error(err instanceof Error ? err.message : "Falha ao carregar a extração");
    }
  }, [id, page, filter, query]);

  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [load, query]);

  // The job: ask for the next slice while it is going.
  const status = data?.extraction.status;
  const going = status === "queued" || status === "running";
  useEffect(() => {
    if (!going) return;
    let stop = false;
    const tick = async () => {
      while (!stop) {
        try {
          if (canManage) await api(`/api/extrator/${id}/run`, { method: "POST" });
        } catch {
          /* the next round tries again */
        }
        if (stop) return;
        await load();
        await new Promise((r) => setTimeout(r, canManage ? 1500 : 6000));
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [going, canManage, id, load]);

  const rows = useMemo(() => data?.results ?? [], [data]);
  const selectable = (row: ResultItem) => !row.imported_at && Boolean(row.phone) && row.status !== "bloqueado";
  const pageIds = rows.filter(selectable).map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((rowId) => selected.has(rowId));

  const toggle = (rowId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(rowId);
      else next.delete(rowId);
      return next;
    });

  const togglePage = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const rowId of pageIds) {
        if (on) next.add(rowId);
        else next.delete(rowId);
      }
      return next;
    });

  const selectAllNew = async () => {
    setWorking("select");
    try {
      const { ids } = await api<{ ids: string[] }>(`/api/extrator/${id}?ids=1&status=novo`);
      setSelected(new Set(ids));
      toast.success(`${num(ids.length)} ${ids.length === 1 ? "lead novo marcado" : "leads novos marcados"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui marcar.");
    } finally {
      setWorking(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Parar esta extração? O que já veio fica.")) return;
    try {
      await api(`/api/extrator/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui parar.");
    }
  };

  /** Call an endpoint until it says nothing is left. */
  const drain = async (
    key: string,
    path: string,
    label: (done: number, remaining: number) => string,
    summary: (totals: Record<string, number>) => string,
  ) => {
    setWorking(key);
    const totals: Record<string, number> = {};
    try {
      for (let round = 0; round < 400; round += 1) {
        const answer = await api<Record<string, number>>(`/api/extrator/${id}/${path}`, { method: "POST" });
        for (const [k, v] of Object.entries(answer)) if (k !== "remaining") totals[k] = (totals[k] ?? 0) + v;
        const done = Object.values(totals)[0] ?? 0;
        setProgress(label(done, answer.remaining ?? 0));
        if (!answer.remaining) break;
      }
      toast.success(summary(totals));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu certo.");
    } finally {
      setWorking(null);
      setProgress(null);
    }
  };

  const checkWhatsapp = () =>
    drain(
      "whatsapp",
      "whatsapp",
      (done, remaining) => `Conferindo números: ${num(done)} feitos, ${num(remaining)} a conferir`,
      (t) =>
        t.checked
          ? `${num(t.checked)} números conferidos: ${num(t.withWhatsapp ?? 0)} com WhatsApp`
          : "Nenhum número a conferir.",
    );

  const readSites = () =>
    drain(
      "sites",
      "enrich",
      (done, remaining) => `Lendo os sites: ${num(done)} lidos, ${num(remaining)} a ler`,
      (t) => (t.read ? `${num(t.read)} sites lidos: ${num(t.improved ?? 0)} trouxeram contato novo` : "Nenhum site a ler."),
    );

  const callList = async () => {
    setWorking("tasks");
    try {
      const { created, already } = await api<{ created: number; already: number }>(
        `/api/extrator/${id}/tasks`,
        postJson({}),
      );
      toast.success(
        created
          ? `${num(created)} ${created === 1 ? "tarefa de ligação criada" : "tarefas de ligação criadas"} para você`
          : already
            ? "Esses leads já têm tarefa de ligação aberta."
            : "Envie os leads para o CRM antes de criar a lista de ligação.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui criar as tarefas.");
    } finally {
      setWorking(null);
    }
  };

  const sendToCrm = async () => {
    const ids = [...selected];
    const name = listName.trim();
    if (name.length < 2) {
      toast.error("Dê um nome à lista.");
      return;
    }
    setWorking("import");
    const total: ImportOutcome = {
      imported: 0,
      created: 0,
      completed: 0,
      skipped: { semTelefone: 0, bloqueado: 0, contato: 0, jaEnviado: 0, erro: 0 },
    };
    try {
      for (let i = 0; i < ids.length; i += IMPORT_BATCH) {
        setProgress(`Enviando para o CRM: ${num(Math.min(i, ids.length))} de ${num(ids.length)}`);
        const part = await api<ImportOutcome>(
          `/api/extrator/${id}/import`,
          postJson({ result_ids: ids.slice(i, i + IMPORT_BATCH), list_name: name, complete_existing: complete }),
        );
        total.imported += part.imported;
        total.created += part.created;
        total.completed += part.completed;
        for (const key of Object.keys(total.skipped) as (keyof ImportOutcome["skipped"])[]) {
          total.skipped[key] += part.skipped[key];
        }
      }
      setSent({ list: name, outcome: total });
      setSelected(new Set());
      setDialog(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "O envio parou no meio. O que já foi continua no CRM.");
      await load();
    } finally {
      setWorking(null);
      setProgress(null);
    }
  };

  if (missing) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Extração não encontrada.</p>
        <Link href="/ferramentas/extrator" className={buttonVariants({ variant: "outline" })}>
          Voltar ao extrator
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const { extraction, total, pageSize } = data;
  const t = extraction.totals;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const personal = rows.some((r) => r.kind === "pessoa");
  const hasSites = extraction.source === "google_maps";
  const busy = working !== null;
  const qr = data.whatsapp === "uazapi";
  const prospectNote =
    data.whatsapp === "meta"
      ? "Este CRM usa a API oficial do WhatsApp, que exige o aceite de quem recebe: lista fria não é disparada por ela. Use a lista de ligação ou a planilha."
      : !qr
        ? "Para prospectar pelo WhatsApp, conecte o número pelo QR code. Enquanto isso, use a lista de ligação ou a planilha."
        : null;

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "", label: "Todos", count: t.kept },
    { key: "novo", label: "Novos", count: t.novos },
    { key: "contato", label: "Já são contato", count: t.contatos },
    { key: "extraido", label: "Já extraídos", count: t.extraidos },
    { key: "sem_telefone", label: "Sem telefone", count: t.sem_telefone },
    { key: "bloqueado", label: "Pediram para não receber", count: t.bloqueados },
    { key: "importados", label: "No CRM", count: t.importados },
  ];

  const skipped = sent
    ? sent.outcome.skipped.contato +
      sent.outcome.skipped.bloqueado +
      sent.outcome.skipped.semTelefone +
      sent.outcome.skipped.jaEnviado +
      sent.outcome.skipped.erro
    : 0;

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-medium text-foreground">{extraction.name}</h1>
              <JobBadge status={extraction.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {SOURCE_NAME[extraction.source]} · {day(extraction.createdAt)}
              {extraction.description ? ` · ${extraction.description}` : ""}
              {extraction.costUsd > 0 ? ` · custo estimado ${usd(extraction.costUsd)}` : ""}
            </p>
          </div>
          <a
            href={`/api/extrator/${id}/export`}
            className={cn(buttonVariants({ variant: "outline" }), t.kept === 0 && "pointer-events-none opacity-50")}
          >
            <Download />
            Baixar planilha
          </a>
        </div>
      </div>

      {going ? (
        <section className="surface space-y-3 rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              {extraction.source === "google_maps" && extraction.found === 0
                ? "Buscando no Google Maps. Costuma levar de 1 a 3 minutos; pode sair desta tela."
                : `Extraindo: ${num(extraction.found)} de ${num(extraction.requested)}`}
            </p>
            {canManage ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void cancel()}>
                Parar
              </Button>
            ) : null}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.round((extraction.found / Math.max(1, extraction.requested)) * 100))}%` }}
            />
          </div>
        </section>
      ) : null}

      {extraction.status === "failed" ? (
        <p className="surface rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
          A extração falhou: {extraction.error ?? "erro desconhecido"}. O que já tinha vindo continua aqui.
        </p>
      ) : null}

      {sent ? (
        <section className="surface space-y-3 rounded-3xl p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserCheck className="size-4 text-emerald-500" />
            {num(sent.outcome.created)} {sent.outcome.created === 1 ? "contato novo" : "contatos novos"} na lista &quot;
            {sent.list}&quot;
            {sent.outcome.completed ? `, ${num(sent.outcome.completed)} já existentes completados` : ""}.
          </p>
          {skipped ? (
            <p className="text-sm text-muted-foreground">
              Ficaram de fora {num(skipped)}:{" "}
              {[
                sent.outcome.skipped.contato && `${num(sent.outcome.skipped.contato)} já eram contato`,
                sent.outcome.skipped.bloqueado && `${num(sent.outcome.skipped.bloqueado)} pediram para não receber`,
                sent.outcome.skipped.semTelefone && `${num(sent.outcome.skipped.semTelefone)} sem telefone`,
                sent.outcome.skipped.jaEnviado && `${num(sent.outcome.skipped.jaEnviado)} já enviados`,
                sent.outcome.skipped.erro && `${num(sent.outcome.skipped.erro)} com erro`,
              ]
                .filter(Boolean)
                .join(", ")}
              .
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Os contatos entraram sem cartão no funil e sem acionar automações: o cartão abre quando o lead responder.
          </p>
          {prospectNote ? <p className="text-sm text-amber-600 dark:text-amber-400">{prospectNote}</p> : null}
          <div className="flex flex-wrap gap-2">
            {qr ? (
              <Link
                href={`/broadcasts?prospectar=${encodeURIComponent(sent.list)}`}
                className={buttonVariants({ size: "sm" })}
              >
                <MessageCircle />
                Prospectar esta lista
              </Link>
            ) : null}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void callList()}>
              {working === "tasks" ? <Loader2 className="animate-spin" /> : <PhoneCall />}
              Criar lista de ligação
            </Button>
          </div>
        </section>
      ) : null}

      {personal ? (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          Esta lista tem MEI ou autônomos: o nome e o telefone são de uma pessoa. A oferta precisa ser sobre a atividade
          profissional dela.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {tabs
          .filter((tab) => tab.key === "" || tab.count > 0)
          .map((tab) => (
            <button
              key={tab.key || "todos"}
              type="button"
              onClick={() => {
                setFilter(tab.key);
                setPage(0);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                filter === tab.key ? "bg-foreground text-background" : "bg-foreground/6 text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label} <span className="tabular-nums opacity-70">{num(tab.count)}</span>
            </button>
          ))}
        <div className="relative ml-auto w-full max-w-60">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(fieldClass, "pl-9")}
            placeholder="Buscar pelo nome"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>

      {canManage ? (
        <div className="surface flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
          <span className="mr-1 text-sm text-foreground tabular-nums">
            {selected.size ? `${num(selected.size)} ${selected.size === 1 ? "marcado" : "marcados"}` : "Marque os leads que quer levar"}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={busy || t.novos === 0} onClick={() => void selectAllNew()}>
            {working === "select" ? <Loader2 className="animate-spin" /> : null}
            Marcar todos os novos
          </Button>
          {selected.size ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>
              Desmarcar
            </Button>
          ) : null}
          <span className="mx-1 hidden h-5 w-px bg-foreground/10 sm:block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || t.kept === 0 || !qr}
            title={qr ? "Confere, pelo número do QR code, quais números têm WhatsApp" : "Precisa do WhatsApp conectado pelo QR code"}
            onClick={() => void checkWhatsapp()}
          >
            {working === "whatsapp" ? <Loader2 className="animate-spin" /> : <MessageCircle />}
            Conferir WhatsApp
          </Button>
          {hasSites ? (
            <Button type="button" variant="outline" size="sm" disabled={busy || t.kept === 0} onClick={() => void readSites()}>
              {working === "sites" ? <Loader2 className="animate-spin" /> : <Globe />}
              Ler os sites
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={busy || t.importados === 0} onClick={() => void callList()}>
            {working === "tasks" ? <Loader2 className="animate-spin" /> : <PhoneCall />}
            Lista de ligação
          </Button>
          <Button type="button" size="sm" className="ml-auto" disabled={busy || selected.size === 0} onClick={() => setDialog(true)}>
            <Send />
            Enviar para o CRM
          </Button>
          {progress ? <p className="basis-full text-xs text-muted-foreground">{progress}</p> : null}
        </div>
      ) : null}

      <div className="surface overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-foreground/8">
              <th className="w-10 px-4 py-3">
                {canManage ? (
                  <input
                    type="checkbox"
                    aria-label="Marcar esta página"
                    className={checkClass}
                    checked={allOnPage}
                    disabled={pageIds.length === 0}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                ) : null}
              </th>
              <th className="px-3 py-3 font-medium">Empresa</th>
              <th className="px-3 py-3 font-medium">Telefone</th>
              <th className="px-3 py-3 font-medium">Cidade</th>
              <th className="px-3 py-3 font-medium">{extraction.source === "cnpj" ? "Atividade e porte" : "Categoria e nota"}</th>
              <th className="px-4 py-3 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {going ? "Os resultados aparecem aqui conforme chegam." : "Nada aqui com esse filtro."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const contactId = row.contact_id ?? row.matched_contact_id;
                const rating = extraOf(row, "nota");
                const reviews = extraOf(row, "avaliacoes");
                return (
                  <tr key={row.id} className="border-b border-foreground/5 align-top last:border-0">
                    <td className="px-4 py-3">
                      {canManage ? (
                        <input
                          type="checkbox"
                          aria-label={`Marcar ${row.name}`}
                          className={checkClass}
                          disabled={!selectable(row)}
                          checked={selected.has(row.id)}
                          onChange={(e) => toggle(row.id, e.target.checked)}
                        />
                      ) : null}
                    </td>
                    <td className="max-w-72 px-3 py-3">
                      <p className="truncate font-medium text-foreground" title={row.name}>
                        {row.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[extraOf(row, "cnpj"), row.email, row.instagram].filter(Boolean).join(" · ") ||
                          row.website ||
                          row.address ||
                          ""}
                      </p>
                      {row.kind === "pessoa" ? (
                        <span className="mt-1 inline-flex rounded-full bg-amber-500/12 px-2 py-0.5 text-[0.7rem] font-medium text-amber-700 dark:text-amber-300">
                          contém dado pessoal
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {row.phone ? (
                        <>
                          <p className="text-foreground tabular-nums">{formatPhone(row.phone)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.phone_kind === "celular" ? "Celular" : row.phone_kind === "fixo" ? "Fixo" : ""}
                            {row.has_whatsapp === true ? " · tem WhatsApp" : row.has_whatsapp === false ? " · sem WhatsApp" : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-foreground">{[row.city, row.uf].filter(Boolean).join("/") || "–"}</p>
                      <p className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground">{row.district ?? ""}</p>
                    </td>
                    <td className="max-w-64 px-3 py-3">
                      <p className="truncate text-foreground" title={row.activity ?? ""}>
                        {row.activity ?? "–"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {extraction.source === "cnpj"
                          ? [extraOf(row, "porte"), extraOf(row, "abertura") && `aberta em ${String(extraOf(row, "abertura")).split("-").reverse().join("/")}`]
                              .filter(Boolean)
                              .join(" · ")
                          : rating !== null
                            ? `Nota ${Number(rating).toLocaleString("pt-BR")}${reviews !== null ? ` · ${num(Number(reviews))} avaliações` : ""}${row.website ? " · tem site" : " · sem site"}`
                            : row.website
                              ? "Tem site"
                              : "Sem site"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        {row.imported_at ? (
                          <span className="inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary">
                            No CRM
                          </span>
                        ) : (
                          <ResultBadge status={row.status} />
                        )}
                        {contactId ? (
                          <Link href={`/contacts?contact=${contactId}`} className="text-xs text-muted-foreground underline hover:text-foreground">
                            ver contato
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            Página {page + 1} de {num(pages)}
          </span>
          <Button type="button" variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </div>
      ) : null}

      <Dialog open={dialog} onOpenChange={(open) => (working === "import" ? null : setDialog(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar {num(selected.size)} para o CRM</DialogTitle>
            <DialogDescription>
              Eles viram contatos com a etiqueta da lista e a origem &quot;Extrator&quot;. Não entram no funil nem
              acionam automações: nada é enviado a eles agora.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">Nome da lista</span>
              <input
                className={fieldClass}
                value={listName}
                maxLength={60}
                onChange={(e) => setListName(e.target.value)}
                placeholder="Dentistas Goiânia nov/26"
              />
              <span className="block text-xs text-muted-foreground">
                Vira uma etiqueta. É por ela que você escolhe esta lista num disparo.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground">
              <input type="checkbox" className={cn(checkClass, "mt-0.5")} checked={complete} onChange={(e) => setComplete(e.target.checked)} />
              <span>
                Completar dados vazios de quem já é contato
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Sem isso, quem já é contato não é tocado. Com isso, só o que está em branco é preenchido, e o contato
                  não entra na lista.
                </span>
              </span>
            </label>
            {working === "import" && progress ? <p className="text-xs text-muted-foreground">{progress}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={working === "import"} onClick={() => setDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={working === "import"} onClick={() => void sendToCrm()}>
              {working === "import" ? <Loader2 className="animate-spin" /> : <Send />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
