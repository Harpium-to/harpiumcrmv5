// DELETE /api/agencia/integracoes/{id} — revoke a platform key (super_admin).
// Effective on the key's next request; the row stays as history.

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'
import { isUuid } from '@/lib/plataforma/access'
import { revokePlatformKey } from '@/lib/plataforma/store'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { admin } = await requireAgencia('super_admin')
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Chave não encontrada.' }, { status: 404 })
    const revoked = await revokePlatformKey(admin, id)
    if (!revoked) {
      return NextResponse.json({ error: 'Chave não encontrada ou já revogada.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
