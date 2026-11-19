import type { JsonSchema } from '@/lib/ai/tool-chat'
import { INVALID_ARGS_KEY } from '@/lib/ai/tool-chat'

// ============================================================
// Checking what the model sent against the tool's own schema.
//
// Every tool declares its input as JSON Schema (the same object the
// provider receives). The model usually respects it, but "usually" is
// not a security property: an id that is a number, a list that is a
// string, a missing required field. This validates the small subset
// the tools use and returns a cleaned object (unknown keys dropped),
// with an error in Portuguese the model can read and correct.
//
// Supported: type object/string/integer/number/boolean/array, enum,
// required, properties, items, minLength/maxLength, minimum/maximum,
// minItems/maxItems, format "uuid".
// ============================================================

export type SchemaCheck =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function checkInput(schema: JsonSchema, input: unknown): SchemaCheck {
  if (input && typeof input === 'object' && INVALID_ARGS_KEY in (input as object)) {
    return { ok: false, error: 'os argumentos não vieram em JSON válido; mande de novo' }
  }
  const out = walk(schema, input ?? {}, 'entrada')
  if (!out.ok) return out
  return { ok: true, value: (out.value ?? {}) as Record<string, unknown> }
}

type Walk = { ok: true; value: unknown } | { ok: false; error: string }

function walk(schema: JsonSchema, value: unknown, path: string): Walk {
  const type = schema.type as string | undefined
  const enumValues = schema.enum as unknown[] | undefined

  if (enumValues && !enumValues.includes(value)) {
    return { ok: false, error: `${path} precisa ser um destes: ${enumValues.join(', ')}` }
  }

  switch (type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: `${path} precisa ser um objeto` }
      }
      const props = (schema.properties ?? {}) as Record<string, JsonSchema>
      const required = (schema.required ?? []) as string[]
      const src = value as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const key of required) {
        if (src[key] === undefined || src[key] === null) {
          return { ok: false, error: `falta ${path === 'entrada' ? '' : `${path}.`}${key}` }
        }
      }
      const open = schema.additionalProperties === true
      for (const [key, raw] of Object.entries(src)) {
        const sub = props[key]
        if (!sub) {
          if (open) result[key] = raw
          continue
        }
        // An optional field sent as null means "not given".
        if (raw === null && !required.includes(key)) continue
        const r = walk(sub, raw, path === 'entrada' ? key : `${path}.${key}`)
        if (!r.ok) return r
        if (r.value !== undefined) result[key] = r.value
      }
      return { ok: true, value: result }
    }
    case 'array': {
      if (!Array.isArray(value)) return { ok: false, error: `${path} precisa ser uma lista` }
      const min = schema.minItems as number | undefined
      const max = schema.maxItems as number | undefined
      if (min !== undefined && value.length < min) {
        return { ok: false, error: `${path} precisa de pelo menos ${min} item(ns)` }
      }
      if (max !== undefined && value.length > max) {
        return { ok: false, error: `${path} aceita no máximo ${max} itens` }
      }
      const items = (schema.items ?? {}) as JsonSchema
      const result: unknown[] = []
      for (let i = 0; i < value.length; i++) {
        const r = walk(items, value[i], `${path}[${i}]`)
        if (!r.ok) return r
        result.push(r.value)
      }
      return { ok: true, value: result }
    }
    case 'string': {
      if (typeof value !== 'string') return { ok: false, error: `${path} precisa ser texto` }
      const text = value.trim()
      const min = schema.minLength as number | undefined
      const max = schema.maxLength as number | undefined
      if (min !== undefined && text.length < min) {
        return { ok: false, error: `${path} está vazio ou curto demais` }
      }
      if (max !== undefined && text.length > max) {
        return { ok: false, error: `${path} passa de ${max} caracteres` }
      }
      if (schema.format === 'uuid' && !UUID.test(text)) {
        return { ok: false, error: `${path} precisa ser um ID (uuid) tirado de uma consulta` }
      }
      return { ok: true, value: text }
    }
    case 'integer':
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        return { ok: false, error: `${path} precisa ser um número` }
      }
      if (type === 'integer' && !Number.isInteger(n)) {
        return { ok: false, error: `${path} precisa ser um número inteiro` }
      }
      const min = schema.minimum as number | undefined
      const max = schema.maximum as number | undefined
      if (min !== undefined && n < min) return { ok: false, error: `${path} precisa ser ≥ ${min}` }
      if (max !== undefined && n > max) return { ok: false, error: `${path} precisa ser ≤ ${max}` }
      return { ok: true, value: n }
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return { ok: false, error: `${path} precisa ser true ou false` }
      return { ok: true, value }
    }
    default:
      // No declared type: pass through (used for free-form configs).
      return { ok: true, value }
  }
}
