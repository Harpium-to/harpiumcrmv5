"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";

// Whether this person sees the chance of closing on deal cards (Radar,
// 080): admins always; attendants unless Configurações › Radar hides it.
// One request per page load, shared by every card.
let cached: Promise<boolean> | null = null;

function loadShowToAgents(): Promise<boolean> {
  cached ??= fetch("/api/radar/settings", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((json: { settings?: { showChanceToAgents?: boolean } } | null) => json?.settings?.showChanceToAgents !== false)
    .catch(() => true);
  return cached;
}

export function useChanceVisible(): boolean {
  const { accountRole } = useAuth();
  const [agentsSee, setAgentsSee] = useState(true);
  useEffect(() => {
    if (accountRole !== "agent") return;
    let cancelled = false;
    void loadShowToAgents().then((v) => {
      if (!cancelled) setAgentsSee(v);
    });
    return () => {
      cancelled = true;
    };
  }, [accountRole]);
  return accountRole === "agent" ? agentsSee : true;
}
