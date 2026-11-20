import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { appendMessage, createConversation } from '@/lib/assistente/store'

import { loadLedger } from './alertas'
import { loadRadarSettings, radarRecipients } from './config'
import { BASELINE_WEEKS, Ledger, median } from './deteccao'
import type { DailyContext, RadarState } from './livro'
import { formatValue } from './metricas'
import { addDays, isoWeek, weekdayOf } from './tempo'

// ============================================================
// The weekly digest (Fase 4). The numbers are put together here, in
// code; the AI only turns them into a short text, under the reports
// analyst's rule — it sees numbers, never the database, and may not
// invent one. A checker (`inventedNumbers`) refuses a text with any
// number that is not in the package, and the code-made text goes out
// instead. Without an AI key the code-made text is the digest.
// See docs/plano-radar-monitoramento.md §5.4.
// ============================================================

export interface DigestLine {
  key: string
  label: string
  value: number
  /** The normal week (median of the previous ones); null while learning. */
  normal: number | null
  unit: 'count' | 'money' | 'minutes' | 'rate'
}

export interface DigestData {
  weekStart: string
  weekEnd: string
  lines: DigestLine[]
  /** Leads by origin this week (top 5). */
  origins: { origin: string; value: number }[]
  alerts: string[]
  forecast: { low: number; high: number; expected: number; month: string } | null
  cooling: number
  stalled: number
}

const LINES: { key: string; label: string; unit: DigestLine['unit'] }[] = [
  { key: 'leads', label: 'Leads novos', unit: 'count' },
  { key: 'conversas_novas', label: 'Conversas novas', unit: 'count' },
  { key: 'mensagens_recebidas', label: 'Mensagens recebidas', unit: 'count' },
  { key: 'negocios_criados', label: 'Negócios criados', unit: 'count' },
  { key: 'negocios_ganhos', label: 'Negócios ganhos', unit: 'count' },
  { key: 'negocios_ganhos_valor', label: 'Valor ganho', unit: 'money' },
  { key: 'negocios_perdidos', label: 'Negócios perdidos', unit: 'count' },
  { key: 'consultas_marcadas', label: 'Consultas marcadas', unit: 'count' },
  { key: 'faltas', label: 'Faltas na agenda', unit: 'count' },
  { key: 'prazo_estourado', label: 'Conversas que passaram do prazo', unit: 'count' },
]

/** The numbers of the week ending on `end`, each next to its normal. Pure. */
export function buildDigestData(args: {
  ledger: Ledger
  end: string
  trackedSince: string
  alerts: string[]
  forecast: DigestData['forecast']
  cooling: number
  stalled: number
}): DigestData {
  const { ledger, end, trackedSince } = args
  const start = addDays(end, -6)
  const normalOf = (key: string): number | null => {
    const weeks: number[] = []
    for (let w = 1; w <= BASELINE_WEEKS; w++) {
      const s = addDays(start, -7 * w)
      if (s < trackedSince) continue
      weeks.push(ledger.sum(key, '', s, addDays(s, 6)))
    }
    return weeks.length >= 2 ? Math.round(median(weeks) * 10) / 10 : null
  }

  const lines: DigestLine[] = LINES.map((l) => ({
    key: l.key,
    label: l.label,
    unit: l.unit,
    value: ledger.sum(l.key, '', start, end),
    normal: normalOf(l.key),
  }))

  // First response: the mean of the daily medians, weighted by waits.
  let weighted = 0
  let waits = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const m = ledger.get('primeira_resposta_min', '', d, false)
    const n = ledger.get('primeira_resposta_n', '', d, true) ?? 0
    if (m !== null && n > 0) {
      weighted += m * n
      waits += n
    }
  }
  if (waits > 0) {
    lines.push({
      key: 'primeira_resposta_min',
      label: 'Tempo médio da primeira resposta',
      unit: 'minutes',
      value: Math.round((weighted / waits) * 10) / 10,
      normal: null,
    })
  }

  const origins = ledger
    .dimensions('leads')
    .map((origin) => ({ origin, value: ledger.sum('leads', origin, start, end) }))
    .filter((o) => o.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  return {
    weekStart: start,
    weekEnd: end,
    lines,
    origins,
    alerts: args.alerts,
    forecast: args.forecast,
    cooling: args.cooling,
    stalled: args.stalled,
  }
}

const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

/** The package as the AI reads it: compact, every number labelled. */
export function digestForAi(d: DigestData): string {
  const out: string[] = [`SEMANA: ${ddmm(d.weekStart)} a ${ddmm(d.weekEnd)}.`]
  for (const l of d.lines) {
    if (l.value === 0 && (l.normal ?? 0) === 0) continue
    out.push(
      `${l.label}: ${formatValue(l.unit, l.value)}${l.normal !== null ? ` (normal de uma semana: ${formatValue(l.unit, l.normal)})` : ''}.`,
    )
  }
  if (d.origins.length > 0) {
    out.push(`LEADS POR ORIGEM: ${d.origins.map((o) => `${o.origin}: ${o.value}`).join('; ')}.`)
  }
  if (d.alerts.length > 0) out.push(`ALERTAS DA SEMANA: ${d.alerts.join(' | ')}.`)
  if (d.forecast) {
    out.push(
      `PREVISÃO DO MÊS: entre ${formatValue('money', d.forecast.low)} e ${formatValue('money', d.forecast.high)} (esperado ${formatValue('money', d.forecast.expected)}).`,
    )
  }
  out.push(`LEADS ESPERANDO RESPOSTA: ${d.cooling}. NEGÓCIOS COM BOA CHANCE PARADOS: ${d.stalled}.`)
  return out.join('\n')
}

export const DIGEST_INSTRUCTIONS = `Você é o Radar de um CRM e escreve o resumo da semana para o dono da empresa, em português do Brasil, com base EXCLUSIVAMENTE nos números do bloco DADOS.

Como escrever:
- Três partes curtas, nesta ordem: "O que mudou", "Atenção" (de 1 a 3 pontos, cada um com o número que o sustenta) e "O que fazer" (ações concretas a partir dos números).
- No máximo 160 palavras. Frases simples, sem jargão.
- Compare com o normal só onde DADOS traz o normal.

Limites que valem sempre:
- NUNCA invente, estime, some ou calcule um número novo. Use os números exatamente como estão em DADOS; se não está lá, não cite número.
- Não compare com mercado ou média do setor.
- Não dê conselho de investimento, jurídico ou contábil.`

/** Every number in a text, normalised ("R$ 1.234" → 1234, "45%" → 45, "4,5" → 4.5). */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  const re = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/\./g, '').replace(',', '.')
    const n = Number(raw)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * Numbers the AI wrote that are not in the package. Small integers
 * (0–10: "3 pontos", "2 ações") and dates of the week are allowed.
 */
export function inventedNumbers(text: string, packageText: string): number[] {
  const allowed = new Set(numbersIn(packageText).map((n) => Math.round(n * 10) / 10))
  return numbersIn(text).filter((n) => {
    if (Number.isInteger(n) && n >= 0 && n <= 10) return false
    return !allowed.has(Math.round(n * 10) / 10)
  })
}

/** The digest without AI: the same numbers, in fixed sentences. */
export function fallbackDigest(d: DigestData): string {
  const parts: string[] = [`Semana de ${ddmm(d.weekStart)} a ${ddmm(d.weekEnd)}.`]
  const changed = d.lines.filter((l) => l.value > 0 || (l.normal ?? 0) > 0).slice(0, 6)
  if (changed.length > 0) {
    parts.push(
      'O que mudou:\n' +
        changed
          .map(
            (l) =>
              `- ${l.label}: ${formatValue(l.unit, l.value)}${l.normal !== null ? ` (normal: ${formatValue(l.unit, l.normal)})` : ''}`,
          )
          .join('\n'),
    )
  }
  if (d.alerts.length > 0) parts.push('Atenção:\n' + d.alerts.slice(0, 3).map((a) => `- ${a}`).join('\n'))
  const todo: string[] = []
  if (d.cooling > 0) todo.push(`- Responder os ${d.cooling} leads que estão esperando (veja no Radar).`)
  if (d.stalled > 0) todo.push(`- Retomar os ${d.stalled} negócios com boa chance que pararam.`)
  if (d.forecast) {
    todo.push(
      `- Previsão do mês: entre ${formatValue('money', d.forecast.low)} e ${formatValue('money', d.forecast.high)}.`,
    )
  }
  if (todo.length > 0) parts.push('O que fazer:\n' + todo.join('\n'))
  return parts.join('\n\n')
}

// ------------------------------------------------------------
// The weekly step
// ------------------------------------------------------------

export async function resumoStep(ctx: DailyContext): Promise<Partial<RadarState>> {
  const { admin, accountId, today, hour, state } = ctx
  const week = isoWeek(today)
  if (state.digest_week === week || !state.tracked_since) return {}

  const settings = await loadRadarSettings(admin, accountId)
  if (!settings.enabled || !settings.digestEnabled) return {}
  if (weekdayOf(today) !== settings.digestWeekday || hour < settings.digestHour) return {}

  // The last full week (Monday to Sunday) before today.
  const end = addDays(today, -weekdayOf(today))
  const from = addDays(end, -7 * (BASELINE_WEEKS + 1))
  const ledger = new Ledger(await loadLedger(admin, accountId, from, end))

  const [alertsRes, coolingRes, panelDeals] = await Promise.all([
    admin
      .from('radar_alerts')
      .select('title, tone')
      .eq('account_id', accountId)
      .gte('period_start', addDays(end, -6))
      .lte('period_start', end)
      .neq('status', 'ignorado')
      .order('created_at', { ascending: false })
      .limit(6),
    admin.rpc('radar_cooling_leads', { p_account: accountId, p_limit: 100 }),
    admin
      .from('deals')
      .select('value, win_probability, expected_close_date, status, win_probability_basis')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .limit(5000),
  ])
  const { forecastMonth } = await import('./chance')
  const deals = (panelDeals.data ?? []) as {
    value: number | string
    win_probability: number | string | null
    expected_close_date: string | null
    status: string
  }[]
  const month = today.slice(0, 7)
  const f = forecastMonth(
    deals.map((d) => ({
      value: Number(d.value) || 0,
      p: d.win_probability === null ? null : Number(d.win_probability),
      expected_close_date: d.expected_close_date,
      status: d.status,
    })),
    month,
  )

  const data = buildDigestData({
    ledger,
    end,
    trackedSince: state.tracked_since,
    alerts: ((alertsRes.data ?? []) as { title: string; tone: string }[])
      .filter((a) => a.tone !== 'bom')
      .map((a) => a.title),
    forecast: f.deals > 0 ? { low: f.low, high: f.high, expected: f.expected, month } : null,
    cooling: Array.isArray(coolingRes.data) ? coolingRes.data.length : 0,
    stalled: 0,
  })

  const pkg = digestForAi(data)
  let text = fallbackDigest(data)
  let byAi = false
  try {
    const config = await loadAiConfig(admin, accountId, { requireActive: false })
    if (config) {
      const generated = await generateReply({
        config,
        systemPrompt: `${DIGEST_INSTRUCTIONS}\n\nDADOS:\n${pkg}`,
        messages: [{ role: 'user', content: 'Escreva o resumo desta semana.' }],
      })
      void logAiUsage(admin, {
        accountId,
        conversationId: null,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage: generated.usage,
      })
      const candidate = generated.text.trim()
      if (candidate && inventedNumbers(candidate, pkg).length === 0) {
        text = candidate.slice(0, 5000)
        byAi = true
      }
    }
  } catch (err) {
    console.error('[radar] digest AI failed, using the code-made text:', err)
  }

  const { error } = await admin.from('radar_digests').upsert(
    {
      account_id: accountId,
      week,
      period_start: data.weekStart,
      period_end: data.weekEnd,
      text,
      data,
      by_ai: byAi,
    },
    { onConflict: 'account_id,week' },
  )
  if (error) throw new Error(error.message)

  const recipients = await radarRecipients(admin, accountId, settings)
  if (recipients.length > 0) {
    await admin.from('notifications').insert(
      recipients.map((userId) => ({
        account_id: accountId,
        user_id: userId,
        type: 'radar',
        title: 'Radar: o resumo da semana chegou',
        body: text.replace(/\s+/g, ' ').slice(0, 220),
      })),
    )
    // And in a "Radar" conversation of the Harpi, per person.
    for (const userId of recipients) {
      try {
        await postToHarpi(admin, { accountId, userId, text, week })
      } catch (err) {
        console.error('[radar] digest to Harpi failed:', err)
      }
    }
  }
  return { digest_week: week }
}

async function postToHarpi(
  admin: SupabaseClient,
  args: { accountId: string; userId: string; text: string; week: string },
): Promise<void> {
  const { data: existing } = await admin
    .from('assistant_conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('user_id', args.userId)
    .eq('origin', 'routine')
    .eq('title', 'Radar')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const conversationId =
    (existing as { id: string } | null)?.id ??
    (await createConversation(admin, { accountId: args.accountId, userId: args.userId, title: 'Radar', origin: 'routine' }))
  await appendMessage(admin, {
    conversationId,
    accountId: args.accountId,
    role: 'user',
    content: { routine: `Radar — resumo da semana ${args.week}`, text: 'Resumo da semana' },
  })
  await appendMessage(admin, {
    conversationId,
    accountId: args.accountId,
    role: 'assistant',
    content: { blocks: [{ type: 'text', text: args.text }] },
  })
}
