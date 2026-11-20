'use client';

// ============================================================
// /agencia/integracoes — platform keys for the agency's internal
// system (Agency OS). Super admin only (the API refuses everyone
// else; the page shows that refusal instead of a blank list).
//
// A key is shown ONCE at creation. It only reads: configuring and
// operating a CRM keeps happening inside the CRM.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Plug, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PLATFORM_SCOPES,
  PLATFORM_SCOPE_LABEL,
  type PlatformScope,
} from '@/lib/plataforma/scopes';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: PlatformScope[];
  createdByEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function when(iso: string | null): string {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AgenciaIntegracoesPage() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);
  const [name, setName] = useState('Agency OS');
  const [scopes, setScopes] = useState<PlatformScope[]>([...PLATFORM_SCOPES]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; plaintext: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agencia/integracoes');
      const json = await res.json();
      if (res.status === 403) {
        setDenied(json.error ?? 'Só um super admin gerencia as integrações.');
        setKeys([]);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? 'Falha ao carregar as chaves');
      setAvailable(json.available !== false);
      setKeys(json.keys ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar as chaves');
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleScope = (s: PlatformScope, on: boolean) => {
    setScopes((prev) =>
      PLATFORM_SCOPES.filter((x) => (x === s ? on : prev.includes(x))),
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/agencia/integracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao gerar a chave');
      setCreated({ name: name.trim(), plaintext: json.key.plaintext });
      setCopied(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar a chave');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.plaintext);
      setCopied(true);
      toast.success('Chave copiada.');
    } catch {
      toast.error('Não consegui copiar. Selecione e copie à mão.');
    }
  };

  const handleRevoke = async (k: KeyRow) => {
    if (
      !window.confirm(
        `Revogar a chave "${k.name}"? O sistema que usa esta chave para de ler o CRM na hora.`,
      )
    ) {
      return;
    }
    setRevokingId(k.id);
    try {
      const res = await fetch(`/api/agencia/integracoes/${k.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao revogar');
      toast.success('Chave revogada.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao revogar');
    } finally {
      setRevokingId(null);
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
        <h1 className="mt-2 text-2xl font-bold">Integrações</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Chaves para o sistema interno da agência (Agency OS) ver os CRMs: os números da
          operação, as listas e o botão que abre o CRM no lugar certo. A chave só lê. Cada
          consulta diz quem está olhando, e o CRM aplica as regras dessa pessoa, inclusive o
          nível de acesso que cada cliente liberou. As leituras da agência aparecem na
          auditoria do dono do CRM.
        </p>
      </div>

      {denied && (
        <p className="border-border bg-card text-muted-foreground rounded-xl border px-4 py-3 text-sm">
          {denied}
        </p>
      )}

      {!available && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          Falta aplicar a migration 075 no banco para usar as integrações.
        </p>
      )}

      {created && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold">Chave &quot;{created.name}&quot; criada</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Copie agora: ela não aparece de novo. No Agency OS, cole em Integrações → Harpium
            CRM, junto com o endereço deste CRM.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="border-border bg-card block flex-1 overflow-x-auto rounded-lg border px-3 py-2 text-xs break-all">
              {created.plaintext}
            </code>
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copiada' : 'Copiar'}
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Endereço do CRM:{' '}
            <code>{typeof window === 'undefined' ? '' : window.location.origin}</code>
          </p>
        </div>
      )}

      {!denied && available && (
        <form onSubmit={handleCreate} className="border-border bg-card space-y-4 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Plug className="h-4 w-4" />
            Nova chave da plataforma
          </div>
          <div className="max-w-sm">
            <Label htmlFor="nome" className="text-muted-foreground">
              Nome (de onde ela vai ser usada)
            </Label>
            <Input
              id="nome"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="border-border bg-muted mt-1"
              required
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-muted-foreground text-sm">O que ela pode ler</legend>
            {PLATFORM_SCOPES.map((s) => (
              <label key={s} className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={scopes.includes(s)}
                  onCheckedChange={(v) => toggleScope(s, v === true)}
                />
                <span>
                  {PLATFORM_SCOPE_LABEL[s]}{' '}
                  <code className="text-muted-foreground text-xs">{s}</code>
                </span>
              </label>
            ))}
          </fieldset>
          <Button
            type="submit"
            disabled={creating || !name.trim() || scopes.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Gerar chave
          </Button>
        </form>
      )}

      <div className="border-border bg-card overflow-hidden rounded-xl border">
        {keys === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            Nenhuma chave ainda.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {k.name}{' '}
                    <code className="text-muted-foreground text-xs">{k.prefix}…</code>
                    {k.revokedAt && (
                      <span className="ml-2 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 dark:text-red-400">
                        revogada
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {k.scopes.join(' · ') || 'sem permissões'} · criada {when(k.createdAt)}
                    {k.createdByEmail ? ` por ${k.createdByEmail}` : ''} · último uso{' '}
                    {when(k.lastUsedAt)}
                    {k.revokedAt ? ` · revogada ${when(k.revokedAt)}` : ''}
                  </p>
                </div>
                {!k.revokedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(k)}
                    disabled={revokingId === k.id}
                    className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                  >
                    {revokingId === k.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Revogar
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
