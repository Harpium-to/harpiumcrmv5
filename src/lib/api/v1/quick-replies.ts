import { isQuickReplyMediaKind, type QuickReplyMediaKind } from '@/lib/quick-replies/media';

// ============================================================
// The public shape of a quick reply (GET /api/v1/quick-replies).
//
// Text replies are `{ id, title, text }`, as they always were. With
// `?include=media` the list also carries the replies with a file
// (migration 063), and every item gains `media`: null for text, else
// `{ kind, url, filename }`, with `text` as the caption ("" for none).
// Callers that never asked keep getting exactly what they got before.
// ============================================================

export interface QuickReplyRow {
  id: string;
  title: string;
  kind?: string | null;
  content_text?: string | null;
  media_kind?: string | null;
  media_url?: string | null;
  media_filename?: string | null;
}

export interface PublicQuickReply {
  id: string;
  title: string;
  text: string;
  media?: { kind: QuickReplyMediaKind; url: string; filename: string | null } | null;
}

export function serializeQuickReplies(
  rows: QuickReplyRow[],
  includeMedia: boolean,
): PublicQuickReply[] {
  const out: PublicQuickReply[] = [];
  for (const row of rows) {
    const text = typeof row.content_text === 'string' ? row.content_text : '';
    if ((row.kind ?? 'text') === 'text') {
      if (!text.trim()) continue;
      out.push(
        includeMedia
          ? { id: row.id, title: row.title, text, media: null }
          : { id: row.id, title: row.title, text },
      );
      continue;
    }
    if (
      includeMedia &&
      row.kind === 'media' &&
      isQuickReplyMediaKind(row.media_kind) &&
      typeof row.media_url === 'string' &&
      row.media_url
    ) {
      out.push({
        id: row.id,
        title: row.title,
        text,
        media: { kind: row.media_kind, url: row.media_url, filename: row.media_filename ?? null },
      });
    }
  }
  return out;
}
