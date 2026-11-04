// Shapes the platform endpoints return to the browser (049 / 050).

import type { AccountRole } from '@/lib/auth/roles'
import type { CrmStatus } from '@/lib/agencia/crm'

/** GET /api/account/mine */
export interface MyAccount {
  id: string
  name: string
  role: AccountRole
  status: CrmStatus
  active: boolean
}

/** GET /api/invitations/mine */
export interface MyInvitation {
  id: string
  accountName: string
  role: string
  expiresAt: string
  agencyLevel: string | null
}
