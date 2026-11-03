"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  QrCode,
  Save,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// UAZAPI channel setup.
//
// The point of this page, versus the Evolution one, is that pairing
// happens here: /connect mints the instance and wires the webhook
// server-side, then we poll /status for the QR until the phone is
// linked. The operator never copies a token or a callback URL.

interface StatusPayload {
  configured: boolean;
  status: string;
  connected: boolean;
  qrcode: string | null;
  paircode: string | null;
  phone: string | null;
  profileName: string | null;
}

const POLL_MS = 2500;
// UAZAPI rotates the QR every ~20s and gives up well before this; stop
// polling so a forgotten tab doesn't hammer the gateway's rate limit.
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export default function UazapiSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [hasInstanceToken, setHasInstanceToken] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [polling, setPolling] = useState(false);
  const pollStartedAt = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/uazapi/config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar");
      setBaseUrl(json.baseUrl ?? "");
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

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/uazapi/status");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao consultar status");
      setStatus(json as StatusPayload);
      return json as StatusPayload;
    } catch {
      // A failed poll is not worth a toast on every tick — the banner
      // keeps showing the last known state.
      return null;
    }
  }, []);

  useEffect(() => {
    void load().then(() => refreshStatus());
  }, [load, refreshStatus]);

  // Poll while pairing. Stops on success or after POLL_TIMEOUT_MS.
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      const s = await refreshStatus();
      if (s?.connected) {
        setPolling(false);
        toast.success(
          s.phone ? `WhatsApp conectado: +${s.phone}` : "WhatsApp conectado",
        );
        return;
      }
      if (Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS) {
        setPolling(false);
        toast.error("Tempo esgotado. Clique em conectar para gerar outro QR.");
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, refreshStatus]);

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
      toast.success("Configuração salva");
      void refreshStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/uazapi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao conectar");
      toast.success("Leia o QR code com o WhatsApp do seu celular");
      pollStartedAt.current = Date.now();
      setPolling(true);
      void refreshStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao conectar");
    } finally {
      setConnecting(false);
    }
  };

  const connected = status?.connected === true;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <QrCode className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            WhatsApp via UAZAPI
          </h1>
          <p className="text-sm text-muted-foreground">
            Conecte o número lendo um QR code, sem sair do sistema.
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
          , principalmente em disparos em massa. Quando o canal está ativo, os
          envios de texto do inbox saem por ele.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Connection state + pairing */}
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {connected ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Smartphone className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium text-foreground">
                    {connected ? "Conectado" : "Não conectado"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connected
                      ? [status?.profileName, status?.phone && `+${status.phone}`]
                          .filter(Boolean)
                          .join(" · ") || "Número pareado"
                      : `Estado: ${status?.status ?? "desconhecido"}`}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={connect}
                disabled={connecting || polling || !baseUrl}
                variant={connected ? "outline" : "default"}
                className={
                  connected
                    ? ""
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }
              >
                {connecting || polling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
                {connected ? "Reconectar" : "Conectar WhatsApp"}
              </Button>
            </div>

            {polling && !connected && (
              <div className="flex flex-col items-center gap-3 border-t border-border pt-4">
                {status?.qrcode ? (
                  <Image
                    src={status.qrcode}
                    alt="QR code para parear o WhatsApp"
                    width={240}
                    height={240}
                    unoptimized
                    className="rounded-lg bg-white p-2"
                  />
                ) : status?.paircode ? (
                  <p className="font-mono text-2xl tracking-widest text-foreground">
                    {status.paircode}
                  </p>
                ) : (
                  <div className="flex h-[240px] w-[240px] items-center justify-center rounded-lg border border-dashed border-border">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="text-center text-xs text-muted-foreground">
                  No celular: WhatsApp → Aparelhos conectados → Conectar
                  aparelho. O código se renova sozinho.
                </p>
              </div>
            )}
          </div>

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
                Ativar canal UAZAPI (roteia os textos por aqui)
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
