import { describe, expect, it } from 'vitest';

import {
  NOTE_MAX_LENGTH,
  NOTES_DEFAULT_LIMIT,
  NOTES_MAX_LIMIT,
  parseNoteBody,
  parseNotesLimit,
  serializeNote,
} from './notes';

describe('parseNoteBody', () => {
  it('takes the text, trimmed', () => {
    expect(parseNoteBody({ text: '  Prefere contato à tarde.  ' })).toEqual({
      ok: true,
      text: 'Prefere contato à tarde.',
    });
  });

  it('refuses a missing, empty or non-text note', () => {
    for (const body of [null, undefined, 'texto', [], {}, { text: '' }, { text: '   ' }, { text: 12 }]) {
      expect(parseNoteBody(body).ok).toBe(false);
    }
  });

  it('refuses a note longer than the limit, and accepts one at it', () => {
    expect(parseNoteBody({ text: 'a'.repeat(NOTE_MAX_LENGTH) }).ok).toBe(true);
    expect(parseNoteBody({ text: 'a'.repeat(NOTE_MAX_LENGTH + 1) }).ok).toBe(false);
  });
});

describe('parseNotesLimit', () => {
  it('defaults when absent or not a positive whole number', () => {
    for (const raw of [null, '', '0', '-3', '2.5', 'abc']) {
      expect(parseNotesLimit(raw)).toBe(NOTES_DEFAULT_LIMIT);
    }
  });

  it('takes a number up to the maximum', () => {
    expect(parseNotesLimit('5')).toBe(5);
    expect(parseNotesLimit('9999')).toBe(NOTES_MAX_LIMIT);
  });
});

describe('serializeNote', () => {
  const row = {
    id: 'n1',
    note_text: 'Ligar na segunda.',
    user_id: 'u1',
    account_id: 'acc', // internal — must not leak
    contact_id: 'c1',
    created_at: '2026-11-10T12:00:00Z',
  };

  it('projects the public shape with the author name', () => {
    expect(serializeNote(row, new Map([['u1', 'Ana Lima']]))).toEqual({
      id: 'n1',
      text: 'Ligar na segunda.',
      author: { id: 'u1', name: 'Ana Lima' },
      created_at: '2026-11-10T12:00:00Z',
    });
  });

  it('keeps the author id when the profile is gone', () => {
    expect(serializeNote(row, new Map()).author).toEqual({ id: 'u1', name: null });
  });

  it('has no author when the row has none', () => {
    expect(serializeNote({ ...row, user_id: null }, new Map()).author).toBeNull();
  });
});
