import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../../messages/pt.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ accountId: null }) }));

import { PathChooser, type PathState } from './whatsapp-path';

function state(extra: Partial<PathState> = {}): PathState {
  return {
    path: null,
    effectivePath: null,
    migrationReady: true,
    canChoose: true,
    viaAgency: false,
    riskTermsVersion: '2026-11-09',
    hostedUnofficial: true,
    oficial: { connected: false },
    naoOficial: {
      configured: false,
      enabled: false,
      manualServer: false,
      status: null,
      phone: null,
      evolution: false,
    },
    ...extra,
  };
}

const render = (s: PathState) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt" messages={messages}>
      <PathChooser state={s} onChosen={() => {}} />
    </NextIntlClientProvider>,
  );

describe('PathChooser (Settings › WhatsApp, D1)', () => {
  it('a CRM with nothing connected sees both paths side by side, nothing chosen', () => {
    const html = render(state());
    expect(html).toContain('Como você quer conectar o WhatsApp?');
    expect(html).toContain('API da Meta');
    expect(html).toContain('QR code, como o WhatsApp Web');
    expect(html).toContain('Sem risco de bloqueio do número');
    expect(html).toContain('O número pode ser bloqueado pelo WhatsApp');
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('aria-checked="true"');
    // Nothing picked yet: no risk box, and nothing to confirm.
    expect(html).not.toContain('Antes de escolher o não oficial');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Usar este caminho/);
  });

  it('the unofficial path comes with the risk and the box to accept it, unticked', () => {
    const html = render(state({ effectivePath: 'nao_oficial', path: null }));
    expect(html).toContain('Antes de escolher o não oficial');
    expect(html).toContain('Nem a Harpium nem o CRM conseguem desfazer um bloqueio.');
    expect(html).toContain('Entendo que o número pode ser bloqueado');
    expect(html).toMatch(/type="checkbox"(?![^>]*checked=)/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Usar este caminho/);
  });

  it('through the agency’s access, the risk cannot be accepted', () => {
    const html = render(state({ effectivePath: 'nao_oficial', viaAgency: true }));
    expect(html).toContain('Só alguém do próprio CRM pode aceitar esse risco.');
    expect(html).not.toContain('type="checkbox"');
  });

  it('someone below admin sees the paths but cannot choose', () => {
    const html = render(state({ canChoose: false }));
    expect(html).toContain('Só administradores do CRM escolhem o caminho do WhatsApp.');
  });
});
