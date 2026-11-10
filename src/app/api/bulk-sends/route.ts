import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { BULK_DAILY_LIMIT, dayKey } from '@/lib/bulk/plan';
import {
  BulkError,
  bulkAvailability,
  createBulkSend,
  listBulkSends,
  parseBulkInput,
} from '@/lib/bulk/sends';

// Bulk sends through the QR-code number (migration 065, Fase 8).
//
// GET  — whether this CRM can, today's count against the limit, and the
//        latest bulk sends with how far each got. Any member.
// POST — plan one (`dry_run: true`: how many, from when to when) or
//        start it. Admins only; starting needs `risk_accepted`.

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const availability = await bulkAvailability(supabaseAdmin(), accountId);
    let items: Awaited<ReturnType<typeof listBulkSends>> = [];
    let unavailable: string | null = null;
    try {
      items = await listBulkSends(supabase, accountId);
    } catch (err) {
      if (err instanceof BulkError && err.code === 'unavailable') unavailable = err.message;
      else throw err;
    }
    const today = dayKey(Date.now());
    const { data } = await supabase
      .from('scheduled_messages')
      .select('send_at')
      .eq('account_id', accountId)
      .not('bulk_send_id', 'is', null)
      .in('status', ['scheduled', 'sending', 'sent'])
      .gte('send_at', new Date(Date.parse(`${today}T00:00:00-03:00`)).toISOString());
    const usedToday = ((data ?? []) as { send_at: string }[]).filter(
      (r) => dayKey(Date.parse(r.send_at)) === today,
    ).length;
    return NextResponse.json({
      ...availability,
      ...(unavailable ? { available: false, reason: unavailable } : {}),
      limit: BULK_DAILY_LIMIT,
      used_today: usedToday,
      items,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const body = await request.json().catch(() => null);
    const input = parseBulkInput(body);
    const dryRun = (body as { dry_run?: unknown } | null)?.dry_run === true;
    const result = await createBulkSend(supabase, supabaseAdmin(), accountId, userId, input, { dryRun });
    return NextResponse.json(result, { status: dryRun ? 200 : 201 });
  } catch (err) {
    if (err instanceof BulkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}
