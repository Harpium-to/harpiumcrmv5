import { describe, expect, it } from 'vitest'

import { hasAgenciaRole, isAgenciaRole } from './roles'

describe('agency roles', () => {
  it('orders support < manager < super_admin', () => {
    expect(hasAgenciaRole('super_admin', 'super_admin')).toBe(true)
    expect(hasAgenciaRole('super_admin', 'support')).toBe(true)
    expect(hasAgenciaRole('manager', 'support')).toBe(true)
    expect(hasAgenciaRole('manager', 'super_admin')).toBe(false)
    expect(hasAgenciaRole('support', 'manager')).toBe(false)
  })

  it('accepts only the roles the database allows', () => {
    expect(isAgenciaRole('manager')).toBe(true)
    expect(isAgenciaRole('admin')).toBe(false)
    expect(isAgenciaRole(null)).toBe(false)
  })
})
