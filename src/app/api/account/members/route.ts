// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's active CRM. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Source of truth
//   Since migration 049 membership lives in `account_members` (a user
//   can belong to several CRMs; `profiles.account_id` is only the one
//   they are looking at right now). Reading profiles by account_id
//   would drop a teammate who is currently in another CRM. Before 049
//   is applied the table doesn't exist and we read profiles as before.
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { isMissingTable } from "@/lib/auth/account-context";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface MemberRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await loadMembers(ctx.supabase, ctx.accountId);
    if (rows === null) {
      return NextResponse.json(
        { error: "Falha ao carregar os membros" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = rows.flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.role,
          joined_at: row.joined_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}

type Client = Awaited<ReturnType<typeof getCurrentAccount>>["supabase"];

/** Roster of `accountId`, oldest member first. null on a read error. */
async function loadMembers(
  supabase: Client,
  accountId: string,
): Promise<MemberRow[] | null> {
  const { data: memberships, error } = await supabase
    .from("account_members")
    .select("user_id, role, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });

  if (error && isMissingTable(error)) {
    return loadMembersFromProfiles(supabase, accountId);
  }
  if (error) {
    console.error("[GET /api/account/members] memberships error:", error);
    return null;
  }

  const ids = (memberships ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];

  // RLS on profiles (049) exposes everyone who is a member of the
  // caller's active CRM, so this is naturally scoped.
  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, avatar_url")
    .in("user_id", ids);
  if (profErr) {
    console.error("[GET /api/account/members] profiles error:", profErr);
    return null;
  }

  const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  return (memberships ?? []).map((m) => {
    const p = byUser.get(m.user_id);
    return {
      user_id: m.user_id,
      full_name: p?.full_name ?? null,
      email: p?.email ?? null,
      avatar_url: p?.avatar_url ?? null,
      role: m.role,
      joined_at: m.created_at,
    };
  });
}

/** Pre-049: one account per user, so profiles.account_id is the roster. */
async function loadMembersFromProfiles(
  supabase: Client,
  accountId: string,
): Promise<MemberRow[] | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, avatar_url, account_role, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[GET /api/account/members] fetch error:", error);
    return null;
  }
  return (data ?? []).map((p) => ({
    user_id: p.user_id,
    full_name: p.full_name,
    email: p.email,
    avatar_url: p.avatar_url,
    role: p.account_role,
    joined_at: p.created_at,
  }));
}
