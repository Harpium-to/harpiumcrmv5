// ============================================================
// One line of a conversation's history (conversation_transfers, 076):
// "Carla passou para Dra. Ana · quer avaliar antes de fechar".
// Pure, so the wording is tested once and reads the same everywhere.
// ============================================================

export interface TransferEvent {
  id: string
  created_at: string
  from_user_id: string | null
  to_user_id: string | null
  from_team_id?: string | null
  to_team_id?: string | null
  actor_user_id: string | null
  source: string
  note: string | null
}

export function describeTransfer(
  e: TransferEvent,
  nameOf: (userId: string) => string | null,
  teamName: (teamId: string) => string | null,
): string {
  const to = e.to_user_id ? nameOf(e.to_user_id) ?? 'alguém da equipe' : null
  const actor = e.actor_user_id ? nameOf(e.actor_user_id) ?? 'Alguém da equipe' : null
  const team = e.to_team_id ? teamName(e.to_team_id) : null
  const where = team ? ` · ${team}` : ''

  let text: string
  if (!e.to_user_id) {
    const queue = team ? `a fila de ${team}` : 'a fila'
    const who =
      e.source === 'ia'
        ? 'A IA passou para'
        : e.source === 'fluxo'
          ? 'Um fluxo passou para'
          : e.source === 'automacao'
            ? 'Uma automação passou para'
            : e.source === 'retorno'
              ? 'Voltou a falar e foi para'
              : `${actor ?? 'Alguém'} devolveu para`
    text = `${who} ${queue}`
  } else if (actor && e.actor_user_id === e.to_user_id && (e.source === 'manual' || e.source === 'api')) {
    text = `${actor} assumiu a conversa${where}`
  } else {
    switch (e.source) {
      case 'ia':
        text = `A IA passou para ${to}${where}`
        break
      case 'rodizio':
        text = `Rodízio: ficou com ${to}${where}`
        break
      case 'chegada':
        text = `Conversa nova: ficou com ${to}${where}`
        break
      case 'fluxo':
        text = `Um fluxo passou para ${to}${where}`
        break
      case 'automacao':
        text = `Uma automação passou para ${to}${where}`
        break
      case 'prazo':
        text = `Passou do prazo: foi para ${to}${where}`
        break
      case 'retorno':
        text = `Voltou a falar: ficou com ${to}${where}`
        break
      case 'outro':
        text = `Ficou com ${to}${where}`
        break
      default:
        text = `${actor ?? 'Alguém da equipe'} passou para ${to}${where}`
    }
  }
  return e.note ? `${text} · ${e.note}` : text
}
