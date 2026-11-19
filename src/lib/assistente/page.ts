import type { ToolContext } from './types'

// ============================================================
// "Where is the person right now?" — so "essa automação" and "esse
// contato" mean something. The panel sends the path and query string;
// this names the screen and, when the URL points at one record, loads
// its name (through the person's RLS client, so a forged URL reveals
// nothing).
// ============================================================

export interface PageRef {
  /** Pathname, e.g. "/automations/4b1…/edit". */
  path: string
  /** Query string without "?", e.g. "contact=…". */
  search?: string
}

const SCREENS: [prefix: string, name: string][] = [
  ['/dashboard', 'Painel'],
  ['/inbox', 'Caixa de entrada'],
  ['/notifications', 'Notificações'],
  ['/contacts', 'Contatos'],
  ['/leads', 'Leads'],
  ['/pipelines', 'Funis (negócios)'],
  ['/agenda', 'Agenda'],
  ['/relatorios', 'Relatórios'],
  ['/agents', 'Agentes de IA'],
  ['/automations', 'Automações'],
  ['/flows', 'Fluxos'],
  ['/broadcasts', 'Disparos'],
  ['/canais', 'Canais'],
  ['/ferramentas', 'Ferramentas'],
  ['/settings', 'Configurações'],
  ['/ajuda', 'Ajuda'],
]

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export interface PageTarget {
  kind: 'contact' | 'conversation' | 'automation' | 'flow'
  id: string
}

/** Pure part: which screen, and which record the URL points at. */
export function parsePage(page: PageRef | null | undefined): { screen: string | null; target: PageTarget | null } {
  if (!page?.path || !page.path.startsWith('/')) return { screen: null, target: null }
  const path = page.path.split('?')[0]
  const screen = SCREENS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null
  const params = new URLSearchParams(page.search ?? '')

  let target: PageTarget | null = null
  const contact = params.get('contact')
  const conversation = params.get('c')
  if (contact && UUID.test(contact)) target = { kind: 'contact', id: contact }
  else if (path.startsWith('/inbox') && conversation && UUID.test(conversation)) {
    target = { kind: 'conversation', id: conversation }
  } else if (path.startsWith('/automations/')) {
    const id = path.split('/')[2]
    if (id && UUID.test(id)) target = { kind: 'automation', id }
  } else if (path.startsWith('/flows/')) {
    const id = path.split('/')[2]
    if (id && UUID.test(id)) target = { kind: 'flow', id }
  }
  const tab = params.get('tab')
  return { screen: screen && tab ? `${screen} › aba ${tab}` : screen, target }
}

/** One or two lines for the instructions. */
export async function describePage(ctx: ToolContext, page: PageRef | null | undefined): Promise<string> {
  const { screen, target } = parsePage(page)
  if (!screen) return 'Tela atual: desconhecida.'
  let record = ''
  if (target) {
    try {
      if (target.kind === 'contact') {
        const { data } = await ctx.db.from('contacts').select('name, phone').eq('id', target.id).eq('account_id', ctx.accountId).maybeSingle()
        if (data) record = `Contato aberto: ${data.name ?? data.phone} [${target.id}].`
      } else if (target.kind === 'conversation') {
        const { data } = await ctx.db
          .from('conversations')
          .select('contact:contacts(id, name)')
          .eq('id', target.id)
          .eq('account_id', ctx.accountId)
          .maybeSingle()
        const contact = (data as { contact?: { id?: string; name?: string } | null } | null)?.contact
        if (data) record = `Conversa aberta [${target.id}] com ${contact?.name ?? 'contato'} [${contact?.id ?? '?'}].`
      } else if (target.kind === 'automation') {
        const { data } = await ctx.db.from('automations').select('name').eq('id', target.id).eq('account_id', ctx.accountId).maybeSingle()
        if (data) record = `Automação aberta: ${data.name} [${target.id}].`
      } else if (target.kind === 'flow') {
        const { data } = await ctx.db.from('flows').select('name').eq('id', target.id).eq('account_id', ctx.accountId).maybeSingle()
        if (data) record = `Fluxo aberto: ${data.name} [${target.id}].`
      }
    } catch {
      record = ''
    }
  }
  return `Tela atual: ${screen}.${record ? ` ${record}` : ''}`
}
