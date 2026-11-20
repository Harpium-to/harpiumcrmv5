// ============================================================
// GET /api/plataforma/v1/crms/{id}/funil — pipelines with stage counts
// and totals (any level), and the most recent cards of each stage
// (only with Leitura / membership: cards carry contact names).
// Every query filters the CRM explicitly (service role).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchAllRows } from '@/lib/reports/fetch-all'

import type { CrmAccess } from './access'
import { crmLink } from './links'
import { contactNames } from './resumo'

const CARDS_PER_STAGE = 20

export interface FunilStage {
  id: string
  name: string
  color: string | null
  position: number
  count: number
  value: number
  deals: Array<{
    id: string
    title: string
    value: number
    contactName: string | null
    updatedAt: string | null
    link: string
  }> | null
}

export interface FunilPipeline {
  id: string
  name: string
  stages: FunilStage[]
  link: string
}

export async function loadFunil(
  admin: SupabaseClient,
  access: CrmAccess,
  opts: { origin: string; pipelineId?: string | null },
): Promise<{ pipelines: FunilPipeline[]; currency: string }> {
  const accountId = access.accountId
  const withDeals = access.level === 'rows'

  let pq = admin.from('pipelines').select('id, name, created_at').eq('account_id', accountId)
  if (opts.pipelineId) pq = pq.eq('id', opts.pipelineId)
  const [pipelinesRes, accountRes] = await Promise.all([
    pq.order('created_at', { ascending: true }),
    admin.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
  ])
  if (pipelinesRes.error) throw pipelinesRes.error
  const pipelines = (pipelinesRes.data ?? []) as Array<{ id: string; name: string }>
  const currency = (accountRes.data as { default_currency?: string } | null)?.default_currency || 'BRL'
  if (pipelines.length === 0) return { pipelines: [], currency }

  const pipelineIds = pipelines.map((p) => p.id)
  const [stagesRes, deals] = await Promise.all([
    admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, color, position')
      .in('pipeline_id', pipelineIds)
      .order('position', { ascending: true }),
    fetchAllRows<{
      id: string
      stage_id: string | null
      pipeline_id: string | null
      title: string
      value: unknown
      contact_id: string | null
      updated_at: string | null
    }>((from, to) =>
      admin
        .from('deals')
        .select('id, stage_id, pipeline_id, title, value, contact_id, updated_at')
        .eq('account_id', accountId)
        .eq('status', 'open')
        .in('pipeline_id', pipelineIds)
        .order('id')
        .range(from, to),
    ),
  ])
  if (stagesRes.error) throw stagesRes.error

  const byStage = new Map<string, typeof deals>()
  for (const d of deals) {
    if (!d.stage_id) continue
    const list = byStage.get(d.stage_id) ?? []
    list.push(d)
    byStage.set(d.stage_id, list)
  }
  for (const list of byStage.values()) {
    list.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
  }

  const shown = withDeals
    ? [...byStage.values()].flatMap((l) => l.slice(0, CARDS_PER_STAGE))
    : []
  const names = withDeals
    ? await contactNames(admin, accountId, shown.map((d) => d.contact_id))
    : new Map<string, string | null>()

  const stages = (stagesRes.data ?? []) as Array<{
    id: string
    pipeline_id: string
    name: string
    color?: string | null
    position: number
  }>

  return {
    currency,
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      link: crmLink(opts.origin, accountId, { kind: 'page', path: `/pipelines?pipeline=${p.id}` }),
      stages: stages
        .filter((s) => s.pipeline_id === p.id)
        .map((s) => {
          const list = byStage.get(s.id) ?? []
          return {
            id: s.id,
            name: s.name,
            color: s.color ?? null,
            position: s.position,
            count: list.length,
            value: list.reduce((sum, d) => sum + (Number(d.value) || 0), 0),
            deals: withDeals
              ? list.slice(0, CARDS_PER_STAGE).map((d) => ({
                  id: d.id,
                  title: d.title,
                  value: Number(d.value) || 0,
                  contactName: d.contact_id ? (names.get(d.contact_id) ?? null) : null,
                  updatedAt: d.updated_at,
                  link: crmLink(opts.origin, accountId, {
                    kind: 'deal',
                    id: d.id,
                    pipelineId: p.id,
                  }),
                }))
              : null,
          }
        }),
    })),
  }
}
