'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
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
import {
  embeddedSignupExtras,
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
} from '@/lib/whatsapp/embedded-signup-client';
import type { ConnectionMode } from '@/lib/whatsapp/connect';
import { CONNECT_CRM_PARAM, readConnectIntent } from '@/lib/agencia/connect-link';
import { useAuth } from '@/hooks/use-auth';

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { accountId } = useAuth();
  // A link from the agency (W2): highlight the button and, for someone
  // in several CRMs, open the one the link is for.
  const intent = readConnectIntent(searchParams, accountId);
  const switchingRef = useRef(false);

  useEffect(() => {
    if (!intent.switchTo || switchingRef.current) return;
    switchingRef.current = true;
    fetch('/api/account/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: intent.switchTo }),
    })
      .then((res) => {
        if (res.ok) {
          // Everything reads the active CRM: reload to see the right one.
          window.location.reload();
          return;
        }
        toast.error(t('linkWrongCrm'));
        const params = new URLSearchParams(searchParams.toString());
        params.delete(CONNECT_CRM_PARAM);
        router.replace(`/settings?${params.toString()}`, { scroll: false });
      })
      .catch(() => toast.error(t('linkWrongCrm')));
  }, [intent.switchTo, router, searchParams, t]);
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
        highlight={intent.highlight && !intent.switchTo}
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
  connection_mode?: ConnectionMode;
  /** Coexistence only: the import of what was already on the phone. */
  sync?: SyncState | null;
}

export interface SyncState {
  connected_at: string | null;
  history_status: 'requested' | 'importing' | 'done' | 'declined' | 'failed' | null;
  history_progress: number | null;
  history_error: string | null;
  contacts_requested_at: string | null;
  contacts_synced_at: string | null;
}

/** Meta takes the import requests only in the first 24h after connecting. */
const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

interface CardProps {
  appId: string;
  configId: string;
  graphVersion: string;
  canManage: boolean;
  /** Opened from the agency's connect link: point at the button. */
  highlight?: boolean;
}

function WhatsAppConnectCard({
  appId,
  configId,
  graphVersion,
  canManage,
  highlight = false,
}: CardProps) {
  const t = useTranslations('Settings.whatsappConnect');
  const [state, setState] = useState<ConnectionState | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [busy, setBusy] = useState<
    'idle' | 'popup' | 'finishing' | 'disconnecting' | 'pin' | 'sync'
  >('idle');
  const [pin, setPin] = useState('');
  // Most clients already run the business on the WhatsApp Business
  // app, so keeping that number (coexistence) is the default.
  const [mode, setMode] = useState<ConnectionMode>('coexistence');
  // The popup reports the chosen WhatsApp account and number through
  // postMessage, separately from the login callback that carries the
  // code. Either can arrive first, so the ids wait here.
  const sessionRef = useRef<{
    wabaId?: string;
    phoneNumberId?: string;
    businessId?: string;
    event?: string;
  }>({});
  const requestedModeRef = useRef<ConnectionMode>('coexistence');
  const cardRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  // Opened from the agency's link: bring the card into view once, as
  // soon as it has rendered with its real state.
  useEffect(() => {
    if (!highlight || scrolledRef.current || !state || !cardRef.current) return;
    scrolledRef.current = true;
    cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, state]);

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

  // While Meta is sending the phone's chats, keep the progress fresh.
  const importing =
    state?.sync?.history_status === 'requested' || state?.sync?.history_status === 'importing';
  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => void loadState(), 15000);
    return () => window.clearInterval(timer);
  }, [importing, loadState]);

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
          event: parsed.event,
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
          mode: requestedModeRef.current,
          event: session.event ?? null,
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
        const name = data.phone_info?.verified_name || data.phone_info?.display_phone_number || '';
        toast.success(
          data.connection_mode === 'coexistence'
            ? t('connectedCoexToast', { name })
            : t('connectedToast', { name }),
          { duration: data.connection_mode === 'coexistence' ? 8000 : undefined },
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

  function connect(chosen: ConnectionMode) {
    if (!window.FB || !sdkReady) return;
    sessionRef.current = {};
    requestedModeRef.current = chosen;
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
        extras: embeddedSignupExtras(chosen),
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

  async function retrySync() {
    setBusy('sync');
    try {
      const res = await fetch('/api/whatsapp/coexistence/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('connectFailed'), { duration: 10000 });
      } else {
        toast.success(t('syncRetryDone'));
      }
      await loadState();
    } catch {
      toast.error(t('connectFailed'));
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

  const connectButton = (label: string, chosen: ConnectionMode) => (
    <Button onClick={() => connect(chosen)} disabled={!canManage || !sdkReady || busy !== 'idle'}>
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

  const highlightClass = highlight ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '';
  const agencyHint = highlight ? (
    <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground">{t('linkHint')}</p>
  ) : null;

  // ---- Not connected: the one-button path ----
  if (!hasConfig) {
    return (
      <Card ref={cardRef} className={highlightClass}>
        {sdk}
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="size-4 text-primary" /> {t('connectTitle')}
          </CardTitle>
          <CardDescription>{t('connectDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {agencyHint}
          <div role="radiogroup" aria-label={t('modeTitle')} className="grid gap-2">
            <p className="text-sm font-medium text-foreground">{t('modeTitle')}</p>
            <ModeOption
              selected={mode === 'coexistence'}
              onSelect={() => setMode('coexistence')}
              title={t('modeCoexTitle')}
              badge={t('modeCoexBadge')}
              description={t('modeCoexDesc')}
            />
            <ModeOption
              selected={mode === 'cloud'}
              onSelect={() => setMode('cloud')}
              title={t('modeCloudTitle')}
              description={t('modeCloudDesc')}
            />
          </div>
          {connectButton(t('connectButton'), mode)}
          {sdkFailed && <p className="text-sm text-destructive">{t('sdkFailed')}</p>}
          {!canManage && <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>}
          {mode === 'coexistence' ? (
            <>
              <p className="text-xs text-muted-foreground">{t('coexHint')}</p>
              <p className="text-xs text-muted-foreground">{t('coexLimits')}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t('numberHint')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('paymentHint')}</p>
        </CardContent>
      </Card>
    );
  }

  // ---- Connected (or connected but needing attention) ----
  const coexistence = state.connection_mode === 'coexistence';
  const phone = state.phone_info;
  const quality = phone?.quality_rating?.toUpperCase();
  const qualityKey =
    quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED' ? quality : 'UNKNOWN';

  return (
    <Card ref={cardRef} className={live ? '' : highlightClass}>
      {sdk}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {live ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <AlertTriangle className="size-4 text-amber-500" />
          )}
          {live ? (coexistence ? t('statusConnectedCoex') : t('statusConnected')) : t('statusAttention')}
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

        {live && coexistence && (
          <p className="text-sm text-muted-foreground">{t('coexConnectedHint')}</p>
        )}

        {coexistence && state.sync && (
          <ImportStatus
            sync={state.sync}
            canManage={canManage}
            busy={busy === 'sync'}
            disabled={busy !== 'idle'}
            onRetry={retrySync}
          />
        )}

        {state.connected && !live && canManage && !coexistence && (
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
            {!state.connected && connectButton(t('reconnect'), coexistence ? 'coexistence' : 'cloud')}
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

export function ModeOption({
  selected,
  onSelect,
  title,
  description,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-primary' : 'border-muted-foreground/50'
        }`}
      >
        {selected && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {title}
          {badge && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/**
 * How the import of the phone's chats and contact names is going.
 * Offers "Tentar de novo" while Meta would still take the request.
 */
export function ImportStatus({
  sync,
  canManage,
  busy,
  disabled,
  onRetry,
}: {
  sync: SyncState;
  canManage: boolean;
  busy: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('Settings.whatsappConnect');
  // Read the clock once per render pass, outside JSX.
  const [now] = useState(() => Date.now());
  const connectedAt = sync.connected_at ? Date.parse(sync.connected_at) : NaN;
  const inWindow = Number.isFinite(connectedAt) && now - connectedAt < SYNC_WINDOW_MS;
  const historyMissing = sync.history_status === null || sync.history_status === 'failed';
  const canRetry = canManage && (historyMissing || !sync.contacts_requested_at);

  let history: string;
  switch (sync.history_status) {
    case 'requested':
      history = t('historyRequested');
      break;
    case 'importing':
      history = t('historyImporting', { progress: sync.history_progress ?? 0 });
      break;
    case 'done':
      history = t('historyDone');
      break;
    case 'declined':
      history = t('historyDeclined');
      break;
    case 'failed':
      history = t('historyFailed', { error: sync.history_error ?? '' });
      break;
    default:
      history = t('historyNone');
  }
  const contacts = sync.contacts_synced_at
    ? t('contactsDone')
    : sync.contacts_requested_at
      ? t('contactsRequested')
      : null;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <History className="size-4 text-primary" /> {t('importTitle')}
      </p>
      <p className="text-sm text-muted-foreground">{history}</p>
      {sync.history_status === 'importing' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.max(2, Math.min(100, sync.history_progress ?? 0))}%` }}
          />
        </div>
      )}
      {contacts && <p className="text-sm text-muted-foreground">{contacts}</p>}
      {canRetry &&
        (inWindow ? (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={disabled}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {t('syncRetrying')}
              </>
            ) : (
              <>
                <RefreshCw className="size-4" /> {t('syncRetry')}
              </>
            )}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('syncExpired')}</p>
        ))}
    </div>
  );
}
