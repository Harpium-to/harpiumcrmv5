"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ExportId } from "@/lib/reports/export";

interface ReportCardProps {
  title: string;
  hint?: string;
  /** Omit to hide the export button for a section with no CSV. */
  exportId?: ExportId;
  /** The query string identifying the current window. */
  query: string;
  children: React.ReactNode;
}

/**
 * One section of the report screen.
 *
 * The export button lives on the section rather than in a toolbar at
 * the top, so what you download is unambiguously the thing you were
 * looking at. A single "exportar" button above a screen of twelve
 * breakdowns raises the question of which one it means.
 */
export function ReportCard({
  title,
  hint,
  exportId,
  query,
  children,
}: ReportCardProps) {
  const t = useTranslations("Reports");
  const [downloading, setDownloading] = useState(false);

  async function download() {
    if (!exportId || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/reports/export?report=${exportId}&${query}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? t("exportFailed"));
      }
      // Read the whole body before creating the link: a failed stream
      // would otherwise save a truncated CSV with no sign anything
      // went wrong.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        filenameFrom(res.headers.get("Content-Disposition")) ??
        `${exportId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("exportFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="surface flex flex-col rounded-2xl p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {hint ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {exportId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void download()}
            disabled={downloading}
            aria-label={`${t("exportCsv")} — ${title}`}
            title={t("exportCsv")}
          >
            {downloading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
          </Button>
        ) : null}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}
