"use client";

// ============================================================
// What the three screens of the extractor share: the shapes the API
// answers with, the badges and the small formatters.
// ============================================================

import { Building2, MapPin } from "lucide-react";

import type {
  ExtractionSource,
  ExtractionStatus,
  ExtraValue,
  ResultStatus,
} from "@/lib/extractor/types";
import { cn } from "@/lib/utils";

export interface Totals {
  kept: number;
  novos: number;
  contatos: number;
  extraidos: number;
  bloqueados: number;
  sem_telefone: number;
  importados: number;
}

export interface ExtractionItem {
  id: string;
  name: string;
  source: ExtractionSource;
  status: ExtractionStatus;
  requested: number;
  found: number;
  fetched: number;
  costUsd: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  description?: string;
  totals: Totals;
}

export interface ResultItem {
  id: string;
  kind: "empresa" | "pessoa";
  name: string;
  phone: string | null;
  phone_kind: "celular" | "fixo" | null;
  has_whatsapp: boolean | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
  activity: string | null;
  extras: Record<string, ExtraValue>;
  status: ResultStatus;
  matched_contact_id: string | null;
  contact_id: string | null;
  imported_at: string | null;
}

export type SourceAvailability = Record<ExtractionSource, { available: boolean; reason?: string }>;

export const STATUS_LABEL: Record<ExtractionStatus, string> = {
  queued: "Na fila",
  running: "Extraindo",
  done: "Pronta",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export const SOURCE_NAME: Record<ExtractionSource, string> = {
  cnpj: "CNPJ",
  google_maps: "Google Maps",
};

export function SourceIcon({ source, className }: { source: ExtractionSource; className?: string }) {
  const Icon = source === "cnpj" ? Building2 : MapPin;
  return <Icon className={className} />;
}

export function JobBadge({ status }: { status: ExtractionStatus }) {
  const going = status === "queued" || status === "running";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "done" && "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        going && "bg-sky-500/12 text-sky-600 dark:text-sky-400",
        status === "failed" && "bg-red-500/12 text-red-600 dark:text-red-400",
        status === "cancelled" && "bg-foreground/8 text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "done" && "bg-emerald-500",
          going && "animate-pulse bg-sky-500",
          status === "failed" && "bg-red-500",
          status === "cancelled" && "bg-muted-foreground",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

const RESULT_TONE: Record<ResultStatus, string> = {
  novo: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  contato: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  extraido: "bg-foreground/8 text-muted-foreground",
  bloqueado: "bg-red-500/12 text-red-600 dark:text-red-400",
  sem_telefone: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
};

export const RESULT_LABEL: Record<ResultStatus, string> = {
  novo: "Novo",
  contato: "Já é contato",
  extraido: "Já extraído antes",
  bloqueado: "Pediu para não receber",
  sem_telefone: "Sem telefone",
};

export function ResultBadge({ status }: { status: ResultStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", RESULT_TONE[status])}>
      {RESULT_LABEL[status]}
    </span>
  );
}

export const num = (n: number) => n.toLocaleString("pt-BR");

export const usd = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** "+5562999998888" → "(62) 99999-8888". */
export function formatPhone(phone: string | null): string {
  if (!phone) return "";
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

/** The native controls of these screens, in the CRM's look. */
export const fieldClass =
  "h-9 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export const checkClass = "size-4 shrink-0 cursor-pointer rounded border-input accent-[var(--primary)]";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Não deu certo. Tente de novo.");
  return json;
}

export const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
