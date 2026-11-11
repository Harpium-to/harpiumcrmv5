"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Loader2, QrCode, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UazapiQrPanel } from "@/components/settings/uazapi-qr-panel";

// UAZAPI — manual setup (D1).
//
// A client chooses the unofficial path in Settings › WhatsApp and
// pairs on the Harpium's server without seeing any of this. This page
// is for the agency (or a CRM with a server of its own): the server
// address and tokens are saved here, then pairing is the same QR panel.

export default function UazapiSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [savedBaseUrl, setSavedBaseUrl] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [hasInstanceToken, setHasInstanceToken] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [panelKey, setPanelKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/uazapi/config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar");
      setBaseUrl(json.baseUrl ?? "");
      setSavedBaseUrl(json.baseUrl ?? "");
      setInstanceName(json.instanceName ?? "");
      setEnabled(Boolean(json.enabled));
      setHasAdminToken(Boolean(json.hasAdminToken));
      setHasInstanceToken(Boolean(json.hasInstanceToken));
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
      const res = await fetch("/api/uazapi/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          instanceName,
          enabled,
          // Only send tokens the operator actually typed.
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {}),
          ...(instanceToken.trim()
            ? { instanceToken: instanceToken.trim() }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      if (adminToken.trim()) {
        setHasAdminToken(true);
        setAdminToken("");
      }
      if (instanceToken.trim()) {
        setHasInstanceToken(true);
        setInstanceToken("");
      }
      setSavedBaseUrl(baseUrl);
      toast.success("Configuração salva");
      // The QR panel re-reads the status of the (possibly new) server.
      setPanelKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <QrCode className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            WhatsApp via UAZAPI · configuração manual
          </h1>
          <p className="text-sm text-muted-foreground">
            Para um servidor UAZAPI próprio. O cliente escolhe o WhatsApp
            não oficial em{" "}
            <Link href="/settings?tab=whatsapp" className="underline">
              Configurações › WhatsApp
            </Link>{" "}
            e conecta no servidor da Harpium, sem nada disto.
          </p>
        </div>
      </div>

      <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          A UAZAPI é um canal não oficial (conecta por QR code) e{" "}
          <strong>
            viola os termos da Meta — há risco de banimento do número
          </strong>
          , principalmente em disparos em massa. Com o canal ativo, tudo o
          que o CRM envia por WhatsApp sai por ele, a menos que o CRM tenha
          escolhido o caminho oficial.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <UazapiQrPanel
            key={panelKey}
            canManage
            canConnect={Boolean(savedBaseUrl)}
          />

          {/* Credentials */}
          <div className="space-y-5 rounded-xl border border-border bg-card p-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="font-medium text-foreground">
                Ativar canal UAZAPI (o CRM envia por aqui)
              </span>
            </label>

            <div>
              <Label htmlFor="baseUrl" className="text-muted-foreground">
                URL do servidor UAZAPI
              </Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://seu-servidor.uazapi.com"
                className="mt-1 border-border bg-muted"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A UAZAPI não tem um host único — use o endereço do servidor
                onde ficam as suas instâncias.
              </p>
            </div>

            <div>
              <Label htmlFor="adminToken" className="text-muted-foreground">
                Token de administrador{" "}
                {hasAdminToken && (
                  <span className="text-xs">(salvo — deixe em branco para manter)</span>
                )}
              </Label>
              <Input
                id="adminToken"
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder={hasAdminToken ? "•••••••• (mantido)" : "admintoken do servidor"}
                className="mt-1 border-border bg-muted"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Usado só para criar a instância na hora de conectar. Fica no
                servidor, nunca vai para o navegador.
              </p>
            </div>

            <div>
              <Label htmlFor="instanceToken" className="text-muted-foreground">
                Token da instância{" "}
                {hasInstanceToken && (
                  <span className="text-xs">(salvo — deixe em branco para manter)</span>
                )}
              </Label>
              <Input
                id="instanceToken"
                type="password"
                value={instanceToken}
                onChange={(e) => setInstanceToken(e.target.value)}
                placeholder={
                  hasInstanceToken ? "•••••••• (mantido)" : "opcional — se já tiver uma instância"
                }
                className="mt-1 border-border bg-muted"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Deixe em branco para o sistema criar a instância sozinho com o
                token de administrador.
              </p>
            </div>

            <div>
              <Label htmlFor="instanceName" className="text-muted-foreground">
                Nome da instância
              </Label>
              <Input
                id="instanceName"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="ex.: atendimento-harpium"
                className="mt-1 border-border bg-muted"
              />
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
        </>
      )}
    </div>
  );
}
