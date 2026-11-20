import { beforeEach, describe, expect, it, vi } from 'vitest'

const CRM = '11111111-1111-4111-8111-111111111111'
const MINE = '22222222-2222-4222-8222-222222222222'

let user: { id: string } | null = null
let active: string | null = null
let switchError: { message: string } | null = null
let agency = false
const calls: string[] = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { account_id: active } }) }),
      }),
    }),
    rpc: async (fn: string) => {
      calls.push(fn)
      if (fn === 'set_active_account') return { error: switchError }
      if (fn === 'is_agencia') return { data: agency, error: null }
      return { data: null, error: null }
    },
  }),
}))

const { GET } = await import('./route')

function open(query: string) {
  return GET(new Request(`https://crm.test/abrir?${query}`))
}
const where = (res: Response) => {
  const loc = new URL(res.headers.get('location')!)
  return `${loc.pathname}${loc.search}`
}
const ir = (path: string) => `crm=${CRM}&ir=${encodeURIComponent(path)}`

beforeEach(() => {
  user = { id: 'u1' }
  active = MINE
  switchError = null
  agency = false
  calls.length = 0
})

describe('/abrir', () => {
  it('without a login, goes to the login and comes back here', async () => {
    user = null
    const res = await open(ir('/pipelines?deal=1'))
    expect(where(res)).toBe(`/login?next=${encodeURIComponent(`/abrir?${ir('/pipelines?deal=1')}`)}`)
  })

  it('switches the active CRM and opens the item', async () => {
    const res = await open(ir('/pipelines?pipeline=p&deal=d'))
    expect(calls).toEqual(['set_active_account'])
    expect(where(res)).toBe('/pipelines?pipeline=p&deal=d')
  })

  it('does not switch when that CRM is already open', async () => {
    active = CRM
    const res = await open(ir('/inbox?c=9'))
    expect(calls).toEqual([])
    expect(where(res)).toBe('/inbox?c=9')
  })

  it('a destination outside the CRM falls back to the dashboard', async () => {
    for (const bad of ['//evil.com', 'https://evil.com/x', '/\\evil.com', '/api/v1/contacts']) {
      const res = await open(ir(bad))
      expect(new URL(res.headers.get('location')!).origin).toBe('https://crm.test')
      expect(where(res)).toBe('/dashboard')
    }
  })

  it('the agency without enough consent lands on the CRM card in the console', async () => {
    switchError = { message: 'forbidden' }
    agency = true
    expect(where(await open(ir('/leads')))).toBe(`/agencia/${CRM}`)
  })

  it('anyone else without access sees why', async () => {
    switchError = { message: 'forbidden' }
    expect(where(await open(ir('/leads')))).toBe(`/abrir/sem-acesso?crm=${CRM}`)
  })

  it('the console needs no switch', async () => {
    const res = await open(ir(`/agencia/${CRM}`))
    expect(calls).toEqual([])
    expect(where(res)).toBe(`/agencia/${CRM}`)
  })
})
