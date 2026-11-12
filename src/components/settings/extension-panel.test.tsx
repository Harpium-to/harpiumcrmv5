import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ExtensionPanelView, type ExtensionStatus } from './extension-panel';

const render = (
  status: ExtensionStatus | null,
  fresh: { key: string; crmUrl: string } | null = null,
) =>
  renderToStaticMarkup(
    <ExtensionPanelView status={status} fresh={fresh} busy={null} onCreate={() => {}} onRevoke={() => {}} />,
  );

describe('ExtensionPanelView (Settings › Extensão do Chrome)', () => {
  it('offers the download with the version and the install steps', () => {
    const html = render({ available: true, role: 'agent', key: null });
    expect(html).toContain('href="/downloads/crm-connector.zip"');
    expect(html).toMatch(/versão \d+\.\d+\.\d+/);
    expect(html).toContain('Carregar sem compactação');
    expect(html).toContain('Harpium CRM');
    expect(html).toContain('não lê suas conversas');
  });

  it('an agent without a key is invited to connect', () => {
    const html = render({ available: true, role: 'agent', key: null });
    expect(html).toContain('Ainda não conectada');
    expect(html).toContain('Gerar minha chave');
    expect(html).not.toContain('Desconectar');
  });

  it('a fresh key is shown once, with the CRM address, both copyable', () => {
    const html = render(
      { available: true, role: 'agent', key: { prefix: 'wacrm_live_ab12', createdAt: '2026-11-04T12:00:00Z', lastUsedAt: null } },
      { key: 'wacrm_live_secret', crmUrl: 'https://crm.harpium.com' },
    );
    expect(html).toContain('https://crm.harpium.com');
    expect(html).toContain('wacrm_live_secret');
    expect(html).toContain('A chave aparece só agora');
    expect(html).toContain('ainda não usou');
    expect(html).toContain('Gerar chave nova');
    expect(html).toContain('Desconectar');
  });

  it('a viewer, or the agency, cannot connect', () => {
    expect(render({ available: true, role: 'viewer', key: null })).toContain('é para quem atende');
    expect(render({ available: true, role: 'admin', viaAgency: true, key: null })).toContain(
      'Você está aqui pela agência',
    );
  });

  it('before migration 054 it says what is missing', () => {
    expect(render({ available: false })).toContain('migration 054');
  });
});
