'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CheckCircle2, History, Loader2, LogOut, QrCode, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';

// ============================================================
// Pairing a WhatsApp number by QR code (UAZAPI), D1.
//
// Shared by Settings › WhatsApp (the client's unofficial path, on the
// Harpium's server) and /canais/uazapi (the agency's manual setup).
// /connect mints the instance and wires the webhook server-side, then
// /status is polled for the QR until the phone is linked: nobody
// copies a token or a callback URL.
// ============================================================

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

export function UazapiQrPanel({
  canManage,
  canConnect,
  onChange,
  note,
}: {
  /** Admins+ connect and disconnect; everyone else sees the state. */
  canManage: boolean;
  /** A server is known (the Harpium's, or one saved for this CRM). */
  canConnect: boolean;
  /** Called after connecting or disconnecting, to refresh the page. */
  onChange?: () => void;
  /** Extra line under the state (e.g. "own server set up by the agency"). */
  note?: ReactNode;
}) {
  const t = useTranslations('Settings.whatsappPath.qr');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [importing, setImporting] = useState<{ chats: number; messages: number } | null>(null);
  const [polling, setPolling] = useState(false);
  const pollStartedAt = useRef<number>(0);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/uazapi/status', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'status');
      setStatus(json as StatusPayload);
      return json as StatusPayload;
    } catch {
      // A failed poll is not worth a toast on every tick — the panel
      // keeps showing the last known state.
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Poll while pairing. Stops on success or after POLL_TIMEOUT_MS.
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      const s = await refreshStatus();
      if (s?.connected) {
        setPolling(false);
        toast.success(
          s.phone ? t('connectedToast', { phone: `+${s.phone}` }) : t('connectedToastNoPhone'),
        );
        onChange?.();
        return;
      }
      if (Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS) {
        setPolling(false);
        toast.error(t('timeout'));
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, refreshStatus, onChange, t]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch('/api/uazapi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      toast.success(t('scanToast'));
      pollStartedAt.current = Date.now();
      setPolling(true);
      void refreshStatus();
    } catch (err) {
      toast.error(t('failed', { message: err instanceof Error ? err.message : '' }));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t('disconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/uazapi/disconnect', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      toast.success(t('disconnected'));
      setPolling(false);
      await refreshStatus();
      onChange?.();
    } catch (err) {
      toast.error(t('failed', { message: err instanceof Error ? err.message : '' }));
    } finally {
      setDisconnecting(false);
    }
  };

  /**
   * Copy the phone's old 1:1 chats, a page per call, following the
   * server's offset (see /api/uazapi/history).
   */
  const importHistory = async () => {
    if (!window.confirm(t('importHistoryConfirm'))) return;
    setImporting({ chats: 0, messages: 0 });
    let chats = 0;
    let messages = 0;
    let contacts = 0;
    try {
      let offset: number | null = 0;
      for (let guard = 0; offset !== null && guard < 200; guard++) {
        const res: Response = await fetch('/api/uazapi/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? '');
        chats += json.chats ?? 0;
        messages += json.imported ?? 0;
        contacts += json.contacts_created ?? 0;
        setImporting({ chats, messages });
        offset = typeof json.next_offset === 'number' ? json.next_offset : null;
      }
      toast.success(
        messages > 0
          ? t('importHistoryDone', { chats, messages, contacts })
          : t('importHistoryNothing'),
      );
    } catch (err) {
      toast.error(t('failed', { message: err instanceof Error ? err.message : '' }));
    } finally {
      setImporting(null);
    }
  };

  const connected = status?.connected === true;
  const busy = connecting || polling;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {connected ? (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
          ) : (
            <Smartphone className="size-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {connected ? t('connected') : t('notConnected')}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {connected
                ? [status?.profileName, status?.phone && `+${status.phone}`]
                    .filter(Boolean)
                    .join(' · ') || t('pairedNumber')
                : t('statusLabel', { status: status?.status ?? '—' })}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            {connected && (
              <Button
                type="button"
                variant="outline"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                {disconnecting ? t('disconnecting') : t('disconnect')}
              </Button>
            )}
            <Button
              type="button"
              onClick={connect}
              disabled={busy || !canConnect}
              variant={connected ? 'outline' : 'default'}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
              {connected ? t('reconnect') : t('connect')}
            </Button>
          </div>
        )}
      </div>

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {!canConnect && <p className="text-sm text-muted-foreground">{t('noServer')}</p>}

      {polling && !connected && (
        <div className="flex flex-col items-center gap-3 border-t border-border pt-4">
          {status?.qrcode ? (
            <Image
              src={status.qrcode}
              alt={t('title')}
              width={240}
              height={240}
              unoptimized
              className="rounded-lg bg-white p-2"
            />
          ) : status?.paircode ? (
            <p className="font-mono text-2xl tracking-widest text-foreground">{status.paircode}</p>
          ) : (
            <div className="flex size-[240px] items-center justify-center rounded-lg border border-dashed border-border">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">{t('instructions')}</p>
        </div>
      )}

      {connected && <p className="text-xs text-muted-foreground">{t('offlineHint')}</p>}

      {connected && canManage && (
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {importing
              ? t('importingHistory', { chats: importing.chats, messages: importing.messages })
              : t('importHistoryHint')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={importHistory}
            disabled={importing !== null}
            className="shrink-0"
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
            {t('importHistory')}
          </Button>
        </div>
      )}
    </div>
  );
}
