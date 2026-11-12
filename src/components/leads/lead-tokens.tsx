"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Copy, KeyRound, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface NamedToken {
  id: string;
  name: string;
  token: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function when(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One URL per origin ("Quiz planejados", "Google Ads", "Zapier"). If one
 * leaks, revoke just that one. Leads sent without an origin take the
 * token's name as their origin.
 */
export function LeadTokens({ canManage }: { canManage: boolean }) {
  const [tokens, setTokens] = useState<NamedToken[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/tokens");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar os tokens");
      setAvailable(json.available !== false);
      setTokens(json.tokens ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar os tokens");
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const urlOf = (token: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/api/leads/ingest/${token}`;

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(urlOf(token));
      toast.success("URL copiada");
    } catch {
      toast.error("Não foi possível copiar — copie manualmente");
    }
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy("create");
    try {
      const res = await fetch("/api/leads/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao criar o token");
      setName("");
      toast.success(`URL "${json.token.name}" criada`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar o token");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (t: NamedToken) => {
    if (!window.confirm(`Revogar a URL "${t.name}"? Quem envia por ela passa a receber erro 401.`)) return;
    setBusy(t.id);
    try {
      const res = await fetch(`/api/leads/tokens?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao revogar");
      toast.success(`URL "${t.name}" revogada`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao revogar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Uma URL por origem</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Crie uma URL para cada origem (quiz, Google Ads, Zapier). Se uma vazar, revogue só
        ela. Lead que chega sem <code className="font-mono">origem</code> recebe o nome da
        URL como origem.
      </p>

      {!available ? (
        <p className="text-xs text-amber-500">
          Disponível depois que a migration 068 for aplicada no banco. A URL principal acima
          continua funcionando.
        </p>
      ) : (
        <>
          {tokens === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : tokens.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{t.name}</span>
                  {t.revoked_at ? (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                      revogada
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      último envio: {when(t.last_used_at)}
                    </span>
                  )}
                  <span className="ml-auto flex gap-1">
                    {!t.revoked_at && (
                      <Button type="button" variant="outline" size="sm" onClick={() => void copy(t.token)}>
                        <Copy className="h-4 w-4" />
                        Copiar URL
                      </Button>
                    )}
                    {canManage && !t.revoked_at && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void revoke(t)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                        Revogar
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma URL por origem ainda.</p>
          )}

          {canManage && (
            <div className="flex max-w-md gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void create();
                  }
                }}
                placeholder="Nome da origem (ex.: Quiz planejados)"
                maxLength={80}
                className="border-border bg-muted"
              />
              <Button
                type="button"
                onClick={() => void create()}
                disabled={busy !== null || !name.trim()}
                className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Criar URL
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
