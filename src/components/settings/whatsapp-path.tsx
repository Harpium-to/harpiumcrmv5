'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BadgeCheck, Check, Loader2, QrCode, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from './settings-panel-head';
import { UazapiQrPanel } from './uazapi-qr-panel';
import { WhatsAppSettings } from './whatsapp-connect';

// ============================================================
// Settings › WhatsApp, with the two paths (D1).
//
// The CRM chooses how its WhatsApp is connected — the Meta API or a
// QR code — and the panel below is that path's: the Embedded Signup
// panel for the official one, the QR pairing for the unofficial one.
// The features are the same either way (the server picks the door);
// what the choice screen compares is cost, risk and the phone.
//
// Before migration 059 there is nothing to choose: the panel is the
// official one, exactly as before.
// See docs/plano-whatsapp-dois-caminhos.md.
// ============================================================

type Path = 'oficial' | 'nao_oficial';

export interface PathState {
  path: Path | null;
  effectivePath: Path | null;
  migrationReady: boolean;
  canChoose: boolean;
  viaAgency: boolean;
  riskTermsVersion: string;
  hostedUnofficial: boolean;
  oficial: { connected: boolean };
  naoOficial: {
    configured: boolean;
    enabled: boolean;
    manualServer: boolean;
    status: string | null;
    phone: string | null;
    evolution: boolean;
  };
}

export function WhatsAppPathSettings() {
  const t = useTranslations('Settings.whatsappPath');
  const [state, setState] = useState<PathState | null>(null);
  const [failed, setFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/path', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setState((await res.json()) as PathState);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <section>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
      </section>
    );
  }

  if (!state) {
    return (
      <section>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  // Nothing to choose yet: the official panel, as before 059.
  if (!state.migrationReady) return <WhatsAppSettings />;

  const current = state.effectivePath;

  if (!current || choosing) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <PathChooser
          state={state}
          onCancel={current ? () => setChoosing(false) : undefined}
          onChosen={async () => {
            setChoosing(false);
            await load();
          }}
        />
      </section>
    );
  }

  const bar = (
    <PathBar
      path={current}
      canChoose={state.canChoose}
      onChange={() => setChoosing(true)}
    />
  );

  if (current === 'oficial') {
    return (
      <div className="space-y-4">
        {bar}
        <WhatsAppSettings />
      </div>
    );
  }

  const n = state.naoOficial;
  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      {bar}
      <UazapiQrPanel
        canManage={state.canChoose}
        canConnect={state.hostedUnofficial || n.configured || n.manualServer}
        onChange={load}
        note={n.manualServer ? t('qr.manualServer') : undefined}
      />
      {n.evolution && !n.configured && (
        <p className="text-sm text-muted-foreground">{t('qr.evolutionNote')}</p>
      )}
    </section>
  );
}

function PathBar({
  path,
  canChoose,
  onChange,
}: {
  path: Path;
  canChoose: boolean;
  onChange: () => void;
}) {
  const t = useTranslations('Settings.whatsappPath');
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {t('current')}:{' '}
        <strong className="text-foreground">
          {path === 'oficial' ? t('currentOficial') : t('currentNaoOficial')}
        </strong>
      </p>
      {canChoose && (
        <Button type="button" variant="outline" size="sm" onClick={onChange}>
          {t('change')}
        </Button>
      )}
    </div>
  );
}

const OFICIAL_POINTS = [
  ['connect', true],
  ['risk', true],
  ['cost', null],
  ['window', false],
  ['phone', null],
  ['status', false],
] as const;

const NAO_OFICIAL_POINTS = [
  ['connect', true],
  ['risk', false],
  ['cost', true],
  ['window', true],
  ['phone', true],
  ['online', false],
] as const;

export function PathChooser({
  state,
  onChosen,
  onCancel,
}: {
  state: PathState;
  onChosen: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const t = useTranslations('Settings.whatsappPath');
  const [selected, setSelected] = useState<Path | null>(state.effectivePath);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  const switching = state.effectivePath !== null && selected !== state.effectivePath;
  const blockedForAgency = selected === 'nao_oficial' && state.viaAgency;
  const canConfirm =
    state.canChoose &&
    selected !== null &&
    !blockedForAgency &&
    (selected === 'oficial' || accepted) &&
    // Re-choosing the stored path is a no-op; only a real change saves.
    (state.path !== selected || state.effectivePath !== selected);

  const confirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selected,
          acceptRisk: selected === 'nao_oficial' ? accepted : undefined,
          termsVersion: state.riskTermsVersion,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? '');
      toast.success(t('chosenToast'));
      await onChosen();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('loadFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-medium text-foreground">{t('chooseTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('chooseDesc')}</p>
      </div>

      <div role="radiogroup" aria-label={t('chooseTitle')} className="grid gap-4 md:grid-cols-2">
        <PathCard
          path="oficial"
          selected={selected === 'oficial'}
          onSelect={() => setSelected('oficial')}
          icon={<BadgeCheck className="size-5" />}
          title={t('oficialTitle')}
          subtitle={t('oficialSubtitle')}
          badge={t('recommended')}
          points={OFICIAL_POINTS.map(([key, good]) => ({
            text: t(`oficialPoints.${key}`),
            good,
          }))}
        />
        <PathCard
          path="nao_oficial"
          selected={selected === 'nao_oficial'}
          onSelect={() => setSelected('nao_oficial')}
          icon={<QrCode className="size-5" />}
          title={t('naoOficialTitle')}
          subtitle={t('naoOficialSubtitle')}
          points={NAO_OFICIAL_POINTS.map(([key, good]) => ({
            text: t(`naoOficialPoints.${key}`),
            good,
          }))}
        />
      </div>

      {selected === 'nao_oficial' && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" />
            {t('riskTitle')}
          </p>
          <p className="text-foreground/80">{t('riskText')}</p>
          {blockedForAgency ? (
            <p className="font-medium text-foreground">{t('riskAgency')}</p>
          ) : (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={!state.canChoose}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="text-foreground">{t('riskAccept')}</span>
            </label>
          )}
        </div>
      )}

      {switching && <p className="text-sm text-muted-foreground">{t('switchNote')}</p>}
      {!state.canChoose && <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={confirm} disabled={!canConfirm || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? t('confirming') : t('confirm')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            {t('cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

function PathCard({
  path,
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  badge,
  points,
}: {
  path: Path;
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  badge?: string;
  points: { text: string; good: boolean | null }[];
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-path={path}
      onClick={onSelect}
      className={cn(
        'flex h-full flex-col gap-3 rounded-xl border bg-card p-5 text-left transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-foreground/5',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground">
            {icon}
          </span>
          <div>
            <p className="font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {badge && (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{badge}</span>
        )}
      </div>
      <ul className="space-y-2 text-sm">
        {points.map((p) => (
          <li key={p.text} className="flex gap-2">
            {p.good === true ? (
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : p.good === false ? (
              <X className="mt-0.5 size-4 shrink-0 text-amber-500" />
            ) : (
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            )}
            <span className="text-foreground/80">{p.text}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}
