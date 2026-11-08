import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { WhatsAppCard } from './whatsapp-card'
import type { WhatsAppDetail } from '@/lib/agencia/whatsapp'

const connected: WhatsAppDetail = {
  state: 'connected',
  reason: null,
  phone: { displayPhoneNumber: '+55 63 3333-0000', verifiedName: 'Clínica Sol', qualityRating: 'GREEN' },
  lastInboundAt: '2026-11-07T12:00:00Z',
  detailsAllowed: true,
}

function render(detail: WhatsAppDetail, canSendLink = true) {
  return renderToStaticMarkup(
    <WhatsAppCard accountId="acc-1" crmName="Clínica Sol" detail={detail} canSendLink={canSendLink} />,
  )
}

describe('WhatsAppCard', () => {
  it('connected with read consent: status and number details', () => {
    const html = render(connected)
    expect(html).toContain('Conectado')
    expect(html).toContain('+55 63 3333-0000')
    expect(html).toContain('Alta')
    // The link stays available but folded away.
    expect(html).toContain('Precisa trocar o número?')
  })

  it('metrics-only consent hides the number and says why', () => {
    const html = render({ ...connected, phone: null, lastInboundAt: null, detailsAllowed: false })
    expect(html).toContain('Conectado')
    expect(html).not.toContain('+55 63 3333-0000')
    expect(html).toContain('libera acesso de')
  })

  it('not connected: reason plus the send-link actions up front', () => {
    const html = render({
      state: 'none',
      reason: 'O WhatsApp ainda não foi conectado neste CRM.',
      phone: null,
      lastInboundAt: null,
      detailsAllowed: true,
    })
    expect(html).toContain('Não conectado')
    expect(html).toContain('ainda não foi conectado')
    expect(html).toContain('Enviar link pelo WhatsApp')
    expect(html).toContain('Copiar link de conexão')
    expect(html).not.toContain('Precisa trocar o número?')
  })

  it('needs attention: shows what Meta said', () => {
    const html = render({
      state: 'attention',
      reason: 'A Meta recusou as credenciais: Error validating access token',
      phone: null,
      lastInboundAt: null,
      detailsAllowed: true,
    })
    expect(html).toContain('Precisa de atenção')
    expect(html).toContain('Error validating access token')
    expect(html).toContain('Enviar link pelo WhatsApp')
  })

  it('archived CRM: no link to send', () => {
    const html = render({ ...connected, state: 'none', reason: 'x', phone: null }, false)
    expect(html).not.toContain('Enviar link pelo WhatsApp')
  })
})
