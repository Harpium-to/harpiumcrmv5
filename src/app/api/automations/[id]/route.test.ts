import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// An automation belongs to the CRM, not to whoever created it.
//
// These routes used to filter by `user_id = auth.uid()`, so in a shared CRM
// the list (read through RLS, scoped to the active CRM) showed every
// automation, but only its author could open, pause, delete or duplicate
// it — everyone else got "Falha ao carregar (404)". The agency login hit it
// on the "Lead recebido" automation that does the SDR of the quiz leads.
//
// The real getCurrentAccount / requireRole run here: the session and the
// `current_account_context()` answer come from a fake SSR client, the rows
// from an in-memory database. That database applies no RLS, so every 404
// below comes from the route's own `account_id` filter.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

const CRM = 'acct-harpium-digital'
const OUTRO_CRM = 'acct-outro-cliente'
const AUTOMACAO = 'a8dd0f7a-d87c-441a-8187-2030f7007732'
const DO_VIZINHO = 'b1b1b1b1-0000-4000-8000-000000000001'

type Pessoa = { id: string; accountId: string; role: string; viaAgency?: boolean }

/** Who is on the CRM, and as what. Only `autor` created the automation. */
const PESSOAS = {
  autor: { id: 'user-autor', accountId: CRM, role: 'owner' },
  agencia: { id: 'user-agencia', accountId: CRM, role: 'admin', viaAgency: true },
  agente: { id: 'user-agente', accountId: CRM, role: 'agent' },
  leitor: { id: 'user-leitor', accountId: CRM, role: 'viewer' },
  // Admin too — but of another CRM, which is the one active for them.
  vizinho: { id: 'user-vizinho', accountId: OUTRO_CRM, role: 'admin' },
} satisfies Record<string, Pessoa>

type Nome = keyof typeof PESSOAS

function world(): Record<string, Row[]> {
  return {
    automations: [
      {
        id: AUTOMACAO,
        account_id: CRM,
        user_id: PESSOAS.autor.id,
        name: 'SDR dos leads do quiz',
        description: null,
        trigger_type: 'lead_received',
        trigger_config: { origens: ['Quiz planejados'] },
        is_active: true,
      },
      {
        id: DO_VIZINHO,
        account_id: OUTRO_CRM,
        user_id: PESSOAS.vizinho.id,
        name: 'Boas-vindas',
        description: null,
        trigger_type: 'first_inbound_message',
        trigger_config: {},
        is_active: true,
      },
    ],
    automation_steps: [
      {
        id: 'step-1',
        automation_id: AUTOMACAO,
        parent_step_id: null,
        branch: null,
        step_type: 'send_message',
        step_config: { text: 'Oi, {{nome}}! Vi que você fez o quiz.' },
        position: 0,
      },
      {
        id: 'step-2',
        automation_id: AUTOMACAO,
        parent_step_id: null,
        branch: null,
        step_type: 'add_tag',
        step_config: { tag_id: 'tag-sdr' },
        position: 1,
      },
    ],
  }
}

let db: Record<string, Row[]> = world()
let caller: Pessoa | null = null
let seq = 0

/** Minimal Supabase query builder over `db`: eq filters, insert/update/delete. */
function fakeDb() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let payload: unknown = null
      let returning = false
      const matches = (r: Row) => filters.every(([col, v]) => r[col] === v)

      const run = (): Row[] => {
        const rows = (db[table] ??= [])
        if (op === 'insert') {
          const list = (Array.isArray(payload) ? payload : [payload]) as Row[]
          const added = list.map((r) => ({ id: `${table}-${++seq}`, ...r }))
          rows.push(...added)
          return added
        }
        const hit = rows.filter(matches)
        if (op === 'update') for (const r of hit) Object.assign(r, payload)
        if (op === 'delete') db[table] = rows.filter((r) => !matches(r))
        return hit.map((r) => ({ ...r }))
      }
      const result = () => {
        const rows = run()
        return { data: op === 'select' || returning ? rows : null, error: null }
      }

      const q = {
        select: () => {
          returning = true
          return q
        },
        insert: (values: unknown) => ((op = 'insert'), (payload = values), q),
        update: (values: Row) => ((op = 'update'), (payload = values), q),
        delete: () => ((op = 'delete'), q),
        eq: (col: string, v: unknown) => (filters.push([col, v]), q),
        order: () => q,
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => {
          const rows = run()
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { message: `expected one row, got ${rows.length}` } }
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve().then(result).then(ok, ko),
      }
      return q
    },
  }
}

/** The SSR client: the session, plus what `current_account_context()` answers. */
function fakeSsrClient() {
  return {
    ...fakeDb(),
    auth: {
      getUser: async () => ({ data: { user: caller ? { id: caller.id } : null }, error: null }),
    },
    rpc: async (fn: string) => {
      if (fn !== 'current_account_context' || !caller) return { data: null, error: null }
      return {
        data: {
          account_id: caller.accountId,
          account_name: caller.accountId === CRM ? 'Harpium Digital' : 'Outro cliente',
          role: caller.role,
          status: 'active',
          via_agency: caller.viaAgency ?? false,
        },
        error: null,
      }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSsrClient() }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => fakeDb() }))

import { DELETE, GET, PATCH } from './route'
import { POST as DUPLICATE } from './duplicate/route'

function entra(nome: Nome | null) {
  caller = nome ? PESSOAS[nome] : null
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const url = (id: string) => `http://localhost/api/automations/${id}`

const open = (id = AUTOMACAO) => GET(new Request(url(id)), ctx(id))
const patch = (body: Row, id = AUTOMACAO) =>
  PATCH(
    new Request(url(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx(id),
  )
const remove = (id = AUTOMACAO) => DELETE(new Request(url(id), { method: 'DELETE' }), ctx(id))
const duplicate = (id = AUTOMACAO) =>
  DUPLICATE(new Request(`${url(id)}/duplicate`, { method: 'POST' }), ctx(id))

const automation = (id = AUTOMACAO) => db.automations.find((a) => a.id === id)
const stepsOf = (id: string) => db.automation_steps.filter((s) => s.automation_id === id)

beforeEach(() => {
  db = world()
  caller = null
  seq = 0
})

describe('GET /api/automations/:id — abrir a automação', () => {
  it.each(['agencia', 'agente', 'leitor', 'autor'] as const)(
    'abre para %s, que está no CRM ativo',
    async (nome) => {
      entra(nome)
      const res = await open()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.automation).toMatchObject({ id: AUTOMACAO, name: 'SDR dos leads do quiz' })
      expect(body.steps.map((s: Row) => s.step_type)).toEqual(['send_message', 'add_tag'])
    },
  )

  it('continua 404 para quem está em outro CRM, mesmo sendo admin lá', async () => {
    entra('vizinho')
    const res = await open()
    expect(res.status).toBe(404)
    expect(await res.json()).not.toHaveProperty('steps')
  })

  it('e 404 para a automação de outro CRM aberta daqui', async () => {
    entra('agencia')
    expect((await open(DO_VIZINHO)).status).toBe(404)
  })

  it('pede login sem sessão', async () => {
    entra(null)
    expect((await open()).status).toBe(401)
  })
})

describe('PATCH /api/automations/:id — editar', () => {
  it.each(['agencia', 'agente'] as const)('%s, que não criou, consegue pausar', async (nome) => {
    entra(nome)
    const res = await patch({ is_active: false })
    expect(res.status).toBe(200)
    expect(automation()?.is_active).toBe(false)
  })

  it('salva o construtor inteiro de uma automação ativa (nome e passos)', async () => {
    entra('agente')
    const res = await patch({
      name: 'SDR do quiz (v2)',
      steps: [{ step_type: 'send_message', step_config: { text: 'Olá! Recebi seu quiz.' } }],
    })
    expect(res.status).toBe(200)
    expect(automation()?.name).toBe('SDR do quiz (v2)')
    expect(stepsOf(AUTOMACAO).map((s) => s.step_config)).toEqual([
      { text: 'Olá! Recebi seu quiz.' },
    ])
  })

  it('o leitor não edita: 403 e nada muda', async () => {
    entra('leitor')
    const res = await patch({ is_active: false, steps: [] })
    expect(res.status).toBe(403)
    expect(automation()?.is_active).toBe(true)
    expect(stepsOf(AUTOMACAO)).toHaveLength(2)
  })

  it('quem está em outro CRM recebe 404 e nada muda', async () => {
    entra('vizinho')
    const res = await patch({ name: 'invadida', is_active: false, steps: [] })
    expect(res.status).toBe(404)
    expect(automation()).toMatchObject({ name: 'SDR dos leads do quiz', is_active: true })
    expect(stepsOf(AUTOMACAO)).toHaveLength(2)
  })

  it('ainda valida a configuração ao manter ativa', async () => {
    entra('agencia')
    const res = await patch({ steps: [] })
    expect(res.status).toBe(400)
    expect(stepsOf(AUTOMACAO)).toHaveLength(2)
  })
})

describe('DELETE /api/automations/:id — excluir', () => {
  it('quem não criou consegue excluir (agente)', async () => {
    entra('agente')
    const res = await remove()
    expect(res.status).toBe(200)
    expect(automation()).toBeUndefined()
  })

  it('o leitor não exclui: 403', async () => {
    entra('leitor')
    expect((await remove()).status).toBe(403)
    expect(automation()).toBeDefined()
  })

  it('quem está em outro CRM recebe 404 em vez de um "excluída" que não excluiu', async () => {
    entra('vizinho')
    expect((await remove()).status).toBe(404)
    expect(automation()).toBeDefined()
  })
})

describe('POST /api/automations/:id/duplicate — duplicar', () => {
  it('quem não criou duplica no mesmo CRM, desligada e com os passos', async () => {
    entra('agencia')
    const res = await duplicate()
    expect(res.status).toBe(201)
    const { automation: copy } = await res.json()
    expect(copy).toMatchObject({
      account_id: CRM,
      user_id: PESSOAS.agencia.id,
      name: 'SDR dos leads do quiz (Copy)',
      is_active: false,
    })
    expect(stepsOf(copy.id).map((s) => s.step_type)).toEqual(['send_message', 'add_tag'])
  })

  it('o leitor não duplica: 403', async () => {
    entra('leitor')
    expect((await duplicate()).status).toBe(403)
    expect(db.automations).toHaveLength(2)
  })

  it('quem está em outro CRM recebe 404 e nada é criado', async () => {
    entra('vizinho')
    expect((await duplicate()).status).toBe(404)
    expect(db.automations).toHaveLength(2)
  })
})
