// ============================================================
// Platform (agency) roles — pure, unit-testable, no I/O.
//
// Mirrors the CHECK on `agencia_membros.role` (migration 049).
//
//   super_admin  everything, including managing the agency team
//   manager      operates client CRMs where the owner granted full
//   support      read-only, even where a CRM grants full access
//
// None of them overrides a client's consent: the database caps the
// agency at the level each CRM's owner chose (see is_account_member).
// ============================================================

export type AgenciaRole = 'super_admin' | 'manager' | 'support'

/** Lowest privilege first. */
export const AGENCIA_ROLES: readonly AgenciaRole[] = [
  'support',
  'manager',
  'super_admin',
] as const

export const AGENCIA_ROLE_LABEL: Record<AgenciaRole, string> = {
  super_admin: 'Super admin',
  manager: 'Gestor',
  support: 'Suporte',
}

export const AGENCIA_ROLE_DESCRIPTION: Record<AgenciaRole, string> = {
  super_admin: 'Tudo, inclusive gerenciar a equipe da agência.',
  manager: 'Opera os CRMs em que o dono liberou acesso total.',
  support: 'Só leitura, mesmo onde o CRM liberou acesso total.',
}

export function isAgenciaRole(value: unknown): value is AgenciaRole {
  return (
    typeof value === 'string' &&
    (AGENCIA_ROLES as readonly string[]).includes(value)
  )
}

export function hasAgenciaRole(role: AgenciaRole, min: AgenciaRole): boolean {
  return AGENCIA_ROLES.indexOf(role) >= AGENCIA_ROLES.indexOf(min)
}
