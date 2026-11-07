'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppConfig } from './whatsapp-config';
import { isFacebookOrigin, parseEmbeddedSignupMessage } from '@/lib/whatsapp/embedded-signup-client';

// ============================================================
// Settings › WhatsApp, with Embedded Signup.
//
// When the server has the Embedded Signup settings, the panel leads
// with one button: the customer goes through Meta's popup and the
// server does the rest (token, register, subscribe). The old form
// stays available, folded, for test numbers and support.
// Without the settings the panel is exactly the old form.
// ============================================================

interface EmbeddedSignupInfo {
  enabled: boolean;
  app_id: string | null;
  config_id: string | null;
  graph_version: string | null;
  can_manage: boolean;
}

interface FacebookLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FacebookSdk {
  init(options: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

export function WhatsAppSettings() {
  const t = useTranslations('Settings.whatsappConnect');
  const [info, setInfo] = useState<EmbeddedSignupInfo | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch('/api/whatsapp/embedded-signup', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: EmbeddedSignupInfo | null) => {
        if (alive) setInfo(data ?? { enabled: false, app_id: null, config_id: null, graph_version: null, can_manage: false });
      })
      .catch(() => {
        if (alive) setInfo({ enabled: false, app_id: null, config_id: null, graph_version: null, can_manage: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!info) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  // Not configured on this server → the panel is the old form, as before.
  if (!info.enabled || !info.app_id || !info.config_id || !info.graph_version) {
    return <WhatsAppConfig />;
  }

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <WhatsAppConnectCard
        key={refreshKey}
        appId={info.app_id}
        configId={info.config_id}
        graphVersion={info.graph_version}
        canManage={info.can_manage}
      />
      {info.can_manage && (
        <Accordion className="rounded-xl border border-border px-4">
          <AccordionItem value="manual" className="border-none">
            <AccordionTrigger className="text-sm">
              <span className="flex flex-col items-start text-left">
                <span className="font-medium text-foreground">{t('manualTitle')}</span>
                <span className="text-xs font-normal text-muted-foreground">{t('manualDesc')}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <WhatsAppConfig hideHeader onChanged={() => setRefreshKey((k) => k + 1)} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </section>
  );
}

interface ConnectionState {
  connected: boolean;
  phone_info?: {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
  };
  registered?: boolean;
  registration_error?: string | null;
  reason?: string;
  message?: string;
}

interface CardProps {
  appId: string;
  configId: string;
  graphVersion: string;
  canManage: boolean;
}

function WhatsAppConnectCard({ appId, configId, graphVersion, canManage }: CardProps) {
  const t = useTranslations('Settings.whatsappConnect');
  const [state, setState] = useState<ConnectionState | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'popup' | 'finishing' | 'disconnecting' | 'pin'>('idle');
  const [pin, setPin] = useState('');
  // The popup reports the chosen WhatsApp account and number through
  // postMessage, separately from the login callback that carries the
  // code. Either can arrive first, so the ids wait here.
  const sessionRef = useRef<{ wabaId?: string; phoneNumberId?: string; businessId?: string }>({});

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/config', { cache: 'no-store' });
      const data = (await res.json()) as ConnectionState;
      setState(data);
    } catch {
      setState({ connected: false, reason: 'unknown' });
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin)) return;
      const parsed = parseEmbeddedSignupMessage(event.data);
      if (!parsed) return;
      if (parsed.kind === 'finish') {
        sessionRef.current = {
          wabaId: parsed.wabaId,
          phoneNumberId: parsed.phoneNumberId,
          businessId: parsed.businessId,
        };
      } else if (parsed.kind === 'error' && parsed.message) {
        toast.error(t('flowError', { message: parsed.message }));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [t]);

  const initSdk = useCallback(() => {
    if (!window.FB) return;
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
    setSdkReady(true);
  }, [appId, graphVersion]);

  async function finish(code: string) {
    setBusy('finishing');
    try {
      const session = sessionRef.current;
      const res = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          waba_id: session.wabaId ?? null,
          phone_number_id: session.phoneNumberId ?? null,
          business_id: session.businessId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('connectFailed'), { duration: 10000 });
        return;
      }
      if (data.registration_error) {
        toast.warning(t('attentionToast'), { duration: 10000 });
      } else {
        toast.success(
          t('connectedToast', {
            name: data.phone_info?.verified_name || data.phone_info?.display_phone_number || '',
          }),
        );
      }
      // Bring the account's approved templates in right away, so the
      // first business-initiated message doesn't need a trip to the
      // templates screen. Best-effort: a failure here isn't a failed
      // connection.
      void fetch('/api/whatsapp/templates/sync', { method: 'POST' }).catch(() => {});
      await loadState();
    } catch {
      toast.error(t('connectFailed'));
    } finally {
      setBusy('idle');
    }
  }

  function connect() {
    if (!window.FB || !sdkReady) return;
    sessionRef.current = {};
    setBusy('popup');
    // The SDK rejects async callbacks, so this stays a plain function.
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setBusy('idle');
          toast.message(t('cancelled'));
          return;
        }
        // Give the session-info message a moment to land; the code is
        // good for ~30s and the server can look the ids up if it never
        // arrives.
        window.setTimeout(() => void finish(code), 800);
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  async function disconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    setBusy('disconnecting');
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnected'));
      await loadState();
    } catch {
      toast.error(t('disconnectFailed'));
    } finally {
      setBusy('idle');
    }
  }

  async function submitPin() {
    if (!/^\d{6}$/.test(pin)) {
      toast.error(t('pinInvalid'));
      return;
    }
    setBusy('pin');
    try {
      const res = await fetch('/api/whatsapp/config/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('connectFailed'), { duration: 10000 });
        return;
      }
      toast.success(t('pinDone'));
      setPin('');
      await loadState();
    } catch {
      toast.error(t('connectFailed'));
    } finally {
      setBusy('idle');
    }
  }

  const sdk = (
    <Script
      src="https://connect.facebook.net/pt_BR/sdk.js"
      strategy="afterInteractive"
      crossOrigin="anonymous"
      onReady={initSdk}
      onError={() => setSdkFailed(true)}
    />
  );

  if (!state) {
    return (
      <Card>
        {sdk}
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('statusChecking')}
        </CardContent>
      </Card>
    );
  }

  const hasConfig = state.connected || (state.reason !== 'no_config' && state.reason !== 'no_account');
  const live = state.connected && state.registered !== false && !state.registration_error;

  const connectButton = (label: string) => (
    <Button onClick={connect} disabled={!canManage || !sdkReady || busy !== 'idle'}>
      {busy === 'popup' ? (
        <>
          <Loader2 className="size-4 animate-spin" /> {t('connecting')}
        </>
      ) : busy === 'finishing' ? (
        <>
          <Loader2 className="size-4 animate-spin" /> {t('finishing')}
        </>
      ) : !sdkReady && !sdkFailed ? (
        <>
          <Loader2 className="size-4 animate-spin" /> {t('loadingSdk')}
        </>
      ) : (
        label
      )}
    </Button>
  );

  // ---- Not connected: the one-button path ----
  if (!hasConfig) {
    return (
      <Card>
        {sdk}
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="size-4 text-primary" /> {t('connectTitle')}
          </CardTitle>
          <CardDescription>{t('connectDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connectButton(t('connectButton'))}
          {sdkFailed && <p className="text-sm text-destructive">{t('sdkFailed')}</p>}
          {!canManage && <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>}
          <p className="text-xs text-muted-foreground">{t('numberHint')}</p>
          <p className="text-xs text-muted-foreground">{t('paymentHint')}</p>
        </CardContent>
      </Card>
    );
  }

  // ---- Connected (or connected but needing attention) ----
  const phone = state.phone_info;
  const quality = phone?.quality_rating?.toUpperCase();
  const qualityKey =
    quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED' ? quality : 'UNKNOWN';

  return (
    <Card>
      {sdk}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {live ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <AlertTriangle className="size-4 text-amber-500" />
          )}
          {live ? t('statusConnected') : t('statusAttention')}
        </CardTitle>
        {!live && (
          <CardDescription>
            {state.connected ? t('notRegistered') : state.message}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {phone && (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t('number')}</dt>
              <dd className="font-medium text-foreground">{phone.display_phone_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('name')}</dt>
              <dd className="font-medium text-foreground">{phone.verified_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('quality')}</dt>
              <dd className="font-medium text-foreground">{t(`quality${qualityKey}`)}</dd>
            </div>
          </dl>
        )}

        {state.connected && !live && canManage && (
          <div className="space-y-2 rounded-lg border border-amber-600/30 bg-amber-950/20 p-3">
            {state.registration_error && (
              <p className="text-xs text-amber-200/80">{state.registration_error}</p>
            )}
            <p className="text-sm text-foreground">{t('pinNeeded')}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="wa-pin" className="text-xs">
                  {t('pinLabel')}
                </Label>
                <Input
                  id="wa-pin"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-32"
                />
              </div>
              <Button onClick={submitPin} disabled={busy !== 'idle' || pin.length !== 6}>
                {busy === 'pin' ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> {t('pinSaving')}
                  </>
                ) : (
                  t('pinSubmit')
                )}
              </Button>
            </div>
          </div>
        )}

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {!state.connected && connectButton(t('reconnect'))}
            <Button variant="outline" onClick={disconnect} disabled={busy !== 'idle'}>
              {busy === 'disconnecting' ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t('disconnecting')}
                </>
              ) : (
                <>
                  <LogOut className="size-4" /> {t('disconnect')}
                </>
              )}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>
        )}
      </CardContent>
    </Card>
  );
}
