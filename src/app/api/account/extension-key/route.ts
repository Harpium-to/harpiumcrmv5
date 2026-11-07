// ============================================================
// /api/account/extension-key — the caller's personal key for the
// Chrome extension, in their active CRM (migration 054).
//
// GET     status: connected (prefix, last used) or not
// POST    mint a new key — the plaintext comes back ONCE, with the CRM
//         address to paste into the extension's options. A new key
//         replaces the previous one.
// DELETE  disconnect (revoke)
//
// The database fixes the scopes and requires agent or above; this route
// only generates the secret (same scheme as every API key).
// ============================================================

import { NextResponse } from 'next/server'

import { generateApiKey } from '@/lib/api-keys/keys'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { isMissingFunction } from '@/lib/auth/account-context'
import { resolvePublicOrigin } from '@/lib/http/base-url'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase.rpc('my_extension_key')
    if (error) {
      if (isMissingFunction(error)) return NextResponse.json({ available: false })
      console.error('[GET extension-key] rpc error:', error)
      return NextResponse.json({ error: 'Falha ao carregar' }, { status: 500 })
    }
    const k = data as Record<string, unknown> | null
    return NextResponse.json({
      available: true,
      role: ctx.role,
      viaAgency: ctx.viaAgency,
      key: k
        ? {
            prefix: String(k.prefix ?? ''),
            createdAt: String(k.created_at ?? ''),
            lastUsedAt: typeof k.last_used_at === 'string' ? k.last_used_at : null,
          }
        : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const limit = checkRateLimit(`extensionKey:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const key = generateApiKey()
    const { error } = await ctx.supabase.rpc('create_extension_key', {
      p_key_hash: key.hash,
      p_key_prefix: key.prefix,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao gerar a chave',
        migration: '054',
        log: 'POST extension-key',
      })
    }
    return NextResponse.json(
      {
        // Plaintext — shown once, never stored.
        key: key.plaintext,
        prefix: key.prefix,
        crmUrl: resolvePublicOrigin(request, 'POST extension-key'),
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await getCurrentAccount()
    const { error } = await ctx.supabase.rpc('revoke_my_extension_key')
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao desconectar',
        migration: '054',
        log: 'DELETE extension-key',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
