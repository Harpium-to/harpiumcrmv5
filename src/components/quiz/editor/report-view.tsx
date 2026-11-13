"use client";

// ============================================================
// The report of a quiz, drawn. It takes the numbers already worked
// out (lib/quiz/report.ts) and only decides how to show them, so the
// same component serves the Relatório tab and the agency's view of a
// client's quiz.
//
// Every chart here is a row of label, bar and number: the figure is
// always written next to its bar, so it survives a greyscale print and
// a screen reader, and one hue is enough.
// ============================================================

import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

import {
  LEAD_STATUS_LABEL,
  NO_CAMPAIGN,
  NO_CREATIVE,
  type PersonRow,
  type QuizReport,
  type SourceRow,
} from "@/lib/quiz/report";
import { cn } from "@/lib/utils";

import { FilterChips, type PillItem } from "@/components/ui/pill-nav";

import { percent } from "../quiz-list";
import { RouteBadge } from "./ui";

function Card({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface flex flex-col rounded-2xl p-5", className)}>
      <header className="mb-4">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="surface rounded-2xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums text-foreground">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** A label, a bar and the number, on one line. */
function BarRow({
  label,
  value,
  share,
  note,
  muted = false,
}: {
  label: ReactNode;
  value: ReactNode;
  /** 0–1: how much of the track the bar fills. */
  share: number;
  note?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-foreground">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/8">
        <div
          className={cn("h-full rounded-full", muted ? "bg-primary/45" : "bg-primary")}
          style={{ width: `${Math.max(Math.min(share, 1) * 100, share > 0 ? 1.5 : 0)}%` }}
        />
      </div>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceTable({
  title,
  column,
  hint,
  rows,
  empty,
}: {
  title: string;
  /** Heading of the first column ("Campanha"). */
  column: string;
  hint: string;
  rows: SourceRow[];
  /** What to call the visits whose link had no such value. */
  empty: string;
}) {
  return (
    <Card title={title} hint={hint}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem visitas no período.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-1 pb-2 font-normal">{column}</th>
                <th className="px-1 pb-2 text-right font-normal">Visitas</th>
                <th className="px-1 pb-2 text-right font-normal">Concluíram</th>
                <th className="px-1 pb-2 text-right font-normal">Leads</th>
                <th className="px-1 pb-2 text-right font-normal">Qualificados</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.slice(0, 12).map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <td className="max-w-[14rem] truncate px-1 py-2 text-foreground">
                    {row.key === NO_CAMPAIGN || row.key === NO_CREATIVE ? (
                      <span className="text-muted-foreground">{empty}</span>
                    ) : (
                      row.key
                    )}
                  </td>
                  <td className="px-1 py-2 text-right text-foreground">{row.visits}</td>
                  <td className="px-1 py-2 text-right text-muted-foreground">
                    {row.completed} <span className="text-xs">({percent(row.completed, row.visits)})</span>
                  </td>
                  <td className="px-1 py-2 text-right text-muted-foreground">{row.leads}</td>
                  <td className="px-1 py-2 text-right text-foreground">{row.qualified}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 12 ? (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              Mostrando as 12 maiores de {rows.length}. O CSV traz todas.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

interface ReportViewProps {
  report: QuizReport;
  people: PersonRow[];
  /** People in the period, of which `people` may be the first few. */
  peopleTotal: number;
  /**
   * False where the viewer may only see numbers (the agency, on a CRM
   * that granted "métricas"): the list of people is left out.
   */
  showPeople?: boolean;
}

export function ReportView({ report, people, peopleTotal, showPeople = true }: ReportViewProps) {
  const { totals } = report;
  const [who, setWho] = useState("all");
  const [open, setOpen] = useState<string | null>(null);

  const chips: PillItem[] = useMemo(
    () => [
      { value: "all", label: "Todos", badge: people.length },
      ...report.results.map((r) => ({
        value: `r:${r.id}`,
        label: r.name,
        badge: people.filter((p) => p.done && p.resultId === r.id).length,
      })),
      { value: "stopped", label: "Pararam no meio", badge: people.filter((p) => !p.done).length },
    ],
    [people, report.results],
  );

  const shown = people.filter((p) =>
    who === "all" ? true : who === "stopped" ? !p.done : p.done && `r:${p.resultId}` === who,
  );

  if (totals.visits === 0) {
    return (
      <div className="surface rounded-2xl px-6 py-12 text-center">
        <p className="text-base font-medium text-foreground">Nenhuma visita neste período</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          Assim que alguém abrir o link do quiz, a visita aparece aqui, mesmo que a pessoa pare
          no meio.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* ---- The period in six numbers ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Visitas" value={totals.visits} note="abriram o link" />
        <Tile
          label="Começaram"
          value={totals.started}
          note={`${percent(totals.started, totals.visits)} das visitas`}
        />
        <Tile
          label="Concluíram"
          value={totals.completed}
          note={`${percent(totals.completed, totals.visits)} das visitas`}
        />
        <Tile
          label="Leads no CRM"
          value={totals.leads}
          note={`${totals.qualified} ${totals.qualified === 1 ? "qualificado" : "qualificados"}`}
        />
        <Tile
          label="Cliques no botão final"
          value={totals.ctaClicks}
          note={`${totals.ctaVisits} ${totals.ctaVisits === 1 ? "pessoa clicou" : "pessoas clicaram"}`}
        />
        <Tile label="Tempo para concluir" value={duration(totals.medianSeconds)} note="tempo típico" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
        {/* ---- Funnel ---- */}
        <Card
          title="Até onde as pessoas foram"
          hint="Quantas visitas chegaram a cada tela, e quantas pararam nela."
        >
          <div className="grid gap-3.5">
            {report.funnel.map((row) => (
              <BarRow
                key={row.id}
                muted={row.conditional}
                label={
                  <>
                    {row.label}
                    {row.conditional ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">(só para alguns)</span>
                    ) : null}
                  </>
                }
                value={
                  <>
                    {row.reached}{" "}
                    <span className="text-xs text-muted-foreground">
                      {percent(row.reached, totals.visits)}
                    </span>
                  </>
                }
                share={totals.visits ? row.reached / totals.visits : 0}
                note={
                  row.stopped > 0
                    ? `${row.stopped} ${row.stopped === 1 ? "pessoa parou" : "pessoas pararam"} aqui`
                    : undefined
                }
              />
            ))}
          </div>
        </Card>

        <div className="grid gap-4">
          {/* ---- Results ---- */}
          <Card title="Resultados" hint="Em que resultado caiu quem concluiu.">
            <div className="grid gap-3.5">
              {report.results.map((r) => (
                <BarRow
                  key={r.id}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {r.name} <RouteBadge route={r.route} />
                    </span>
                  }
                  value={
                    <>
                      {r.count}{" "}
                      <span className="text-xs text-muted-foreground">
                        {percent(r.count, totals.completed)}
                      </span>
                    </>
                  }
                  share={totals.completed ? r.count / totals.completed : 0}
                />
              ))}
            </div>
          </Card>

          {/* ---- Devices ---- */}
          <Card title="Aparelho">
            <div className="grid gap-3.5">
              {report.devices.map((d) => (
                <BarRow
                  key={d.key}
                  label={d.key === "mobile" ? "Celular" : d.key === "desktop" ? "Computador" : "Não identificado"}
                  value={
                    <>
                      {d.visits}{" "}
                      <span className="text-xs text-muted-foreground">
                        {percent(d.completed, d.visits)} concluíram
                      </span>
                    </>
                  }
                  share={d.visits / totals.visits}
                />
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ---- Answers ---- */}
      {report.answers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {report.answers.map((question) => (
            <Card
              key={question.stepId}
              title={question.label}
              hint={`${question.total} ${question.total === 1 ? "resposta" : "respostas"}`}
            >
              <div className="grid gap-3">
                {question.options.map((option) => (
                  <BarRow
                    key={option.id}
                    label={option.label}
                    value={
                      <>
                        {option.count}{" "}
                        <span className="text-xs text-muted-foreground">
                          {percent(option.count, question.total)}
                        </span>
                      </>
                    }
                    share={question.total ? option.count / question.total : 0}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {/* ---- Where the visits came from ---- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SourceTable
          title="Por campanha"
          column="Campanha"
          hint="Pelo utm_campaign do link."
          rows={report.campaigns}
          empty="Sem campanha no link"
        />
        <SourceTable
          title="Por criativo"
          column="Criativo"
          hint="Pelo utm_content do link: qual anúncio traz lead qualificado."
          rows={report.creatives}
          empty="Sem criativo no link"
        />
      </div>

      {/* ---- People ---- */}
      {showPeople ? (
        <Card
          title="Pessoas"
          hint={
            peopleTotal > people.length
              ? `As ${people.length} visitas mais recentes de ${peopleTotal}. O CSV traz todas.`
              : "Uma linha por visita, das mais recentes para as mais antigas. Clique para ver as respostas."
          }
        >
          <FilterChips items={chips} value={who} onChange={setWho} ariaLabel="Filtrar pessoas" />
          <div className="-mx-1 mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-1 pb-2 font-normal">Quando</th>
                  <th className="px-1 pb-2 font-normal">Pessoa</th>
                  <th className="px-1 pb-2 font-normal">Situação</th>
                  <th className="px-1 pb-2 font-normal">Campanha · criativo</th>
                  <th className="w-8 px-1 pb-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => {
                  const expanded = open === person.id;
                  return (
                    <Fragment key={person.id}>
                      <tr
                        className="cursor-pointer border-t border-border hover:bg-foreground/[0.03]"
                        onClick={() => setOpen(expanded ? null : person.id)}
                      >
                        <td className="px-1 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                          {when(person.at)}
                        </td>
                        <td className="px-1 py-2.5">
                          <span className="block text-foreground">
                            {person.name || <span className="text-muted-foreground">Sem nome</span>}
                          </span>
                          {person.phone || person.email ? (
                            <span className="block text-xs tabular-nums text-muted-foreground">
                              {person.phone || person.email}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-1 py-2.5">
                          {person.done ? (
                            <span className="inline-flex flex-wrap items-center gap-1.5 text-foreground">
                              {person.resultName}
                              {person.route ? <RouteBadge route={person.route} /> : null}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {person.stoppedAt === "Abriu a página"
                                ? "Abriu a página e saiu"
                                : `Parou em “${person.stoppedAt}”`}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[14rem] truncate px-1 py-2.5 text-muted-foreground">
                          {[person.campaign, person.creative].filter(Boolean).join(" · ") || "–"}
                        </td>
                        <td className="px-1 py-2.5">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`Respostas de ${person.name || "visita sem nome"}`}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/8"
                          >
                            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-foreground/[0.03]">
                          <td colSpan={5} className="px-3 py-3">
                            <PersonDetail person={person} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {shown.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-1 py-6 text-center text-muted-foreground">
                      Ninguém neste filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function PersonDetail({ person }: { person: PersonRow }) {
  const facts = [
    ["Empresa", person.company],
    ["Cidade", person.city],
    ["Instagram", person.instagram],
    ["E-mail", person.phone ? person.email : ""],
    ["Origem", person.source],
    ["Aparelho", person.device],
    ["Cliques no botão final", person.ctaClicks > 0 ? String(person.ctaClicks) : ""],
    ["Lead", LEAD_STATUS_LABEL[person.leadStatus] ?? ""],
  ].filter(([, value]) => value);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <dl className="grid content-start gap-1.5 text-sm">
        {person.answers.length === 0 ? (
          <p className="text-muted-foreground">Saiu antes de responder alguma pergunta.</p>
        ) : (
          person.answers.map((item) => (
            <div key={item.question} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{item.question}:</dt>
              <dd className="text-foreground">{item.answer}</dd>
            </div>
          ))
        )}
      </dl>
      <div className="grid content-start gap-1.5 text-sm">
        {facts.map(([label, value]) => (
          <p key={label} className="flex flex-wrap gap-x-2">
            <span className="text-muted-foreground">{label}:</span>
            <span className="text-foreground">{value}</span>
          </p>
        ))}
        {person.contactId ? (
          <Link
            href={`/contacts?contact=${person.contactId}`}
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3.5" />
            Abrir o contato no CRM
          </Link>
        ) : null}
      </div>
    </div>
  );
}
