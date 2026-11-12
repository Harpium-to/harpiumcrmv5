import { describe, expect, it } from 'vitest'

import { phoneTail, sendCheck } from './send-check.js'

// ---------------------------------------------------------------------
// "Enviar pelo CRM" may only show when the message would leave from the
// number on the screen, to the person on the screen. Every way that can
// fail must keep it off, with a reason a person can act on.
// ---------------------------------------------------------------------

const READY = { status: 'ready', provider: 'meta', phone: '5563992286787' }
// WhatsApp still names this mobile by its old 8-digit form.
const ME = '556392286787'
const CHAT = { state: 'user', phone: '5531999998888', lid: null }
const CONTACT = { phone: '+55 (31) 99999-8888' }

const check = (over = {}) =>
  sendCheck({ sender: READY, myPhone: ME, chat: CHAT, contact: CONTACT, ...over })

describe('sendCheck', () => {
  it('sends to the open chat when every number lines up', () => {
    expect(check()).toEqual({ ok: true, to: '+5531999998888' })
  })

  it('accepts the ninth-digit forms on both sides', () => {
    expect(check({ myPhone: '5563992286787' }).ok).toBe(true)
    // WhatsApp knows the customer without the 9, the CRM with it.
    expect(check({ chat: { state: 'user', phone: '553199998888' } })).toEqual({
      ok: true,
      to: '+553199998888',
    })
  })

  it('says nothing while the CRM has not answered', () => {
    expect(check({ sender: null })).toEqual({ ok: false, why: null })
    expect(check({ sender: { status: 'loading' } })).toEqual({ ok: false, why: null })
  })

  it('is off, with a reason, when the CRM cannot or will not say', () => {
    expect(check({ sender: { status: 'denied' } }).why).toMatch(/062/)
    expect(check({ sender: { status: 'missing' } }).why).toMatch(/ainda não envia/)
    expect(check({ sender: { status: 'error' } }).why).toMatch(/Não consegui perguntar/)
    expect(check({ sender: { ...READY, provider: null, phone: null } }).why).toMatch(
      /Nenhum WhatsApp/,
    )
    expect(check({ sender: { ...READY, phone: null } }).why).toMatch(/confirmar o número/)
  })

  it('is off when this WhatsApp is not the CRM number, and names both endings', () => {
    const result = check({ myPhone: '5511912345678' })
    expect(result.ok).toBe(false)
    expect(result.why).toMatch(/final 5678/)
    expect(result.why).toMatch(/final 6787/)
  })

  it('is off when this WhatsApp number cannot be read', () => {
    expect(check({ myPhone: null }).why).toMatch(/número deste WhatsApp/)
  })

  it('is off without a chat with a person whose number is known', () => {
    expect(check({ chat: null }).ok).toBe(false)
    expect(check({ chat: { state: 'other' } }).ok).toBe(false)
    expect(check({ chat: { state: 'user', phone: null, lid: '123' } }).why).toMatch(
      /número desta conversa/,
    )
  })

  it('is off when the chat is not, by number, the contact on the panel', () => {
    expect(check({ contact: null }).why).toMatch(/escolha ou crie o contato/)
    // A lid chat linked by hand to a record with another number.
    expect(check({ contact: { phone: '+5531988887777' } }).why).toMatch(/outro número/)
  })
})

describe('phoneTail', () => {
  it('is the last four digits', () => {
    expect(phoneTail('+55 (63) 99228-6787')).toBe('6787')
    expect(phoneTail(null)).toBe('')
  })
})
