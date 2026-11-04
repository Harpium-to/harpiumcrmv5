// ============================================================
// Pure helpers for the account context — no I/O, unit-testable.
//
// Migration 049 moved "which CRM is this request about, and with what
// role" into the database: `current_account_context()` returns the
// caller's ACTIVE CRM and their effective role in it, whether that
// role comes from a membership or from the agency consent the CRM's
// owner granted. The server trusts that answer, not the
// `profiles.account_role` mirror (which can't follow a temporary
// agency grant expiring).
// ============================================================

import { isAccountRole, type AccountRole } from "./roles";

export interface ResolvedAccount {
  accountId: string;
  role: AccountRole;
  account: { id: string; name: string };
  /** True when access comes from the agency consent, not a membership. */
  viaAgency: boolean;
}

/**
 * Narrow the JSON returned by `current_account_context()`. Returns
 * null for "no active CRM" (the RPC returns SQL NULL) and for any
 * shape this code doesn't understand — the caller treats both as
 * "can't scope this user", never as a guessed role.
 */
export function parseAccountContext(value: unknown): ResolvedAccount | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.account_id !== "string" || v.account_id === "") return null;
  if (!isAccountRole(v.role)) return null;
  return {
    accountId: v.account_id,
    role: v.role,
    account: {
      id: v.account_id,
      name: typeof v.account_name === "string" ? v.account_name : "",
    },
    viaAgency: v.via_agency === true,
  };
}

/**
 * PostgREST / Postgres "function does not exist" — the migration that
 * creates it hasn't been applied yet, so the caller should fall back
 * to the previous behaviour instead of failing.
 */
export function isMissingFunction(error: { code?: string } | null): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883");
}

/** Same idea for a table that doesn't exist yet. */
export function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === "PGRST205" || error.code === "42P01");
}
