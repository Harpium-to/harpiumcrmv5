// ============================================================
// GET /api/agenda/feed/{token} — an agenda as an iCalendar feed
//
// What Google Agenda, Apple Calendar and Outlook fetch when someone
// follows the agenda "by URL" (see lib/agenda/ics.ts). No login: those
// apps cannot sign in, so the token in the address is the credential.
// It names appointments' contacts, which is why it is a separate,
// secret token and not the public booking one — and why it only works
// while an admin has the feed turned on.
// ============================================================

import { buildIcs, type IcsEvent } from "@/lib/agenda/ics";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const TOKEN = /^[0-9a-f]{64}$/;
/** How much of the agenda the feed carries, either side of today. */
const DAYS_BACK = 30;
const DAYS_AHEAD = 180;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const limit = checkRateLimit(`agenda-feed:${ip}`, RATE_LIMITS.publicAgendaRead);
  if (!limit.success) return rateLimitResponse(limit);

  // Calendar apps append ".ics" or not as they please.
  const token = (await params).token.replace(/\.ics$/i, "");
  if (!TOKEN.test(token)) return new Response("Not found", { status: 404 });

  const admin = supabaseAdmin();
  const { data: calendar } = await admin
    .from("calendars")
    .select("id, name, timezone")
    .eq("feed_token", token)
    .eq("feed_enabled", true)
    .maybeSingle();
  if (!calendar) return new Response("Not found", { status: 404 });

  const now = new Date();
  const { data: events, error } = await admin
    .from("calendar_events")
    .select(
      "id, kind, title, notes, starts_at, ends_at, status, updated_at, contact:contacts(name, phone)",
    )
    .eq("calendar_id", (calendar as { id: string }).id)
    .gt("ends_at", new Date(now.getTime() - DAYS_BACK * 86_400_000).toISOString())
    .lt("starts_at", new Date(now.getTime() + DAYS_AHEAD * 86_400_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(2000);
  if (error) return new Response("Unavailable", { status: 503 });

  return new Response(
    buildIcs({
      calendar: calendar as { id: string; name: string; timezone: string },
      events: (events ?? []) as unknown as IcsEvent[],
      now,
    }),
    {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="agenda.ics"',
        // Private data behind a secret URL: nothing in between keeps it.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
