import { describe, expect, it } from 'vitest'

import { Ledger, type LedgerRow } from './deteccao'
import { buildDigestData, digestForAi, fallbackDigest, inventedNumbers, numbersIn } from './resumo'
import { addDays } from './tempo'

const END = '2026-11-15' // a Sunday
const rows: LedgerRow[] = []
for (let i = 0; i < 49; i++) {
  const day = addDays(END, -i)
  rows.push({ day, metric: 'leads', dimension: '', value: i < 7 ? 2 : 4 })
  rows.push({ day, metric: 'leads', dimension: 'instagram', value: i < 7 ? 1 : 3 })
  rows.push({ day, metric: 'negocios_ganhos_valor', dimension: '', value: i < 7 ? 1000 : 500 })
}
rows.push({ day: END, metric: 'primeira_resposta_min', dimension: '', value: 12 })
rows.push({ day: END, metric: 'primeira_resposta_n', dimension: '', value: 4 })

const data = buildDigestData({
  ledger: new Ledger(rows),
  end: END,
  trackedSince: '2026-09-01',
  alerts: ['Leads novos caíram 50% na semana'],
  forecast: { low: 3000, high: 9000, expected: 6000, month: '2026-11' },
  cooling: 4,
  stalled: 2,
})

describe('buildDigestData', () => {
  it('the week next to its normal', () => {
    const leads = data.lines.find((l) => l.key === 'leads')!
    expect(leads).toMatchObject({ value: 14, normal: 28 })
    expect(data.lines.find((l) => l.key === 'negocios_ganhos_valor')).toMatchObject({ value: 7000, normal: 3500 })
    expect(data.lines.find((l) => l.key === 'primeira_resposta_min')).toMatchObject({ value: 12 })
    expect(data.origins).toEqual([{ origin: 'instagram', value: 7 }])
  })

  it('the package for the AI labels every number', () => {
    const pkg = digestForAi(data)
    expect(pkg).toContain('SEMANA: 09/11 a 15/11.')
    expect(pkg).toContain('Leads novos: 14 (normal de uma semana: 28).')
    expect(pkg).toContain('LEADS ESPERANDO RESPOSTA: 4.')
  })

  it('without AI the same numbers in fixed sentences', () => {
    const text = fallbackDigest(data)
    expect(text).toContain('- Leads novos: 14 (normal: 28)')
    expect(text).toContain('Atenção:\n- Leads novos caíram 50% na semana')
    expect(text).toContain('Responder os 4 leads')
    expect(inventedNumbers(text, digestForAi(data))).toEqual([])
  })
})

describe('the invented-number check', () => {
  const pkg = digestForAi(data)

  it('reads Brazilian numbers', () => {
    expect(numbersIn('R$ 1.234,50 e 45% e 4,5 min e 2026')).toEqual([1234.5, 45, 4.5, 2026])
  })

  it('accepts a text that only uses the package', () => {
    const ok = 'O que mudou: foram 14 leads novos, metade do normal de 28. Atenção: 4 leads esperando resposta. Valor ganho de R$ 7.000.'
    expect(inventedNumbers(ok, pkg)).toEqual([])
  })

  it('refuses a number that is not there', () => {
    const bad = 'Os leads caíram 50%, e a conversão está em 37%; espere R$ 12.500 este mês.'
    expect(inventedNumbers(bad, pkg)).toEqual([37, 12500])
  })
})
