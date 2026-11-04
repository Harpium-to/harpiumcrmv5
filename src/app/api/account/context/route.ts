// ============================================================
// GET /api/account/context — the active CRM as the server sees it:
// name, effective role, lifecycle status and whether the caller is
// here through the agency (support mode). The client's AuthProvider
// only has the profile mirror; banners that must be right ask here.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    return NextResponse.json({
      accountId: ctx.accountId,
      accountName: ctx.account.name,
      role: ctx.role,
      status: ctx.status,
      viaAgency: ctx.viaAgency,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
