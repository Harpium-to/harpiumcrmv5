import { beforeEach, describe, expect, it } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'

import { requireRows, resolveCrmAccess } from './access'
import { AUDIT_THROTTLE_MS, logPlatformAccess } from './audit'
import { parsePersonEmail, requirePlatformKey, type PlatformPerson } from './auth'
import { PlatformError } from './errors'
import { fakePlatformDb } from './fake.test-helper'
import { generatePlatformKey, looksLikePlatformKey } from './keys'
import { normalizeScopes } from './scopes'

const ACC = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const U_AG = 'aaaaaaaa-0000-4000-8000-000000000001'
const U_MEMBER = 'bbbbbbbb-0000-4000-8000-000000000002'
const U_OUT = 'cccccccc-0000-4000-8000-000000000003'

function req(key: string | null, person: string | null): Request {
  const headers: Record<string, string> = {}
  if (key) headers.authorization = `Bearer ${key}`
  if (person) headers['x-harpium-pessoa'] = person
  return new Request('https://crm.test/api/plataforma/v1/eu', { headers })
}

async function failure(p: Promise<unknown>): Promise<{ code: string; reason?: string; status: number }> {
  try {
    await p
  } catch (err) {
    if (err instanceof PlatformError) return { code: err.code, reason: err.reason, status: err.status }
    throw err
  }
  throw new Error('expected a PlatformError')
}

describe('platform keys and scopes', () => {
  it('generates a key that looks like one, with only its hash stored', () => {
    const k = generatePlatformKey()
    expect(k.plaintext.startsWith('hpk_live_')).toBe(true)
    expect(looksLikePlatformKey(k.plaintext)).toBe(true)
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(k.hash).not.toContain(k.plaintext.slice(9))
    expect(looksLikePlatformKey('wacrm_live_' + 'x'.repeat(40))).toBe(false)
  })

  it('keeps only known scopes, in order, without repeats', () => {
    expect(normalizeScopes(['dados:read', 'x', 'crms:read', 'crms:read'])).toEqual([
      'crms:read',
      'dados:read',
    ])
    expect(normalizeScopes('crms:read')).toEqual([])
  })

  it('reads the person header as a lower-cased e-mail or nothing', () => {
    expect(parsePersonEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com')
    expect(parsePersonEmail('ana')).toBeNull()
    expect(parsePersonEmail('a b@c.d')).toBeNull()
    expect(parsePersonEmail(null)).toBeNull()
  })
})

describe('requirePlatformKey', () => {
  const key = generatePlatformKey()
  const revoked = generatePlatformKey()
  let db: ReturnType<typeof fakePlatformDb>

  beforeEach(() => {
    __resetRateLimitForTests()
    db = fakePlatformDb(
      {
        platform_api_keys: [
          { id: 'k1', name: 'Agency OS', key_hash: key.hash, scopes: ['crms:read'], revoked_at: null },
          {
            id: 'k2',
            name: 'Velha',
            key_hash: revoked.hash,
            scopes: ['crms:read'],
            revoked_at: '2026-11-01T00:00:00Z',
          },
        ],
        agencia_membros: [{ user_id: U_AG, role: 'super_admin' }],
        profiles: [{ user_id: U_AG, full_name: ' Marcelo ' }],
      },
      {
        platform_user_id_by_email: ({ p_email }) =>
          ({ 'agus@teste.dev': U_AG, 'membro@teste.dev': U_MEMBER })[String(p_email)] ?? null,
      },
    )
  })

  it('answers who the person is and what the key may do', async () => {
    const ctx = await requirePlatformKey(req(key.plaintext, 'Agus@teste.dev'), 'crms:read', db)
    expect(ctx.keyId).toBe('k1')
    expect(ctx.person).toEqual({
      userId: U_AG,
      email: 'agus@teste.dev',
      name: 'Marcelo',
      agencyRole: 'super_admin',
    })
  })

  it('a member outside the agency has no agency role', async () => {
    const ctx = await requirePlatformKey(req(key.plaintext, 'membro@teste.dev'), undefined, db)
    expect(ctx.person.agencyRole).toBeNull()
  })

  it('refuses each failure with its own code and reason', async () => {
    expect(await failure(requirePlatformKey(req(null, 'agus@teste.dev'), undefined, db))).toEqual({
      code: 'unauthorized',
      reason: undefined,
      status: 401,
    })
    expect(
      await failure(requirePlatformKey(req('hpk_live_' + 'x'.repeat(43), 'agus@teste.dev'), undefined, db)),
    ).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(
      await failure(requirePlatformKey(req(revoked.plaintext, 'agus@teste.dev'), undefined, db)),
    ).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(
      await failure(requirePlatformKey(req(key.plaintext, 'agus@teste.dev'), 'dados:read', db)),
    ).toMatchObject({ code: 'forbidden', reason: 'missing_scope', status: 403 })
    expect(await failure(requirePlatformKey(req(key.plaintext, null), undefined, db))).toMatchObject({
      code: 'bad_request',
      status: 400,
    })
    expect(
      await failure(requirePlatformKey(req(key.plaintext, 'ninguem@teste.dev'), undefined, db)),
    ).toMatchObject({ code: 'forbidden', reason: 'no_crm_login', status: 403 })
  })

  it('limits each key per minute', async () => {
    let last: { code: string } | null = null
    for (let i = 0; i < 301; i++) {
      try {
        await requirePlatformKey(req(key.plaintext, 'agus@teste.dev'), undefined, db)
      } catch (err) {
        last = err as PlatformError
      }
    }
    expect(last?.code).toBe('rate_limited')
  })
})

describe('resolveCrmAccess', () => {
  const person = (userId: string, agencyRole: PlatformPerson['agencyRole']): PlatformPerson => ({
    userId,
    email: 'x@teste.dev',
    name: null,
    agencyRole,
  })
  const roles: Record<string, string | null> = {}
  const db = fakePlatformDb(
    {
      accounts: [{ id: ACC, name: 'Harpium Digital', status: 'active' }],
      account_members: [{ account_id: ACC, user_id: U_MEMBER, role: 'agent' }],
    },
    {
      platform_effective_role: ({ p_user_id }) => roles[String(p_user_id)] ?? null,
      agency_access_level: () => 'read',
    },
  )

  it('a member reads rows, as a member', async () => {
    roles[U_MEMBER] = 'agent'
    const a = await resolveCrmAccess(db, person(U_MEMBER, null), ACC)
    expect(a).toMatchObject({ level: 'rows', via: 'member', role: 'agent', consent: null })
    expect(() => requireRows(a)).not.toThrow()
  })

  it('the agency with consent reads rows; without it, only metrics', async () => {
    roles[U_AG] = 'viewer'
    expect(await resolveCrmAccess(db, person(U_AG, 'support'), ACC)).toMatchObject({
      level: 'rows',
      via: 'agency',
      consent: 'read',
    })
    roles[U_AG] = null
    const metrics = await resolveCrmAccess(db, person(U_AG, 'support'), ACC)
    expect(metrics.level).toBe('metrics')
    expect(() => requireRows(metrics)).toThrow(PlatformError)
  })

  it('an outsider has no access; an unknown CRM is not found', async () => {
    expect(await failure(resolveCrmAccess(db, person(U_OUT, null), ACC))).toMatchObject({
      reason: 'no_access',
      status: 403,
    })
    expect(await failure(resolveCrmAccess(db, person(U_AG, 'super_admin'), OTHER))).toMatchObject({
      code: 'not_found',
    })
    expect(await failure(resolveCrmAccess(db, person(U_AG, 'super_admin'), 'nao-e-uuid'))).toMatchObject({
      code: 'not_found',
    })
  })
})

describe('logPlatformAccess', () => {
  const agencyAccess = {
    accountId: ACC,
    name: 'X',
    status: 'active' as const,
    level: 'rows' as const,
    via: 'agency' as const,
    role: 'viewer',
    consent: 'read' as const,
  }
  const p: PlatformPerson = { userId: U_AG, email: 'a@b.c', name: null, agencyRole: 'super_admin' }

  it('logs agency reads with the origin, and never a member reading their own CRM', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = { agencia_auditoria: [] }
    const db = fakePlatformDb(tables)
    await logPlatformAccess(db, { person: p, access: { ...agencyAccess, via: 'member' }, action: 'api_list_leads' })
    expect(tables.agencia_auditoria).toHaveLength(0)
    await logPlatformAccess(db, { person: p, access: agencyAccess, action: 'api_list_leads', detalhe: 'busca' })
    expect(tables.agencia_auditoria[0]).toMatchObject({
      actor_user_id: U_AG,
      account_id: ACC,
      action: 'api_list_leads',
      origem: 'agency_os',
      detalhe: 'busca',
    })
  })

  it('writes the summary at most once per window', async () => {
    const now = Date.now()
    const tables: Record<string, Array<Record<string, unknown>>> = {
      agencia_auditoria: [
        {
          actor_user_id: U_AG,
          account_id: ACC,
          action: 'api_view_summary',
          created_at: new Date(now - 60_000).toISOString(),
        },
      ],
    }
    const db = fakePlatformDb(tables)
    await logPlatformAccess(db, { person: p, access: agencyAccess, action: 'api_view_summary' }, now)
    expect(tables.agencia_auditoria).toHaveLength(1)
    await logPlatformAccess(
      db,
      { person: p, access: agencyAccess, action: 'api_view_summary' },
      now + AUDIT_THROTTLE_MS,
    )
    expect(tables.agencia_auditoria).toHaveLength(2)
  })
})
