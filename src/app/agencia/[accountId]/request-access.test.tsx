import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))

const { RequestAccessForm } = await import('./request-access')
type Props = Parameters<typeof RequestAccessForm>[0]

const base: Props = {
  accountId: 'acc-1',
  currentLevel: 'metrics',
  pending: null,
  canRequest: true,
  hasOwner: true,
}
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(<RequestAccessForm {...base} {...over} />)

describe('RequestAccessForm (console)', () => {
  it('from metrics, the agency can ask for read or full', () => {
    const html = render()
    expect(html).toMatch(/<option value="read"[^>]*>Leitura<\/option>/)
    expect(html).toMatch(/<option value="full"[^>]*>Total<\/option>/)
    expect(html).toContain('Pedir acesso ao dono')
  })

  it('from read, only full is left to ask for', () => {
    const html = render({ currentLevel: 'read' })
    expect(html).not.toMatch(/<option value="read"/)
    expect(html).toMatch(/<option value="full"[^>]*>Total<\/option>/)
  })

  it('at full there is nothing to ask', () => {
    expect(render({ currentLevel: 'full' })).toBe('')
  })

  it('shows the open request', () => {
    const html = render({
      pending: {
        id: 'r',
        level: 'full',
        tempHours: 72,
        reason: null,
        createdAt: '2026-11-04T12:00:00Z',
      },
    })
    expect(html).toContain('Pedido enviado: Total por 3 dias.')
    expect(html).toContain('Enviar novo pedido')
  })

  it('support, or a manager outside the portfolio, is pointed to who can ask', () => {
    const html = render({ canRequest: false })
    expect(html).toContain('fale com um super admin ou com o gestor')
    expect(html).not.toContain('Pedir acesso ao dono')
  })

  it('a CRM with no owner yet has nobody to ask', () => {
    expect(render({ hasOwner: false })).toContain('ainda não tem dono')
  })
})
