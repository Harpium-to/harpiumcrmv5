"use client";

import { useEffect, useState } from "react";

/** The active CRM as the server sees it (/api/account/context). */
export interface CrmContext {
  accountName: string;
  role: string;
  status: string;
  viaAgency: boolean;
}

// Requests in flight, per CRM. The banner and the rail both ask on the
// same render; they share one request. Nothing is kept once it lands,
// so a later mount still gets a fresh answer (a support grant can
// expire while the tab is open).
const inflight = new Map<string, Promise<CrmContext | null>>();

function fetchContext(accountId: string): Promise<CrmContext | null> {
  const pending = inflight.get(accountId);
  if (pending) return pending;
  const request = fetch("/api/account/context", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<CrmContext>) : null))
    .catch(() => null)
    .finally(() => inflight.delete(accountId));
  inflight.set(accountId, request);
  return request;
}

/**
 * The open CRM from the server's side: the effective role, its status
 * and whether the caller came in through the agency. The profile mirror
 * in `useAuth` cannot tell support mode apart, so anything that must
 * be right about it asks here. Null until the answer arrives.
 */
export function useCrmContext(accountId: string | null): CrmContext | null {
  const [ctx, setCtx] = useState<CrmContext | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void fetchContext(accountId).then((next) => {
      if (!cancelled) setCtx(next);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return ctx;
}
