import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { blankButtonsPayload } from '@/components/interactive/interactive-builder'

import { MediaFields, type DraftState } from './quick-replies-manager'

const URL_BASE = 'https://p.supabase.co/storage/v1/object/public/chat-media/account-x'

function draft(media: DraftState['media'], caption = ''): DraftState {
  return {
    title: 'Catálogo',
    kind: 'media',
    content_text: caption,
    interactive_payload: blankButtonsPayload(),
    media,
    unsavedPath: null,
  }
}

function render(d: DraftState, uploading = false) {
  return renderToStaticMarkup(
    <MediaFields
      draft={d}
      uploading={uploading}
      inputRef={{ current: null }}
      onPick={() => {}}
      onCaption={() => {}}
    />,
  )
}

describe('MediaFields', () => {
  it('asks for a file first, and says which ones go', () => {
    const html = render(draft(null))
    expect(html).toContain('Escolher arquivo')
    expect(html).toContain('até 16 MB')
    expect(html).toContain('Legenda (opcional)')
  })

  it('says the upload is under way', () => {
    expect(render(draft(null), true)).toContain('Enviando o arquivo…')
  })

  it('shows a photo and lets the caption carry variables', () => {
    const html = render(
      draft({ kind: 'image', url: `${URL_BASE}/1-loja.jpg`, path: 'account-x/1-loja.jpg', filename: 'loja.jpg' }),
    )
    expect(html).toContain(`<img src="${URL_BASE}/1-loja.jpg"`)
    expect(html).toContain('Imagem · loja.jpg')
    expect(html).toContain('Trocar arquivo')
    expect(html).toContain('{{primeiro_nome}}')
  })

  it('plays an audio and drops the caption field', () => {
    const html = render(
      draft({ kind: 'audio', url: `${URL_BASE}/1-oi.ogg`, path: 'account-x/1-oi.ogg', filename: 'oi.ogg' }),
    )
    expect(html).toContain('<audio')
    expect(html).toContain('O áudio vai sem legenda.')
    expect(html).not.toContain('Legenda (opcional)')
  })

  it('names a document', () => {
    const html = render(
      draft({ kind: 'document', url: `${URL_BASE}/1-c.pdf`, path: 'account-x/1-c.pdf', filename: 'Catálogo 2026.pdf' }),
    )
    expect(html).toContain('Catálogo 2026.pdf')
    expect(html).toContain('Arquivo · Catálogo 2026.pdf')
  })
})
