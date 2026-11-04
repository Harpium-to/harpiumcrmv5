import { describe, expect, it, vi } from 'vitest'

import { rpcErrorStatus, rpcErrorToResponse } from './rpc-error'

describe('rpcErrorToResponse', () => {
  it('maps the SQLSTATEs our functions raise', () => {
    expect(rpcErrorStatus({ code: '42501' })).toBe(403)
    expect(rpcErrorStatus({ code: '22023' })).toBe(400)
    expect(rpcErrorStatus({ code: '23505' })).toBe(409)
    expect(rpcErrorStatus({ code: 'PGRST202' })).toBe(409)
    expect(rpcErrorStatus({ code: '57014' })).toBe(500)
  })

  it('passes the function’s own message through for expected errors', async () => {
    const res = rpcErrorToResponse(
      { code: '42501', message: 'Este CRM não está na sua carteira' },
      { fallback: 'Falhou' },
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Este CRM não está na sua carteira' })
  })

  it('names the missing migration', async () => {
    const res = rpcErrorToResponse(
      { code: 'PGRST202', message: 'Could not find the function' },
      { fallback: 'Falhou', migration: '050' },
    )
    expect(await res.json()).toEqual({
      error: 'Isto exige a migration 050 aplicada no Supabase.',
    })
  })

  it('hides unexpected errors behind the fallback', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = rpcErrorToResponse(
      { code: '57014', message: 'canceling statement due to statement timeout' },
      { fallback: 'Falha ao criar o CRM' },
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Falha ao criar o CRM' })
    spy.mockRestore()
  })
})
