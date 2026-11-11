'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

export interface PickedContact {
  id: string;
  name: string | null;
  phone: string | null;
}

/**
 * Characters that mean something to PostgREST's `or=(…)` filter or to
 * LIKE. A name never needs them, and letting them through would turn a
 * search box into a way to rewrite the filter.
 */
export function cleanSearchTerm(raw: string): string {
  return raw.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function contactLine(contact: PickedContact): string {
  const name = contact.name?.trim();
  if (name && contact.phone) return `${name} · ${contact.phone}`;
  return name || contact.phone || 'Contato sem nome';
}

/**
 * Pick one of the CRM's contacts by name or phone. Reads through RLS,
 * so it only ever lists the active CRM's contacts.
 */
export function ContactPicker({
  accountId,
  value,
  onChange,
  disabled,
}: {
  accountId: string | null;
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  disabled?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PickedContact[] | null>(null);
  const [searching, setSearching] = useState(false);

  const clean = cleanSearchTerm(term);

  useEffect(() => {
    if (value || !accountId || clean.length < 2) return;
    let cancelled = false;
    // Wait for a pause in the typing before asking.
    const timer = setTimeout(async () => {
      setSearching(true);
      const like = `%${clean}%`;
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', accountId)
        .or(`name.ilike.${like},phone.ilike.${like}`)
        .order('name', { ascending: true })
        .limit(8);
      if (cancelled) return;
      setSearching(false);
      setResults(error ? [] : ((data ?? []) as PickedContact[]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, clean, supabase, value]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate">{contactLine(value)}</span>
        {disabled ? null : (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setTerm('');
              setResults(null);
            }}
            aria-label="Trocar contato"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  const showResults = clean.length >= 2 && results !== null;

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            if (cleanSearchTerm(e.target.value).length < 2) setResults(null);
          }}
          placeholder="Buscar contato por nome ou telefone"
          aria-label="Buscar contato"
          disabled={disabled}
          className="bg-muted border-border pl-8 text-foreground placeholder:text-muted-foreground"
        />
        {searching ? (
          <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {showResults ? (
        results.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            Nenhum contato com “{clean}”. Cadastre em Contatos, ou marque só com o título.
          </p>
        ) : (
          <ul className="max-h-44 overflow-y-auto rounded-lg border border-border bg-card">
            {results.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => onChange(contact)}
                  className="block w-full truncate px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {contactLine(contact)}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
