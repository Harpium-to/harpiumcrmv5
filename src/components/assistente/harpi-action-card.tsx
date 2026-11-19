"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, Loader2, Pencil, RotateCcw, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UiAction } from "@/lib/assistente/types";

// ============================================================
// The confirmation card. Its text was built by the server from the
// exact action — the model did not write it — and "Confirmar" runs
// precisely that. After it ran: the result, a link, and Undo while
// it can still be undone.
// ============================================================

const RISK_TONE: Record<UiAction["risk"], string> = {
  pequena: "border-border",
  maior: "border-primary/40",
  cliente: "border-amber-500/60",
};

export function HarpiActionCard({
  action,
  busy,
  onDecide,
  onNavigate,
}: {
  action: UiAction;
  busy: boolean;
  onDecide: (decision: "confirmar" | "cancelar" | "ajustar" | "desfazer") => Promise<UiAction | null>;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { preview } = action;
  const pending = action.status === "pending";

  const confirmAndOpen = async () => {
    const after = await onDecide("confirmar");
    // Straight to what was just created (its editor), when it worked.
    if (after?.status === "done" && after.link) {
      router.push(after.link.href);
      onNavigate?.();
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm",
        pending ? RISK_TONE[action.risk] : "border-border",
        !pending && action.status !== "done" && "opacity-80",
      )}
    >
      <div className="flex items-start gap-2">
        <StatusIcon status={action.status} />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">{preview.title}</p>
      </div>

      {preview.lines.length > 0 && (
        <ul className="mt-2 space-y-1 text-[0.8rem] leading-snug text-muted-foreground">
          {preview.lines.map((line, i) => (
            <li key={i} className={cn("break-words", /^\s/.test(line) && "pl-4")}>
              {line.trim()}
            </li>
          ))}
        </ul>
      )}

      {preview.sample && preview.sample.length > 0 && (
        <p className="mt-2 text-[0.75rem] text-muted-foreground">
          {preview.sample.join(", ")}
          {preview.count && preview.count > preview.sample.length
            ? ` e mais ${preview.count - preview.sample.length}`
            : ""}
        </p>
      )}

      {(preview.badges?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {preview.badges!.map((b) => (
            <span
              key={b}
              className={cn(
                "rounded-md px-2 py-0.5 text-[0.7rem] font-medium",
                b === "Fala com clientes" || b === "Avisa o cliente"
                  ? "bg-amber-400 text-amber-950"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {b}
            </span>
          ))}
        </div>
      )}

      {pending && (preview.warnings?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1">
          {preview.warnings!.map((w) => (
            <p key={w} className="flex gap-1.5 rounded-md bg-amber-400/15 px-2 py-1.5 text-[0.75rem] text-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      {pending ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => onDecide("confirmar")}>
            <Check className="size-3.5" />
            Confirmar
          </Button>
          {preview.openAfter && (
            <Button size="sm" variant="outline" disabled={busy} onClick={confirmAndOpen}>
              {preview.openAfter.label}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("ajustar")}>
            <Pencil className="size-3.5" />
            Ajustar
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("cancelar")}>
            <X className="size-3.5" />
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem]">
          <span className="text-muted-foreground">{statusLine(action)}</span>
          {action.link && action.status === "done" && (
            <Link href={action.link.href} onClick={onNavigate} className="font-medium text-primary hover:underline">
              {action.link.label}
            </Link>
          )}
          {action.canUndo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide("desfazer")}
              className="inline-flex items-center gap-1 font-medium text-foreground/80 hover:text-foreground disabled:opacity-50"
            >
              <Undo2 className="size-3.5" />
              Desfazer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function statusLine(action: UiAction): string {
  switch (action.status) {
    case "done":
      return action.auto ? `Feito direto (alteração pequena). ${action.summary ?? ""}` : action.summary ?? "Feito.";
    case "failed":
      return `Não deu certo: ${action.error ?? "erro"}`;
    case "cancelled":
      return "Cancelado. Nada foi feito.";
    case "expired":
      return "Expirou sem resposta. Nada foi feito.";
    case "undone":
      return "Desfeito.";
    case "running":
      return "Fazendo…";
    default:
      return "";
  }
}

function StatusIcon({ status }: { status: UiAction["status"] }) {
  const cls = "mt-0.5 size-4 shrink-0";
  if (status === "done") return <Check className={cn(cls, "text-emerald-600")} />;
  if (status === "failed") return <AlertTriangle className={cn(cls, "text-destructive")} />;
  if (status === "running") return <Loader2 className={cn(cls, "animate-spin text-muted-foreground")} />;
  if (status === "undone") return <RotateCcw className={cn(cls, "text-muted-foreground")} />;
  if (status === "cancelled" || status === "expired") return <X className={cn(cls, "text-muted-foreground")} />;
  return <Clock className={cn(cls, "text-amber-600")} />;
}
