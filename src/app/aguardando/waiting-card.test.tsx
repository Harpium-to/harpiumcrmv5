import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: async () => {} } }),
}))

const { WaitingCard } = await import('./waiting-card')

describe('WaitingCard (/aguardando)', () => {
  it('with no invitation, explains the wait and which email is signed in', () => {
    const html = renderToStaticMarkup(
      <WaitingCard email="nova@cliente.com" isAgencia={false} invitations={[]} />,
    )
    expect(html).toContain('Aguardando liberação')
    expect(html).toContain('nova@cliente.com')
    expect(html).not.toContain('painel da agência')
    expect(html).toContain('Sair')
  })

  it('an owner invitation shows what the agency will see before accepting', () => {
    const html = renderToStaticMarkup(
      <WaitingCard
        email="nova@cliente.com"
        isAgencia={false}
        invitations={[
          {
            id: 'inv-1',
            accountName: 'Clínica Sol',
            role: 'owner',
            expiresAt: '2026-11-18T12:00:00Z',
            agencyLevel: 'read',
          },
        ]}
      />,
    )
    expect(html).toContain('Você tem um convite')
    expect(html).toContain('Clínica Sol')
    expect(html).toContain('Como Dono')
    expect(html).toContain('Acesso da agência: Leitura.')
    expect(html).toContain('Aceitar e entrar')
  })

  it('the agency team gets a way back to their console', () => {
    const html = renderToStaticMarkup(
      <WaitingCard email="time@harpium.com" isAgencia invitations={[]} />,
    )
    expect(html).toContain('Ir para o painel da agência')
  })
})
