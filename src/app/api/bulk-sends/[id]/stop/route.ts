import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { BulkError, stopBulkSend } from '@/lib/bulk/sends';

// POST /api/bulk-sends/{id}/stop — cancel what a bulk send still had to
// send (admins). What already went, went.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;
    return NextResponse.json(await stopBulkSend(supabase, accountId, id));
  } catch (err) {
    if (err instanceof BulkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}
