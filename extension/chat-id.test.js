import { describe, expect, it } from 'vitest'

import { chatPhoneFromDataIds, usableChatName } from './chat-id.js'

// ---------------------------------------------------------------------
// The panel identifies the open chat from WhatsApp's own message ids.
// A wrong answer here is not a crash — it is one customer's CRM record
// rendered beside another customer's conversation, with nothing on
// screen to suggest anything is wrong.
//
// So every case that is not confidently a phone number must come back
// null, and these pin that.
// ---------------------------------------------------------------------

describe('chatPhoneFromDataIds', () => {
  it('reads the number out of a normal message id', () => {
    expect(
      chatPhoneFromDataIds(['false_5511999998888@c.us_3EB0C767D82B0D09A4C1']),
    ).toBe('5511999998888')
  })

  it('reads an outbound message id too', () => {
    expect(chatPhoneFromDataIds(['true_5511999998888@c.us_ABC'])).toBe(
      '5511999998888',
    )
  })

  it('accepts the s.whatsapp.net server some builds use', () => {
    expect(chatPhoneFromDataIds(['false_447700900123@s.whatsapp.net_X'])).toBe(
      '447700900123',
    )
  })

  it('refuses a group rather than picking a participant', () => {
    expect(
      chatPhoneFromDataIds([
        'false_120363000000000000@g.us_3EB0_5511999998888@c.us',
      ]),
    ).toBeNull()
  })

  it('refuses status and broadcast lists', () => {
    expect(chatPhoneFromDataIds(['false_status@broadcast_X'])).toBeNull()
    expect(chatPhoneFromDataIds(['false_5511999998888@status_X'])).toBeNull()
  })

  it('refuses a @lid id, which is NOT a phone number', () => {
    // Newer builds address some chats by a privacy-preserving id.
    // Treating its digits as a phone number would send a lookup — and
    // possibly a new contact — for a number nobody owns.
    expect(chatPhoneFromDataIds(['false_123456789012345@lid_X'])).toBeNull()
  })

  it('skips ids it cannot read and keeps looking', () => {
    expect(
      chatPhoneFromDataIds([
        'lixo',
        '',
        'false_@c.us_X',
        'false_5511999998888@c.us_X',
      ]),
    ).toBe('5511999998888')
  })

  it('stops at the first group id instead of scanning past it', () => {
    // A group's rows also carry the sender's own c.us id; reading on
    // would return a participant's number for a group chat.
    expect(
      chatPhoneFromDataIds([
        'false_120363000000000000@g.us_A',
        'false_5511999998888@c.us_B',
      ]),
    ).toBeNull()
  })

  it('refuses something too short to be a real number', () => {
    expect(chatPhoneFromDataIds(['false_12345@c.us_X'])).toBeNull()
  })

  it('returns null for nothing at all', () => {
    expect(chatPhoneFromDataIds([])).toBeNull()
    expect(chatPhoneFromDataIds(undefined)).toBeNull()
    expect(chatPhoneFromDataIds([null, 42, {}])).toBeNull()
  })
})

describe('usableChatName', () => {
  it('keeps a real name', () => {
    expect(usableChatName('  Maria Souza ')).toBe('Maria Souza')
  })

  it('rejects a title that is just the number', () => {
    // WhatsApp shows the number when the person is not in the address
    // book. Saved as a name it looks filled in, so nobody fixes it.
    expect(usableChatName('+55 11 99999-8888')).toBeNull()
    expect(usableChatName('(11) 99999 8888')).toBeNull()
    expect(usableChatName('+447700900123')).toBeNull()
  })

  it('keeps a name that merely contains digits', () => {
    expect(usableChatName('Loja 24h')).toBe('Loja 24h')
  })

  it('returns null for nothing', () => {
    expect(usableChatName('')).toBeNull()
    expect(usableChatName(undefined)).toBeNull()
  })
})
