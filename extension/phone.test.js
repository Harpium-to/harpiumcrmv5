import { describe, expect, it } from 'vitest'

import { equivalentPhoneKeys as serverKeys } from '../src/lib/whatsapp/phone-utils'
import { equivalentPhoneKeys, phoneDigits, samePhone } from './phone.js'

// ---------------------------------------------------------------------
// The panel shows a CRM record beside a chat only when the numbers are
// the same person. Too loose and it shows a stranger; too strict and it
// says "Sem cadastro" for a customer who is right there in the CRM.
// ---------------------------------------------------------------------

const CASES = [
  '+55 31 99999-8888',
  '5531999998888',
  '553199998888',
  '553188887777',
  '5511987654321',
  '551187654321',
  '553132221111', // landline
  '5531932221111', // mobile whose 8-digit part starts with 3
  '+1 415-555-1212',
  '447700900123',
  '5520999998888', // not a real area code, still the same shape
  '',
  '  -  ',
]

describe('equivalentPhoneKeys', () => {
  it('matches the CRM rule exactly', () => {
    for (const phone of CASES) {
      expect(equivalentPhoneKeys(phone), phone).toEqual(serverKeys(phone))
    }
  })
})

describe('samePhone', () => {
  it('is the same number whatever the formatting', () => {
    expect(samePhone('5531999998888', '+55 (31) 99999-8888')).toBe(true)
  })

  it('is the same Brazilian mobile with or without the ninth digit', () => {
    expect(samePhone('553199998888', '+5531999998888')).toBe(true)
    expect(samePhone('5531999998888', '553199998888')).toBe(true)
  })

  it('is NOT the same number in another area code', () => {
    // Same last 8 digits, different people.
    expect(samePhone('5531999998888', '5511999998888')).toBe(false)
  })

  it('never pairs a landline with a mobile', () => {
    expect(samePhone('553132221111', '5531932221111')).toBe(false)
  })

  it('is false against nothing', () => {
    expect(samePhone('5531999998888', '')).toBe(false)
    expect(samePhone('', '')).toBe(false)
    expect(samePhone('5531999998888', null)).toBe(false)
  })
})

describe('phoneDigits', () => {
  it('keeps digits only', () => {
    expect(phoneDigits('+55 (31) 99999-8888')).toBe('5531999998888')
    expect(phoneDigits(undefined)).toBe('')
  })
})
