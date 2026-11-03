import { describe, it, expect } from 'vitest'
import { decide, toAutonomy, toolForAction, type AgentPolicy } from './autonomy'

function policy(over: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    autonomy: 3,
    tools: ['crm', 'pipeline', 'messaging', 'calendar', 'proposals', 'delegation'],
    requireApprovalFor: [],
    ...over,
  }
}

describe('decide', () => {
  it('blocks an action whose tool was never granted', () => {
    const result = decide(policy({ tools: ['crm'] }), 'send_message')
    expect(result).toEqual({ allowed: false, reason: 'tool_not_granted' })
  })

  it('checks the tool before autonomy, so approval cannot grant a missing tool', () => {
    // The bug this guards: a researcher with no messaging tool becoming
    // a sender the moment a human clicks Approve.
    const result = decide(
      policy({ autonomy: 1, tools: ['crm'] }),
      'send_message',
    )
    expect(result).toEqual({ allowed: false, reason: 'tool_not_granted' })
  })

  it('lets a level 2 agent keep the CRM up to date unattended', () => {
    expect(decide(policy({ autonomy: 2 }), 'update_crm')).toEqual({
      allowed: true,
      needsApproval: false,
    })
  })

  it('stops a level 2 agent before it speaks to a customer', () => {
    expect(decide(policy({ autonomy: 2 }), 'send_message')).toEqual({
      allowed: true,
      needsApproval: true,
      reason: 'autonomy_below_threshold',
    })
  })

  it('lets a level 3 agent speak unattended', () => {
    expect(decide(policy({ autonomy: 3 }), 'send_message')).toEqual({
      allowed: true,
      needsApproval: false,
    })
  })

  it('requires approval for everything at level 1', () => {
    for (const action of ['update_crm', 'send_message', 'create_deal'] as const) {
      const result = decide(policy({ autonomy: 1 }), action)
      expect(result).toMatchObject({ allowed: true, needsApproval: true })
    }
  })

  it('never lets a discount, a close or a deletion run unattended at any level', () => {
    for (const action of ['give_discount', 'close_deal', 'delete_data'] as const) {
      expect(decide(policy({ autonomy: 4 }), action)).toEqual({
        allowed: true,
        needsApproval: true,
        reason: 'never_unattended',
      })
    }
  })

  it('honours an operator pin below the autonomy ceiling', () => {
    const result = decide(
      policy({ autonomy: 4, requireApprovalFor: ['send_message'] }),
      'send_message',
    )
    expect(result).toEqual({
      allowed: true,
      needsApproval: true,
      reason: 'pinned_by_operator',
    })
  })

  it('reserves delegation for the orchestrating level', () => {
    expect(decide(policy({ autonomy: 3 }), 'delegate_task')).toMatchObject({
      needsApproval: true,
    })
    expect(decide(policy({ autonomy: 4 }), 'delegate_task')).toEqual({
      allowed: true,
      needsApproval: false,
    })
  })
})

describe('toolForAction', () => {
  it('groups record-keeping actions under one grant', () => {
    expect(toolForAction('create_lead')).toBe('crm')
    expect(toolForAction('update_crm')).toBe('crm')
    expect(toolForAction('log_activity')).toBe('crm')
  })
})

describe('toAutonomy', () => {
  it('clamps out-of-range and unparseable values to a valid level', () => {
    expect(toAutonomy(0)).toBe(1)
    expect(toAutonomy(99)).toBe(4)
    expect(toAutonomy('3')).toBe(3)
    expect(toAutonomy('nonsense')).toBe(1)
    expect(toAutonomy(undefined)).toBe(1)
  })
})
