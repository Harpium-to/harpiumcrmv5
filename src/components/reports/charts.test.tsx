import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import { CategoryBars } from './category-bars'
import { DayBars } from './day-bars'
import { FirstResponse } from './first-response'
import { GoalMeters } from './goal-meters'
import { OTHER, UNASSIGNED } from '@/lib/reports/aggregate'
import messages from '../../../messages/pt.json'
import type {
  BreakdownRow,
  FirstResponseSummary,
  GoalAttainmentRow,
} from '@/lib/reports/types'

/**
 * The reports screen renders behind a login this session cannot pass,
 * so the marks are checked from the markup instead.
 *
 * These assert the things that are invisible in code review and
 * obvious on screen: that a bar actually gets a width, that a stacked
 * pair keeps both segments, that an unmeasurable target draws no meter
 * at all, and that no sentinel key reaches the page as
 * `__unassigned__`.
 */
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt"
      messages={messages}
      timeZone="America/Sao_Paulo"
    >
      {node}
    </NextIntlClientProvider>,
  )
}

function row(over: Partial<BreakdownRow> & { key: string }): BreakdownRow {
  return { label: over.key, count: 1, value: null, ...over }
}

describe('DayBars', () => {
  const data = [
    { day: '2026-05-16', a: 0, b: 0 },
    { day: '2026-05-17', a: 3, b: 1 },
    { day: '2026-05-18', a: 1, b: 0 },
  ]

  it('scales bars against the peak', () => {
    const html = render(<DayBars data={data} labelA="Ganhos" labelB="Perdidos" />)
    // The 17th totals 4 (the peak) and the 18th totals 1.
    expect(html).toContain('height:100%')
    expect(html).toContain('height:25%')
  })

  it('draws nothing for an empty day but keeps its slot', () => {
    const html = render(<DayBars data={data} labelA="Ganhos" labelB="Perdidos" />)
    // Three columns regardless; the empty one has no coloured segment.
    expect(html.match(/flex h-full flex-1/g)).toHaveLength(3)
    expect(html).toContain('height:0%')
  })

  it('keeps both segments of a stacked day', () => {
    const html = render(<DayBars data={data} labelA="Ganhos" labelB="Perdidos" />)
    expect(html).toContain('--viz-series-1')
    expect(html).toContain('--viz-series-2')
  })

  it('uses the blue–red pair for polarity, never green–red', () => {
    // Green vs red measures ΔE 4.1 under deuteranopia and a bar
    // segment has no room for the icon that normally rescues it.
    const html = render(
      <DayBars data={data} labelA="Ganhos" labelB="Perdidos" tone="polarity" />,
    )
    expect(html).toContain('--viz-pos')
    expect(html).toContain('--viz-neg')
  })

  it('shows a legend only when there are two series', () => {
    const LEGEND_DOT = /size-2 shrink-0 rounded-full/g
    const two = render(<DayBars data={data} labelA="Ganhos" labelB="Perdidos" />)
    expect(two).toContain('Ganhos')
    expect(two).toContain('Perdidos')
    expect(two.match(LEGEND_DOT)).toHaveLength(2)

    // One series is named by the card title, so a legend box would
    // just repeat it.
    const one = render(<DayBars data={[{ day: '2026-05-18', a: 2 }]} labelA="Leads" />)
    expect(one.match(LEGEND_DOT)).toBeNull()
    expect(one).not.toContain('Perdidos')
  })

  it('labels the peak instead of every bar', () => {
    const html = render(<DayBars data={data} labelA="Ganhos" labelB="Perdidos" />)
    expect(html).toContain('Pico: 4 em 17/05')
  })

  it('formats day keys without a timezone shift', () => {
    // `new Date('2026-05-18')` is UTC midnight, which renders as the
    // 17th west of Greenwich — the bug the repo's own date-utils test
    // is still failing on.
    const html = render(<DayBars data={[{ day: '2026-05-18', a: 1 }]} labelA="L" />)
    expect(html).toContain('18/05')
    expect(html).not.toContain('17/05')
  })

  it('says so instead of drawing an empty plot', () => {
    const html = render(
      <DayBars data={[{ day: '2026-05-18', a: 0, b: 0 }]} labelA="L" labelB="M" />,
    )
    expect(html).toContain('Nenhuma movimentação neste período')
  })
})

describe('CategoryBars', () => {
  const rows: BreakdownRow[] = [
    row({ key: 'meta', count: 10 }),
    row({ key: 'indicacao', count: 5 }),
    row({ key: UNASSIGNED, label: '', count: 3 }),
    row({ key: OTHER, label: '', count: 2 }),
  ]

  it('gives every bar the same hue', () => {
    // Magnitude, not identity: the categories are named by their
    // labels, so a different colour per row would imply meaning.
    const html = render(<CategoryBars rows={rows} />)
    expect(html.match(/--viz-series-1/g)).toHaveLength(rows.length)
    expect(html).not.toContain('--viz-series-2')
  })

  it('always prints the number next to the label', () => {
    // So the figure survives colour-blindness, greyscale print and a
    // screen reader — there is no separate table view to maintain.
    const html = render(<CategoryBars rows={rows} />)
    expect(html).toContain('meta')
    expect(html).toContain('>10<')
  })

  it('puts words on the sentinel buckets', () => {
    const html = render(<CategoryBars rows={rows} />)
    expect(html).toContain('Sem informação')
    expect(html).toContain('Outros')
    expect(html).not.toContain('__unassigned__')
    expect(html).not.toContain('__other__')
  })

  it('scales against the biggest row, not the total', () => {
    const html = render(<CategoryBars rows={rows} />)
    expect(html).toContain('width:100%')
    expect(html).toContain('width:50%')
  })

  it('keeps a nonzero row visible even when it rounds to nothing', () => {
    const html = render(
      <CategoryBars rows={[row({ key: 'a', count: 1000 }), row({ key: 'b', count: 1 })]} />,
    )
    expect(html).toContain('width:1.5%')
  })

  it('says so when there is nothing to show', () => {
    expect(render(<CategoryBars rows={[]} />)).toContain('Sem dados neste período')
  })
})

describe('GoalMeters', () => {
  const measured: GoalAttainmentRow = {
    agentId: 'a',
    agentName: 'Clara',
    metricId: 'conversations_per_day',
    metricLabelKey: 'goalConversationsPerDay',
    target: 10,
    actual: 4,
    ratio: 0.4,
    measured: true,
  }
  const unmeasured: GoalAttainmentRow = {
    ...measured,
    metricId: 'meetings_per_week',
    metricLabelKey: 'goalMeetingsPerWeek',
    target: 5,
    actual: null,
    ratio: null,
    measured: false,
  }

  it('draws a meter for a measured target', () => {
    const html = render(<GoalMeters rows={[measured]} />)
    expect(html).toContain('4 / 10')
    expect(html).toContain('40%')
    expect(html).toContain('width:40%')
  })

  it('draws NO meter for an unmeasurable one', () => {
    // An empty bar at 0% would read as an agent failing completely,
    // and somebody would switch off an agent that works fine.
    const html = render(<GoalMeters rows={[unmeasured]} />)
    expect(html).toContain('Sem fonte de medição')
    expect(html).not.toContain('width:0%')
    expect(html).not.toContain('0%<')
    expect(html).toContain('limitação nossa')
  })

  it('caps the meter at full instead of overflowing the track', () => {
    const html = render(
      <GoalMeters rows={[{ ...measured, actual: 30, ratio: 3 }]} />,
    )
    expect(html).toContain('width:100%')
    expect(html).toContain('300%')
  })

  it('rounds a scaled target to something readable', () => {
    const html = render(<GoalMeters rows={[{ ...measured, target: 7.03 }]} />)
    expect(html).toContain('4 / 7')
    expect(html).not.toContain('7.03')
  })

  it('says so when no agent has a target', () => {
    expect(render(<GoalMeters rows={[]} />)).toContain(
      'Nenhum agente tem meta definida',
    )
  })
})

describe('FirstResponse', () => {
  const summary: FirstResponseSummary = {
    replied: 40,
    unreplied: 3,
    medianMinutes: 4.5,
    p90Minutes: 38,
    byResponder: [
      { responder: 'agent', replied: 30, medianMinutes: 6 },
      { responder: 'bot', replied: 10, medianMinutes: 0.2 },
    ],
    byDay: [
      { day: '2026-05-17', replied: 0, medianMinutes: null },
      { day: '2026-05-18', replied: 40, medianMinutes: 4.5 },
    ],
  }

  it('shows median, p90 and unanswered as separate numbers', () => {
    const html = render(<FirstResponse summary={summary} />)
    expect(html).toContain('4,5 min')
    expect(html).toContain('38 min')
    expect(html).toMatch(/Sem resposta<\/dt><dd[^>]*>3</)
  })

  it('names who answered instead of leaking the raw sender type', () => {
    const html = render(<FirstResponse summary={summary} />)
    expect(html).toContain('Respondido por pessoa')
    expect(html).toContain('Respondido por IA / fluxo')
    expect(html).toContain('0,2 min')
    expect(html).not.toContain('>bot<')
  })

  it('leaves a day with no answered wait empty and keeps its slot', () => {
    const html = render(<FirstResponse summary={summary} />)
    expect(html.match(/flex h-full flex-1/g)).toHaveLength(2)
    expect(html).toContain('height:0%')
    expect(html).toContain('height:100%')
  })

  it('says there is no data rather than drawing zeros', () => {
    const html = render(
      <FirstResponse
        summary={{ ...summary, replied: 0, unreplied: 0, medianMinutes: null, p90Minutes: null, byResponder: [] }}
      />,
    )
    expect(html).not.toContain('min<')
    expect(html).not.toContain('flex h-full flex-1')
  })
})
