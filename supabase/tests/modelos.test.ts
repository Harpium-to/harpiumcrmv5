// ============================================================
// Migration 053 — niche templates: the built-in ones, applying a
// template to a CRM (additive, consent-checked), and saving a CRM's
// structure as a new template.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

async function templateId(db: PGlite, slug: string): Promise<string> {
  const [row] = await sql<{ id: string }>(db, 'SELECT id FROM crm_templates WHERE slug = $1', [
    slug,
  ])
  return row.id
}

function newCrm(db: PGlite, name: string, level = 'metrics') {
  return asUser<{ id: string }>(
    db,
    U.agus,
    `SELECT agencia_create_account($1, $2, $3, NOW() + INTERVAL '7 days', NULL, $4) AS id`,
    [name, `${name.toLowerCase().replace(/\W/g, '')}@teste.dev`, `tok-${name}`, level],
  ).then((r) => r[0].id)
}

function apply(db: PGlite, actor: string, accountId: string, tplId: string) {
  return asUser<{ s: Record<string, number> }>(
    db,
    actor,
    'SELECT agencia_apply_template($1, $2) AS s',
    [accountId, tplId],
  ).then((r) => r[0].s)
}

describe('053 — built-in templates', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('ships Clínica médica, Academia and Serviços', async () => {
    const rows = await sql<{ slug: string; niche: string; built_in: boolean }>(
      w.db,
      'SELECT slug, niche, built_in FROM crm_templates ORDER BY slug',
    )
    expect(rows).toEqual([
      { slug: 'academia', niche: 'gym', built_in: true },
      { slug: 'clinica-medica', niche: 'medical_clinic', built_in: true },
      { slug: 'servicos', niche: 'services', built_in: true },
    ])
  })

  it('the clinic template suggests the most private access', async () => {
    const [row] = await sql<{ suggested_access: string }>(
      w.db,
      `SELECT suggested_access FROM crm_templates WHERE slug = 'clinica-medica'`,
    )
    expect(row.suggested_access).toBe('metrics')
  })

  it('only the agency can read templates', async () => {
    expect(await asUser(w.db, U.alice, 'SELECT * FROM crm_templates')).toEqual([])
    expect(await asUser(w.db, U.agus, 'SELECT * FROM crm_templates')).toHaveLength(3)
  })
})

describe('053 — applying a template', () => {
  let w: World
  let clinic: string
  let tpl: string
  beforeAll(async () => {
    w = await buildWorld()
    clinic = await newCrm(w.db, 'Clínica Sol')
    tpl = await templateId(w.db, 'clinica-medica')
  })

  it('fills an onboarding CRM with the whole package', async () => {
    const summary = await apply(w.db, U.agus, clinic, tpl)
    expect(summary).toEqual({
      pipelines: 1,
      stages: 6,
      tags: 5,
      custom_fields: 4,
      quick_replies: 5,
      automations: 2,
      skipped: 0,
    })
    const stages = await sql<{ name: string }>(
      w.db,
      `SELECT s.name FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
       WHERE p.account_id = $1 ORDER BY s.position`,
      [clinic],
    )
    expect(stages.map((s) => s.name)).toEqual([
      'Novo contato',
      'Agendamento',
      'Consulta realizada',
      'Retorno / tratamento',
      'Fidelizado',
      'Perdido',
    ])
  })

  it('automations arrive switched off, with names turned into real ids', async () => {
    const autos = await sql<{ name: string; is_active: boolean }>(
      w.db,
      'SELECT name, is_active FROM automations WHERE account_id = $1 ORDER BY name',
      [clinic],
    )
    expect(autos.every((a) => a.is_active === false)).toBe(true)

    const steps = await sql<{ step_type: string; step_config: Record<string, string> }>(
      w.db,
      `SELECT st.step_type, st.step_config FROM automation_steps st
       JOIN automations a ON a.id = st.automation_id
       WHERE a.account_id = $1 AND a.name = 'Boas-vindas ao novo paciente'
       ORDER BY st.position`,
      [clinic],
    )
    expect(steps.map((s) => s.step_type)).toEqual(['send_message', 'add_tag', 'create_deal'])
    const [tag] = await sql<{ name: string }>(w.db, 'SELECT name FROM tags WHERE id = $1', [
      steps[1].step_config.tag_id,
    ])
    expect(tag.name).toBe('Primeira consulta')
    const [stage] = await sql<{ name: string; account_id: string }>(
      w.db,
      `SELECT s.name, p.account_id FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = $1 AND p.id = $2`,
      [steps[2].step_config.stage_id, steps[2].step_config.pipeline_id],
    )
    expect(stage).toEqual({ name: 'Novo contato', account_id: clinic })
  })

  it('is additive: applying again creates nothing and skips everything', async () => {
    const summary = await apply(w.db, U.agus, clinic, tpl)
    expect(summary).toEqual({
      pipelines: 0,
      stages: 0,
      tags: 0,
      custom_fields: 0,
      quick_replies: 0,
      automations: 0,
      skipped: 17,
    })
  })

  it('records what was applied, by whom', async () => {
    const rows = await sql<{ template_name: string; applied_by: string }>(
      w.db,
      'SELECT template_name, applied_by FROM crm_template_applications WHERE account_id = $1',
      [clinic],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ template_name: 'Clínica médica', applied_by: U.agus })
    const audit = await sql<{ action: string }>(
      w.db,
      `SELECT action FROM agencia_auditoria WHERE account_id = $1 AND action = 'apply_template'`,
      [clinic],
    )
    expect(audit).toHaveLength(2)
  })

  it('a live client CRM needs the owner’s full consent', async () => {
    const gym = await templateId(w.db, 'academia')
    // A is active with 'read' (049 backfill).
    expect(await errorCode(apply(w.db, U.agus, w.A, gym))).toBe('42501')
    await asUser(w.db, U.dave, `SELECT set_agency_access('full')`)
    const summary = await apply(w.db, U.agus, w.D, gym)
    expect(summary.pipelines).toBe(1)
  })

  it('support, and managers outside their portfolio, cannot apply', async () => {
    expect(await errorCode(apply(w.db, U.sara, clinic, tpl))).toBe('42501')
    expect(await errorCode(apply(w.db, U.mel, clinic, tpl))).toBe('42501')
  })

  it('an inactive template cannot be applied', async () => {
    await sql(w.db, `UPDATE crm_templates SET active = FALSE WHERE slug = 'servicos'`)
    const other = await newCrm(w.db, 'Outra')
    expect(
      await errorCode(apply(w.db, U.agus, other, await templateId(w.db, 'servicos'))),
    ).toBe('22023')
  })
})

describe('053 — saving a CRM as a template', () => {
  let w: World
  let source: string
  beforeAll(async () => {
    w = await buildWorld()
    source = await newCrm(w.db, 'Modelo base')
    await apply(w.db, U.agus, source, await templateId(w.db, 'clinica-medica'))
  })

  const save = (actor: string, accountId: string, name = 'Clínica da casa') =>
    asUser<{ id: string }>(
      w.db,
      actor,
      `SELECT agencia_template_from_account($1, $2, 'medical_clinic', 'Teste') AS id`,
      [accountId, name],
    ).then((r) => r[0].id)

  it('only a super admin saves templates', async () => {
    expect(await errorCode(save(U.mel, source))).toBe('42501')
  })

  it('a live CRM at metrics can’t be copied — its texts are the client’s', async () => {
    expect(await errorCode(save(U.agus, w.E))).toBe('42501')
  })

  it('copies the structure, with ids turned back into names', async () => {
    const id = await save(U.agus, source)
    const [tpl] = await sql<{ content: Record<string, Array<Record<string, unknown>>>; built_in: boolean }>(
      w.db,
      'SELECT content, built_in FROM crm_templates WHERE id = $1',
      [id],
    )
    expect(tpl.built_in).toBe(false)
    expect(tpl.content.pipelines).toHaveLength(1)
    expect(tpl.content.tags).toHaveLength(5)
    expect(tpl.content.quick_replies).toHaveLength(5)
    const welcome = tpl.content.automations.find(
      (a) => a.name === 'Boas-vindas ao novo paciente',
    ) as { steps: Array<{ type: string; config: Record<string, string> }> }
    expect(welcome.steps[1]).toEqual({ type: 'add_tag', config: { tag: 'Primeira consulta' } })
    expect(welcome.steps[2].config).toMatchObject({ pipeline: 'Pacientes', stage: 'Novo contato' })
  })

  it('a saved template applies cleanly to another CRM (round trip)', async () => {
    const id = await save(U.agus, source, 'Cópia')
    const target = await newCrm(w.db, 'Destino')
    const summary = await apply(w.db, U.agus, target, id)
    expect(summary).toMatchObject({ pipelines: 1, stages: 6, tags: 5, automations: 2, skipped: 0 })
  })

  it('never copies contacts or conversations', async () => {
    const id = await save(U.agus, source, 'Sem dados')
    const [tpl] = await sql<{ keys: string[] }>(
      w.db,
      'SELECT array(SELECT jsonb_object_keys(content)) AS keys FROM crm_templates WHERE id = $1',
      [id],
    )
    expect(tpl.keys.sort()).toEqual([
      'automations',
      'custom_fields',
      'pipelines',
      'quick_replies',
      'tags',
    ])
  })
})
