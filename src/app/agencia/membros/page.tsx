"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2, UserPlus, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Member {
  userId: string;
  email: string | null;
  name: string | null;
  label: string | null;
  createdAt: string;
  isSelf: boolean;
}

export default function AgenciaMembrosPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agencia/membros");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar membros");
      setMembers(json.members);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar membros");
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/agencia/membros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), label: label.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao adicionar membro");
      toast.success("Membro adicionado.");
      setEmail("");
      setLabel("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao adicionar membro");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (m: Member) => {
    setRemovingId(m.userId);
    try {
      const res = await fetch(`/api/agencia/membros?userId=${encodeURIComponent(m.userId)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao remover membro");
      toast.success("Membro removido.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover membro");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/agencia"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Todas as contas
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Membros da agência</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operadores com acesso à super-visão de todas as contas.
        </p>
      </div>

      {/* Add member */}
      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <Label htmlFor="email" className="text-muted-foreground">
            Email da pessoa
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="pessoa@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 border-border bg-muted"
          />
        </div>
        <div className="flex-1">
          <Label htmlFor="label" className="text-muted-foreground">
            Rótulo <span className="text-xs">(opcional)</span>
          </Label>
          <Input
            id="label"
            placeholder="ex.: João — sócio"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 border-border bg-muted"
          />
        </div>
        <Button
          type="submit"
          disabled={adding}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Adicionar
        </Button>
      </form>
      <p className="-mt-3 text-xs text-muted-foreground">
        A pessoa precisa já ter uma conta no sistema. Ela passa a enxergar e
        analisar todas as contas.
      </p>

      {/* Members list */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {members === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum membro ainda.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {m.label ?? m.name ?? m.email ?? m.userId}
                      {m.isSelf && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (você)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.email ?? "sem email"}
                    </p>
                  </div>
                </div>
                {!m.isSelf && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removingId === m.userId}
                    onClick={() => handleRemove(m)}
                    className="text-muted-foreground hover:text-red-400"
                  >
                    {removingId === m.userId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
