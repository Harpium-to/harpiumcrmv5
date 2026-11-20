"use client";

import { useEffect, useSyncExternalStore } from "react";

import { fetchAccountMembers } from "@/lib/account/members";
import type { Team } from "@/lib/atendimento/setores";
import type { AccountMember } from "@/types";

// ============================================================
// The CRM's setores and people, shared by the inbox (filters, the
// "Transferir" dialog, the timeline) and the settings screen. One
// fetch per page load; `reload()` after a change refreshes everyone.
// ============================================================

interface Snapshot<T> {
  data: T;
  loaded: boolean;
}

function createStore<T>(initial: T, load: () => Promise<T>) {
  let snapshot: Snapshot<T> = { data: initial, loaded: false };
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((l) => l());

  const reload = (): Promise<void> => {
    inflight = load()
      .then((data) => {
        snapshot = { data, loaded: true };
      })
      .catch(() => {
        snapshot = { ...snapshot, loaded: true };
      })
      .finally(() => {
        inflight = null;
        emit();
      });
    return inflight;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => snapshot,
    ensure() {
      if (!snapshot.loaded && !inflight) void reload();
    },
    reload,
  };
}

const teamsStore = createStore<Team[]>([], async () => {
  const res = await fetch("/api/teams", { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { teams?: Team[] };
  return json.teams ?? [];
});

const membersStore = createStore<AccountMember[]>([], fetchAccountMembers);

const EMPTY_TEAMS: Snapshot<Team[]> = { data: [], loaded: false };
const EMPTY_MEMBERS: Snapshot<AccountMember[]> = { data: [], loaded: false };

/** The CRM's setores (active and inactive), with their people. */
export function useTeams() {
  const snap = useSyncExternalStore(teamsStore.subscribe, teamsStore.get, () => EMPTY_TEAMS);
  useEffect(() => teamsStore.ensure(), []);
  return { teams: snap.data, loaded: snap.loaded, reload: teamsStore.reload };
}

/** The CRM's people (account_members), with "Recebe conversas". */
export function useMembers() {
  const snap = useSyncExternalStore(membersStore.subscribe, membersStore.get, () => EMPTY_MEMBERS);
  useEffect(() => membersStore.ensure(), []);
  return { members: snap.data, loaded: snap.loaded, reload: membersStore.reload };
}

/** Initials for an avatar chip: "Maria Souza" → "MS". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}
