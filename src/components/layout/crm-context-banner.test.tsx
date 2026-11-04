import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}))

const { CrmContextBannerView } = await import('./crm-context-banner')

const ctx = { accountName: 'Clínica Sol', role: 'admin', status: 'active', viaAgency: false }

describe('CrmContextBannerView', () => {
  it('a member in an active CRM sees nothing', () => {
    expect(renderToStaticMarkup(<CrmContextBannerView ctx={ctx} />)).toBe('')
  })

  it('support mode says where, as what, that it is recorded, and the way out', () => {
    const html = renderToStaticMarkup(<CrmContextBannerView ctx={{ ...ctx, viaAgency: true }} />)
    expect(html).toContain('Modo suporte')
    expect(html).toContain('Clínica Sol')
    expect(html).toContain('como administrador')
    expect(html).toContain('fica registrado para o dono')
    expect(html).toContain('Sair do modo suporte')
  })

  it('read-only support says so', () => {
    const html = renderToStaticMarkup(
      <CrmContextBannerView ctx={{ ...ctx, viaAgency: true, role: 'viewer' }} />,
    )
    expect(html).toContain('como leitura')
  })

  it('a suspended CRM explains itself', () => {
    expect(
      renderToStaticMarkup(<CrmContextBannerView ctx={{ ...ctx, status: 'suspended' }} />),
    ).toContain('Este CRM está suspenso')
  })
})
