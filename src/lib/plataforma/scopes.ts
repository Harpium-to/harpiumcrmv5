// ============================================================
// What a platform key may read. None of them writes client data:
// configuring and operating a CRM happens inside the CRM.
// ============================================================

export const PLATFORM_SCOPES = ['crms:read', 'dados:read', 'webhooks:manage'] as const;

export type PlatformScope = (typeof PLATFORM_SCOPES)[number];

export const PLATFORM_SCOPE_LABEL: Record<PlatformScope, string> = {
  'crms:read': 'Carteira, resumo e funil (números da operação)',
  'dados:read': 'Listas com dado pessoal: leads, contatos, negócios, conversas, tarefas e agenda',
  'webhooks:manage': 'Ligar o aviso de lead novo para o sistema da agência',
};

export function isPlatformScope(value: unknown): value is PlatformScope {
  return typeof value === 'string' && (PLATFORM_SCOPES as readonly string[]).includes(value);
}

export function hasPlatformScope(granted: readonly string[], scope: PlatformScope): boolean {
  return granted.includes(scope);
}

/** Keep only known scopes, without repeats, in the canonical order. */
export function normalizeScopes(values: unknown): PlatformScope[] {
  if (!Array.isArray(values)) return [];
  return PLATFORM_SCOPES.filter((s) => values.includes(s));
}
