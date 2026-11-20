// The GET handler shared by the /api/plataforma/v1/crms/{id}/<list> routes.

import { requireRows, resolveCrmAccess } from './access'
import { logPlatformAccess } from './audit'
import { requirePlatformKey } from './auth'
import { okList, toPlatformErrorResponse } from './errors'
import { LIST_AUDIT, loadList, type ListResource } from './listas'
import { originOf } from './route-helpers'

export function listRoute(resource: ListResource) {
  return async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const ctx = await requirePlatformKey(request, 'dados:read')
      const { id } = await params
      const access = await resolveCrmAccess(ctx.admin, ctx.person, id)
      requireRows(access)
      const page = await loadList(ctx.admin, id, resource, request, originOf(request))
      await logPlatformAccess(ctx.admin, {
        person: ctx.person,
        access,
        action: LIST_AUDIT[resource],
        detalhe: page.detalhe,
      })
      return okList(page.items, page.nextCursor)
    } catch (err) {
      return toPlatformErrorResponse(err)
    }
  }
}
