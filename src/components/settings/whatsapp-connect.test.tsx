import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../../messages/pt.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ accountId: null }) }));

import { ImportStatus, ModeOption, type SyncState } from './whatsapp-connect';

const HOUR = 60 * 60 * 1000;

function sync(extra: Partial<SyncState> = {}): SyncState {
  return {
    connected_at: new Date(Date.now() - HOUR).toISOString(),
    history_status: 'requested',
    history_progress: 0,
    history_error: null,
    contacts_requested_at: new Date(Date.now() - HOUR).toISOString(),
    contacts_synced_at: null,
    ...extra,
  };
}

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

const status = (s: SyncState, canManage = true) =>
  render(<ImportStatus sync={s} canManage={canManage} busy={false} disabled={false} onRetry={() => {}} />);

describe('ImportStatus (Settings › WhatsApp, coexistence)', () => {
  it('shows the progress while importing, with no retry', () => {
    const html = status(sync({ history_status: 'importing', history_progress: 42 }));
    expect(html).toContain('Importando as conversas do celular: 42%');
    expect(html).toContain('width:42%');
    expect(html).toContain('Importando os nomes dos contatos');
    expect(html).not.toContain('Tentar de novo');
  });

  it('done and declined say so', () => {
    expect(status(sync({ history_status: 'done', contacts_synced_at: 'x' }))).toContain(
      'Conversas do celular importadas.',
    );
    expect(status(sync({ history_status: 'declined' }))).toContain(
      'foi escolhido não compartilhar',
    );
  });

  it("a failed request shows Meta's reason and a retry inside the 24h window", () => {
    const html = status(sync({ history_status: 'failed', history_error: 'Not eligible' }));
    expect(html).toContain('Not eligible');
    expect(html).toContain('Tentar de novo');
  });

  it('after 24h the retry gives way to an explanation', () => {
    const html = status(
      sync({ history_status: 'failed', connected_at: new Date(Date.now() - 25 * HOUR).toISOString() }),
    );
    expect(html).not.toContain('Tentar de novo');
    expect(html).toContain('24 horas');
  });

  it('members who are not admins see the status but no retry', () => {
    expect(status(sync({ history_status: 'failed' }), false)).not.toContain('Tentar de novo');
  });
});

describe('ModeOption', () => {
  it('is a radio with its state and badge', () => {
    const html = render(
      <ModeOption selected onSelect={() => {}} title="Usar o número" description="desc" badge="Recomendado" />,
    );
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Recomendado');
  });
});
