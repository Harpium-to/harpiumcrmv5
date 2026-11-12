"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useNow } from "@/hooks/use-now";
import { waitInfo } from "@/lib/inbox/handoff-wait";

/**
 * Conversations the AI handed to the team that nobody has answered
 * yet (`needs_human_since`, migration 058), for every screen: the
 * floating alert, the menu badge and the browser tab title. The inbox
 * list reads the same column from its own data.
 *
 * One provider for the whole dashboard so there is a single realtime
 * channel, and so a new handoff is announced once (a toast) wherever
 * the person is. Before 058 the column doesn't exist: the first query
 * fails and everything stays empty.
 */

export interface WaitingConversation {
  id: string;
  since: string;
  contactName: string | null;
  assignedAgentId: string | null;
}

interface WaitingState {
  /** Longest wait first. */
  items: WaitingConversation[];
  lateCount: number;
  now: number;
}

const WaitingContext = createContext<WaitingState>({ items: [], lateCount: 0, now: 0 });

export function useWaitingConversations(): WaitingState {
  return useContext(WaitingContext);
}

interface Row {
  id: string;
  contact_id?: string | null;
  needs_human_since?: string | null;
  assigned_agent_id?: string | null;
  contact?: { name?: string | null; phone?: string | null } | null;
}

function contactLabel(c: Row["contact"]): string | null {
  return c?.name?.trim() || c?.phone || null;
}

export function WaitingConversationsProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Handoff");
  const router = useRouter();
  const pathname = usePathname();
  const now = useNow(30_000);
  const [map, setMap] = useState<Map<string, WaitingConversation>>(new Map());
  // Mirror for the realtime callback, which must know synchronously
  // whether a conversation was already waiting (to announce new ones).
  const known = useRef<Map<string, WaitingConversation>>(new Map());
  // The toast's action depends on where the person is.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let loaded = false;

    const commit = (next: Map<string, WaitingConversation>) => {
      known.current = next;
      setMap(next);
    };

    const announce = (item: WaitingConversation) => {
      const onInbox = pathnameRef.current?.startsWith("/inbox");
      toast.warning(tRef.current("toastTitle", { name: item.contactName ?? tRef.current("someone") }), {
        description: tRef.current("toastBody"),
        duration: 10_000,
        action: onInbox
          ? undefined
          : {
              label: tRef.current("open"),
              onClick: () => router.push(`/inbox?c=${item.id}`),
            },
      });
    };

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, needs_human_since, assigned_agent_id, contact:contacts(name, phone)")
        .not("needs_human_since", "is", null);
      if (cancelled) return;
      loaded = true;
      if (error || !data) return; // before 058, or a transient failure
      const next = new Map<string, WaitingConversation>();
      for (const row of data as Row[]) {
        if (!row.needs_human_since) continue;
        next.set(row.id, {
          id: row.id,
          since: row.needs_human_since,
          contactName: contactLabel(row.contact),
          assignedAgentId: row.assigned_agent_id ?? null,
        });
      }
      commit(next);
    })();

    const channel = supabase
      .channel("waiting-conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const prev = known.current;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as Row).id;
            if (id && prev.has(id)) {
              const next = new Map(prev);
              next.delete(id);
              commit(next);
            }
            return;
          }
          const row = payload.new as Row;
          const existing = prev.get(row.id);
          if (!row.needs_human_since) {
            if (existing) {
              const next = new Map(prev);
              next.delete(row.id);
              commit(next);
            }
            return;
          }
          const item: WaitingConversation = {
            id: row.id,
            since: row.needs_human_since,
            contactName: existing?.contactName ?? null,
            assignedAgentId: row.assigned_agent_id ?? null,
          };
          if (
            existing &&
            existing.since === item.since &&
            existing.assignedAgentId === item.assignedAgentId
          ) {
            return; // a new message on a conversation already waiting
          }
          const next = new Map(prev);
          next.set(row.id, item);
          commit(next);
          if (existing || !loaded) return;
          // A new handoff: look up who it is, then tell the person.
          (async () => {
            let name: string | null = null;
            if (row.contact_id) {
              const { data } = await supabase
                .from("contacts")
                .select("name, phone")
                .eq("id", row.contact_id)
                .maybeSingle();
              name = contactLabel(data as Row["contact"]);
            }
            if (cancelled) return;
            const current = known.current.get(row.id);
            if (!current) return; // answered in the meantime
            if (name) {
              const withName = new Map(known.current);
              withName.set(row.id, { ...current, contactName: name });
              commit(withName);
            }
            announce({ ...current, contactName: name });
          })();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [router]);

  const value = useMemo<WaitingState>(() => {
    const items = Array.from(map.values()).sort(
      (a, b) => Date.parse(a.since) - Date.parse(b.since),
    );
    const lateCount = items.filter((i) => waitInfo(i.since, now).late).length;
    return { items, lateCount, now };
  }, [map, now]);

  // "(2) Harpium CRM" in the tab, so it shows from another tab too.
  const count = value.items.length;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }, [count, pathname, now]);

  return <WaitingContext.Provider value={value}>{children}</WaitingContext.Provider>;
}
