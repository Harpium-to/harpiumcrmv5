// ============================================================
// POST /api/agenda/notify  { eventId }
//
// The Agenda screen calls this right after booking or moving an
// appointment, so the customer's confirmation leaves at once instead
// of waiting for the scheduler's next run (which stays the safety net,
// and is the only sender of reminders).
//
// It decides nothing: whether a message is due is the database's rule
// (claim_calendar_notifications, migration 067), which also makes sure
// each one goes once however many times this is called. Agents and
// above, and only for an appointment of their own CRM.
// ============================================================

import { NextResponse } from "next/server";

import { processCalendarNotifications } from "@/lib/agenda/messages";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as { eventId?: unknown } | null;
    const eventId = typeof body?.eventId === "string" ? body.eventId : "";
    if (!UUID.test(eventId)) {
      return NextResponse.json({ error: "'eventId' inválido" }, { status: 400 });
    }

    // Through RLS: only an appointment of the caller's active CRM is
    // found, so the service-role claim below cannot be pointed at
    // another CRM's agenda.
    const { data: event } = await ctx.supabase
      .from("calendar_events")
      .select("id")
      .eq("id", eventId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 });
    }

    const result = await processCalendarNotifications(supabaseAdmin(), eventId);
    return NextResponse.json({ sent: result?.sent ?? 0, failed: result?.failed ?? 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
