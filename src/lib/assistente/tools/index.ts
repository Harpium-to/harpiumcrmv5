import type { ToolSpec } from '@/lib/ai/tool-chat'

import { AUTOMATION_TOOLS } from './automacoes'
import { CRM_TOOLS } from './crm'
import { READ_TOOLS } from './leitura'
import { ROUTINE_TOOLS } from './rotinas'
import type { ToolDef } from '../types'

// ============================================================
// Every tool the assistant has, by name.
// ============================================================

export const ALL_TOOLS: ToolDef[] = [...READ_TOOLS, ...CRM_TOOLS, ...AUTOMATION_TOOLS, ...ROUTINE_TOOLS]

const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]))

export function toolByName(name: string): ToolDef | undefined {
  return BY_NAME.get(name)
}

export function toSpec(tool: ToolDef): ToolSpec {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}
