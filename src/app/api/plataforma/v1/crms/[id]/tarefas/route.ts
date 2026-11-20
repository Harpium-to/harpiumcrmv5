// GET /api/plataforma/v1/crms/{id}/tarefas — scope dados:read, Leitura or
// membership. See src/lib/plataforma/listas.ts for filters and shape.

import { listRoute } from '@/lib/plataforma/list-route'

export const dynamic = 'force-dynamic'

export const GET = listRoute('tarefas')
