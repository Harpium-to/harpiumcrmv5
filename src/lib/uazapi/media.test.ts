import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('./api', () => ({ downloadUazapiMedia: h.download }))

import { baseMime, copyUazapiMediaToStorage, mediaObjectPath } from './media'

function fakeStorage(uploadError: { message: string } | null = null) {
  const uploads: { path: string; opts: unknown }[] = []
  const admin = {
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, opts: unknown) => {
          uploads.push({ path, opts })
          return { error: uploadError }
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage/${path}` } }),
      }),
    },
  }
  return { admin: admin as never, uploads }
}

const SRV = { baseUrl: 'https://srv', token: 't' }

describe('media paths', () => {
  it('strips MIME parameters', () => {
    expect(baseMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(baseMime('IMAGE/JPEG')).toBe('image/jpeg')
    expect(baseMime(null)).toBeNull()
  })

  it('files under the account folder the bucket’s rules match on', () => {
    expect(mediaObjectPath('acct-1', '3EB0:ABC/x', 'jpg', 1700)).toBe(
      'account-acct-1/1700-wa_3EB0_ABC_x.jpg',
    )
  })
})

describe('copyUazapiMediaToStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies the file to our bucket and returns our URL', async () => {
    h.download.mockResolvedValue({ fileUrl: 'https://cdn.uazapi/a.mp3', mimetype: 'audio/mpeg' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    )
    const { admin, uploads } = fakeStorage()
    const url = await copyUazapiMediaToStorage(admin, 'acct-1', SRV, 'WA1')
    expect(h.download).toHaveBeenCalledWith(SRV, 'WA1')
    expect(uploads[0].path).toMatch(/^account-acct-1\/\d+-wa_WA1\.mp3$/)
    expect(uploads[0].opts).toEqual({ contentType: 'audio/mpeg', upsert: false })
    expect(url).toBe(`https://storage/${uploads[0].path}`)
  })

  it('gives up (null) on a type the bucket would refuse, without uploading', async () => {
    h.download.mockResolvedValue({ fileUrl: 'https://cdn.uazapi/a.zip', mimetype: 'application/zip' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 200 })))
    const { admin, uploads } = fakeStorage()
    expect(await copyUazapiMediaToStorage(admin, 'acct-1', SRV, 'WA1')).toBeNull()
    expect(uploads).toEqual([])
  })

  it('never throws: a gateway or storage failure is null', async () => {
    h.download.mockRejectedValue(new Error('Falha ao baixar a mídia: HTTP 404'))
    expect(await copyUazapiMediaToStorage(fakeStorage().admin, 'acct-1', SRV, 'WA1')).toBeNull()

    h.download.mockResolvedValue({ fileUrl: 'https://cdn.uazapi/a.jpg', mimetype: 'image/jpeg' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 200 })))
    const failing = fakeStorage({ message: 'quota' })
    expect(await copyUazapiMediaToStorage(failing.admin, 'acct-1', SRV, 'WA1')).toBeNull()
  })
})
