// Shared bits of the /api/plataforma/v1 route handlers.

import { resolvePublicOrigin } from '@/lib/http/base-url'

import { platformErrors } from './errors'

/** The CRM's public origin, for the links handed back. */
export function originOf(request: Request): string {
  const origin = resolvePublicOrigin(request, 'api/plataforma')
  if (origin) return origin
  try {
    return new URL(request.url).origin
  } catch {
    throw platformErrors.badRequest('Endereço do CRM indefinido')
  }
}
