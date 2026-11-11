import { describe, expect, it } from 'vitest';

import { serializeQuickReplies } from './quick-replies';

const rows = [
  { id: 'a', title: 'Horário', kind: 'text', content_text: 'Das 8h às 18h.' },
  { id: 'b', title: 'Vazia', kind: 'text', content_text: '  ' },
  {
    id: 'c',
    title: 'Catálogo',
    kind: 'media',
    content_text: 'Segue, {{primeiro_nome}}.',
    media_kind: 'document',
    media_url: 'https://p.supabase.co/storage/v1/object/public/chat-media/account-x/1-c.pdf',
    media_filename: 'Catálogo.pdf',
  },
  {
    id: 'd',
    title: 'Áudio',
    kind: 'media',
    content_text: null,
    media_kind: 'audio',
    media_url: 'https://p.supabase.co/storage/v1/object/public/chat-media/account-x/1-d.ogg',
    media_filename: null,
  },
  { id: 'e', title: 'Quebrada', kind: 'media', media_kind: 'sticker', media_url: 'x' },
  { id: 'f', title: 'Botões', kind: 'interactive', content_text: null },
];

describe('serializeQuickReplies', () => {
  it('keeps the old shape, text only, for callers that did not ask for files', () => {
    expect(serializeQuickReplies(rows, false)).toEqual([
      { id: 'a', title: 'Horário', text: 'Das 8h às 18h.' },
    ]);
  });

  it('adds the replies with a file when asked, caption as text', () => {
    expect(serializeQuickReplies(rows, true)).toEqual([
      { id: 'a', title: 'Horário', text: 'Das 8h às 18h.', media: null },
      {
        id: 'c',
        title: 'Catálogo',
        text: 'Segue, {{primeiro_nome}}.',
        media: {
          kind: 'document',
          url: 'https://p.supabase.co/storage/v1/object/public/chat-media/account-x/1-c.pdf',
          filename: 'Catálogo.pdf',
        },
      },
      {
        id: 'd',
        title: 'Áudio',
        text: '',
        media: {
          kind: 'audio',
          url: 'https://p.supabase.co/storage/v1/object/public/chat-media/account-x/1-d.ogg',
          filename: null,
        },
      },
    ]);
  });

  it('treats rows from before migration 063 (no kind column read) as text', () => {
    expect(serializeQuickReplies([{ id: 'z', title: 'T', content_text: 'Oi' }], true)).toEqual([
      { id: 'z', title: 'T', text: 'Oi', media: null },
    ]);
  });
});
