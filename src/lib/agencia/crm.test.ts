import { describe, expect, it } from 'vitest'

import {
  isAgencyAccessLevel,
  isCrmNiche,
  isCrmStatus,
  nicheLabel,
  toCrmStatus,
} from './crm'

describe('CRM vocabulary', () => {
  it('reads a missing status (before migration 050) as active', () => {
    expect(toCrmStatus(undefined)).toBe('active')
    expect(toCrmStatus(null)).toBe('active')
    expect(toCrmStatus('suspended')).toBe('suspended')
    expect(toCrmStatus('deleted')).toBe('active')
  })

  it('accepts only the statuses the database allows', () => {
    expect(isCrmStatus('archived')).toBe(true)
    expect(isCrmStatus('ativo')).toBe(false)
  })

  it('labels niches, and shows an unknown one as-is instead of hiding it', () => {
    expect(nicheLabel('gym')).toBe('Academia / Studio')
    expect(nicheLabel('padaria')).toBe('padaria')
    expect(nicheLabel(null)).toBeNull()
    expect(isCrmNiche('gym')).toBe(true)
    expect(isCrmNiche('padaria')).toBe(false)
  })

  it('knows the three agency access levels', () => {
    expect(isAgencyAccessLevel('metrics')).toBe(true)
    expect(isAgencyAccessLevel('full')).toBe(true)
    expect(isAgencyAccessLevel('total')).toBe(false)
  })
})

describe('auditActionLabel', () => {
  it('reads support-mode writes as sentences', async () => {
    const { auditActionLabel } = await import('./crm')
    expect(auditActionLabel('contacts_insert')).toBe('Criou um contato')
    expect(auditActionLabel('automations_update')).toBe('Alterou uma automação')
    expect(auditActionLabel('quick_replies_delete')).toBe('Excluiu uma resposta rápida')
    expect(auditActionLabel('messages_insert')).toBe('Enviou uma mensagem')
    expect(auditActionLabel('enter_account')).toBe('Entrou no CRM')
    expect(auditActionLabel('leave_account')).toBe('Saiu do CRM')
  })

  it('shows an unknown action as-is', async () => {
    const { auditActionLabel } = await import('./crm')
    expect(auditActionLabel('robots_insert')).toBe('robots_insert')
    expect(auditActionLabel('algo_novo')).toBe('algo_novo')
  })
})
