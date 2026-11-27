"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * How many agent actions wait for a person's OK in the open CRM: the
 * badge on "Agentes de IA". It counts the rows the Aprovações tab lists
 * (status `pending`) and counts again whenever one changes —
 * `agent_approvals` is in the Realtime publication (045).
 *
 * `enabled: false` skips the query and the subscription, for menus
 * that do not show the agents at all.
 */
export function usePendingApprovals(
  accountId: string | null,
  enabled = true,
): number {
  const [count, setCount] = useState(0);
  const active = enabled && !!accountId;

  useEffect(() => {
    if (!active || !accountId) return;
    const supabase = createClient();
    let cancelled = false;

    const recount = async () => {
      const { count: pending, error } = await supabase
        .from("agent_approvals")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("status", "pending");
      if (!cancelled && !error) setCount(pending ?? 0);
    };
    void recount();

    const channel = supabase
      .channel(`pending-approvals-${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_approvals" },
        () => {
          void recount();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [active, accountId]);

  return active ? count : 0;
}
