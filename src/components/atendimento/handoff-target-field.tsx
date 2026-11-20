'use client';

import { OptionSelect } from '@/components/agenda/option-select';
import type { HandoffMode } from '@/lib/atendimento/destino';
import type { Team } from '@/lib/atendimento/setores';
import type { AccountMember } from '@/types';

export interface HandoffTargetValue {
  /** null: inherit (agents) / the old behaviour (account). */
  mode: HandoffMode | null;
  teamId: string | null;
  userId: string | null;
}

const INHERIT = '__inherit__';

/**
 * "Quando passar para uma pessoa" — shared by Configurações › IA (the
 * account) and each AI agent (which may inherit the account's).
 */
export function HandoffTargetField({
  value,
  onChange,
  members,
  teams,
  allowInherit = false,
  disabled,
  idPrefix = 'handoff',
}: {
  value: HandoffTargetValue;
  onChange: (next: HandoffTargetValue) => void;
  members: AccountMember[];
  teams: Team[];
  /** An agent: "Igual à conta" is the first option. */
  allowInherit?: boolean;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const activeTeams = teams.filter((t) => t.active);
  const people = members.filter((m) => m.role !== 'viewer');

  // What the select shows. A legacy row with only a person reads as "pessoa".
  const shown: string =
    value.mode ?? (value.userId ? 'pessoa' : allowInherit ? INHERIT : activeTeams.length > 0 ? 'ia_escolhe' : 'fila');

  const options = [
    ...(allowInherit ? [{ value: INHERIT, label: 'Igual à configuração da IA da conta' }] : []),
    ...(activeTeams.length > 0
      ? [
          { value: 'ia_escolhe', label: 'A IA escolhe o setor pelo assunto' },
          { value: 'setor', label: 'Sempre para um setor' },
        ]
      : []),
    { value: 'pessoa', label: 'Sempre para uma pessoa' },
    { value: 'fila', label: 'Fila geral (ninguém em especial)' },
  ];
  // A mode that needs setores, chosen before they were all removed.
  if (!options.some((o) => o.value === shown)) {
    options.push({ value: shown, label: shown === 'setor' ? 'Sempre para um setor' : 'A IA escolhe o setor' });
  }

  const pick = (mode: string) => {
    if (mode === INHERIT) onChange({ mode: null, teamId: null, userId: null });
    else
      onChange({
        mode: mode as HandoffMode,
        teamId: mode === 'setor' ? value.teamId ?? activeTeams[0]?.id ?? null : null,
        userId: mode === 'pessoa' ? value.userId ?? null : null,
      });
  };

  return (
    <div className="space-y-2">
      <OptionSelect ariaLabel="Quando passar para uma pessoa" value={shown} onChange={pick} options={options} disabled={disabled} />
      {shown === 'setor' && (
        <OptionSelect
          ariaLabel="Setor"
          value={value.teamId ?? ''}
          disabled={disabled}
          onChange={(teamId) => onChange({ mode: 'setor', teamId, userId: null })}
          options={activeTeams.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
        />
      )}
      {shown === 'pessoa' && (
        <OptionSelect
          ariaLabel="Pessoa"
          value={value.userId ?? ''}
          disabled={disabled}
          onChange={(userId) => onChange({ mode: 'pessoa', teamId: null, userId })}
          options={people.map((m) => ({ value: m.user_id, label: m.full_name || m.email || 'Sem nome' }))}
        />
      )}
      <p id={`${idPrefix}-help`} className="text-xs text-muted-foreground">
        {shown === 'ia_escolhe'
          ? 'A IA lê o que cada setor resolve e manda a conversa para o certo. Na dúvida, vai para o setor de entrada.'
          : shown === 'setor'
            ? 'Toda conversa que a IA passar vai para este setor, que escolhe a pessoa pela regra dele.'
            : shown === 'pessoa'
              ? 'Toda conversa que a IA passar vai para esta pessoa.'
              : shown === 'fila'
                ? 'A conversa fica na fila geral, para quem pegar.'
                : 'Usa o que está em Configurações › IA.'}
      </p>
    </div>
  );
}
