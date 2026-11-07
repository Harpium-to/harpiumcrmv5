import { describe, expect, it } from 'vitest'
import { isFacebookOrigin, parseEmbeddedSignupMessage } from './embedded-signup-client'

describe('isFacebookOrigin', () => {
  it.each([
    'https://www.facebook.com',
    'https://web.facebook.com',
    'https://facebook.com',
    'https://business.facebook.com',
  ])('accepts %s', (origin) => {
    expect(isFacebookOrigin(origin)).toBe(true)
  })

  it.each([
    'https://evilfacebook.com',
    'https://facebook.com.evil.io',
    'http://www.facebook.com',
    'null',
    '',
    'https://harpium-crm.netlify.app',
  ])('rejects %s', (origin) => {
    expect(isFacebookOrigin(origin)).toBe(false)
  })
})

describe('parseEmbeddedSignupMessage', () => {
  const finish = {
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH',
    data: { phone_number_id: '111', waba_id: '222', business_id: '333' },
  }

  it('reads the ids from a FINISH message sent as a JSON string', () => {
    expect(parseEmbeddedSignupMessage(JSON.stringify(finish))).toEqual({
      kind: 'finish',
      event: 'FINISH',
      phoneNumberId: '111',
      wabaId: '222',
      businessId: '333',
    })
  })

  it('accepts an already-parsed object and the FINISH variants', () => {
    const parsed = parseEmbeddedSignupMessage({ ...finish, event: 'FINISH_ONLY_WABA' })
    expect(parsed).toMatchObject({ kind: 'finish', event: 'FINISH_ONLY_WABA', wabaId: '222' })
  })

  it('turns numeric ids into strings', () => {
    const parsed = parseEmbeddedSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: 111, waba_id: 222 },
    })
    expect(parsed).toMatchObject({ phoneNumberId: '111', wabaId: '222' })
  })

  it('reads CANCEL and ERROR', () => {
    expect(
      parseEmbeddedSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: { current_step: 'PHONE_NUMBER_VERIFICATION' },
      }),
    ).toEqual({ kind: 'cancel', step: 'PHONE_NUMBER_VERIFICATION' })

    expect(
      parseEmbeddedSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'ERROR',
        data: { error_message: 'Número já em uso', error_code: '524' },
      }),
    ).toEqual({ kind: 'error', message: 'Número já em uso', code: '524' })
  })

  it.each([
    ['not json', 'oi'],
    ['another type', JSON.stringify({ type: 'SOMETHING_ELSE', event: 'FINISH' })],
    ['unknown event', JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'WHATEVER' })],
    ['null', null],
    ['number', 42],
  ])('ignores %s', (_label, raw) => {
    expect(parseEmbeddedSignupMessage(raw)).toBeNull()
  })
})
