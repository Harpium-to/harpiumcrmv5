// The funnel every account starts with. Seeded the first time someone
// opens the Funil page with no funnel yet, and by the first-contact deal
// (see ./first-contact.ts) when a new contact writes before anyone has.
// Both paths read from here so they always create the same funnel.
//
// No server-only imports: the Funil page is a client component.

export const DEFAULT_PIPELINE_NAME = 'Funil de vendas'

export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Novo lead', color: '#3b82f6', position: 0 }, // blue
  { name: 'Qualificado', color: '#eab308', position: 1 }, // yellow
  { name: 'Proposta enviada', color: '#f97316', position: 2 }, // orange
  { name: 'Negociação', color: '#8b5cf6', position: 3 }, // purple
  { name: 'Ganho', color: '#22c55e', position: 4 }, // green
] as const
