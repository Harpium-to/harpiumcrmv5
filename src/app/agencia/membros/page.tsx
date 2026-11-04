'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Trash2,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AGENCIA_ROLES,
  AGENCIA_ROLE_DESCRIPTION,
  AGENCIA_ROLE_LABEL,
  isAgenciaRole,
  type AgenciaRole,
} from '@/lib/agencia/roles';

interface Member {
  userId: string;
  email: string | null;
  name: string | null;
  label: string | null;
  role: AgenciaRole;
  createdAt: string;
  isSelf: boolean;
}

// Most privileged first in the pickers.
const ROLE_OPTIONS = [...AGENCIA_ROLES].reverse();

function RolePicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: AgenciaRole;
  onChange: (role: AgenciaRole) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (isAgenciaRole(v)) onChange(v);
      }}
    >
      <SelectTrigger
        className={`border-border bg-muted text-foreground ${className ?? ''}`}
        disabled={disabled}
      >
        <SelectValue>
          {(v: string) => (isAgenciaRole(v) ? AGENCIA_ROLE_LABEL[v] : v)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((r) => (
          <SelectItem key={r} value={r}>
            {AGENCIA_ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function AgenciaMembrosPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<AgenciaRole>('support');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agencia/membros');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao carregar membros');
      setMembers(json.members);
      setCanManage(json.canManage === true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao carregar membros'
      );
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
      const res = await fetch('/api/agencia/membros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          label: label.trim() || undefined,
          role,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao adicionar membro');
      toast.success('Membro adicionado.');
      setEmail('');
      setLabel('');
      setRole('support');
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao adicionar membro'
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (m: Member, next: AgenciaRole) => {
    if (next === m.role) return;
    setChangingId(m.userId);
    try {
      const res = await fetch('/api/agencia/membros', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.userId, role: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao mudar o papel');
      toast.success(`Papel alterado para ${AGENCIA_ROLE_LABEL[next]}.`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao mudar o papel'
      );
    } finally {
      setChangingId(null);
    }
  };

  const handleRemove = async (m: Member) => {
    setRemovingId(m.userId);
    try {
      const res = await fetch(
        `/api/agencia/membros?userId=${encodeURIComponent(m.userId)}`,
        {
          method: 'DELETE',
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao remover membro');
      toast.success('Membro removido.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao remover membro'
      );
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/agencia"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Todas as contas
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Membros da agência</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A equipe da Harpium que administra a plataforma. Dentro do CRM de cada
          cliente, ninguém daqui passa do nível de acesso que o dono daquele CRM
          liberou.
        </p>
      </div>

      {/* Roles legend */}
      <ul className="grid gap-2 sm:grid-cols-3">
        {ROLE_OPTIONS.map((r) => (
          <li key={r} className="border-border bg-card rounded-xl border p-3">
            <p className="text-sm font-medium">{AGENCIA_ROLE_LABEL[r]}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {AGENCIA_ROLE_DESCRIPTION[r]}
            </p>
          </li>
        ))}
      </ul>

      {!canManage && members !== null && (
        <p className="border-border bg-card text-muted-foreground rounded-xl border px-4 py-3 text-sm">
          Só um super admin adiciona, remove ou muda o papel de alguém da
          equipe.
        </p>
      )}

      {/* Add member */}
      {canManage && (
        <form
          onSubmit={handleAdd}
          className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-end"
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
              className="border-border bg-muted mt-1"
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
              className="border-border bg-muted mt-1"
            />
          </div>
          <div>
            <Label className="text-muted-foreground">Papel</Label>
            <RolePicker value={role} onChange={setRole} className="mt-1 w-36" />
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
      )}
      {canManage && (
        <p className="text-muted-foreground -mt-3 text-xs">
          A pessoa precisa já ter uma conta no sistema. Começa como Suporte, a
          menos que você escolha outro papel.
        </p>
      )}

      {/* Members list */}
      <div className="border-border bg-card overflow-hidden rounded-xl border">
        {members === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            Nenhum membro ainda.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-primary/10 flex h-9 w-9 items-center justify-center rounded-full">
                    <ShieldCheck className="text-primary h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {m.label ?? m.name ?? m.email ?? m.userId}
                      {m.isSelf && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          (você)
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {m.email ?? 'sem email'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && !m.isSelf ? (
                    <RolePicker
                      value={m.role}
                      onChange={(next) => handleRoleChange(m, next)}
                      disabled={changingId === m.userId}
                      className="w-36"
                    />
                  ) : (
                    <span className="border-border text-muted-foreground rounded-md border px-2.5 py-1 text-xs font-medium">
                      {AGENCIA_ROLE_LABEL[m.role]}
                    </span>
                  )}
                  {canManage && !m.isSelf && (
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
