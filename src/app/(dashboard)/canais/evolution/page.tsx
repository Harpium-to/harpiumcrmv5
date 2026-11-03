"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, Plug, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function EvolutionSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [instance, setInstance] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);

  const webhookUrl =
    webhookToken && typeof window !== "undefined"
      ? `${window.location.origin}/api/evolution/webhook/${webhookToken}`
      : "";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/evolution/config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar");
      setBaseUrl(json.baseUrl ?? "");
      setInstance(json.instance ?? "");
      setEnabled(Boolean(json.enabled));
      setHasApiKey(Boolean(json.hasApiKey));
      setWebhookToken(json.webhookToken ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/evolution/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          instance,
          enabled,
          // only send the key if the user typed a new one
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      if (json.webhookToken) setWebhookToken(json.webhookToken);
      if (apiKey.trim()) {
        setHasApiKey(true);
        setApiKey("");
      }
      toast.success("Configuração salva");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("URL copiada");
    } catch {
      toast.error("Copie manualmente");
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Plug className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            WhatsApp via Evolution API
          </h1>
          <p className="text-sm text-muted-foreground">
            Canal alternativo (não oficial) ao lado da API oficial da Meta.
          </p>
        </div>
      </div>

      <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          A Evolution API é não oficial (conecta por QR code) e{" "}
          <strong>viola os termos da Meta — há risco de banimento do número</strong>,
          principalmente em disparos em massa. Use com cautela. Quando o canal
          está ativo, os envios de texto do inbox saem por ele.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <span className="font-medium text-foreground">
              Ativar canal Evolution (roteia os textos por aqui)
            </span>
          </label>

          <div>
            <Label htmlFor="baseUrl" className="text-muted-foreground">
              URL da instância Evolution
            </Label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://sua-evolution.com"
              className="mt-1 border-border bg-muted"
            />
          </div>

          <div>
            <Label htmlFor="instance" className="text-muted-foreground">
              Nome da instância
            </Label>
            <Input
              id="instance"
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
              placeholder="ex.: minha-empresa"
              className="mt-1 border-border bg-muted"
            />
          </div>

          <div>
            <Label htmlFor="apiKey" className="text-muted-foreground">
              API Key {hasApiKey && <span className="text-xs">(já salva — deixe em branco para manter)</span>}
            </Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? "•••••••• (mantida)" : "sua apikey do Evolution"}
              className="mt-1 border-border bg-muted"
            />
          </div>

          <div>
            <Label className="text-muted-foreground">
              URL de webhook (cole no Evolution)
            </Label>
            <div className="mt-1 flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="border-border bg-muted font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                onClick={copyWebhook}
                disabled={!webhookUrl}
                className="shrink-0"
              >
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              No Evolution, configure o webhook da instância com esta URL e o
              evento <code className="font-mono">messages.upsert</code>.
            </p>
          </div>

          <Button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar
          </Button>
        </div>
      )}
    </div>
  );
}
