import { describe, expect, it } from 'vitest';

import {
  mediaKindForMime,
  parseQuickReplyMedia,
  QUICK_REPLY_CAPTION_MAX,
} from './media';

const ACC = '11111111-2222-3333-4444-555555555555';
const BASE = 'https://proj.supabase.co';
const PATH = `account-${ACC}/1731234567890-catalogo.pdf`;
const URL_OK = `${BASE}/storage/v1/object/public/chat-media/${PATH}`;

const body = (over: Record<string, unknown> = {}) => ({
  media_kind: 'document',
  media_url: URL_OK,
  media_path: PATH,
  media_filename: 'Catálogo 2026.pdf',
  content_text: 'Segue o catálogo, {{primeiro_nome}}.',
  ...over,
});

describe('parseQuickReplyMedia', () => {
  it('keeps a file this account uploaded', () => {
    expect(parseQuickReplyMedia(body(), ACC, BASE)).toEqual({
      ok: true,
      value: {
        media_kind: 'document',
        media_url: URL_OK,
        media_path: PATH,
        media_filename: 'Catálogo 2026.pdf',
        content_text: 'Segue o catálogo, {{primeiro_nome}}.',
      },
    });
  });

  it('accepts the storage URL with a trailing slash', () => {
    expect(parseQuickReplyMedia(body(), ACC, `${BASE}/`).ok).toBe(true);
  });

  it('refuses a file from another account, another site or another bucket', () => {
    const other = `account-99999999-2222-3333-4444-555555555555/1-x.pdf`;
    expect(
      parseQuickReplyMedia(
        body({ media_path: other, media_url: `${BASE}/storage/v1/object/public/chat-media/${other}` }),
        ACC,
        BASE,
      ).ok,
    ).toBe(false);
    expect(parseQuickReplyMedia(body({ media_url: 'https://evil.example/x.pdf' }), ACC, BASE).ok).toBe(
      false,
    );
    expect(
      parseQuickReplyMedia(
        body({ media_url: `${BASE}/storage/v1/object/public/flow-media/${PATH}` }),
        ACC,
        BASE,
      ).ok,
    ).toBe(false);
    // A path that climbs out of the folder.
    expect(
      parseQuickReplyMedia(
        body({
          media_path: `account-${ACC}/../account-x/a.pdf`,
          media_url: `${BASE}/storage/v1/object/public/chat-media/account-${ACC}/../account-x/a.pdf`,
        }),
        ACC,
        BASE,
      ).ok,
    ).toBe(false);
  });

  it('refuses when the CRM does not know its own storage address', () => {
    expect(parseQuickReplyMedia(body(), ACC, '').ok).toBe(false);
  });

  it('needs a known kind', () => {
    expect(parseQuickReplyMedia(body({ media_kind: 'sticker' }), ACC, BASE)).toEqual({
      ok: false,
      error: 'Escolha o arquivo da resposta rápida.',
    });
  });

  it('drops the caption of an audio, which WhatsApp does not show', () => {
    const r = parseQuickReplyMedia(body({ media_kind: 'audio' }), ACC, BASE);
    expect(r.ok && r.value.content_text).toBeNull();
  });

  it('keeps no empty caption or filename', () => {
    const r = parseQuickReplyMedia(body({ content_text: '   ', media_filename: ' ' }), ACC, BASE);
    expect(r.ok && r.value.content_text).toBeNull();
    expect(r.ok && r.value.media_filename).toBeNull();
  });

  it('refuses a caption longer than WhatsApp allows', () => {
    const r = parseQuickReplyMedia(
      body({ content_text: 'a'.repeat(QUICK_REPLY_CAPTION_MAX + 1) }),
      ACC,
      BASE,
    );
    expect(r.ok).toBe(false);
  });
});

describe('mediaKindForMime', () => {
  it('maps the types the chat-media bucket accepts', () => {
    expect(mediaKindForMime('image/jpeg')).toBe('image');
    expect(mediaKindForMime('video/mp4')).toBe('video');
    expect(mediaKindForMime('application/pdf')).toBe('document');
    expect(mediaKindForMime('audio/ogg; codecs=opus')).toBe('audio');
    expect(mediaKindForMime('audio/mpeg')).toBe('audio');
  });

  it('is null for anything else', () => {
    expect(mediaKindForMime('image/gif')).toBeNull();
    expect(mediaKindForMime('audio/webm')).toBeNull();
    expect(mediaKindForMime('')).toBeNull();
    expect(mediaKindForMime(undefined)).toBeNull();
  });
});
