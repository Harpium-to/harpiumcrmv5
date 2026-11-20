import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import type { SupabaseClient } from '@supabase/supabase-js'

import { classifyLead, loadCrmKnowledge } from './classify'
import { leadPhone, phoneKeys, phoneKind } from './phone'
import { RESULT_COLUMNS, type ResultRow } from './store'
import type { ExtractedLead } from './types'

// ============================================================
// The complement from the company's own site: the WhatsApp link, the
// e-mail and the Instagram it published to be found.
//
// The address comes from outside (Google Maps), so it is treated as
// hostile: only http(s), never an address inside a private network
// (checked after resolving the name, and again on every redirect), a
// short timeout and a small read. A site whose robots.txt closes it to
// everyone is not read.
// ============================================================

/** Sites read per call of the screen. */
export const ENRICH_BATCH = 8
const TIMEOUT_MS = 6000
const MAX_BYTES = 400_000
const MAX_REDIRECTS = 3
const AGENT = 'Mozilla/5.0 (compatible; SiteContactReader/1.0)'

export interface SiteContacts {
  whatsapp: string | null
  email: string | null
  instagram: string | null
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x2f;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"')

/** E-mails that are never the company's contact. */
const NOT_A_CONTACT = /(example\.|sentry|wixpress|\.png$|\.jpe?g$|\.gif$|\.webp$|\.svg$|noreply|no-reply|seuemail|email@)/i

/** What a page says about how to reach the company. Pure. */
export function extractContacts(html: string): SiteContacts {
  const page = decodeEntities(html)

  let whatsapp: string | null = null
  const links = page.matchAll(
    /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s>]*&)?phone=|web\.whatsapp\.com\/send\/?\?(?:[^"'\s>]*&)?phone=|whatsapp:\/\/send\/?\?(?:[^"'\s>]*&)?phone=)(?:%2B|\+)?(\d{10,15})/gi,
  )
  for (const m of links) {
    const phone = leadPhone(m[1].length <= 11 ? m[1] : `+${m[1]}`)
    if (phone) {
      whatsapp = phone
      break
    }
  }

  let email: string | null = null
  const mailto = /mailto:([^"'?\s>]+)/i.exec(page)
  const candidates = [
    ...(mailto ? [decodeURIComponent(mailto[1])] : []),
    ...[...page.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].slice(0, 40).map((m) => m[0]),
  ]
  for (const candidate of candidates) {
    const value = candidate.trim().toLowerCase().replace(/[.,;]+$/, '')
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(value) && !NOT_A_CONTACT.test(value)) {
      email = value
      break
    }
  }

  let instagram: string | null = null
  for (const m of page.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})/gi)) {
    const handle = m[1].replace(/\.+$/, '')
    if (/^(p|reel|reels|explore|stories|accounts|tv|share|about|developer)$/i.test(handle)) continue
    instagram = `@${handle}`
    break
  }
  return { whatsapp, email, instagram }
}

/** True when robots.txt closes the whole site to every robot. Pure. */
export function robotsClosesSite(robots: string): boolean {
  let applies = false
  let sawRule = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [field, ...rest] = line.split(':')
    const value = rest.join(':').trim()
    const name = field.trim().toLowerCase()
    if (name === 'user-agent') {
      // A new group starts after rules; consecutive agents share one.
      if (sawRule) applies = false
      sawRule = false
      if (value === '*') applies = true
    } else if (name === 'disallow' || name === 'allow') {
      sawRule = true
      if (applies && name === 'disallow' && value === '/') return true
    }
  }
  return false
}

/** An address the server must never call: loopback, private, link-local. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6 === '::' || v6 === '::1') return true
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')) return true
  if (v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  return mapped ? isPrivateAddress(mapped[1]) : false
}

/** The URL to read, or null when it is not a public web address. */
export function publicUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return null
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|test)$/i.test(host)) return null
  return url
}

export interface FetchDeps {
  fetch: typeof fetch
  resolve: (host: string) => Promise<string[]>
}

const defaultFetchDeps: FetchDeps = {
  fetch,
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
}

async function guardedGet(start: URL, deps: FetchDeps): Promise<{ url: URL; text: string } | null> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const addresses = await deps.resolve(url.hostname).catch(() => [])
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) return null
    const res = await deps.fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    })
    if (res.status >= 300 && res.status < 400) {
      const next = publicUrl(new URL(res.headers.get('location') ?? '', url).toString())
      if (!next) return null
      url = next
      continue
    }
    if (!res.ok || !res.body) return null
    const type = res.headers.get('content-type') ?? ''
    if (type && !/text\/|html|xml/i.test(type)) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      size += value.byteLength
    }
    await reader.cancel().catch(() => {})
    return { url, text: Buffer.concat(chunks).toString('utf8').slice(0, MAX_BYTES) }
  }
  return null
}

/** What the company's site says, or null when it could not be read. */
export async function readSite(raw: string, deps: FetchDeps = defaultFetchDeps): Promise<SiteContacts | null> {
  const url = publicUrl(raw)
  if (!url) return null
  try {
    const robots = await guardedGet(new URL('/robots.txt', url), deps).catch(() => null)
    if (robots && robotsClosesSite(robots.text)) return null
    const page = await guardedGet(url, deps)
    return page ? extractContacts(page.text) : null
  } catch {
    return null
  }
}

export interface EnrichDeps {
  read: (url: string) => Promise<SiteContacts | null>
}

function asLead(row: ResultRow, phone: string | null): ExtractedLead {
  return {
    source: row.source,
    externalKey: row.external_key,
    kind: row.kind,
    name: row.name,
    phone,
    email: row.email,
    website: row.website,
    instagram: row.instagram,
    address: row.address,
    district: row.district,
    city: row.city,
    uf: row.uf,
    cep: row.cep,
    activity: row.activity,
    extras: row.extras,
  }
}

/**
 * Read the sites of the next rows of an extraction that have one and
 * were not read yet. Fills only what is empty; a WhatsApp number from
 * the site takes the place of a missing number or of a landline, and
 * the row is then checked against the CRM again.
 */
export async function enrichNext(
  admin: SupabaseClient,
  accountId: string,
  extractionId: string,
  deps: EnrichDeps = { read: (url) => readSite(url) },
): Promise<{ read: number; improved: number; remaining: number }> {
  const { data, error, count } = await admin
    .from('lead_extraction_results')
    .select(RESULT_COLUMNS, { count: 'exact' })
    .eq('account_id', accountId)
    .eq('extraction_id', extractionId)
    .not('website', 'is', null)
    .is('enriched_at', null)
    .is('imported_at', null)
    .order('created_at', { ascending: true })
    .limit(ENRICH_BATCH)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ResultRow[]
  if (rows.length === 0) return { read: 0, improved: 0, remaining: 0 }

  const found = await Promise.all(rows.map((row) => deps.read(row.website as string).catch(() => null)))
  const at = new Date().toISOString()
  let improved = 0

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const site = found[i]
    const patch: Record<string, unknown> = { enriched_at: at }
    if (site) {
      if (!row.email && site.email) patch.email = site.email
      if (!row.instagram && site.instagram) patch.instagram = site.instagram
      const better = site.whatsapp && (!row.phone || row.phone_kind === 'fixo') && site.whatsapp !== row.phone
      if (better && site.whatsapp) {
        const lead = asLead(row, site.whatsapp)
        const known = await loadCrmKnowledge(admin, accountId, extractionId, row.source, [lead])
        // The row itself is in the table: its own number is not "extracted before".
        for (const key of phoneKeys(row.phone)) known.extractedPhones.delete(key)
        const { status, matchedContactId } = classifyLead(lead, known)
        patch.phone = site.whatsapp
        patch.phone_normalized = phoneKeys(site.whatsapp)[0] ?? null
        patch.phone_kind = phoneKind(site.whatsapp)
        patch.status = status
        patch.matched_contact_id = matchedContactId
        patch.has_whatsapp = null
        patch.whatsapp_checked_at = null
        patch.extras = { ...row.extras, telefone_anterior: row.phone }
      }
      if (Object.keys(patch).length > 1) improved += 1
    }
    await admin.from('lead_extraction_results').update(patch).eq('id', row.id)
  }
  return { read: rows.length, improved, remaining: Math.max(0, (count ?? rows.length) - rows.length) }
}
