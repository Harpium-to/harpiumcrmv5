import { describe, expect, it } from 'vitest'

import {
  chatFromDataIds,
  chatFromPage,
  chatIdentityFromDataIds,
  chatPhoneFromDataIds,
  phoneFromHeaderTitles,
  usableChatName,
} from './chat-id.js'

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

describe('chatIdentityFromDataIds', () => {
  it('returns the phone of a normal chat', () => {
    expect(
      chatIdentityFromDataIds(['false_5511999998888@c.us_3EB0C767D82B0D09A4C1']),
    ).toEqual({ phone: '5511999998888' })
  })

  it('returns a lid chat as a lid, never as a phone', () => {
    expect(chatIdentityFromDataIds(['false_123456789012345@lid_X'])).toEqual({
      lid: '123456789012345',
    })
  })

  it('prefers a phone id when the chat carries both', () => {
    expect(
      chatIdentityFromDataIds([
        'false_123456789012345@lid_A',
        'true_5511999998888@c.us_B',
      ]),
    ).toEqual({ phone: '5511999998888' })
  })

  it('refuses a group even when a participant is a lid', () => {
    expect(
      chatIdentityFromDataIds([
        'false_120363000000000000@g.us_3EB0_123456789012345@lid',
      ]),
    ).toBeNull()
  })

  it('ignores a lid that is not all digits', () => {
    expect(chatIdentityFromDataIds(['false_12a45@lid_X'])).toBeNull()
  })

  it('returns null for nothing at all', () => {
    expect(chatIdentityFromDataIds([])).toBeNull()
    expect(chatIdentityFromDataIds(undefined)).toBeNull()
  })
})

// What page-bridge.js answers with. It runs in WhatsApp's own world, so
// from here it is untrusted input: the wrong shape must come back null
// (read the page instead), never as a contact.
describe('chatFromPage', () => {
  const answer = (chat, extra = {}) => JSON.stringify({ v: 1, ready: true, chat, ...extra })

  it('reads a chat addressed by phone number', () => {
    expect(chatFromPage(answer({ server: 'c.us', user: '5531999998888', phone: null }))).toEqual({
      state: 'user',
      phone: '5531999998888',
      lid: null,
    })
  })

  it('reads a lid chat with the number WhatsApp has for the contact', () => {
    expect(
      chatFromPage(answer({ server: 'lid', user: '123456789012345', phone: '553199998888' })),
    ).toEqual({ state: 'user', phone: '553199998888', lid: '123456789012345' })
  })

  it('keeps a lid chat without a number as a lid, never as a phone', () => {
    expect(chatFromPage(answer({ server: 'lid', user: '123456789012345', phone: null }))).toEqual({
      state: 'user',
      phone: null,
      lid: '123456789012345',
    })
  })

  it('drops a number that is not plainly a number', () => {
    for (const phone of ['', '12345', '5531-99999', '+5531999998888', 5531999998888, {}, '1'.repeat(16)]) {
      expect(chatFromPage(answer({ server: 'lid', user: '123', phone }))).toEqual({
        state: 'user',
        phone: null,
        lid: '123',
      })
    }
  })

  it('says "none" when no chat is open', () => {
    expect(chatFromPage(answer(null))).toEqual({ state: 'none' })
  })

  it('says "other" for a group, a channel or a broadcast', () => {
    for (const server of ['g.us', 'broadcast', 'newsletter', 'something-new']) {
      expect(chatFromPage(answer({ server, user: null, phone: null }))).toEqual({ state: 'other' })
    }
  })

  it('gives no answer when WhatsApp was not ready', () => {
    expect(chatFromPage(JSON.stringify({ v: 1, ready: false, chat: null }))).toBeNull()
  })

  it('gives no answer for anything it does not recognise', () => {
    expect(chatFromPage(null)).toBeNull()
    expect(chatFromPage(undefined)).toBeNull()
    expect(chatFromPage('')).toBeNull()
    expect(chatFromPage('not json')).toBeNull()
    expect(chatFromPage({ v: 1, ready: true, chat: null })).toBeNull() // an object, not the string
    expect(chatFromPage(JSON.stringify({ v: 2, ready: true, chat: null }))).toBeNull()
    expect(chatFromPage(answer('5531999998888'))).toBeNull()
    expect(chatFromPage(answer({ server: 'c.us', user: 'abc' }))).toBeNull()
    expect(chatFromPage(answer({ server: 'c.us', user: '12345' }))).toBeNull()
    expect(chatFromPage(answer({ server: 'lid', user: '12a45' }))).toBeNull()
    expect(chatFromPage(answer({ server: '', user: '5531999998888' }))).toBeNull()
    expect(chatFromPage(answer({ user: '5531999998888' }))).toBeNull()
  })
})

describe('chatFromDataIds', () => {
  it('reads the old message ids, which carried the chat id', () => {
    expect(chatFromDataIds(['false_5511999998888@c.us_3EB0C767'])).toEqual({
      state: 'user',
      phone: '5511999998888',
      lid: null,
    })
    expect(chatFromDataIds(['false_123456789012345@lid_X'])).toEqual({
      state: 'user',
      phone: null,
      lid: '123456789012345',
    })
  })

  it('says "other" for a group or a broadcast', () => {
    expect(chatFromDataIds(['false_120363000000000000@g.us_3EB0_5511999998888@c.us'])).toEqual({
      state: 'other',
    })
    expect(chatFromDataIds(['false_status@broadcast_X'])).toEqual({ state: 'other' })
  })

  it('gives no answer for the ids WhatsApp uses now (November 2026)', () => {
    // Just the message id: nothing in it names the chat.
    expect(chatFromDataIds(['3EB0C767D82B0D09A4C1', 'AC5F11D09E2B4A77', '3A7F00B2'])).toBeNull()
    expect(chatFromDataIds([])).toBeNull()
    expect(chatFromDataIds(undefined)).toBeNull()
  })
})

describe('phoneFromHeaderTitles', () => {
  it('reads the number WhatsApp shows for someone not in the address book', () => {
    expect(phoneFromHeaderTitles(['+55 31 99999-8888'])).toBe('5531999998888')
    expect(phoneFromHeaderTitles(['+1 (415) 555-1212'])).toBe('14155551212')
  })

  it('ignores names, statuses and anything without the +', () => {
    expect(phoneFromHeaderTitles(['Maria Souza'])).toBeNull()
    expect(phoneFromHeaderTitles(['online'])).toBeNull()
    expect(phoneFromHeaderTitles(['(31) 99999-8888'])).toBeNull()
    expect(phoneFromHeaderTitles(['~ Maria'])).toBeNull()
  })

  it('picks the one number among other titles', () => {
    expect(
      phoneFromHeaderTitles(['Dados do contato', '+55 31 99999-8888', 'online']),
    ).toBe('5531999998888')
  })

  it('refuses when two different numbers are on screen', () => {
    expect(
      phoneFromHeaderTitles(['+55 31 99999-8888', '+55 11 98888-7777']),
    ).toBeNull()
  })

  it('refuses something too short or too long to be a number', () => {
    expect(phoneFromHeaderTitles(['+55 31'])).toBeNull()
    expect(phoneFromHeaderTitles(['+1234567890123456'])).toBeNull()
  })

  it('returns null for nothing', () => {
    expect(phoneFromHeaderTitles([])).toBeNull()
    expect(phoneFromHeaderTitles(undefined)).toBeNull()
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
