// ============================================================
// GET  /api/public/agenda/{token} — an agenda's free slots
// POST /api/public/agenda/{token} — book one  { start, name, phone }
//
// Behind the public booking page (/marcar/{token}). No login: the
// token is the credential, and it only opens an agenda whose link an
// admin turned on. What a visitor can see and do is decided in
// lib/agenda/public.ts; this file is the HTTP around it — per-IP
// limits, and answers that never say whether a token exists but is
// off (both are 404).
// ============================================================

import { after, NextResponse } from "next/server";

import { processGoogleCalendarSync } from "@/lib/agenda/google-sync";
import { processCalendarNotifications } from "@/lib/agenda/messages";
import {
  bookPublic,
  loadPublicCalendar,
  parsePublicBooking,
  publicSlots,
} from "@/lib/agenda/public";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// A fresh response each time: a Response's body can be sent only once.
const notFound = () =>
  NextResponse.json(
    { error: "Este link de agendamento não está disponível." },
    { status: 404 },
  );

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limit = checkRateLimit(
    `agenda-read:${clientIp(request)}`,
    RATE_LIMITS.publicAgendaRead,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  const admin = supabaseAdmin();
  const calendar = await loadPublicCalendar(admin, token);
  if (!calendar) return notFound();

  const slots = await publicSlots(admin, calendar, new Date());
  if (slots === null) {
    return NextResponse.json(
      { error: "Não consegui carregar os horários. Tente de novo." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      business: calendar.accountName,
      agenda: calendar.name,
      slotMinutes: calendar.slotMinutes,
      timezone: calendar.timezone,
      autoConfirm: calendar.autoConfirm,
      slots: slots.map((s) => ({ day: s.dayKey, start: s.start.toISOString() })),
    },
    // What is free changes with every booking.
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limit = checkRateLimit(
    `agenda-book:${clientIp(request)}`,
    RATE_LIMITS.publicAgendaBook,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  const admin = supabaseAdmin();
  const calendar = await loadPublicCalendar(admin, token);
  if (!calendar) return notFound();

  const parsed = parsePublicBooking(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const outcome = await bookPublic(admin, calendar, parsed.input, new Date());
  if (outcome.status === "booked" || outcome.status === "pending") {
    // Into the professional's Google Agenda, if this agenda writes there
    // (069) — after answering, so the customer does not wait on Google.
    const eventId = outcome.eventId;
    after(() => processGoogleCalendarSync(admin, { eventId }));
  }
  switch (outcome.status) {
    case "booked":
      // The agenda's own confirmation, if it has one turned on — now
      // rather than at the scheduler's next run.
      await processCalendarNotifications(admin, outcome.eventId);
      return NextResponse.json({ status: "booked", start: outcome.start.toISOString() });
    case "pending":
      return NextResponse.json({ status: "pending", start: outcome.start.toISOString() });
    case "unavailable":
      return NextResponse.json(
        { error: "Esse horário acabou de ser ocupado. Escolha outro, por favor." },
        { status: 409 },
      );
    case "limit":
      return NextResponse.json(
        {
          error:
            "Este número já tem horários marcados. Para marcar mais um, fale com a gente pelo WhatsApp.",
        },
        { status: 409 },
      );
    default:
      return NextResponse.json(
        { error: "Não consegui marcar agora. Tente de novo em instantes." },
        { status: 500 },
      );
  }
}
