import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadApprovals } from '@/lib/agents/approvals'
import type { ApprovalStatus } from '@/lib/agents/types'

const STATUSES: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired']

/**
 * GET /api/agents/approvals?status=pending
 *
 * The approvals queue. Defaults to pending — the list someone opens
 * this screen to act on.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams

    const statusParam = params.get('status')
    const status = statusParam
      ? statusParam
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is ApprovalStatus => (STATUSES as string[]).includes(s))
      : (['pending'] as ApprovalStatus[])

    const limitRaw = Number(params.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50

    const approvals = await loadApprovals(supabase, accountId, { status, limit })
    return NextResponse.json({ approvals })
  } catch (err) {
    return toErrorResponse(err)
  }
}
