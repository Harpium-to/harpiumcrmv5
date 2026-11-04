-- ============================================================
-- 053_modelos_nicho.sql — niche templates for client CRMs (Fase 5)
--
-- See docs/plano-plataforma-agencia.md §7. A template is a package the
-- agency copies into a CRM: funnels with stages, tags, custom fields,
-- quick replies and automations (always created OFF — the client turns
-- them on). Copy, not link: editing a template later never touches a
-- CRM it was applied to.
--
--   crm_templates               the packages (3 built in, seeded once)
--   crm_template_applications   what was applied where, by whom, with
--                               a summary of what was created/skipped
--
--   agencia_apply_template      apply to a CRM — additive: anything
--                               with the same name already there is
--                               left alone. Writing into a client's
--                               CRM needs it to be in onboarding OR
--                               the owner to have granted full access.
--   agencia_template_from_account
--                               "save this CRM as a template" — its
--                               structure, never its contacts or
--                               conversations. super_admin only.
--
-- Content format (also validated app-side, src/lib/agencia/templates.ts):
--   { "pipelines":     [{ "name", "stages": [{ "name", "color" }] }],
--     "tags":          [{ "name", "color" }],
--     "custom_fields": [{ "name", "type", "options"? }],
--     "quick_replies": [{ "title", "text" }],
--     "automations":   [{ "name", "description"?, "trigger",
--                         "trigger_config"?, "steps": [{ "type", "config" }] }] }
-- Steps refer to tags / funnels BY NAME ("tag", "pipeline", "stage");
-- they become ids when applied, and back to names when saved.
--
-- Idempotent — safe to run multiple times.
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_templates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  niche            TEXT,
  description      TEXT,
  content          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- What the agency proposes to the owner for this kind of CRM.
  suggested_access TEXT NOT NULL DEFAULT 'metrics'
                   CHECK (suggested_access IN ('metrics', 'read', 'full')),
  built_in         BOOLEAN NOT NULL DEFAULT FALSE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON crm_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE crm_templates ENABLE ROW LEVEL SECURITY;

-- The agency reads them; writes go through the service role (API,
-- super_admin) or the functions below.
DROP POLICY IF EXISTS crm_templates_select ON crm_templates;
CREATE POLICY crm_templates_select ON crm_templates FOR SELECT
  USING (is_agencia());

CREATE TABLE IF NOT EXISTS crm_template_applications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id   UUID REFERENCES crm_templates(id) ON DELETE SET NULL,
  -- Kept so the record survives the template being deleted.
  template_name TEXT NOT NULL,
  applied_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_template_applications_account
  ON crm_template_applications(account_id, applied_at DESC);

ALTER TABLE crm_template_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_template_applications_select ON crm_template_applications;
CREATE POLICY crm_template_applications_select ON crm_template_applications FOR SELECT
  USING (is_agencia() OR is_account_member(account_id, 'admin'));


-- ============================================================
-- 2. APPLY CONTENT TO A CRM (internal)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_crm_template_content(
  p_account_id UUID,
  p_content JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
  v_pipeline JSONB;
  v_stage JSONB;
  v_item JSONB;
  v_step JSONB;
  v_pipeline_id UUID;
  v_automation_id UUID;
  v_tag_id UUID;
  v_stage_id UUID;
  v_config JSONB;
  v_pos INT;
  v_skip_step BOOLEAN;
  v_created JSONB := jsonb_build_object(
    'pipelines', 0, 'stages', 0, 'tags', 0, 'custom_fields', 0,
    'quick_replies', 0, 'automations', 0, 'skipped', 0
  );
BEGIN
  -- Legacy NOT NULL user_id columns on these tables get the CRM's
  -- owner pointer (the agency placeholder while in onboarding, 050).
  SELECT owner_user_id INTO v_author FROM accounts WHERE id = p_account_id;
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;

  -- Tags first: automations refer to them by name.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_content->'tags', '[]'::jsonb)) LOOP
    IF EXISTS (
      SELECT 1 FROM tags
      WHERE account_id = p_account_id AND lower(name) = lower(v_item->>'name')
    ) THEN
      v_created := jsonb_set(v_created, '{skipped}', to_jsonb((v_created->>'skipped')::int + 1));
    ELSE
      INSERT INTO tags (user_id, account_id, name, color)
      VALUES (v_author, p_account_id, v_item->>'name', COALESCE(v_item->>'color', '#3b82f6'));
      v_created := jsonb_set(v_created, '{tags}', to_jsonb((v_created->>'tags')::int + 1));
    END IF;
  END LOOP;

  FOR v_pipeline IN SELECT * FROM jsonb_array_elements(COALESCE(p_content->'pipelines', '[]'::jsonb)) LOOP
    IF EXISTS (
      SELECT 1 FROM pipelines
      WHERE account_id = p_account_id AND lower(name) = lower(v_pipeline->>'name')
    ) THEN
      v_created := jsonb_set(v_created, '{skipped}', to_jsonb((v_created->>'skipped')::int + 1));
      CONTINUE;
    END IF;

    INSERT INTO pipelines (user_id, account_id, name)
    VALUES (v_author, p_account_id, v_pipeline->>'name')
    RETURNING id INTO v_pipeline_id;
    v_created := jsonb_set(v_created, '{pipelines}', to_jsonb((v_created->>'pipelines')::int + 1));

    v_pos := 0;
    FOR v_stage IN SELECT * FROM jsonb_array_elements(COALESCE(v_pipeline->'stages', '[]'::jsonb)) LOOP
      INSERT INTO pipeline_stages (pipeline_id, name, position, color)
      VALUES (v_pipeline_id, v_stage->>'name', v_pos, COALESCE(v_stage->>'color', '#3b82f6'));
      v_pos := v_pos + 1;
      v_created := jsonb_set(v_created, '{stages}', to_jsonb((v_created->>'stages')::int + 1));
    END LOOP;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_content->'custom_fields', '[]'::jsonb)) LOOP
    IF EXISTS (
      SELECT 1 FROM custom_fields
      WHERE account_id = p_account_id AND lower(field_name) = lower(v_item->>'name')
    ) THEN
      v_created := jsonb_set(v_created, '{skipped}', to_jsonb((v_created->>'skipped')::int + 1));
    ELSE
      INSERT INTO custom_fields (user_id, account_id, field_name, field_type, field_options)
      VALUES (
        v_author, p_account_id, v_item->>'name',
        COALESCE(v_item->>'type', 'text'), v_item->'options'
      );
      v_created := jsonb_set(v_created, '{custom_fields}', to_jsonb((v_created->>'custom_fields')::int + 1));
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_content->'quick_replies', '[]'::jsonb)) LOOP
    IF EXISTS (
      SELECT 1 FROM quick_replies
      WHERE account_id = p_account_id AND lower(title) = lower(v_item->>'title')
    ) THEN
      v_created := jsonb_set(v_created, '{skipped}', to_jsonb((v_created->>'skipped')::int + 1));
    ELSE
      INSERT INTO quick_replies (account_id, user_id, title, kind, content_text)
      VALUES (p_account_id, v_author, v_item->>'title', 'text', v_item->>'text');
      v_created := jsonb_set(v_created, '{quick_replies}', to_jsonb((v_created->>'quick_replies')::int + 1));
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_content->'automations', '[]'::jsonb)) LOOP
    IF EXISTS (
      SELECT 1 FROM automations
      WHERE account_id = p_account_id AND lower(name) = lower(v_item->>'name')
    ) THEN
      v_created := jsonb_set(v_created, '{skipped}', to_jsonb((v_created->>'skipped')::int + 1));
      CONTINUE;
    END IF;

    -- Always OFF: the client decides when it starts talking to people.
    INSERT INTO automations (
      user_id, account_id, name, description, trigger_type, trigger_config, is_active
    ) VALUES (
      v_author, p_account_id, v_item->>'name', v_item->>'description',
      v_item->>'trigger', COALESCE(v_item->'trigger_config', '{}'::jsonb), FALSE
    )
    RETURNING id INTO v_automation_id;
    v_created := jsonb_set(v_created, '{automations}', to_jsonb((v_created->>'automations')::int + 1));

    v_pos := 0;
    FOR v_step IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'steps', '[]'::jsonb)) LOOP
      v_config := COALESCE(v_step->'config', '{}'::jsonb);
      v_skip_step := FALSE;

      IF v_step->>'type' IN ('add_tag', 'remove_tag') THEN
        SELECT id INTO v_tag_id FROM tags
        WHERE account_id = p_account_id AND lower(name) = lower(v_config->>'tag')
        LIMIT 1;
        IF v_tag_id IS NULL THEN
          INSERT INTO tags (user_id, account_id, name)
          VALUES (v_author, p_account_id, v_config->>'tag')
          RETURNING id INTO v_tag_id;
        END IF;
        v_config := jsonb_build_object('tag_id', v_tag_id);
      ELSIF v_step->>'type' = 'create_deal' THEN
        SELECT s.id, p.id INTO v_stage_id, v_pipeline_id
        FROM pipelines p
        JOIN pipeline_stages s ON s.pipeline_id = p.id
        WHERE p.account_id = p_account_id
          AND lower(p.name) = lower(v_config->>'pipeline')
          AND lower(s.name) = lower(v_config->>'stage')
        LIMIT 1;
        IF v_stage_id IS NULL THEN
          v_skip_step := TRUE;
        ELSE
          v_config := jsonb_strip_nulls(jsonb_build_object(
            'pipeline_id', v_pipeline_id,
            'stage_id', v_stage_id,
            'title', v_config->>'title',
            'value', v_config->'value'
          ));
        END IF;
      END IF;

      IF NOT v_skip_step THEN
        INSERT INTO automation_steps (automation_id, step_type, step_config, position)
        VALUES (v_automation_id, v_step->>'type', v_config, v_pos);
        v_pos := v_pos + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_created;
END;
$$;

ALTER FUNCTION public.apply_crm_template_content(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_crm_template_content(UUID, JSONB) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 3. AGENCY: APPLY A TEMPLATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.agencia_apply_template(
  p_account_id UUID,
  p_template_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := require_agencia_operator(p_account_id);
  v_status TEXT;
  v_tpl crm_templates%ROWTYPE;
  v_summary JSONB;
BEGIN
  SELECT status INTO v_status FROM accounts WHERE id = p_account_id;
  IF v_status IS NULL OR v_status = 'archived' THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;

  -- Writing into a client's CRM is operating it: only while the agency
  -- is still setting it up, or with the owner's full consent.
  IF v_status <> 'onboarding' AND agency_access_level(p_account_id) <> 'full' THEN
    RAISE EXCEPTION 'Aplicar um modelo altera o CRM do cliente: só em implantação ou com acesso Total liberado pelo dono'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tpl FROM crm_templates WHERE id = p_template_id;
  IF NOT FOUND OR NOT v_tpl.active THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = '22023';
  END IF;

  v_summary := apply_crm_template_content(p_account_id, v_tpl.content);

  INSERT INTO crm_template_applications (account_id, template_id, template_name, applied_by, summary)
  VALUES (p_account_id, v_tpl.id, v_tpl.name, auth.uid(), v_summary);

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (auth.uid(), p_account_id, 'apply_template');

  RETURN v_summary;
END;
$$;

ALTER FUNCTION public.agencia_apply_template(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_apply_template(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_apply_template(UUID, UUID) TO authenticated;


-- ============================================================
-- 4. AGENCY: SAVE A CRM AS A TEMPLATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.agencia_template_from_account(
  p_account_id UUID,
  p_name TEXT,
  p_niche TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_content JSONB;
  v_id UUID;
  v_slug TEXT;
BEGIN
  IF agencia_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Só um super admin cria modelos' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Dê um nome ao modelo' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status FROM accounts WHERE id = p_account_id;
  IF v_status IS NULL OR v_status = 'archived' THEN
    RAISE EXCEPTION 'CRM não encontrado' USING ERRCODE = '22023';
  END IF;
  -- Quick replies and automation messages are the client's words.
  IF v_status <> 'onboarding' AND agency_access_level(p_account_id) = 'metrics' THEN
    RAISE EXCEPTION 'O dono deste CRM liberou só Métricas: a configuração dele não pode ser copiada'
      USING ERRCODE = '42501';
  END IF;

  v_content := jsonb_build_object(
    'pipelines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', p.name,
        'stages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', s.name, 'color', s.color) ORDER BY s.position)
          FROM pipeline_stages s WHERE s.pipeline_id = p.id
        ), '[]'::jsonb)
      ) ORDER BY p.created_at)
      FROM pipelines p WHERE p.account_id = p_account_id
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color) ORDER BY t.created_at)
      FROM tags t WHERE t.account_id = p_account_id
    ), '[]'::jsonb),
    'custom_fields', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', f.field_name, 'type', f.field_type, 'options', f.field_options
      )) ORDER BY f.created_at)
      FROM custom_fields f WHERE f.account_id = p_account_id
    ), '[]'::jsonb),
    'quick_replies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('title', q.title, 'text', q.content_text) ORDER BY q.created_at)
      FROM quick_replies q
      WHERE q.account_id = p_account_id AND q.kind = 'text' AND q.content_text IS NOT NULL
    ), '[]'::jsonb),
    -- Only automations whose every step can travel between CRMs: the
    -- ones that point at a person, a template, a webhook or a custom
    -- field by id would arrive broken.
    'automations', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', a.name,
        'description', a.description,
        'trigger', a.trigger_type,
        'trigger_config', a.trigger_config,
        'steps', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'type', st.step_type,
            'config', CASE
              WHEN st.step_type IN ('add_tag', 'remove_tag') THEN jsonb_build_object(
                'tag', (SELECT t.name FROM tags t WHERE t.id::text = st.step_config->>'tag_id'))
              WHEN st.step_type = 'create_deal' THEN jsonb_strip_nulls(jsonb_build_object(
                'pipeline', (SELECT p.name FROM pipelines p WHERE p.id::text = st.step_config->>'pipeline_id'),
                'stage', (SELECT s.name FROM pipeline_stages s WHERE s.id::text = st.step_config->>'stage_id'),
                'title', st.step_config->>'title',
                'value', st.step_config->'value'))
              ELSE st.step_config
            END
          ) ORDER BY st.position)
          FROM automation_steps st
          WHERE st.automation_id = a.id AND st.parent_step_id IS NULL
        ), '[]'::jsonb)
      )) ORDER BY a.created_at)
      FROM automations a
      WHERE a.account_id = p_account_id
        AND a.trigger_type IN ('first_inbound_message', 'new_contact_created',
                               'keyword_match', 'new_message_received')
        AND NOT EXISTS (
          SELECT 1 FROM automation_steps st
          WHERE st.automation_id = a.id
            AND (st.parent_step_id IS NOT NULL
                 OR st.step_type NOT IN ('send_message', 'wait', 'add_tag',
                                         'remove_tag', 'create_deal', 'close_conversation'))
        )
    ), '[]'::jsonb)
  );

  v_slug := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g')
    || '-' || substr(md5(random()::text), 1, 6);

  INSERT INTO crm_templates (slug, name, niche, description, content, created_by)
  VALUES (v_slug, btrim(p_name), NULLIF(btrim(p_niche), ''), NULLIF(btrim(p_description), ''),
          v_content, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO agencia_auditoria (actor_user_id, account_id, action)
  VALUES (auth.uid(), p_account_id, 'save_template');

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.agencia_template_from_account(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agencia_template_from_account(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_template_from_account(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ============================================================
-- 5. BUILT-IN TEMPLATES (seeded once; agency edits are kept)
-- ============================================================
INSERT INTO crm_templates (slug, name, niche, description, suggested_access, built_in, content)
VALUES
(
  'clinica-medica',
  'Clínica médica',
  'medical_clinic',
  'Funil do primeiro contato ao paciente fidelizado, campos de convênio e especialidade, respostas para agendamento e pós-consulta.',
  'metrics',
  TRUE,
  $json${
    "pipelines": [
      { "name": "Pacientes", "stages": [
        { "name": "Novo contato", "color": "#64748b" },
        { "name": "Agendamento", "color": "#3b82f6" },
        { "name": "Consulta realizada", "color": "#8b5cf6" },
        { "name": "Retorno / tratamento", "color": "#f59e0b" },
        { "name": "Fidelizado", "color": "#10b981" },
        { "name": "Perdido", "color": "#ef4444" }
      ] }
    ],
    "tags": [
      { "name": "Particular", "color": "#3b82f6" },
      { "name": "Convênio", "color": "#8b5cf6" },
      { "name": "Primeira consulta", "color": "#10b981" },
      { "name": "Retorno", "color": "#f59e0b" },
      { "name": "Urgente", "color": "#ef4444" }
    ],
    "custom_fields": [
      { "name": "Convênio", "type": "text" },
      { "name": "Especialidade", "type": "text",
        "options": ["Clínica geral", "Cardiologia", "Dermatologia", "Ginecologia", "Pediatria", "Ortopedia", "Outra"] },
      { "name": "Data de nascimento", "type": "text" },
      { "name": "Como nos conheceu", "type": "text",
        "options": ["Indicação", "Google", "Instagram", "Convênio", "Outro"] }
    ],
    "quick_replies": [
      { "title": "Boas-vindas",
        "text": "Olá! Obrigado por entrar em contato com a nossa clínica. Como posso te ajudar? Se quiser agendar uma consulta, me diga a especialidade e o melhor dia e horário para você." },
      { "title": "Confirmar consulta",
        "text": "Olá! Passando para confirmar sua consulta. Você pode responder SIM para confirmar ou me avisar se precisar remarcar." },
      { "title": "Endereço e como chegar",
        "text": "Nosso endereço é: [endereço da clínica]. Temos estacionamento [informar]. Chegue com 15 minutos de antecedência, por favor." },
      { "title": "Documentos para a consulta",
        "text": "Para a consulta, traga um documento com foto e, se for por convênio, a carteirinha do plano. Se tiver exames recentes, traga também." },
      { "title": "Pós-consulta",
        "text": "Olá! Como você está se sentindo depois da consulta? Se tiver qualquer dúvida sobre as orientações ou precisar agendar o retorno, é só me chamar por aqui." }
    ],
    "automations": [
      { "name": "Boas-vindas ao novo paciente",
        "description": "Responde a primeira mensagem, marca como primeira consulta e abre o card no funil.",
        "trigger": "first_inbound_message",
        "steps": [
          { "type": "send_message", "config": { "text": "Olá! Obrigado por falar com a nossa clínica. Em instantes nossa equipe te responde. Se quiser agendar, já pode me dizer a especialidade e o melhor horário para você." } },
          { "type": "add_tag", "config": { "tag": "Primeira consulta" } },
          { "type": "create_deal", "config": { "pipeline": "Pacientes", "stage": "Novo contato", "title": "Novo paciente" } }
        ] },
      { "name": "Pedido de agendamento",
        "description": "Quando a pessoa fala em agendar, explica o que a equipe precisa saber.",
        "trigger": "keyword_match",
        "trigger_config": { "keywords": ["agendar", "marcar", "consulta", "horário"], "match_type": "contains" },
        "steps": [
          { "type": "send_message", "config": { "text": "Vamos agendar! Me diga, por favor: 1) a especialidade, 2) se é particular ou convênio (qual?) e 3) os melhores dias e horários para você." } }
        ] }
    ]
  }$json$::jsonb
),
(
  'academia',
  'Academia / Studio',
  'gym',
  'Funil do interessado ao aluno matriculado, aula experimental, planos e modalidades, mensagens de reativação.',
  'read',
  TRUE,
  $json${
    "pipelines": [
      { "name": "Alunos", "stages": [
        { "name": "Interessado", "color": "#64748b" },
        { "name": "Aula experimental agendada", "color": "#3b82f6" },
        { "name": "Aula experimental feita", "color": "#8b5cf6" },
        { "name": "Matriculado", "color": "#10b981" },
        { "name": "Não fechou", "color": "#ef4444" }
      ] }
    ],
    "tags": [
      { "name": "Musculação", "color": "#3b82f6" },
      { "name": "Funcional", "color": "#f59e0b" },
      { "name": "Pilates", "color": "#ec4899" },
      { "name": "Aula experimental", "color": "#8b5cf6" },
      { "name": "Plano anual", "color": "#10b981" },
      { "name": "Ex-aluno", "color": "#64748b" }
    ],
    "custom_fields": [
      { "name": "Plano", "type": "text", "options": ["Mensal", "Trimestral", "Semestral", "Anual"] },
      { "name": "Modalidade", "type": "text",
        "options": ["Musculação", "Funcional", "Pilates", "Dança", "Luta", "Outra"] },
      { "name": "Objetivo", "type": "text",
        "options": ["Emagrecimento", "Hipertrofia", "Condicionamento", "Saúde", "Outro"] },
      { "name": "Vencimento do plano", "type": "text" }
    ],
    "quick_replies": [
      { "title": "Boas-vindas",
        "text": "Oi! Que bom ter você por aqui. Qual é o seu objetivo: emagrecer, ganhar massa, condicionamento ou saúde? Assim eu te indico a melhor modalidade." },
      { "title": "Valores e planos",
        "text": "Nossos planos: Mensal R$ [valor], Trimestral R$ [valor], Semestral R$ [valor] e Anual R$ [valor]. Quer agendar uma aula experimental gratuita antes de decidir?" },
      { "title": "Agendar aula experimental",
        "text": "Perfeito! A aula experimental é gratuita. Qual dia e horário ficam melhor para você? Venha com roupa confortável e traga uma garrafinha de água." },
      { "title": "Horários",
        "text": "Funcionamos de segunda a sexta das [horário] às [horário] e aos sábados das [horário] às [horário]." },
      { "title": "Reativação",
        "text": "Oi! Sentimos sua falta por aqui. Que tal voltar a treinar? Tenho uma condição especial para quem está retornando. Posso te contar?" }
    ],
    "automations": [
      { "name": "Boas-vindas ao interessado",
        "description": "Responde a primeira mensagem e abre o card no funil de alunos.",
        "trigger": "first_inbound_message",
        "steps": [
          { "type": "send_message", "config": { "text": "Oi! Obrigado pelo contato. Qual é o seu objetivo com os treinos? Já te passo as opções e você pode agendar uma aula experimental gratuita." } },
          { "type": "create_deal", "config": { "pipeline": "Alunos", "stage": "Interessado", "title": "Novo interessado" } }
        ] },
      { "name": "Interesse em aula experimental",
        "description": "Quando a pessoa fala em aula experimental, marca a etiqueta e pede o melhor horário.",
        "trigger": "keyword_match",
        "trigger_config": { "keywords": ["experimental", "aula grátis", "aula gratis", "conhecer"], "match_type": "contains" },
        "steps": [
          { "type": "add_tag", "config": { "tag": "Aula experimental" } },
          { "type": "send_message", "config": { "text": "Ótimo! A aula experimental é gratuita. Me diga o dia e o horário que ficam melhor para você." } }
        ] }
    ]
  }$json$::jsonb
),
(
  'servicos',
  'Serviços / Agência',
  'services',
  'Funil de vendas consultivas do lead ao fechamento, temperatura do lead, proposta e follow-up.',
  'full',
  TRUE,
  $json${
    "pipelines": [
      { "name": "Vendas", "stages": [
        { "name": "Novo lead", "color": "#64748b" },
        { "name": "Qualificado", "color": "#3b82f6" },
        { "name": "Proposta enviada", "color": "#8b5cf6" },
        { "name": "Negociação", "color": "#f59e0b" },
        { "name": "Ganho", "color": "#10b981" },
        { "name": "Perdido", "color": "#ef4444" }
      ] }
    ],
    "tags": [
      { "name": "Quente", "color": "#ef4444" },
      { "name": "Morno", "color": "#f59e0b" },
      { "name": "Frio", "color": "#3b82f6" },
      { "name": "Indicação", "color": "#10b981" },
      { "name": "Cliente", "color": "#8b5cf6" }
    ],
    "custom_fields": [
      { "name": "Segmento", "type": "text" },
      { "name": "Orçamento estimado", "type": "text" },
      { "name": "Prazo", "type": "text", "options": ["Imediato", "Até 30 dias", "Até 90 dias", "Sem prazo"] },
      { "name": "Origem", "type": "text",
        "options": ["Indicação", "Site", "Instagram", "Google", "Evento", "Outro"] }
    ],
    "quick_replies": [
      { "title": "Boas-vindas",
        "text": "Olá! Obrigado pelo contato. Para eu entender como podemos ajudar, me conte um pouco sobre a sua empresa e o que você está buscando." },
      { "title": "Apresentação",
        "text": "Nós ajudamos empresas como a sua a [resultado principal]. Posso te mostrar em 15 minutos como funciona? Qual o melhor horário para uma conversa rápida?" },
      { "title": "Enviar proposta",
        "text": "Segue a proposta conforme conversamos. Qualquer dúvida estou à disposição. Podemos marcar uma conversa para revisar juntos?" },
      { "title": "Follow-up da proposta",
        "text": "Olá! Conseguiu dar uma olhada na proposta? Fico à disposição para ajustar o que for preciso." },
      { "title": "Agradecimento",
        "text": "Muito obrigado pela confiança! Nos próximos dias vou te passar os próximos passos para começarmos." }
    ],
    "automations": [
      { "name": "Boas-vindas ao novo lead",
        "description": "Responde a primeira mensagem e abre a oportunidade no funil de vendas.",
        "trigger": "first_inbound_message",
        "steps": [
          { "type": "send_message", "config": { "text": "Olá! Obrigado pelo contato. Já já alguém da equipe fala com você. Enquanto isso, me conte: qual é a sua empresa e o que você está buscando?" } },
          { "type": "create_deal", "config": { "pipeline": "Vendas", "stage": "Novo lead", "title": "Novo lead" } }
        ] },
      { "name": "Pedido de orçamento",
        "description": "Quando a pessoa pede preço ou proposta, marca como quente.",
        "trigger": "keyword_match",
        "trigger_config": { "keywords": ["orçamento", "orcamento", "proposta", "preço", "preco", "valor"], "match_type": "contains" },
        "steps": [
          { "type": "add_tag", "config": { "tag": "Quente" } },
          { "type": "send_message", "config": { "text": "Claro! Para preparar uma proposta certinha, me diga: qual o objetivo, o prazo e se já tem um orçamento em mente?" } }
        ] }
    ]
  }$json$::jsonb
)
ON CONFLICT (slug) DO NOTHING;
