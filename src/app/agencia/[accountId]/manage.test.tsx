import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))

const { CrmManagePanel } = await import('./manage')
type Props = Parameters<typeof CrmManagePanel>[0]

/**
 * The console sits behind a login the test runner can't use, so the
 * panel's permission-dependent shape is pinned from its markup: what a
 * super admin, a manager outside their portfolio and support each get.
 */

const base: Props = {
  accountId: 'acc-1',
  status: 'onboarding',
  niche: 'medical_clinic',
  managerUserId: 'mgr-1',
  notes: 'Contrato anual',
  ownerEmail: null,
  pendingOwner: {
    accountId: 'acc-1',
    email: 'dono@clinica.com',
    expiresAt: '2026-11-18T12:00:00Z',
  },
  agencyLevel: 'metrics',
  operators: [
    { userId: 'mgr-1', name: 'Mel', role: 'manager' },
    { userId: 'sa-1', name: 'Agus', role: 'super_admin' },
  ],
  myRole: 'super_admin',
  canEdit: true,
}

const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(<CrmManagePanel {...base} {...over} />)

describe('CrmManagePanel', () => {
  it('a super admin edits everything, including archiving and the manager', () => {
    const html = render()
    expect(html).toContain('Arquivado')
    expect(html).toContain('id="crm-manager"')
    expect(html).toContain('Salvar')
    expect(html).toContain('Gerar convite')
  })

  it('shows the pending owner invitation and the consent level', () => {
    const html = render()
    expect(html).toContain('Convite pendente')
    expect(html).toContain('dono@clinica.com')
    expect(html).toContain('Métricas')
    expect(html).toContain('Convidar o dono')
  })

  it('once there is an owner, the invite becomes a handover', () => {
    const html = render({ ownerEmail: 'dono@clinica.com', pendingOwner: null })
    expect(html).toContain('Passar a propriedade para')
    expect(html).toContain('O dono atual continua como administrador')
  })

  it('a manager on their own CRM cannot archive or reassign', () => {
    const html = render({ myRole: 'manager' })
    expect(html).not.toContain('>Arquivado<')
    expect(html).not.toContain('id="crm-manager"')
    expect(html).toContain('Mel') // shown as text instead
    expect(html).toContain('Salvar')
  })

  it('outside the portfolio, or as support, it is read-only', () => {
    const outside = render({ myRole: 'manager', canEdit: false })
    expect(outside).toContain('não está na sua carteira')
    expect(outside).not.toContain('Salvar')
    expect(outside).not.toContain('Gerar convite')

    const support = render({ myRole: 'support', canEdit: false })
    expect(support).toContain('Suporte')
    expect(support).not.toContain('Salvar')
  })

  it('an archived CRM gets no new owner invitations', () => {
    expect(render({ status: 'archived' })).not.toContain('Gerar convite')
  })
})
