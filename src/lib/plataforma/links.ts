// ============================================================
// Links the platform API hands back: every item comes with the URL
// that opens it in the CRM, through /abrir (which switches the active
// CRM first — see src/app/abrir/route.ts). The Agency OS never needs to
// know the CRM's routes.
// ============================================================

import { DEEP_LINK_PREFIXES, safeNextPath } from '@/lib/http/next-path'

export type CrmTarget =
  | { kind: 'dashboard' }
  | { kind: 'lead'; id: string }
  | { kind: 'contact'; id: string }
  | { kind: 'deal'; id: string; pipelineId?: string | null }
  | { kind: 'conversation'; id: string }
  | { kind: 'event'; id: string; startsAt?: string | null }
  | { kind: 'page'; path: string }

/** 'YYYY-MM-DD' of an instant in Brasília (no DST since 2019). */
export function brtDay(iso: string): string {
  const t = new Date(iso).getTime() - 3 * 3_600_000
  return new Date(t).toISOString().slice(0, 10)
}

export function crmTargetPath(target: CrmTarget): string {
  switch (target.kind) {
    case 'dashboard':
      return '/dashboard'
    case 'lead':
      return `/leads?lead=${encodeURIComponent(target.id)}`
    case 'contact':
      return `/contacts?contact=${encodeURIComponent(target.id)}`
    case 'deal': {
      const sp = new URLSearchParams()
      if (target.pipelineId) sp.set('pipeline', target.pipelineId)
      sp.set('deal', target.id)
      return `/pipelines?${sp.toString()}`
    }
    case 'conversation':
      return `/inbox?c=${encodeURIComponent(target.id)}`
    case 'event': {
      const sp = new URLSearchParams()
      if (target.startsAt) sp.set('data', brtDay(target.startsAt))
      sp.set('evento', target.id)
      return `/agenda?${sp.toString()}`
    }
    case 'page':
      return safeNextPath(target.path, { prefixes: DEEP_LINK_PREFIXES })
  }
}

/** `<origin>/abrir?crm=<id>&ir=<path>`. */
export function crmLink(origin: string, accountId: string, target: CrmTarget): string {
  const sp = new URLSearchParams({ crm: accountId, ir: crmTargetPath(target) })
  return `${origin}/abrir?${sp.toString()}`
}

export interface CrmPageLinks {
  abrir: string
  leads: string
  funil: string
  inbox: string
  agenda: string
  relatorios: string
  automacoes: string
  agentes: string
  canais: string
  configuracoes: string
  painelAgencia: string
}

export function pageLinks(origin: string, accountId: string): CrmPageLinks {
  const page = (path: string) => crmLink(origin, accountId, { kind: 'page', path })
  return {
    abrir: page('/dashboard'),
    leads: page('/leads'),
    funil: page('/pipelines'),
    inbox: page('/inbox'),
    agenda: page('/agenda'),
    relatorios: page('/relatorios'),
    automacoes: page('/automations'),
    agentes: page('/agents'),
    canais: page('/canais'),
    configuracoes: page('/settings'),
    painelAgencia: `${origin}/agencia/${encodeURIComponent(accountId)}`,
  }
}
