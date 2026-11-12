'use client';

import { useMemo, useState } from 'react';
import { BellOff } from 'lucide-react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';

/** "16/11/2026", the day they asked. */
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('pt-BR') : '';
}

/**
 * "Pediu para não receber mensagens automáticas" (migration 066). On,
 * the contact is left out of bulk sends, template broadcasts, sequences
 * and flows started by hand; a message someone writes still goes. The
 * parent keys this by contact.
 */
export function ContactOptOut({
  contactId,
  optedOutAt,
}: {
  contactId: string;
  optedOutAt: string | null | undefined;
}) {
  const supabase = useMemo(() => createClient(), []);
  const canEdit = useCan('send-messages');
  const [since, setSince] = useState<string | null>(optedOutAt ?? null);
  const [saving, setSaving] = useState(false);

  async function toggle(on: boolean) {
    const value = on ? new Date().toISOString() : null;
    setSaving(true);
    const { error } = await supabase
      .from('contacts')
      .update({ opted_out_at: value })
      .eq('id', contactId);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === 'PGRST204' || error.code === '42703'
          ? 'O descadastro precisa da atualização 066 do CRM.'
          : 'Não consegui salvar.',
      );
      return;
    }
    setSince(value);
  }

  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <BellOff className="size-3.5 text-muted-foreground" />
          Pediu para não receber mensagens automáticas
        </span>
        <span className="block text-xs text-muted-foreground">
          {since
            ? `Desde ${day(since)}. Fica de fora de disparos, sequências e fluxos; mensagens escritas por alguém ainda saem.`
            : 'Marque quando o contato pedir para sair: ele fica de fora de disparos, sequências e fluxos.'}
        </span>
      </span>
      <Switch
        checked={Boolean(since)}
        disabled={!canEdit || saving}
        onCheckedChange={(on) => void toggle(on)}
        aria-label="Pediu para não receber mensagens automáticas"
      />
    </label>
  );
}
