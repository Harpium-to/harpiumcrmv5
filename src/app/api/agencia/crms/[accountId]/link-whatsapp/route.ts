// ============================================================
// /api/agencia/crms/<accountId>/link-whatsapp — the WhatsApp connect
// link from the agency console (Fase A, migration 081).
//
// Who: a super_admin, or the manager whose portfolio has the CRM — the
// same people who edit it in the console. An archived CRM gets no new
// link. Answers in lib/whatsapp/connect-link-api.ts.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { loadAccountRows } from '@/lib/agencia/crms'
import { ForbiddenError, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  cancelConnectLinks,
  connectLinkStatus,
  newConnectLink,
} from '@/lib/whatsapp/connect-link-api'

const UUID = /^[0-9a-f-]{36}$/i

async function gate(params: Promise<{ accountId: string }>) {
  const { admin, userId, role } = await requireAgencia('manager')
  const { accountId } = await params
  if (!UUID.test(accountId)) throw new ForbiddenError('CRM inválido.')
  const [crm] = await loadAccountRows(admin, accountId)
  if (!crm) return { admin, userId, accountId, crm: null }
  if (role !== 'super_admin' && crm.manager_user_id !== userId) {
    throw new ForbiddenError('Só quem gerencia este CRM pode mandar o link.')
  }
  return { admin, userId, accountId, crm }
}

type Ctx = { params: Promise<{ accountId: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { admin, accountId, crm } = await gate(params)
    if (!crm) return NextResponse.json({ error: 'CRM não encontrado.' }, { status: 404 })
    return await connectLinkStatus(admin, accountId)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { admin, userId, accountId, crm } = await gate(params)
    if (!crm) return NextResponse.json({ error: 'CRM não encontrado.' }, { status: 404 })
    if (crm.status === 'archived') {
      return NextResponse.json({ error: 'CRM arquivado não recebe conexão nova.' }, { status: 409 })
    }
    const limit = checkRateLimit(`agencia:waConnectLink:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    return await newConnectLink(request, admin, {
      accountId,
      userId,
      via: 'agencia',
      crmName: crm.name,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { admin, accountId, crm } = await gate(params)
    if (!crm) return NextResponse.json({ error: 'CRM não encontrado.' }, { status: 404 })
    return await cancelConnectLinks(admin, accountId)
  } catch (err) {
    return toErrorResponse(err)
  }
}
