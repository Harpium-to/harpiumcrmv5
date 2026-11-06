import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))

const { TemplateView } = await import('./view')
const { TemplatesPanel } = await import('../../[accountId]/templates-panel')

const content = {
  pipelines: [{ name: 'Pacientes', stages: [{ name: 'Novo contato' }, { name: 'Agendamento' }] }],
  tags: [{ name: 'Convênio', color: '#8b5cf6' }],
  custom_fields: [{ name: 'Especialidade', type: 'text', options: ['Cardiologia', 'Pediatria'] }],
  quick_replies: [{ title: 'Boas-vindas', text: 'Olá!' }],
  automations: [
    {
      name: 'Agendamento',
      trigger: 'keyword_match',
      trigger_config: { keywords: ['agendar', 'consulta'], match_type: 'contains' },
      steps: [
        { type: 'add_tag', config: { tag: 'Convênio' } },
        { type: 'create_deal', config: { pipeline: 'Pacientes', stage: 'Agendamento', title: 'Consulta' } },
        { type: 'wait', config: { amount: 2, unit: 'hours' } },
      ],
    },
  ],
}

describe('TemplateView', () => {
  it('reads like what the CRM will get, not like JSON', () => {
    const html = renderToStaticMarkup(<TemplateView content={content} />)
    expect(html).toContain('1. Novo contato')
    expect(html).toContain('2. Agendamento')
    expect(html).toContain('Cardiologia, Pediatria')
    expect(html).toContain('Quando: Mensagem com palavra-chave (agendar, consulta)')
    expect(html).toContain('Marca a etiqueta “Convênio”')
    expect(html).toContain('Cria negócio “Consulta” em Pacientes › Agendamento')
    expect(html).toContain('Espera 2 horas')
  })

  it('flags a broken template instead of rendering it', () => {
    const html = renderToStaticMarkup(
      <TemplateView content={{ automations: [{ name: 'X', trigger: 'tag_added', steps: [] }] }} />,
    )
    expect(html).toContain('pode chegar quebrado')
    expect(html).toContain('gatilho &quot;tag_added&quot; não pode ir num modelo')
  })
})

describe('TemplatesPanel (CRM page)', () => {
  const base = {
    accountId: 'a',
    templates: [
      {
        id: 't1',
        name: 'Clínica médica',
        counts: { pipelines: 1, stages: 6, tags: 5, customFields: 4, quickReplies: 5, automations: 2 },
      },
    ],
    applications: [
      {
        templateName: 'Clínica médica',
        appliedAt: '2026-11-04T12:00:00Z',
        summary: { pipelines: 1, stages: 6, tags: 5, custom_fields: 4, quick_replies: 5, automations: 2, skipped: 0 },
      },
    ],
    canEdit: true,
    canApplyNow: true,
    canSave: true,
    isSuper: true,
  }

  it('shows what was applied and offers to apply and save', () => {
    const html = renderToStaticMarkup(<TemplatesPanel {...base} />)
    expect(html).toContain('Clínica médica')
    expect(html).toContain('Criado: 1 funil (6 etapas)')
    expect(html).toContain('Aplicar')
    expect(html).toContain('Salvar como modelo')
    expect(html).toContain('Nunca contatos ou conversas')
  })

  it('a live CRM without full consent explains why applying is off', () => {
    const html = renderToStaticMarkup(<TemplatesPanel {...base} canApplyNow={false} />)
    expect(html).toContain('só em implantação ou com acesso Total')
  })

  it('at metrics the configuration cannot be copied', () => {
    const html = renderToStaticMarkup(<TemplatesPanel {...base} canSave={false} />)
    expect(html).toContain('a configuração dele não pode ser copiada')
  })

  it('a manager does not see "save as template"', () => {
    const html = renderToStaticMarkup(<TemplatesPanel {...base} isSuper={false} />)
    expect(html).not.toContain('Salvar como modelo')
  })
})
