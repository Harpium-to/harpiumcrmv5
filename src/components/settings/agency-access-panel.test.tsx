import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgencyAccessDetails } from './agency-access-panel';
import type { AgencyAccessView } from '@/types/platform';

/**
 * Settings → Acesso da agência sits behind a login, so its
 * owner / non-owner / sensitive-data variants are pinned from markup.
 */

type View = Extract<AgencyAccessView, { available: true }>;

const base: View = {
  available: true,
  level: 'metrics',
  tempLevel: null,
  tempUntil: null,
  effectiveLevel: 'metrics',
  pending: null,
  canDecide: true,
  canSeeLog: true,
  niche: null,
  history: [],
  activity: [],
};

const noop = async () => {};
const render = (over: Partial<View> = {}) =>
  renderToStaticMarkup(
    <AgencyAccessDetails
      view={{ ...base, ...over }}
      head={<h2>Acesso da agência</h2>}
      busy={null}
      selected={over.level ?? base.level}
      setSelected={() => {}}
      tempLevel="full"
      setTempLevel={() => {}}
      tempHours={24}
      setTempHours={() => {}}
      put={noop}
      decide={noop}
    />,
  );

const pending = {
  id: 'req-1',
  level: 'full' as const,
  tempHours: 24,
  reason: 'Configurar automações',
  createdAt: '2026-11-04T12:00:00Z',
};

describe('AgencyAccessDetails', () => {
  it('the owner answers a pending request', () => {
    const html = render({ pending });
    expect(html).toContain('A agência pediu acesso Total por 1 dia');
    expect(html).toContain('Configurar automações');
    expect(html).toContain('Liberar');
    expect(html).toContain('Recusar');
  });

  it('anyone else sees the request but cannot answer it', () => {
    const html = render({ pending, canDecide: false });
    expect(html).toContain('Só o dono do CRM responde.');
    expect(html).not.toContain('Recusar');
    expect(html).toContain('Só o dono do CRM muda o acesso da agência.');
  });

  it('marks the current level and offers a temporary grant above it', () => {
    const html = render({ level: 'read' });
    expect(html).toContain('atual');
    expect(html).toContain('aria-label="Nível temporário"');
    // From Leitura, only Total can be granted temporarily.
    expect(html).not.toMatch(/<option value="read"[^>]*>Leitura/);
    expect(html).toMatch(/<option value="full"[^>]*>Total/);
  });

  it('a running temporary grant says when it ends and can be ended', () => {
    const html = render({
      tempLevel: 'full',
      tempUntil: '2999-01-01T00:00:00Z',
      effectiveLevel: 'full',
    });
    expect(html).toContain('liberado até');
    expect(html).toContain('volta sozinho para');
    expect(html).toContain('Encerrar agora');
  });

  it('warns about health data in a clinic CRM', () => {
    expect(render({ niche: 'medical_clinic' })).toContain('dados de saúde');
    expect(render({ niche: 'gym' })).not.toContain('dados de saúde');
  });

  it('shows what the agency did, by name, to owner and admins only', () => {
    const activity = [
      { at: '2026-11-04T12:00:00Z', action: 'enter_account', by: 'Agus' },
    ];
    expect(render({ activity })).toContain('Agus');
    expect(render({ activity })).toContain('entrou no crm');
    expect(render({ activity, canSeeLog: false })).not.toContain('Agus');
  });
});
