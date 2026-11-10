import { describe, expect, it } from 'vitest'

import { checkPathChoice } from './path-choice'
import { WHATSAPP_RISK_TERMS_VERSION } from './whatsapp-route'

const choose = (over: Partial<Parameters<typeof checkPathChoice>[0]> = {}) =>
  checkPathChoice({
    path: 'nao_oficial',
    acceptRisk: true,
    termsVersion: WHATSAPP_RISK_TERMS_VERSION,
    viaAgency: false,
    ...over,
  })

describe('checkPathChoice', () => {
  it('the official path needs no acceptance, from anyone with the role', () => {
    expect(choose({ path: 'oficial', acceptRisk: false, viaAgency: true })).toEqual({
      ok: true,
      path: 'oficial',
      riskTermsVersion: null,
    })
  })

  it('the unofficial path records the version of the text that was accepted', () => {
    expect(choose()).toEqual({
      ok: true,
      path: 'nao_oficial',
      riskTermsVersion: WHATSAPP_RISK_TERMS_VERSION,
    })
  })

  it('refuses the unofficial path without the box ticked', () => {
    expect(choose({ acceptRisk: undefined })).toMatchObject({ ok: false, status: 400 })
    expect(choose({ acceptRisk: 'true' })).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses an acceptance of an older text', () => {
    expect(choose({ termsVersion: '2020-01-01' })).toMatchObject({ ok: false, status: 409 })
  })

  it('the agency cannot accept the risk for the client', () => {
    expect(choose({ viaAgency: true })).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses anything that is not one of the two paths', () => {
    expect(choose({ path: 'evolution' })).toMatchObject({ ok: false, status: 400 })
  })
})
