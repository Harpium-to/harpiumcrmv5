"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Check, Copy, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface OpenLink {
  created_at: string;
  expires_at: string;
  via: "crm" | "agencia";
}

interface Generated {
  url: string;
  message: string;
  expires_at: string;
}

/**
 * The WhatsApp connect link that works without login (Fase A, 081):
 * send it over WhatsApp, copy it, see until when the open one is good
 * and cancel it. Used in Settings › WhatsApp and in the agency console;
 * `endpoint` says which route answers (GET/POST/DELETE).
 */
export function ConnectLinkPanel({
  endpoint,
  emphasize = false,
}: {
  endpoint: string;
  /** Not connected yet: sending the link is the obvious next step. */
  emphasize?: boolean;
}) {
  const t = useTranslations("ConnectLink");
  const [open, setOpen] = useState<OpenLink | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState<"idle" | "new" | "cancel">("idle");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { link: OpenLink | null };
      setOpen(data.link);
    } catch {
      /* the buttons still work */
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ensureLink(): Promise<Generated | null> {
    if (generated) return generated;
    setBusy("new");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("failed"));
        return null;
      }
      const g = data as Generated;
      setGenerated(g);
      setOpen({ created_at: new Date().toISOString(), expires_at: g.expires_at, via: "crm" });
      return g;
    } catch {
      toast.error(t("failed"));
      return null;
    } finally {
      setBusy("idle");
    }
  }

  async function share() {
    // Open the tab while the click still counts, then point it at wa.me.
    const tab = window.open("about:blank", "_blank");
    const g = await ensureLink();
    if (!g) {
      tab?.close();
      return;
    }
    const href = `https://wa.me/?text=${encodeURIComponent(g.message)}`;
    if (tab) {
      tab.opener = null;
      tab.location.href = href;
    } else {
      window.location.href = href;
    }
  }

  async function copy() {
    const g = await ensureLink();
    if (!g) return;
    try {
      await navigator.clipboard.writeText(g.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t("copyPrompt"), g.url);
    }
  }

  async function cancel() {
    if (!confirm(t("cancelConfirm"))) return;
    setBusy("cancel");
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("failed"));
        return;
      }
      setOpen(null);
      setGenerated(null);
      toast.success(t("cancelled"));
    } finally {
      setBusy("idle");
    }
  }

  const disabled = busy !== "idle";
  const until = open ? format(new Date(open.expires_at), "dd/MM 'às' HH:mm") : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={emphasize ? "default" : "outline"} onClick={share} disabled={disabled}>
          {busy === "new" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("send")}
        </Button>
        <Button size="sm" variant="outline" onClick={copy} disabled={disabled}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>

      {generated && (
        <Input
          readOnly
          value={generated.url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 font-mono text-xs"
          aria-label={t("linkLabel")}
        />
      )}

      {open ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{t("activeUntil", { until: until ?? "" })}</span>
          {!generated && <span>{t("replaceHint")}</span>}
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-destructive underline underline-offset-2"
            onClick={cancel}
            disabled={disabled}
          >
            {busy === "cancel" ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            {t("cancel")}
          </button>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("rules")}</p>
      )}
    </div>
  );
}
