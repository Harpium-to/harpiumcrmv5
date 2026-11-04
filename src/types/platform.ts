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

/** GET /api/account/agency-access */
export type AgencyAccessView =
  | { available: false }
  | {
      available: true
      level: 'metrics' | 'read' | 'full'
      tempLevel: 'read' | 'full' | null
      tempUntil: string | null
      effectiveLevel: 'metrics' | 'read' | 'full'
      pending: {
        id: string
        level: 'read' | 'full'
        tempHours: number | null
        reason: string | null
        createdAt: string
      } | null
      canDecide: boolean
      canSeeLog: boolean
      niche: string | null
      history: {
        level: string
        tempLevel: string | null
        tempUntil: string | null
        by: string
        at: string
      }[]
      activity: { at: string; action: string; by: string }[]
    }
