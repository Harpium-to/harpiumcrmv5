"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import { AgendaView } from "@/components/agenda/agenda-view";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { createSupabaseAgendaStore } from "@/lib/agenda/store";
import { createClient } from "@/lib/supabase/client";

/**
 * The CRM's own agenda (migration 067): one per professional, with
 * opening hours, appointments and blocks. The screen itself lives in
 * `components/agenda`; this page only hands it the signed-in person's
 * CRM and what their role lets them do.
 */
export default function AgendaPage() {
  const { user, accountId } = useAuth();
  const canBook = useCan("send-messages");
  const canManage = useCan("edit-settings");

  const store = useMemo(
    () =>
      accountId
        ? createSupabaseAgendaStore(createClient(), accountId, user?.id ?? null)
        : null,
    [accountId, user?.id],
  );

  if (!store) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AgendaView
      // A switch of CRM starts the screen over instead of showing the
      // previous CRM's week for a moment.
      key={accountId}
      store={store}
      accountId={accountId}
      canBook={canBook}
      canManage={canManage}
    />
  );
}
