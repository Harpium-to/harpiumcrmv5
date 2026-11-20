// ============================================================
// Migration 073 — Ferramentas › Extrator de leads; and the separate
// CNPJ base (supabase/cnpj-base/schema.sql).
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M073 = '073_extrator_leads.sql'

describe('073 — extractions and their results', () => {
  let w: World
  let exA: string
  let exD: string

  beforeAll(async () => {
    w = await buildWorld()
    const rows = await sql<{ id: string; name: string }>(
      w.db,
      `INSERT INTO lead_extractions (account_id, name, source, requested, found) VALUES
         ('${w.A}', 'Dentistas da A', 'cnpj', 100, 3),
         ('${w.D}', 'Lojas da D', 'google_maps', 50, 1)
       RETURNING id, name`,
    )
    exA = rows.find((r) => r.name === 'Dentistas da A')!.id
    exD = rows.find((r) => r.name === 'Lojas da D')!.id
    await sql(
      w.db,
      `INSERT INTO lead_extraction_results (account_id, extraction_id, source, external_key, name, phone, phone_normalized, status, imported_at) VALUES
         ('${w.A}', '${exA}', 'cnpj', '11111111000100', 'Um', '+5562999990001', '5562999990001', 'novo', NULL),
         ('${w.A}', '${exA}', 'cnpj', '22222222000100', 'Dois', '+5562999990002', '5562999990002', 'contato', NOW()),
         ('${w.A}', '${exA}', 'cnpj', '33333333000100', 'Três', NULL, NULL, 'sem_telefone', NULL),
         ('${w.D}', '${exD}', 'google_maps', 'ChIJ-1', 'Loja', '+5563999990001', '5563999990001', 'novo', NULL)`,
    )
    await sql(w.db, `INSERT INTO lead_extractor_settings (account_id, monthly_limit) VALUES ('${w.A}', 500)`)
  })

  const names = (u: string, table: string) =>
    asUser<{ name: string }>(w.db, u, `SELECT name FROM ${table} ORDER BY name`).then((r) => r.map((x) => x.name))

  it('members read their CRM only', async () => {
    expect(await names(U.carol, 'lead_extractions')).toEqual(['Dentistas da A'])
    expect(await names(U.dave, 'lead_extractions')).toEqual(['Lojas da D'])
    expect(await names(U.otto, 'lead_extractions')).toEqual([])
    expect(await names(U.bob, 'lead_extraction_results')).toEqual(['Dois', 'Três', 'Um'])
    expect(await names(U.dave, 'lead_extraction_results')).toEqual(['Loja'])
  })

  it('nobody writes through their own session, not even the owner', async () => {
    expect(
      await errorCode(
        asUser(
          w.db,
          U.alice,
          `INSERT INTO lead_extractions (account_id, name, source, requested) VALUES ($1, 'Direto', 'cnpj', 10)`,
          [w.A],
        ),
      ),
    ).toBe('42501')
    expect(await asUser(w.db, U.alice, `UPDATE lead_extractions SET requested = 5000 RETURNING id`)).toEqual([])
    expect(await asUser(w.db, U.alice, `DELETE FROM lead_extraction_results RETURNING id`)).toEqual([])
    expect(
      await asUser(w.db, U.alice, `UPDATE lead_extractor_settings SET monthly_limit = 99999 RETURNING account_id`),
    ).toEqual([])
    expect(
      await errorCode(
        asUser(
          w.db,
          U.alice,
          `INSERT INTO prospecting_blocklist (account_id, phone_normalized, reason) VALUES ($1, '5562911112222', 'manual')`,
          [w.A],
        ),
      ),
    ).toBe('42501')
  })

  it('the totals follow the caller', async () => {
    const totals = (u: string) =>
      asUser<Record<string, number>>(
        w.db,
        u,
        'SELECT kept, novos, contatos, sem_telefone, importados FROM lead_extraction_totals',
      )
    expect(await totals(U.alice)).toEqual([{ kept: 3, novos: 1, contatos: 1, sem_telefone: 1, importados: 1 }])
    expect(await totals(U.dave)).toEqual([{ kept: 1, novos: 1, contatos: 0, sem_telefone: 0, importados: 0 }])
    expect(await totals(U.otto)).toEqual([])
  })

  it('checks what goes in', async () => {
    const bad = (cols: string, values: string) =>
      errorCode(sql(w.db, `INSERT INTO lead_extractions (account_id, name, ${cols}) VALUES ('${w.A}', 'x', ${values})`))
    expect(await bad('source, requested', `'instagram', 10`)).toBe('23514')
    expect(await bad('source, requested', `'cnpj', 0`)).toBe('23514')
    expect(await bad('source, requested', `'cnpj', 5001`)).toBe('23514')
    expect(await bad('source, requested, status', `'cnpj', 10, 'pausada'`)).toBe('23514')
    // The same company twice in one extraction.
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO lead_extraction_results (account_id, extraction_id, source, external_key, name)
           VALUES ('${w.A}', '${exA}', 'cnpj', '11111111000100', 'De novo')`,
        ),
      ),
    ).toBe('23505')
  })

  it('a contact who opts out goes on the block list, and comes off when unmarked', async () => {
    const blocked = () =>
      sql<{ phone_normalized: string }>(
        w.db,
        `SELECT phone_normalized FROM prospecting_blocklist WHERE account_id = '${w.A}' ORDER BY 1`,
      ).then((r) => r.map((x) => x.phone_normalized))
    expect(await blocked()).toEqual([])
    // Bob is an agent: he may mark the contact, and has no access to the list.
    await asUser(w.db, U.bob, `UPDATE contacts SET opted_out_at = NOW() WHERE phone = '5511900000001'`)
    expect(await blocked()).toEqual(['5511900000001'])
    expect(
      await asUser<{ phone_normalized: string }>(w.db, U.carol, 'SELECT phone_normalized FROM prospecting_blocklist'),
    ).toEqual([{ phone_normalized: '5511900000001' }])
    expect(await asUser(w.db, U.dave, 'SELECT phone_normalized FROM prospecting_blocklist')).toEqual([])

    await asUser(w.db, U.bob, `UPDATE contacts SET opted_out_at = NULL WHERE phone = '5511900000001'`)
    expect(await blocked()).toEqual([])
  })

  it('the block survives the contact being deleted', async () => {
    await sql(
      w.db,
      `INSERT INTO contacts (user_id, account_id, phone, name, opted_out_at)
       VALUES ('${U.alice}', '${w.A}', '5562977776666', 'Saiu', NOW())`,
    )
    await sql(w.db, `DELETE FROM contacts WHERE phone = '5562977776666'`)
    const rows = await sql(
      w.db,
      `SELECT 1 FROM prospecting_blocklist WHERE account_id = '${w.A}' AND phone_normalized = '5562977776666'`,
    )
    expect(rows).toHaveLength(1)
  })

  it('bulk sends gain the prospecting mode, and recipients a reply mark', async () => {
    const [bulk] = await sql<{ mode: string; variations: unknown[] }>(
      w.db,
      `INSERT INTO bulk_sends (account_id, name, content_text, total, risk_accepted_at)
       VALUES ('${w.A}', 'Normal', 'Oi', 0, NOW()) RETURNING mode, variations`,
    )
    expect(bulk).toEqual({ mode: 'normal', variations: [] })
    expect(
      await errorCode(
        sql(
          w.db,
          `INSERT INTO bulk_sends (account_id, name, content_text, total, risk_accepted_at, mode)
           VALUES ('${w.A}', 'Errado', 'Oi', 0, NOW(), 'turbo')`,
        ),
      ),
    ).toBe('23514')
    const cols = await sql<{ column_name: string }>(
      w.db,
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'scheduled_messages' AND column_name = 'replied_at'`,
    )
    expect(cols).toHaveLength(1)
  })

  it('runs twice without changing anything, and picks up who had already opted out', async () => {
    await sql(w.db, `UPDATE contacts SET opted_out_at = NOW() WHERE phone = '5511900000002'`)
    await sql(w.db, `DELETE FROM prospecting_blocklist WHERE phone_normalized = '5511900000002'`)
    await applyMigration(w.db, M073)
    await applyMigration(w.db, M073)
    expect(await names(U.alice, 'lead_extractions')).toEqual(['Dentistas da A'])
    const rows = await sql(
      w.db,
      `SELECT 1 FROM prospecting_blocklist WHERE account_id = '${w.D}' AND phone_normalized = '5511900000002'`,
    )
    expect(rows).toHaveLength(1)
  })
})

describe('the CNPJ base', () => {
  let db: PGlite
  const schema = readFileSync(join(__dirname, '..', 'cnpj-base', 'schema.sql'), 'utf8')

  const search = (filters: Record<string, unknown>, after = '', limit = 200) =>
    db
      .query<{ cnpj: string; razao_social: string; municipio_nome: string; responsavel: string | null; mei: boolean }>(
        'SELECT cnpj, razao_social, municipio_nome, responsavel, mei FROM cnpj_buscar($1::jsonb, $2, $3)',
        [JSON.stringify(filters), after, limit],
      )
      .then((r) => r.rows)
  const count = (filters: Record<string, unknown>, ceiling = 10001) =>
    db
      .query<{ n: number }>('SELECT cnpj_contar($1::jsonb, $2) AS n', [JSON.stringify(filters), ceiling])
      .then((r) => r.rows[0].n)

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`)
    await db.exec(schema)
    await db.exec(schema)
    // Supabase grants the tables to every role and leaves the gate to RLS.
    await db.exec('GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated')
    await db.exec(`
      INSERT INTO cnpj_cnaes VALUES ('8630504', 'Atividade odontológica'), ('4754701', 'Comércio varejista de móveis');
      INSERT INTO cnpj_municipios VALUES (9373, 'GOIANIA', 'GO'), (9733, 'PALMAS', 'TO');
      INSERT INTO cnpj_empresas (basico, razao_social, natureza, porte, capital, mei, lote) VALUES
        ('11111111', 'CLINICA UM LTDA', '2062', '01', 50000, FALSE, '2026-11'),
        ('22222222', 'JOAO PEREIRA',    '2135', '01', 1000,  TRUE,  '2026-11'),
        ('33333333', 'MOVEIS TRES SA',  '2054', '05', 900000, FALSE, '2026-11'),
        ('44444444', 'CLINICA VELHA',   '2062', '03', 20000, FALSE, '2026-10');
      INSERT INTO cnpj_responsaveis VALUES ('11111111', 'ANA SOUZA', '2026-11');
      INSERT INTO cnpj_estabelecimentos
        (cnpj, basico, matriz, nome_fantasia, abertura, cnae, bairro, cep, uf, municipio, telefone1, email, tem_celular, lote) VALUES
        ('11111111000100', '11111111', TRUE,  'CLINICA UM', '2019-03-05', '8630504', 'SETOR BUENO', '74230100', 'GO', 9373, '62999990001', 'a@um.com', TRUE,  '2026-11'),
        ('11111111000281', '11111111', FALSE, 'CLINICA UM FILIAL', '2026-06-01', '8630504', 'CENTRO', '74000000', 'GO', 9373, '6232220002', NULL, FALSE, '2026-11'),
        ('22222222000100', '22222222', TRUE,  NULL, '2026-09-10', '8630504', 'SETOR BUENO', '74230200', 'GO', 9373, '62999990003', NULL, TRUE, '2026-11'),
        ('33333333000100', '33333333', TRUE,  'MOVEIS TRES', '2001-01-01', '4754701', 'PLANO DIRETOR', '77000000', 'TO', 9733, NULL, NULL, FALSE, '2026-11'),
        ('44444444000100', '44444444', TRUE,  'CLINICA VELHA', '2010-01-01', '8630504', 'CENTRO', '74000001', 'GO', 9373, NULL, NULL, FALSE, '2026-10');
    `)
  })

  const cnpjs = (rows: { cnpj: string }[]) => rows.map((r) => r.cnpj)

  it('filters by activity and city, with the names joined in', async () => {
    const rows = await search({ cnaes: ['8630504'], municipios: [9373], tipo: 'todos' })
    expect(cnpjs(rows)).toEqual(['11111111000100', '11111111000281', '22222222000100', '44444444000100'])
    expect(rows[0]).toMatchObject({ razao_social: 'CLINICA UM LTDA', municipio_nome: 'GOIANIA', responsavel: 'ANA SOUZA' })
    expect(cnpjs(await search({ cnaes: ['4754701'], ufs: ['TO'], tipo: 'todos' }))).toEqual(['33333333000100'])
  })

  it('separates MEI from companies', async () => {
    const base = { cnaes: ['8630504'], municipios: [9373] }
    expect(cnpjs(await search({ ...base, tipo: 'mei' }))).toEqual(['22222222000100'])
    expect(cnpjs(await search({ ...base, tipo: 'empresas' }))).not.toContain('22222222000100')
  })

  it('applies the other filters', async () => {
    const base = { cnaes: ['8630504'], municipios: [9373], tipo: 'todos' }
    expect(cnpjs(await search({ ...base, bairro: 'setor b' }))).toEqual(['11111111000100', '22222222000100'])
    expect(cnpjs(await search({ ...base, so_celular: true }))).toEqual(['11111111000100', '22222222000100'])
    expect(cnpjs(await search({ ...base, com_telefone: true }))).toHaveLength(3)
    expect(cnpjs(await search({ ...base, com_email: true }))).toEqual(['11111111000100'])
    expect(cnpjs(await search({ ...base, unidade: 'filial' }))).toEqual(['11111111000281'])
    expect(cnpjs(await search({ ...base, abertura_de: '2026-01-01' }))).toEqual(['11111111000281', '22222222000100'])
    expect(cnpjs(await search({ ...base, abertura_ate: '2015-01-01' }))).toEqual(['44444444000100'])
    expect(cnpjs(await search({ ...base, portes: ['03'] }))).toEqual(['44444444000100'])
    expect(cnpjs(await search({ ...base, capital_min: 30000 }))).toEqual(['11111111000100', '11111111000281'])
    expect(cnpjs(await search({ ...base, cep: '742302' }))).toEqual(['22222222000100'])
  })

  it('pages in CNPJ order and counts up to a ceiling', async () => {
    const base = { cnaes: ['8630504'], municipios: [9373], tipo: 'todos' }
    const first = await search(base, '', 2)
    expect(cnpjs(first)).toEqual(['11111111000100', '11111111000281'])
    expect(cnpjs(await search(base, first[1].cnpj, 2))).toEqual(['22222222000100', '44444444000100'])
    expect(await count(base)).toBe(4)
    expect(await count(base, 3)).toBe(3)
  })

  it('after a load, what did not come in the month goes away', async () => {
    let removed = 0
    for (;;) {
      const { rows } = await db.query<{ n: number }>(`SELECT cnpj_finalizar_lote('2026-11', 1) AS n`)
      if (!rows[0].n) break
      removed += rows[0].n
    }
    expect(removed).toBe(2)
    expect(cnpjs(await search({ cnaes: ['8630504'], municipios: [9373], tipo: 'todos' }))).not.toContain(
      '44444444000100',
    )
    const { rows } = await db.query<{ valor: string }>(`SELECT valor FROM cnpj_meta WHERE chave = 'lote'`)
    expect(rows).toEqual([{ valor: '2026-11' }])
  })

  it('the public key reads nothing', async () => {
    await db.exec('SET ROLE anon')
    try {
      expect((await db.query('SELECT * FROM cnpj_estabelecimentos')).rows).toEqual([])
      expect((await db.query('SELECT * FROM cnpj_empresas')).rows).toEqual([])
      await expect(db.query(`SELECT cnpj_contar('{}'::jsonb, 10)`)).rejects.toThrow()
    } finally {
      await db.exec('RESET ROLE')
    }
  })
})
