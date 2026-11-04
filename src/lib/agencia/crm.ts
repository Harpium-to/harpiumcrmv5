// ============================================================
// CRM lifecycle vocabulary — pure, unit-testable, no I/O.
//
// Mirrors migration 050 (accounts.status / niche) and 049
// (account_agency_access.level). Database values are English slugs;
// everything a person reads is here, in Portuguese.
// ============================================================

export type CrmStatus = 'onboarding' | 'active' | 'suspended' | 'archived'

export const CRM_STATUSES: readonly CrmStatus[] = [
  'onboarding',
  'active',
  'suspended',
  'archived',
] as const

export const CRM_STATUS_LABEL: Record<CrmStatus, string> = {
  onboarding: 'Em implantação',
  active: 'Ativo',
  suspended: 'Suspenso',
  archived: 'Arquivado',
}

export const CRM_STATUS_DESCRIPTION: Record<CrmStatus, string> = {
  onboarding: 'Criado, ainda sendo configurado com o cliente.',
  active: 'Em uso normal.',
  suspended: 'O cliente só consegue ler. Mensagens continuam chegando.',
  archived: 'Some para todos. Os dados ficam guardados.',
}

export function isCrmStatus(value: unknown): value is CrmStatus {
  return (
    typeof value === 'string' &&
    (CRM_STATUSES as readonly string[]).includes(value)
  )
}

/** Unknown / missing (pre-050) reads as active — today's behaviour. */
export function toCrmStatus(value: unknown): CrmStatus {
  return isCrmStatus(value) ? value : 'active'
}

// Niches. Fase 5 attaches a template to each; for now it is a label
// the agency filters and reports by.
export const CRM_NICHES = [
  { id: 'medical_clinic', label: 'Clínica médica' },
  { id: 'dental_aesthetic', label: 'Odontologia / Estética' },
  { id: 'gym', label: 'Academia / Studio' },
  { id: 'real_estate', label: 'Imobiliária' },
  { id: 'education', label: 'Educação / Cursos' },
  { id: 'law', label: 'Advocacia' },
  { id: 'retail', label: 'Varejo / E-commerce' },
  { id: 'services', label: 'Serviços / Agência' },
  { id: 'other', label: 'Outro' },
] as const

export type CrmNiche = (typeof CRM_NICHES)[number]['id']

export function nicheLabel(id: string | null | undefined): string | null {
  if (!id) return null
  return CRM_NICHES.find((n) => n.id === id)?.label ?? id
}

export function isCrmNiche(value: unknown): value is CrmNiche {
  return typeof value === 'string' && CRM_NICHES.some((n) => n.id === value)
}

export type AgencyAccessLevel = 'metrics' | 'read' | 'full'

export const AGENCY_ACCESS_LEVELS: readonly AgencyAccessLevel[] = [
  'metrics',
  'read',
  'full',
] as const

export const AGENCY_ACCESS_LABEL: Record<AgencyAccessLevel, string> = {
  metrics: 'Métricas',
  read: 'Leitura',
  full: 'Total',
}

export const AGENCY_ACCESS_DESCRIPTION: Record<AgencyAccessLevel, string> = {
  metrics:
    'A agência vê só números de uso. Nenhum nome, telefone ou conversa.',
  read: 'A agência vê contatos, funil e conversas, sem alterar nada.',
  full: 'A agência pode operar o CRM junto com você, como administradora.',
}

export function isAgencyAccessLevel(value: unknown): value is AgencyAccessLevel {
  return (
    typeof value === 'string' &&
    (AGENCY_ACCESS_LEVELS as readonly string[]).includes(value)
  )
}

/** Labels for agencia_auditoria.action. Unknown actions show raw. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  view_account: 'Abriu a conta',
  view_conversation: 'Abriu uma conversa',
  export_contacts: 'Exportou contatos',
  enter_account: 'Entrou no CRM',
  create_account: 'Criou o CRM',
  invite_owner: 'Convidou o dono',
  update_account: 'Alterou os dados do CRM',
  request_access: 'Pediu mais acesso',
  status_onboarding: 'Mudou para Em implantação',
  status_active: 'Ativou o CRM',
  status_suspended: 'Suspendeu o CRM',
  status_archived: 'Arquivou o CRM',
}

/**
 * Version of the consent text the owner agrees to when choosing a
 * level, stored with every change (account_agency_access.terms_version
 * and its history). Bump it whenever AGENCY_ACCESS_DESCRIPTION or the
 * consent copy in settings changes meaningfully.
 */
export const AGENCY_CONSENT_TERMS_VERSION = '2026-11-04'

/** Niches whose CRMs hold health data (sensitive under LGPD art. 11). */
export const HEALTH_NICHES: readonly string[] = ['medical_clinic', 'dental_aesthetic']
