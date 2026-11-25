import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import pt from '../../../../messages/pt.json'

import { WhatsAppCard } from './whatsapp-card'
import type { WhatsAppDetail } from '@/lib/agencia/whatsapp'

const connected: WhatsAppDetail = {
  state: 'connected',
  reason: null,
  phone: { displayPhoneNumber: '+55 63 3333-0000', verifiedName: 'Clínica Sol', qualityRating: 'GREEN' },
  lastInboundAt: '2026-11-07T12:00:00Z',
  detailsAllowed: true,
  coexistence: false,
}

function render(detail: WhatsAppDetail, canSendLink = true, canManageLink?: boolean) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <WhatsAppCard
        accountId="acc-1"
        crmName="Clínica Sol"
        detail={detail}
        canSendLink={canSendLink}
        canManageLink={canManageLink}
      />
    </NextIntlClientProvider>,
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
      coexistence: false,
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
      coexistence: false,
    })
    expect(html).toContain('Precisa de atenção')
    expect(html).toContain('Error validating access token')
    expect(html).toContain('Enviar link pelo WhatsApp')
  })

  it('official path: the link works without login', () => {
    const html = render({ ...connected, state: 'none', reason: 'x', phone: null })
    expect(html).toContain('não precisa de login')
    expect(html).toContain('vale por 7 dias')
  })

  it('official path: only whoever edits the CRM can send the link', () => {
    const html = render({ ...connected, state: 'none', reason: 'x', phone: null }, true, false)
    expect(html).not.toContain('Enviar link pelo WhatsApp')
    expect(html).toContain('Só quem gerencia este CRM')
    expect(render(connected, true, false)).not.toContain('Precisa trocar o número?')
  })

  it('QR code path keeps the link with login', () => {
    const html = render({ ...connected, state: 'none', reason: 'x', phone: null, path: 'nao_oficial' })
    expect(html).toContain('entra com o login dele')
    expect(html).toContain('Enviar link pelo WhatsApp')
  })

  it('archived CRM: no link to send', () => {
    const html = render({ ...connected, state: 'none', reason: 'x', phone: null }, false)
    expect(html).not.toContain('Enviar link pelo WhatsApp')
  })

  it('coexistence: says the phone keeps working', () => {
    const html = render({ ...connected, coexistence: true })
    expect(html).toContain('junto com o app WhatsApp Business')
  })

  it('coexistence is not mentioned for a plain connection', () => {
    expect(render(connected)).not.toContain('junto com o app WhatsApp Business')
  })
})
