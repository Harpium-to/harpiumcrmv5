// ============================================================
// Reading the body of a lead POST — pure, unit-tested, no I/O.
//
// Senders differ: the quiz and Zapier send JSON, many form tools only
// send `application/x-www-form-urlencoded`, some send JSON labelled as
// text/plain, and Make sometimes wraps the object in an array. All of
// them end up here as one plain object, or as a clear error code the
// route turns into a 400/413.
// ============================================================

/** Largest body accepted, in bytes (100 KB). */
export const MAX_LEAD_BODY_BYTES = 100 * 1024

export type BodyError = 'formato_invalido' | 'muito_grande'

export type BodyParse =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: BodyError }

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Parse a raw body given its Content-Type. */
export function parseLeadBody(contentType: string | null, body: string): BodyParse {
  if (byteLength(body) > MAX_LEAD_BODY_BYTES) return { ok: false, error: 'muito_grande' }
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'formato_invalido' }

  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/x-www-form-urlencoded')) {
    return formResult(Array.from(new URLSearchParams(trimmed).entries()))
  }

  // JSON — also when the sender forgot the header or used text/plain.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isDict(parsed)) return { ok: true, payload: parsed }
      // Make/Integromat sometimes sends `[ {…} ]`.
      if (Array.isArray(parsed) && isDict(parsed[0])) return { ok: true, payload: parsed[0] }
      return { ok: false, error: 'formato_invalido' }
    } catch {
      return { ok: false, error: 'formato_invalido' }
    }
  }

  // A form body sent without its Content-Type.
  if (/^[^=&\s]+=/.test(trimmed)) {
    return formResult(Array.from(new URLSearchParams(trimmed).entries()))
  }
  return { ok: false, error: 'formato_invalido' }
}

function formResult(pairs: [string, string][]): BodyParse {
  const payload = formPairsToPayload(pairs)
  return Object.keys(payload).length > 0
    ? { ok: true, payload }
    : { ok: false, error: 'formato_invalido' }
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_INDEX = 200

/** "respostas[0][pergunta]" → ["respostas","0","pergunta"]; "contato.nome" → ["contato","nome"]. */
function keyPath(key: string): string[] {
  const out: string[] = []
  for (const m of key.matchAll(/\[([^\]]*)\]|([^[.\]]+)/g)) {
    out.push(m[1] !== undefined ? m[1] : m[2])
  }
  return out.length ? out : [key]
}

/**
 * Form fields to a plain object. Bracket and dot keys nest
 * (`contato[nome]`, `contato.nome`, `etiquetas[]`, `respostas[0][pergunta]`),
 * so a form can carry the Harpium Lead v1 shape too. A key repeated
 * without brackets becomes a list.
 */
export function formPairsToPayload(pairs: [string, string][]): Dict {
  const root: Dict = {}
  for (const [rawKey, value] of pairs) {
    const key = rawKey.trim()
    if (!key) continue
    const path = keyPath(key)
    if (path.some((seg) => FORBIDDEN.has(seg))) continue
    assign(root, path, value)
  }
  return root
}

function assign(root: Dict, path: string[], value: string): void {
  let cur: Dict | unknown[] = root
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]
    const last = i === path.length - 1
    const next = path[i + 1]
    const nextIsList = next !== undefined && (next === '' || /^\d+$/.test(next))

    if (Array.isArray(cur)) {
      const idx = seg === '' ? cur.length : Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx > MAX_INDEX) return
      if (last) {
        cur[idx] = value
        return
      }
      const slot: unknown = cur[idx]
      if (typeof slot !== 'object' || slot === null) cur[idx] = nextIsList ? [] : {}
      cur = cur[idx] as Dict | unknown[]
      continue
    }

    if (last) {
      const prev = cur[seg]
      if (prev === undefined) cur[seg] = value
      else if (Array.isArray(prev)) prev.push(value)
      else if (typeof prev === 'string') cur[seg] = [prev, value]
      return
    }
    const slot: unknown = cur[seg]
    if (typeof slot !== 'object' || slot === null) cur[seg] = nextIsList ? [] : {}
    cur = cur[seg] as Dict | unknown[]
  }
}
