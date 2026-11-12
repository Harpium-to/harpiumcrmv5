import { describe, it, expect } from 'vitest'
import { buildLeadNote, noteMarker } from './note'
import { normalizeLead } from './parse'

const when = new Date('2026-11-11T22:15:00Z') // 19:15 in São Paulo

describe('buildLeadNote', () => {
  it('writes answers, route, campaign and leftover fields', () => {
    const lead = normalizeLead({
      versao: '1',
      origem: 'quiz-planejados',
      contato: { nome: 'Ana', telefone: '+5563999990000' },
      campanha: { utm_source: 'meta', utm_campaign: 'planejados-nov' },
      qualificacao: { rota: 'A', qualificado: true, pontuacao: 80, motivos: ['perfil completo'] },
      respostas: [
        { pergunta: 'Faturamento mensal', resposta: 'De R$ 75 mil a R$ 150 mil' },
        { pergunta: 'Maior desafio', resposta: 'Preço' },
      ],
      nota: 'Pediu retorno à tarde',
      consentimento: { aceito: true, em: '2026-11-11' },
    })
    const text = buildLeadNote({
      lead,
      leadId: 'lead-1',
      receivedAt: when,
      extraFields: { ticket_medio: '40a80' },
    })
    expect(text).toBe(
      [
        'Lead recebido · quiz-planejados · 11/11/2026, 19:15\nCampanha: planejados-nov · utm_source: meta · utm_campaign: planejados-nov',
        'Rota A · qualificado · pontuação 80\nMotivos: perfil completo',
        'Respostas\n• Faturamento mensal: De R$ 75 mil a R$ 150 mil\n• Maior desafio: Preço',
        'Outros dados\n• ticket_medio: 40a80',
        'Observação\nPediu retorno à tarde',
        'Consentimento (LGPD): aceito em 2026-11-11',
        noteMarker('lead-1'),
      ].join('\n\n'),
    )
  })

  it('skips the note for a bare name + phone', () => {
    const lead = normalizeLead({ nome: 'Pedro', telefone: '11988887777' })
    expect(buildLeadNote({ lead, leadId: 'x', receivedAt: when, extraFields: {} })).toBeNull()
  })

  it('keeps UTMs of an otherwise plain lead', () => {
    const lead = normalizeLead({ nome: 'Pedro', telefone: '11988887777', utm_source: 'google' })
    const text = buildLeadNote({ lead, leadId: 'x', receivedAt: when, extraFields: {} })
    expect(text).toContain('utm_source: google')
    expect(text).toContain('Lead recebido · formulário')
  })
})
