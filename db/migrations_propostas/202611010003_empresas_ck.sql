-- MIG-03: empresas, vitrine, análise CK, moderação, suspensão e contestação (M03).
--
-- Fonte: docs/marcos/M03/MINI-ESPEC_M03.md (aprovada, ADR-G03 revisão 2) e
-- docs/marcos/M03/PLANO_IMPLEMENTACAO_M03.md (etapas E1 a E3).
-- Autorizada pelo idealizador em 01/11/2026 para o branch `desenvolvimento`.
--
-- Princípios:
--  - situação do ERP separada da situação da vitrine (ADR-005);
--  - toda escrita passa por RPCs SECURITY DEFINER com autorização interna,
--    `operation_key` (idempotência) e checagem de estado/versão;
--  - nenhum papel da API escreve direto nas tabelas; leitura por RLS;
--  - projeção pública separada, sem campos privados, ainda sem acesso anônimo (M10);
--  - histórico append-only; ações da CK auditadas.
--
-- Rastreabilidade: RF-011 a RF-019, RF-167 a RF-174, RF-177; RN-001, RN-003, RN-004,
-- RN-005, RN-046, RN-047, RN-050, RN-051; RNF-002 a RNF-004, RNF-010, RNF-011, RNF-014.
-- Rollback (somente sem dados reais): 202611010003_empresas_ck.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Infraestrutura comum: erros com código do API-001, idempotência, histórico
-- ---------------------------------------------------------------------------

-- Erro padronizado: HINT carrega o código do API-001 (lido pelo cliente).
CREATE FUNCTION app_private.erro(p_codigo text, p_mensagem text, p_detalhe text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = p_mensagem,
    HINT = p_codigo,
    DETAIL = coalesce(p_detalhe, ''),
    ERRCODE = CASE p_codigo
      WHEN 'FORBIDDEN_ACTION' THEN '42501'
      WHEN 'TENANT_FORBIDDEN' THEN '42501'
      WHEN 'AUTH_REQUIRED' THEN '28000'
      ELSE 'P0001' END;
END $$;
REVOKE ALL ON FUNCTION app_private.erro(text, text, text) FROM PUBLIC;

CREATE FUNCTION app_private.exigir_usuario() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  usuario text := (SELECT authz.usuario_atual());
BEGIN
  IF usuario IS NULL THEN
    PERFORM app_private.erro('AUTH_REQUIRED', 'Sessão ausente ou expirada.');
  END IF;
  RETURN usuario;
END $$;
REVOKE ALL ON FUNCTION app_private.exigir_usuario() FROM PUBLIC;

-- Idempotência (RNF-011, API-001): mesma chave e mesmo conteúdo devolvem o mesmo
-- resultado; mesma chave com conteúdo diferente gera IDEMPOTENCY_CONFLICT.
CREATE TABLE app_private.operacoes_idempotentes (
  ator        text NOT NULL,
  funcao      text NOT NULL,
  chave       text NOT NULL,
  assinatura  text NOT NULL,
  resultado   jsonb NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ator, funcao, chave)
);

CREATE FUNCTION app_private.idem_inicio(p_ator text, p_funcao text, p_chave text, p_assinatura text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  anterior app_private.operacoes_idempotentes;
BEGIN
  IF p_chave IS NULL OR char_length(p_chave) NOT BETWEEN 8 AND 100 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Chave de operação ausente ou inválida.', 'operation_key');
  END IF;
  -- Serializa repetições simultâneas da mesma operação.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_ator || '|' || p_funcao || '|' || p_chave, 0));
  SELECT * INTO anterior FROM app_private.operacoes_idempotentes
   WHERE ator = p_ator AND funcao = p_funcao AND chave = p_chave;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF anterior.assinatura <> p_assinatura THEN
    PERFORM app_private.erro('IDEMPOTENCY_CONFLICT', 'Esta operação já foi registrada com outros dados.');
  END IF;
  RETURN anterior.resultado;
END $$;
REVOKE ALL ON FUNCTION app_private.idem_inicio(text, text, text, text) FROM PUBLIC;

CREATE FUNCTION app_private.idem_fim(p_ator text, p_funcao text, p_chave text, p_assinatura text, p_resultado jsonb)
RETURNS jsonb LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO app_private.operacoes_idempotentes (ator, funcao, chave, assinatura, resultado)
  VALUES (p_ator, p_funcao, p_chave, p_assinatura, p_resultado)
  RETURNING resultado
$$;
REVOKE ALL ON FUNCTION app_private.idem_fim(text, text, text, text, jsonb) FROM PUBLIC;

CREATE FUNCTION app_private.impedir_alteracao_historico() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Histórico não pode ser alterado ou excluído.'
    USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN_ACTION';
END $$;

CREATE FUNCTION app_private.auditar(p_empresa uuid, p_ator text, p_acao text, p_recurso text, p_recurso_id uuid, p_dados jsonb)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO app_private.eventos_auditoria (empresa_id, ator_auth_id, tipo_acao, recurso_tipo, recurso_id, dados_minimizados)
  VALUES (p_empresa, p_ator, p_acao, p_recurso, p_recurso_id, coalesce(p_dados, '{}'::jsonb))
$$;
REVOKE ALL ON FUNCTION app_private.auditar(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Administradores CK (concessão só fora da aplicação: ARQ-001 §11, Q8)
-- ---------------------------------------------------------------------------

CREATE TABLE app_private.administradores_ck (
  auth_user_id  text PRIMARY KEY,
  ativo         boolean NOT NULL DEFAULT true,
  concedido_em  timestamptz NOT NULL DEFAULT now(),
  concedido_por text NOT NULL,
  revogado_em   timestamptz
);

CREATE FUNCTION app_private.conceder_ck_admin(p_auth_user_id text, p_concedido_por text)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  INSERT INTO app_private.administradores_ck (auth_user_id, concedido_por)
  VALUES (p_auth_user_id, p_concedido_por)
  ON CONFLICT (auth_user_id) DO UPDATE SET ativo = true, revogado_em = NULL,
    concedido_em = now(), concedido_por = excluded.concedido_por;
  PERFORM app_private.auditar(NULL, p_concedido_por, 'ck_admin.concedido', 'administradores_ck', NULL,
    jsonb_build_object('auth_user_id', p_auth_user_id));
END $$;
REVOKE ALL ON FUNCTION app_private.conceder_ck_admin(text, text) FROM PUBLIC;

CREATE FUNCTION app_private.revogar_ck_admin(p_auth_user_id text, p_revogado_por text)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  UPDATE app_private.administradores_ck SET ativo = false, revogado_em = now()
   WHERE auth_user_id = p_auth_user_id;
  PERFORM app_private.auditar(NULL, p_revogado_por, 'ck_admin.revogado', 'administradores_ck', NULL,
    jsonb_build_object('auth_user_id', p_auth_user_id));
END $$;
REVOKE ALL ON FUNCTION app_private.revogar_ck_admin(text, text) FROM PUBLIC;

CREATE FUNCTION authz.eh_ck_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_private.administradores_ck
     WHERE auth_user_id = (SELECT authz.usuario_atual()) AND ativo
  )
$$;
REVOKE ALL ON FUNCTION authz.eh_ck_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.eh_ck_admin() TO authenticated;

-- E-mail confirmado no Neon Auth (defesa em profundidade para o envio da vitrine).
CREATE FUNCTION authz.email_verificado() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT u."emailVerified" FROM neon_auth."user" u
                    WHERE u.id::text = (SELECT authz.usuario_atual())), false)
$$;
REVOKE ALL ON FUNCTION authz.email_verificado() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Categorias, empresas e vínculo do proprietário
-- ---------------------------------------------------------------------------

CREATE TABLE public.categorias_plataforma (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.categorias_plataforma (id),
  tipo      text NOT NULL CHECK (tipo IN ('negocio', 'produto', 'servico')),
  slug      text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nome      text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  ativo     boolean NOT NULL DEFAULT true,
  ordem     integer NOT NULL DEFAULT 0,
  CONSTRAINT categorias_plataforma_unica UNIQUE (tipo, slug)
);
COMMENT ON TABLE public.categorias_plataforma IS
  'Categorias oficiais. Lista inicial PROVISÓRIA (seed de desenvolvimento), sujeita à aprovação da CK.';

INSERT INTO public.categorias_plataforma (tipo, slug, nome, ordem) VALUES
  ('negocio', 'alimentacao', 'Alimentação', 10),
  ('negocio', 'beleza-estetica', 'Beleza e estética', 20),
  ('negocio', 'costura-moda', 'Costura e moda', 30),
  ('negocio', 'assistencia-tecnica', 'Assistência técnica', 40),
  ('negocio', 'construcao-reformas', 'Construção e reformas', 50),
  ('negocio', 'servicos-domesticos', 'Serviços domésticos', 60),
  ('negocio', 'saude-bem-estar', 'Saúde e bem-estar', 70),
  ('negocio', 'educacao-aulas', 'Educação e aulas', 80),
  ('negocio', 'eventos-festas', 'Eventos e festas', 90),
  ('negocio', 'automotivo', 'Automotivo', 100),
  ('negocio', 'comercio-varejo', 'Comércio e varejo', 110),
  ('negocio', 'outros', 'Outros', 999);

CREATE TABLE public.empresas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Campos públicos relevantes (exigem análise da CK; Q4 = B)
  nome_publico          text NOT NULL CHECK (char_length(nome_publico) BETWEEN 2 AND 120),
  modalidade            text NOT NULL CHECK (modalidade IN ('comercio', 'servicos', 'ambos')),
  categoria_id          uuid NOT NULL REFERENCES public.categorias_plataforma (id),
  cidade                text NOT NULL CHECK (char_length(cidade) BETWEEN 2 AND 80),
  uf                    text NOT NULL CHECK (uf = 'SP'),
  bairro                text CHECK (char_length(bairro) <= 80),
  area_atendimento      text CHECK (char_length(area_atendimento) <= 200),
  telefone_publico      text CHECK (telefone_publico ~ '^\d{10,13}$'),
  whatsapp_publico      text CHECK (whatsapp_publico ~ '^\d{10,13}$'),
  email_publico         text CHECK (char_length(email_publico) <= 254),
  -- Campos públicos de menor risco (publicam direto, com moderação)
  descricao_publica     text CHECK (char_length(descricao_publica) <= 1000),
  horario_funcionamento text CHECK (char_length(horario_funcionamento) <= 300),
  -- Campos privados (nunca públicos: RN-047, RNF-014)
  documento             text CHECK (documento ~ '^(\d{11}|\d{14})$'),
  email_contato         text NOT NULL CHECK (char_length(email_contato) <= 254),
  endereco_privado      text CHECK (char_length(endereco_privado) <= 300),
  observacoes_internas  text CHECK (char_length(observacoes_internas) <= 1000),
  -- Situações independentes (ADR-005)
  situacao_erp          text NOT NULL DEFAULT 'ativa' CHECK (situacao_erp IN ('ativa')),
  situacao_vitrine      text NOT NULL DEFAULT 'rascunho' CHECK (situacao_vitrine IN
                          ('rascunho', 'em_analise', 'correcao_solicitada', 'rejeitada', 'publicada', 'suspensa')),
  suspensao_gravidade   text CHECK (suspensao_gravidade IN ('comum', 'grave')),
  suspensao_fundamento  text CHECK (suspensao_fundamento IN ('fraude', 'risco_consumidor', 'exigencia_legal')),
  -- Última versão pública aprovada (inclui alterações diretas de menor risco)
  dados_publicados      jsonb,
  versao                integer NOT NULL DEFAULT 1,
  criada_por            text NOT NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresas_suspensao_coerente CHECK (
    (situacao_vitrine = 'suspensa') = (suspensao_gravidade IS NOT NULL)
    AND (suspensao_gravidade = 'grave') = (suspensao_fundamento IS NOT NULL)
  )
);
COMMENT ON TABLE public.empresas IS
  'Empresa (ERP) e cópia de trabalho da vitrine. Escrita só por RPC; leitura só do proprietário.';

CREATE TABLE public.membros_empresa (
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  auth_user_id  text NOT NULL,
  papel         text NOT NULL CHECK (papel IN ('proprietario')),
  estado        text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'inativo')),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, auth_user_id)
);
CREATE INDEX membros_empresa_usuario_idx ON public.membros_empresa (auth_user_id) WHERE estado = 'ativo';

CREATE FUNCTION authz.eh_proprietario(p_empresa_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membros_empresa
     WHERE empresa_id = p_empresa_id AND auth_user_id = (SELECT authz.usuario_atual())
       AND papel = 'proprietario' AND estado = 'ativo'
  )
$$;
REVOKE ALL ON FUNCTION authz.eh_proprietario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.eh_proprietario(uuid) TO authenticated;

-- Membro (qualquer papel ativo): usado para impedir conflito de interesse da CK.
CREATE FUNCTION app_private.eh_membro(p_empresa_id uuid, p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.membros_empresa
                  WHERE empresa_id = p_empresa_id AND auth_user_id = p_usuario AND estado = 'ativo')
$$;
REVOKE ALL ON FUNCTION app_private.eh_membro(uuid, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Solicitações, eventos, contestações, moderações e projeção pública
-- ---------------------------------------------------------------------------

CREATE TABLE public.solicitacoes_publicacao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas (id),
  tipo             text NOT NULL CHECK (tipo IN ('publicacao_inicial', 'alteracao')),
  estado           text NOT NULL DEFAULT 'aberta' CHECK (estado IN
                     ('aberta', 'aprovada', 'correcao_solicitada', 'rejeitada', 'cancelada_por_suspensao')),
  dados_publicos   jsonb NOT NULL,
  enviada_por      text NOT NULL,
  enviada_em       timestamptz NOT NULL DEFAULT now(),
  decidida_por     text,
  decidida_em      timestamptz,
  motivo           text,
  campos_corrigir  text[],
  origem_contestacao_id uuid
);
-- Uma solicitação aberta por empresa (evita análises duplicadas).
CREATE UNIQUE INDEX solicitacoes_uma_aberta ON public.solicitacoes_publicacao (empresa_id) WHERE estado = 'aberta';
CREATE INDEX solicitacoes_fila ON public.solicitacoes_publicacao (estado, enviada_em);

-- A cópia congelada não muda depois do envio.
CREATE FUNCTION app_private.congelar_solicitacao() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.dados_publicos IS DISTINCT FROM OLD.dados_publicos OR NEW.empresa_id <> OLD.empresa_id OR NEW.tipo <> OLD.tipo THEN
    RAISE EXCEPTION 'A cópia enviada para análise não pode ser alterada.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitacoes_congeladas BEFORE UPDATE ON public.solicitacoes_publicacao
  FOR EACH ROW EXECUTE FUNCTION app_private.congelar_solicitacao();
CREATE TRIGGER solicitacoes_sem_exclusao BEFORE DELETE ON public.solicitacoes_publicacao
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.eventos_publicacao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas (id),
  tipo              text NOT NULL,
  situacao_anterior text,
  situacao_nova     text,
  solicitacao_id    uuid REFERENCES public.solicitacoes_publicacao (id),
  contestacao_id    uuid,
  moderacao_id      uuid,
  ator_auth_id      text NOT NULL,
  papel_ator        text NOT NULL CHECK (papel_ator IN ('gestor', 'ck')),
  motivo            text,
  gravidade         text,
  fundamento        text,
  mesmo_decisor     boolean,
  operation_key     text,
  criado_em         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX eventos_publicacao_empresa ON public.eventos_publicacao (empresa_id, criado_em);
CREATE TRIGGER eventos_publicacao_somente_insercao BEFORE UPDATE OR DELETE ON public.eventos_publicacao
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.contestacoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas (id),
  evento_decisao_id  uuid NOT NULL REFERENCES public.eventos_publicacao (id),
  tipo_decisao       text NOT NULL CHECK (tipo_decisao IN ('rejeicao', 'suspensao')),
  motivo_gestor      text NOT NULL CHECK (char_length(motivo_gestor) BETWEEN 10 AND 2000),
  estado             text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'em_revisao', 'deferida', 'indeferida')),
  aberta_por         text NOT NULL,
  aberta_em          timestamptz NOT NULL DEFAULT now(),
  revisora_por       text,
  decidida_por       text,
  decidida_em        timestamptz,
  justificativa_ck   text,
  mesmo_decisor      boolean
);
-- Uma contestação em andamento por decisão (Q7).
CREATE UNIQUE INDEX contestacoes_uma_ativa ON public.contestacoes (evento_decisao_id) WHERE estado IN ('aberta', 'em_revisao');
CREATE TRIGGER contestacoes_sem_exclusao BEFORE DELETE ON public.contestacoes
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.moderacoes_vitrine (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  antes         jsonb NOT NULL,
  depois        jsonb NOT NULL,
  estado        text NOT NULL DEFAULT 'pendente' CHECK (estado IN
                  ('pendente', 'mantida', 'correcao_pedida', 'restaurada', 'encerrada_por_suspensao')),
  criada_por    text NOT NULL,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  decidida_por  text,
  decidida_em   timestamptz,
  motivo        text
);
CREATE INDEX moderacoes_fila ON public.moderacoes_vitrine (estado, criada_em);
CREATE TRIGGER moderacoes_sem_exclusao BEFORE DELETE ON public.moderacoes_vitrine
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- Projeção pública: só campos públicos aprovados; anônimo sem acesso até o M10.
CREATE TABLE public.public_empresa_cards (
  empresa_id            uuid PRIMARY KEY REFERENCES public.empresas (id),
  solicitacao_origem_id uuid REFERENCES public.solicitacoes_publicacao (id),
  nome_publico          text NOT NULL,
  modalidade            text NOT NULL,
  categoria_id          uuid NOT NULL REFERENCES public.categorias_plataforma (id),
  cidade                text NOT NULL,
  uf                    text NOT NULL,
  bairro                text,
  area_atendimento      text,
  telefone_publico      text,
  whatsapp_publico      text,
  email_publico         text,
  descricao_publica     text,
  horario_funcionamento text,
  selo                  text NOT NULL DEFAULT 'Aprovado para publicação',
  publicado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Campos, validação e projeção
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_private.campos_relevantes() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['nome_publico','categoria_id','modalidade','cidade','uf','bairro','area_atendimento',
                   'telefone_publico','whatsapp_publico','email_publico'] $$;

CREATE FUNCTION app_private.campos_menor_risco() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['descricao_publica','horario_funcionamento'] $$;

CREATE FUNCTION app_private.campos_privados() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['documento','email_contato','endereco_privado','observacoes_internas'] $$;

-- Detecta telefone, e-mail, endereço web ou sequência longa de dígitos (ex.: CEP).
CREATE FUNCTION app_private.tem_contato(p_texto text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p_texto IS NOT NULL AND (
       p_texto ~* '[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}'
    OR p_texto ~* '(https?://|www\.)'
    OR p_texto ~* '[a-z0-9-]+\.(com|net|org|br|io|app|site|online|shop|store)([^a-z]|$)'
    OR p_texto ~ '([0-9][[:space:]().-]*){8,}'
  )
$$;

CREATE FUNCTION app_private.dados_publicos(e public.empresas) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'nome_publico', e.nome_publico, 'categoria_id', e.categoria_id, 'modalidade', e.modalidade,
    'cidade', e.cidade, 'uf', e.uf, 'bairro', e.bairro, 'area_atendimento', e.area_atendimento,
    'telefone_publico', e.telefone_publico, 'whatsapp_publico', e.whatsapp_publico,
    'email_publico', e.email_publico, 'descricao_publica', e.descricao_publica,
    'horario_funcionamento', e.horario_funcionamento)
$$;

-- Campos relevantes da cópia de trabalho que diferem do que está publicado.
CREATE FUNCTION app_private.relevantes_pendentes(e public.empresas) RETURNS text[]
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(array_agg(c ORDER BY c), ARRAY[]::text[])
    FROM unnest(app_private.campos_relevantes()) AS c
   WHERE e.dados_publicados IS NOT NULL
     AND (app_private.dados_publicos(e) -> c) IS DISTINCT FROM (e.dados_publicados -> c)
$$;

CREATE FUNCTION app_private.empresa_json(e public.empresas) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT to_jsonb(e) - 'criada_por'
    || jsonb_build_object(
         'relevantes_pendentes', app_private.relevantes_pendentes(e),
         'solicitacao_aberta', (SELECT to_jsonb(s) - 'decidida_por' - 'enviada_por'
                                  FROM public.solicitacoes_publicacao s
                                 WHERE s.empresa_id = e.id AND s.estado = 'aberta'))
$$;

-- Aplica as chaves recebidas (somente as permitidas) e valida o resultado.
CREATE FUNCTION app_private.aplicar_campos(e public.empresas, d jsonb) RETURNS public.empresas
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  chave text;
  permitidas text[] := app_private.campos_relevantes() || app_private.campos_menor_risco() || app_private.campos_privados();
  valor text;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dados da empresa ausentes.');
  END IF;
  FOR chave IN SELECT jsonb_object_keys(d) LOOP
    IF NOT chave = ANY (permitidas) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Campo não permitido: ' || chave, chave);
    END IF;
    valor := nullif(btrim(d ->> chave), '');
    CASE chave
      WHEN 'nome_publico' THEN e.nome_publico := valor;
      WHEN 'categoria_id' THEN
        BEGIN
          e.categoria_id := valor::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          PERFORM app_private.erro('VALIDATION_ERROR', 'Categoria inválida.', 'categoria_id');
        END;
      WHEN 'modalidade' THEN e.modalidade := valor;
      WHEN 'cidade' THEN e.cidade := valor;
      WHEN 'uf' THEN e.uf := upper(valor);
      WHEN 'bairro' THEN e.bairro := valor;
      WHEN 'area_atendimento' THEN e.area_atendimento := valor;
      WHEN 'telefone_publico' THEN e.telefone_publico := nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '');
      WHEN 'whatsapp_publico' THEN e.whatsapp_publico := nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '');
      WHEN 'email_publico' THEN e.email_publico := lower(valor);
      WHEN 'descricao_publica' THEN e.descricao_publica := valor;
      WHEN 'horario_funcionamento' THEN e.horario_funcionamento := valor;
      WHEN 'documento' THEN e.documento := nullif(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '');
      WHEN 'email_contato' THEN e.email_contato := lower(valor);
      WHEN 'endereco_privado' THEN e.endereco_privado := valor;
      WHEN 'observacoes_internas' THEN e.observacoes_internas := valor;
    END CASE;
  END LOOP;

  IF e.nome_publico IS NULL OR char_length(e.nome_publico) NOT BETWEEN 2 AND 120 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe o nome do negócio (2 a 120 caracteres).', 'nome_publico');
  END IF;
  IF e.modalidade IS NULL OR e.modalidade NOT IN ('comercio', 'servicos', 'ambos') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a modalidade: comércio, serviços ou ambos.', 'modalidade');
  END IF;
  IF e.categoria_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.categorias_plataforma
                                            WHERE id = e.categoria_id AND tipo = 'negocio' AND ativo) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha uma categoria da lista.', 'categoria_id');
  END IF;
  IF e.cidade IS NULL OR char_length(e.cidade) NOT BETWEEN 2 AND 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe a cidade.', 'cidade');
  END IF;
  IF e.uf IS DISTINCT FROM 'SP' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Nesta fase, o AutoniCK atende apenas o estado de São Paulo (SP).', 'uf');
  END IF;
  IF char_length(e.bairro) > 80 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O bairro pode ter até 80 caracteres.', 'bairro');
  END IF;
  IF char_length(e.area_atendimento) > 200 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A área de atendimento pode ter até 200 caracteres.', 'area_atendimento');
  END IF;
  IF e.telefone_publico IS NOT NULL AND e.telefone_publico !~ '^\d{10,13}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Telefone público inválido. Use DDD e número.', 'telefone_publico');
  END IF;
  IF e.whatsapp_publico IS NOT NULL AND e.whatsapp_publico !~ '^\d{10,13}$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'WhatsApp público inválido. Use DDD e número.', 'whatsapp_publico');
  END IF;
  IF e.email_publico IS NOT NULL AND (e.email_publico !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(e.email_publico) > 254) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'E-mail público inválido.', 'email_publico');
  END IF;
  IF char_length(e.descricao_publica) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição pode ter até 1000 caracteres.', 'descricao_publica');
  END IF;
  IF app_private.tem_contato(e.descricao_publica) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição não pode ter telefone, e-mail ou link. Use os campos de contato público, que passam por análise.', 'descricao_publica');
  END IF;
  IF char_length(e.horario_funcionamento) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário pode ter até 300 caracteres.', 'horario_funcionamento');
  END IF;
  IF app_private.tem_contato(e.horario_funcionamento) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O horário não pode ter telefone, e-mail ou link.', 'horario_funcionamento');
  END IF;
  IF e.documento IS NOT NULL AND e.documento !~ '^(\d{11}|\d{14})$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Documento inválido: use CPF (11 dígitos) ou CNPJ (14 dígitos).', 'documento');
  END IF;
  IF e.email_contato IS NULL OR e.email_contato !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(e.email_contato) > 254 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um e-mail de contato válido.', 'email_contato');
  END IF;
  IF char_length(e.endereco_privado) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O endereço pode ter até 300 caracteres.', 'endereco_privado');
  END IF;
  IF char_length(e.observacoes_internas) > 1000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'As observações podem ter até 1000 caracteres.', 'observacoes_internas');
  END IF;
  RETURN e;
END $$;

-- Recria a projeção a partir de dados_publicados (somente para empresa publicada).
CREATE FUNCTION app_private.sincronizar_projecao(p_empresa_id uuid, p_solicitacao_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  e public.empresas;
  d jsonb;
BEGIN
  SELECT * INTO e FROM public.empresas WHERE id = p_empresa_id;
  IF e.situacao_vitrine <> 'publicada' OR e.dados_publicados IS NULL THEN
    DELETE FROM public.public_empresa_cards WHERE empresa_id = p_empresa_id;
    RETURN;
  END IF;
  d := e.dados_publicados;
  INSERT INTO public.public_empresa_cards AS p (
    empresa_id, solicitacao_origem_id, nome_publico, modalidade, categoria_id, cidade, uf, bairro,
    area_atendimento, telefone_publico, whatsapp_publico, email_publico, descricao_publica, horario_funcionamento)
  VALUES (p_empresa_id, p_solicitacao_id, d ->> 'nome_publico', d ->> 'modalidade', (d ->> 'categoria_id')::uuid,
    d ->> 'cidade', d ->> 'uf', d ->> 'bairro', d ->> 'area_atendimento', d ->> 'telefone_publico',
    d ->> 'whatsapp_publico', d ->> 'email_publico', d ->> 'descricao_publica', d ->> 'horario_funcionamento')
  ON CONFLICT (empresa_id) DO UPDATE SET
    solicitacao_origem_id = coalesce(excluded.solicitacao_origem_id, p.solicitacao_origem_id),
    nome_publico = excluded.nome_publico, modalidade = excluded.modalidade,
    categoria_id = excluded.categoria_id, cidade = excluded.cidade, uf = excluded.uf,
    bairro = excluded.bairro, area_atendimento = excluded.area_atendimento,
    telefone_publico = excluded.telefone_publico, whatsapp_publico = excluded.whatsapp_publico,
    email_publico = excluded.email_publico, descricao_publica = excluded.descricao_publica,
    horario_funcionamento = excluded.horario_funcionamento, atualizado_em = now();
END $$;

CREATE FUNCTION app_private.registrar_evento(
  p_empresa uuid, p_tipo text, p_anterior text, p_nova text, p_ator text, p_papel text,
  p_motivo text DEFAULT NULL, p_solicitacao uuid DEFAULT NULL, p_contestacao uuid DEFAULT NULL,
  p_moderacao uuid DEFAULT NULL, p_gravidade text DEFAULT NULL, p_fundamento text DEFAULT NULL,
  p_mesmo_decisor boolean DEFAULT NULL, p_chave text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO public.eventos_publicacao (empresa_id, tipo, situacao_anterior, situacao_nova, ator_auth_id, papel_ator,
    motivo, solicitacao_id, contestacao_id, moderacao_id, gravidade, fundamento, mesmo_decisor, operation_key)
  VALUES (p_empresa, p_tipo, p_anterior, p_nova, p_ator, p_papel, p_motivo, p_solicitacao, p_contestacao,
    p_moderacao, p_gravidade, p_fundamento, p_mesmo_decisor, p_chave)
  RETURNING id
$$;

-- Carrega a empresa com trava, conferindo que quem chama é o proprietário.
CREATE FUNCTION app_private.empresa_do_proprietario(p_empresa_id uuid, p_usuario text) RETURNS public.empresas
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  e public.empresas;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = p_empresa_id AND auth_user_id = p_usuario
                    AND papel = 'proprietario' AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  SELECT * INTO e FROM public.empresas WHERE id = p_empresa_id FOR UPDATE;
  RETURN e;
END $$;

-- Confere CK Admin ativo e ausência de conflito de interesse; trava a empresa.
CREATE FUNCTION app_private.empresa_para_ck(p_empresa_id uuid, p_usuario text) RETURNS public.empresas
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  e public.empresas;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_private.administradores_ck WHERE auth_user_id = p_usuario AND ativo) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode realizar esta ação.');
  END IF;
  SELECT * INTO e FROM public.empresas WHERE id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Empresa não encontrada.');
  END IF;
  IF app_private.eh_membro(p_empresa_id, p_usuario) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Você é membro desta empresa e não pode decidir sobre ela (conflito de interesse).');
  END IF;
  RETURN e;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. RPCs do gestor (proprietário)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.criar_empresa(p_dados jsonb, p_operation_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(coalesce(p_dados::text, ''));
  anterior jsonb;
  e public.empresas;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfis_identidade WHERE auth_user_id = usuario AND tipo_conta = 'business') THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Crie seu perfil Business antes de cadastrar uma empresa.');
  END IF;
  e.id := gen_random_uuid();
  e.uf := 'SP';
  e := app_private.aplicar_campos(e, p_dados);
  INSERT INTO public.empresas (id, nome_publico, modalidade, categoria_id, cidade, uf, bairro, area_atendimento,
    telefone_publico, whatsapp_publico, email_publico, descricao_publica, horario_funcionamento,
    documento, email_contato, endereco_privado, observacoes_internas, criada_por)
  VALUES (e.id, e.nome_publico, e.modalidade, e.categoria_id, e.cidade, e.uf, e.bairro, e.area_atendimento,
    e.telefone_publico, e.whatsapp_publico, e.email_publico, e.descricao_publica, e.horario_funcionamento,
    e.documento, e.email_contato, e.endereco_privado, e.observacoes_internas, usuario)
  RETURNING * INTO e;
  INSERT INTO public.membros_empresa (empresa_id, auth_user_id, papel) VALUES (e.id, usuario, 'proprietario');
  PERFORM app_private.registrar_evento(e.id, 'empresa_criada', NULL, 'rascunho', usuario, 'gestor', p_chave => p_operation_key);
  PERFORM app_private.auditar(e.id, usuario, 'empresa.criada', 'empresas', e.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'criar_empresa', p_operation_key, assinatura, app_private.empresa_json(e));
END $$;

CREATE FUNCTION public.atualizar_empresa(p_empresa_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_dados::text, p_expected_version));
  anterior jsonb;
  atual public.empresas;
  novo public.empresas;
  antes jsonb := '{}'::jsonb;
  depois jsonb := '{}'::jsonb;
  c text;
  moderacao uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'atualizar_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  atual := app_private.empresa_do_proprietario(p_empresa_id, usuario);
  IF atual.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Os dados desta empresa mudaram desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  novo := app_private.aplicar_campos(atual, p_dados);

  -- Q4 = B: com a vitrine publicada, campos de menor risco vão ao público na hora.
  IF atual.situacao_vitrine = 'publicada' THEN
    FOREACH c IN ARRAY app_private.campos_menor_risco() LOOP
      IF (app_private.dados_publicos(novo) -> c) IS DISTINCT FROM (atual.dados_publicados -> c) THEN
        antes := antes || jsonb_build_object(c, atual.dados_publicados -> c);
        depois := depois || jsonb_build_object(c, app_private.dados_publicos(novo) -> c);
      END IF;
    END LOOP;
    IF depois <> '{}'::jsonb THEN
      novo.dados_publicados := atual.dados_publicados || depois;
    END IF;
  END IF;

  UPDATE public.empresas SET
    nome_publico = novo.nome_publico, modalidade = novo.modalidade, categoria_id = novo.categoria_id,
    cidade = novo.cidade, uf = novo.uf, bairro = novo.bairro, area_atendimento = novo.area_atendimento,
    telefone_publico = novo.telefone_publico, whatsapp_publico = novo.whatsapp_publico,
    email_publico = novo.email_publico, descricao_publica = novo.descricao_publica,
    horario_funcionamento = novo.horario_funcionamento, documento = novo.documento,
    email_contato = novo.email_contato, endereco_privado = novo.endereco_privado,
    observacoes_internas = novo.observacoes_internas, dados_publicados = novo.dados_publicados,
    versao = atual.versao + 1, atualizado_em = now()
  WHERE id = p_empresa_id
  RETURNING * INTO novo;

  IF depois <> '{}'::jsonb THEN
    PERFORM app_private.sincronizar_projecao(p_empresa_id);
    INSERT INTO public.moderacoes_vitrine (empresa_id, antes, depois, criada_por)
    VALUES (p_empresa_id, antes, depois, usuario) RETURNING id INTO moderacao;
    PERFORM app_private.registrar_evento(p_empresa_id, 'alteracao_direta', 'publicada', 'publicada', usuario, 'gestor',
      p_moderacao => moderacao, p_chave => p_operation_key);
  END IF;
  RETURN app_private.idem_fim(usuario, 'atualizar_empresa', p_operation_key, assinatura,
    app_private.empresa_json(novo) || jsonb_build_object('publicado_direto', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(depois) k)));
END $$;

CREATE FUNCTION public.enviar_vitrine_para_analise(p_empresa_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_expected_version));
  anterior jsonb;
  e public.empresas;
  ultima public.solicitacoes_publicacao;
  sol uuid;
  c text;
  mudou boolean := false;
  tipo_sol text;
  situacao_antes text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'enviar_vitrine_para_analise', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  e := app_private.empresa_do_proprietario(p_empresa_id, usuario);
  IF e.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Os dados desta empresa mudaram desde que você abriu a tela. Atualize antes de continuar.');
  END IF;
  IF NOT (SELECT authz.email_verificado()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Confirme seu e-mail antes de enviar a vitrine para análise.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_publicacao WHERE empresa_id = p_empresa_id AND estado = 'aberta') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já existe um envio em análise para esta empresa.');
  END IF;
  -- Revalida os dados mínimos (defesa contra dados antigos).
  PERFORM app_private.aplicar_campos(e, '{}'::jsonb);

  IF e.situacao_vitrine IN ('rascunho', 'correcao_solicitada', 'rejeitada') THEN
    IF e.situacao_vitrine = 'rejeitada' AND EXISTS (SELECT 1 FROM public.contestacoes
         WHERE empresa_id = p_empresa_id AND estado IN ('aberta', 'em_revisao')) THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'Há uma contestação em andamento. Aguarde a decisão antes de reenviar.');
    END IF;
    IF e.situacao_vitrine = 'correcao_solicitada' THEN
      -- T6: pelo menos um campo apontado pela CK precisa ter mudado.
      SELECT * INTO ultima FROM public.solicitacoes_publicacao
       WHERE empresa_id = p_empresa_id AND estado = 'correcao_solicitada' ORDER BY decidida_em DESC LIMIT 1;
      FOREACH c IN ARRAY coalesce(ultima.campos_corrigir, ARRAY[]::text[]) LOOP
        IF (app_private.dados_publicos(e) -> c) IS DISTINCT FROM (ultima.dados_publicos -> c) THEN
          mudou := true;
        END IF;
      END LOOP;
      IF NOT mudou THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Altere pelo menos um dos campos indicados pela CK antes de reenviar.');
      END IF;
    END IF;
    tipo_sol := 'publicacao_inicial';
    INSERT INTO public.solicitacoes_publicacao (empresa_id, tipo, dados_publicos, enviada_por)
    VALUES (p_empresa_id, tipo_sol, app_private.dados_publicos(e), usuario) RETURNING id INTO sol;
    situacao_antes := e.situacao_vitrine;
    UPDATE public.empresas SET situacao_vitrine = 'em_analise', versao = versao + 1, atualizado_em = now()
     WHERE id = p_empresa_id RETURNING * INTO e;
    PERFORM app_private.registrar_evento(p_empresa_id, 'enviada_para_analise', situacao_antes, 'em_analise', usuario, 'gestor',
      p_solicitacao => sol, p_chave => p_operation_key);
  ELSIF e.situacao_vitrine = 'publicada' THEN
    IF cardinality(app_private.relevantes_pendentes(e)) = 0 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Não há alteração relevante para enviar. Descrição e horário já são publicados direto.');
    END IF;
    tipo_sol := 'alteracao';
    INSERT INTO public.solicitacoes_publicacao (empresa_id, tipo, dados_publicos, enviada_por)
    VALUES (p_empresa_id, tipo_sol, app_private.dados_publicos(e), usuario) RETURNING id INTO sol;
    UPDATE public.empresas SET versao = versao + 1, atualizado_em = now() WHERE id = p_empresa_id RETURNING * INTO e;
    PERFORM app_private.registrar_evento(p_empresa_id, 'alteracao_enviada', 'publicada', 'publicada', usuario, 'gestor',
      p_solicitacao => sol, p_chave => p_operation_key);
  ELSE
    PERFORM app_private.erro('STATE_CONFLICT', 'A situação atual da vitrine não permite envio.');
  END IF;
  RETURN app_private.idem_fim(usuario, 'enviar_vitrine_para_analise', p_operation_key, assinatura, app_private.empresa_json(e));
END $$;

CREATE FUNCTION public.abrir_contestacao(p_empresa_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_motivo));
  anterior jsonb;
  e public.empresas;
  decisao public.eventos_publicacao;
  nova public.contestacoes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'abrir_contestacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  e := app_private.empresa_do_proprietario(p_empresa_id, usuario);
  IF e.situacao_vitrine NOT IN ('rejeitada', 'suspensa') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível contestar uma rejeição ou uma suspensão.');
  END IF;
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 10 AND 2000 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o motivo da contestação (10 a 2000 caracteres).', 'motivo');
  END IF;
  SELECT * INTO decisao FROM public.eventos_publicacao
   WHERE empresa_id = p_empresa_id AND papel_ator = 'ck' AND situacao_nova = e.situacao_vitrine
   ORDER BY criado_em DESC LIMIT 1;
  IF decisao.id IS NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Não encontramos a decisão da CK a contestar.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.contestacoes WHERE evento_decisao_id = decisao.id AND estado IN ('aberta', 'em_revisao')) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já existe uma contestação em andamento para esta decisão.');
  END IF;
  INSERT INTO public.contestacoes (empresa_id, evento_decisao_id, tipo_decisao, motivo_gestor, aberta_por)
  VALUES (p_empresa_id, decisao.id, CASE e.situacao_vitrine WHEN 'rejeitada' THEN 'rejeicao' ELSE 'suspensao' END,
          btrim(p_motivo), usuario)
  RETURNING * INTO nova;
  PERFORM app_private.registrar_evento(p_empresa_id, 'contestacao_aberta', e.situacao_vitrine, e.situacao_vitrine, usuario, 'gestor',
    p_contestacao => nova.id, p_chave => p_operation_key);
  RETURN app_private.idem_fim(usuario, 'abrir_contestacao', p_operation_key, assinatura,
    to_jsonb(nova) - 'decidida_por' - 'revisora_por' - 'aberta_por');
END $$;

-- ---------------------------------------------------------------------------
-- 7. RPCs da CK
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.sou_ck_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT authz.eh_ck_admin() $$;

CREATE FUNCTION public.ck_listar_empresas()
RETURNS TABLE (id uuid, nome_publico text, cidade text, uf text, categoria_id uuid, modalidade text,
               situacao_vitrine text, suspensao_gravidade text, suspensao_fundamento text,
               solicitacao_aberta uuid, versao integer, criado_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode ver esta lista.');
  END IF;
  -- Só dados públicos e situação: a CK não lê dados privados da empresa (SEC-T21).
  RETURN QUERY
    SELECT e.id, e.nome_publico, e.cidade, e.uf, e.categoria_id, e.modalidade, e.situacao_vitrine,
           e.suspensao_gravidade, e.suspensao_fundamento,
           (SELECT s.id FROM public.solicitacoes_publicacao s WHERE s.empresa_id = e.id AND s.estado = 'aberta'),
           e.versao, e.criado_em
      FROM public.empresas e
     ORDER BY e.criado_em DESC;
END $$;

CREATE FUNCTION public.ck_historico_empresa(p_empresa_id uuid)
RETURNS SETOF public.eventos_publicacao
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode ver o histórico completo.');
  END IF;
  RETURN QUERY SELECT * FROM public.eventos_publicacao WHERE empresa_id = p_empresa_id ORDER BY criado_em;
END $$;

CREATE FUNCTION public.ck_decidir_solicitacao(p_solicitacao_id uuid, p_decisao text, p_motivo text,
  p_campos text[], p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_solicitacao_id, p_decisao, p_motivo, array_to_string(p_campos, ',')));
  anterior jsonb;
  s public.solicitacoes_publicacao;
  e public.empresas;
  nova_situacao text;
  motivo_limpo text := nullif(btrim(coalesce(p_motivo, '')), '');
  c text;
  publicados jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_decidir_solicitacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO s FROM public.solicitacoes_publicacao WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN
    IF NOT (SELECT authz.eh_ck_admin()) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode realizar esta ação.');
    END IF;
    PERFORM app_private.erro('NOT_FOUND', 'Envio não encontrado.');
  END IF;
  e := app_private.empresa_para_ck(s.empresa_id, usuario);
  -- Trava o envio e confere o estado (a primeira decisão vence).
  SELECT * INTO s FROM public.solicitacoes_publicacao WHERE id = p_solicitacao_id FOR UPDATE;
  IF s.estado <> 'aberta' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este envio já foi decidido.');
  END IF;
  IF p_decisao NOT IN ('aprovar', 'pedir_correcao', 'rejeitar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Decisão inválida.', 'decisao');
  END IF;
  IF p_decisao IN ('pedir_correcao', 'rejeitar') AND (motivo_limpo IS NULL OR char_length(motivo_limpo) < 10) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o motivo (pelo menos 10 caracteres).', 'motivo');
  END IF;
  IF p_decisao = 'pedir_correcao' THEN
    IF coalesce(cardinality(p_campos), 0) = 0 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Indique os campos que precisam de correção.', 'campos');
    END IF;
    FOREACH c IN ARRAY p_campos LOOP
      IF NOT c = ANY (app_private.campos_relevantes() || app_private.campos_menor_risco()) THEN
        PERFORM app_private.erro('VALIDATION_ERROR', 'Campo inválido: ' || c, 'campos');
      END IF;
    END LOOP;
  END IF;

  IF s.tipo = 'publicacao_inicial' THEN
    IF e.situacao_vitrine <> 'em_analise' THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'A empresa não está em análise.');
    END IF;
    nova_situacao := CASE p_decisao WHEN 'aprovar' THEN 'publicada' WHEN 'pedir_correcao' THEN 'correcao_solicitada' ELSE 'rejeitada' END;
    publicados := CASE WHEN p_decisao = 'aprovar' THEN s.dados_publicos ELSE e.dados_publicados END;
  ELSE
    IF e.situacao_vitrine <> 'publicada' THEN
      PERFORM app_private.erro('STATE_CONFLICT', 'A empresa não está publicada.');
    END IF;
    nova_situacao := 'publicada';
    publicados := e.dados_publicados;
    IF p_decisao = 'aprovar' THEN
      FOREACH c IN ARRAY app_private.campos_relevantes() LOOP
        publicados := publicados || jsonb_build_object(c, s.dados_publicos -> c);
      END LOOP;
    END IF;
  END IF;

  UPDATE public.solicitacoes_publicacao SET
    estado = CASE p_decisao WHEN 'aprovar' THEN 'aprovada' WHEN 'pedir_correcao' THEN 'correcao_solicitada' ELSE 'rejeitada' END,
    decidida_por = usuario, decidida_em = now(), motivo = motivo_limpo,
    campos_corrigir = CASE WHEN p_decisao = 'pedir_correcao' THEN p_campos END
  WHERE id = p_solicitacao_id;
  UPDATE public.empresas SET situacao_vitrine = nova_situacao, dados_publicados = publicados,
    versao = versao + 1, atualizado_em = now()
  WHERE id = e.id RETURNING * INTO e;
  IF p_decisao = 'aprovar' THEN
    PERFORM app_private.sincronizar_projecao(e.id, s.id);
  END IF;
  PERFORM app_private.registrar_evento(e.id,
    CASE WHEN s.tipo = 'alteracao' THEN 'alteracao_' ELSE '' END || CASE p_decisao WHEN 'aprovar' THEN 'aprovada' WHEN 'pedir_correcao' THEN 'correcao_solicitada' ELSE 'rejeitada' END,
    CASE WHEN s.tipo = 'alteracao' THEN 'publicada' ELSE 'em_analise' END, nova_situacao, usuario, 'ck',
    p_motivo => motivo_limpo, p_solicitacao => s.id, p_chave => p_operation_key);
  PERFORM app_private.auditar(e.id, usuario, 'ck.solicitacao.' || p_decisao, 'solicitacoes_publicacao', s.id,
    jsonb_build_object('tipo', s.tipo));
  RETURN app_private.idem_fim(usuario, 'ck_decidir_solicitacao', p_operation_key, assinatura,
    jsonb_build_object('empresa_id', e.id, 'situacao_vitrine', e.situacao_vitrine, 'solicitacao_id', s.id, 'decisao', p_decisao));
END $$;

CREATE FUNCTION public.ck_suspender_vitrine(p_empresa_id uuid, p_motivo text, p_gravidade text, p_fundamento text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_motivo, p_gravidade, p_fundamento));
  anterior jsonb;
  e public.empresas;
  motivo_limpo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_suspender_vitrine', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  e := app_private.empresa_para_ck(p_empresa_id, usuario);
  IF e.situacao_vitrine <> 'publicada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível suspender uma vitrine publicada.');
  END IF;
  IF motivo_limpo IS NULL OR char_length(motivo_limpo) < 10 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o motivo da suspensão (pelo menos 10 caracteres).', 'motivo');
  END IF;
  IF p_gravidade IS NULL OR p_gravidade NOT IN ('comum', 'grave') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Indique a gravidade: comum ou grave.', 'gravidade');
  END IF;
  IF p_gravidade = 'grave' AND (p_fundamento IS NULL OR p_fundamento NOT IN ('fraude', 'risco_consumidor', 'exigencia_legal')) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Suspensão grave exige fundamento: fraude, risco ao consumidor ou exigência legal.', 'fundamento');
  END IF;
  IF p_gravidade = 'comum' AND p_fundamento IS NOT NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Fundamento só se aplica à suspensão grave.', 'fundamento');
  END IF;
  UPDATE public.solicitacoes_publicacao SET estado = 'cancelada_por_suspensao', decidida_por = usuario, decidida_em = now()
   WHERE empresa_id = p_empresa_id AND estado = 'aberta';
  UPDATE public.moderacoes_vitrine SET estado = 'encerrada_por_suspensao', decidida_por = usuario, decidida_em = now()
   WHERE empresa_id = p_empresa_id AND estado = 'pendente';
  UPDATE public.empresas SET situacao_vitrine = 'suspensa', suspensao_gravidade = p_gravidade,
    suspensao_fundamento = CASE WHEN p_gravidade = 'grave' THEN p_fundamento END,
    versao = versao + 1, atualizado_em = now()
  WHERE id = p_empresa_id RETURNING * INTO e;
  -- Remove a projeção na mesma transação (sem período de carência).
  PERFORM app_private.sincronizar_projecao(p_empresa_id);
  PERFORM app_private.registrar_evento(p_empresa_id, 'suspensa', 'publicada', 'suspensa', usuario, 'ck',
    p_motivo => motivo_limpo, p_gravidade => p_gravidade, p_fundamento => e.suspensao_fundamento, p_chave => p_operation_key);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'ck.vitrine.suspensa', 'empresas', p_empresa_id,
    jsonb_build_object('gravidade', p_gravidade, 'fundamento', e.suspensao_fundamento));
  RETURN app_private.idem_fim(usuario, 'ck_suspender_vitrine', p_operation_key, assinatura,
    jsonb_build_object('empresa_id', e.id, 'situacao_vitrine', e.situacao_vitrine));
END $$;

CREATE FUNCTION public.ck_reativar_vitrine(p_empresa_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_motivo));
  anterior jsonb;
  e public.empresas;
  motivo_limpo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_reativar_vitrine', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  e := app_private.empresa_para_ck(p_empresa_id, usuario);
  IF e.situacao_vitrine <> 'suspensa' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A vitrine não está suspensa.');
  END IF;
  IF motivo_limpo IS NULL OR char_length(motivo_limpo) < 10 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o motivo da reativação (pelo menos 10 caracteres).', 'motivo');
  END IF;
  UPDATE public.empresas SET situacao_vitrine = 'publicada', suspensao_gravidade = NULL, suspensao_fundamento = NULL,
    versao = versao + 1, atualizado_em = now()
  WHERE id = p_empresa_id RETURNING * INTO e;
  PERFORM app_private.sincronizar_projecao(p_empresa_id);
  PERFORM app_private.registrar_evento(p_empresa_id, 'reativada', 'suspensa', 'publicada', usuario, 'ck',
    p_motivo => motivo_limpo, p_chave => p_operation_key);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'ck.vitrine.reativada', 'empresas', p_empresa_id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'ck_reativar_vitrine', p_operation_key, assinatura,
    jsonb_build_object('empresa_id', e.id, 'situacao_vitrine', e.situacao_vitrine));
END $$;

CREATE FUNCTION public.ck_assumir_contestacao(p_contestacao_id uuid, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_contestacao_id::text);
  anterior jsonb;
  ct public.contestacoes;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_assumir_contestacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ct FROM public.contestacoes WHERE id = p_contestacao_id;
  IF NOT FOUND THEN
    IF NOT (SELECT authz.eh_ck_admin()) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode realizar esta ação.');
    END IF;
    PERFORM app_private.erro('NOT_FOUND', 'Contestação não encontrada.');
  END IF;
  PERFORM app_private.empresa_para_ck(ct.empresa_id, usuario);
  SELECT * INTO ct FROM public.contestacoes WHERE id = p_contestacao_id FOR UPDATE;
  IF ct.estado <> 'aberta' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta contestação já está em revisão ou foi decidida.');
  END IF;
  UPDATE public.contestacoes SET estado = 'em_revisao', revisora_por = usuario WHERE id = p_contestacao_id RETURNING * INTO ct;
  PERFORM app_private.registrar_evento(ct.empresa_id, 'contestacao_em_revisao', NULL, NULL, usuario, 'ck',
    p_contestacao => ct.id, p_chave => p_operation_key);
  RETURN app_private.idem_fim(usuario, 'ck_assumir_contestacao', p_operation_key, assinatura,
    jsonb_build_object('contestacao_id', ct.id, 'estado', ct.estado));
END $$;

CREATE FUNCTION public.ck_decidir_contestacao(p_contestacao_id uuid, p_decisao text, p_justificativa text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_contestacao_id, p_decisao, p_justificativa));
  anterior jsonb;
  ct public.contestacoes;
  decisao public.eventos_publicacao;
  e public.empresas;
  sol_origem public.solicitacoes_publicacao;
  nova_sol uuid;
  mesmo boolean;
  justificativa text := nullif(btrim(coalesce(p_justificativa, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_decidir_contestacao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO ct FROM public.contestacoes WHERE id = p_contestacao_id;
  IF NOT FOUND THEN
    IF NOT (SELECT authz.eh_ck_admin()) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode realizar esta ação.');
    END IF;
    PERFORM app_private.erro('NOT_FOUND', 'Contestação não encontrada.');
  END IF;
  e := app_private.empresa_para_ck(ct.empresa_id, usuario);
  SELECT * INTO ct FROM public.contestacoes WHERE id = p_contestacao_id FOR UPDATE;
  IF ct.estado <> 'em_revisao' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'A contestação precisa estar em revisão para ser decidida.');
  END IF;
  IF p_decisao NOT IN ('deferir', 'indeferir') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Decisão inválida.', 'decisao');
  END IF;
  -- Q7 = C, com auditoria: justificativa obrigatória.
  IF justificativa IS NULL OR char_length(justificativa) < 20 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Justifique a decisão (pelo menos 20 caracteres).', 'justificativa');
  END IF;
  SELECT * INTO decisao FROM public.eventos_publicacao WHERE id = ct.evento_decisao_id;
  mesmo := decisao.ator_auth_id = usuario;

  IF p_decisao = 'deferir' THEN
    IF ct.tipo_decisao = 'rejeicao' THEN
      IF e.situacao_vitrine <> 'rejeitada' THEN
        PERFORM app_private.erro('STATE_CONFLICT', 'A empresa não está mais rejeitada.');
      END IF;
      -- T10: nova análise a partir da cópia da decisão contestada.
      SELECT * INTO sol_origem FROM public.solicitacoes_publicacao WHERE id = decisao.solicitacao_id;
      INSERT INTO public.solicitacoes_publicacao (empresa_id, tipo, dados_publicos, enviada_por, origem_contestacao_id)
      VALUES (e.id, 'publicacao_inicial', sol_origem.dados_publicos, ct.aberta_por, ct.id) RETURNING id INTO nova_sol;
      UPDATE public.empresas SET situacao_vitrine = 'em_analise', versao = versao + 1, atualizado_em = now()
       WHERE id = e.id RETURNING * INTO e;
      PERFORM app_private.registrar_evento(e.id, 'contestacao_deferida', 'rejeitada', 'em_analise', usuario, 'ck',
        p_motivo => justificativa, p_contestacao => ct.id, p_solicitacao => nova_sol, p_mesmo_decisor => mesmo, p_chave => p_operation_key);
    ELSE
      IF e.situacao_vitrine <> 'suspensa' THEN
        PERFORM app_private.erro('STATE_CONFLICT', 'A empresa não está mais suspensa.');
      END IF;
      -- T11: volta a publicada com a última versão aprovada.
      UPDATE public.empresas SET situacao_vitrine = 'publicada', suspensao_gravidade = NULL, suspensao_fundamento = NULL,
        versao = versao + 1, atualizado_em = now()
       WHERE id = e.id RETURNING * INTO e;
      PERFORM app_private.sincronizar_projecao(e.id);
      PERFORM app_private.registrar_evento(e.id, 'contestacao_deferida', 'suspensa', 'publicada', usuario, 'ck',
        p_motivo => justificativa, p_contestacao => ct.id, p_mesmo_decisor => mesmo, p_chave => p_operation_key);
    END IF;
  ELSE
    PERFORM app_private.registrar_evento(e.id, 'contestacao_indeferida', e.situacao_vitrine, e.situacao_vitrine, usuario, 'ck',
      p_motivo => justificativa, p_contestacao => ct.id, p_mesmo_decisor => mesmo, p_chave => p_operation_key);
  END IF;
  UPDATE public.contestacoes SET estado = CASE p_decisao WHEN 'deferir' THEN 'deferida' ELSE 'indeferida' END,
    decidida_por = usuario, decidida_em = now(), justificativa_ck = justificativa, mesmo_decisor = mesmo
  WHERE id = ct.id RETURNING * INTO ct;
  PERFORM app_private.auditar(e.id, usuario, 'ck.contestacao.' || p_decisao, 'contestacoes', ct.id,
    jsonb_build_object('mesmo_decisor', mesmo));
  RETURN app_private.idem_fim(usuario, 'ck_decidir_contestacao', p_operation_key, assinatura,
    jsonb_build_object('contestacao_id', ct.id, 'estado', ct.estado, 'empresa_id', e.id,
                       'situacao_vitrine', e.situacao_vitrine, 'mesmo_decisor', mesmo));
END $$;

CREATE FUNCTION public.ck_moderar_alteracao_direta(p_moderacao_id uuid, p_decisao text, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_moderacao_id, p_decisao, p_motivo));
  anterior jsonb;
  m public.moderacoes_vitrine;
  e public.empresas;
  motivo_limpo text := nullif(btrim(coalesce(p_motivo, '')), '');
  c text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'ck_moderar_alteracao_direta', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.moderacoes_vitrine WHERE id = p_moderacao_id;
  IF NOT FOUND THEN
    IF NOT (SELECT authz.eh_ck_admin()) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Somente a equipe da CK pode realizar esta ação.');
    END IF;
    PERFORM app_private.erro('NOT_FOUND', 'Alteração não encontrada.');
  END IF;
  e := app_private.empresa_para_ck(m.empresa_id, usuario);
  SELECT * INTO m FROM public.moderacoes_vitrine WHERE id = p_moderacao_id FOR UPDATE;
  IF m.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta alteração já foi moderada.');
  END IF;
  IF p_decisao NOT IN ('manter', 'pedir_correcao', 'restaurar') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Decisão inválida.', 'decisao');
  END IF;
  IF p_decisao <> 'manter' AND (motivo_limpo IS NULL OR char_length(motivo_limpo) < 10) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Explique o motivo (pelo menos 10 caracteres).', 'motivo');
  END IF;
  IF p_decisao = 'restaurar' THEN
    -- Volta a versão anterior na cópia de trabalho e na versão publicada.
    UPDATE public.empresas SET
      descricao_publica = CASE WHEN m.antes ? 'descricao_publica' THEN m.antes ->> 'descricao_publica' ELSE descricao_publica END,
      horario_funcionamento = CASE WHEN m.antes ? 'horario_funcionamento' THEN m.antes ->> 'horario_funcionamento' ELSE horario_funcionamento END,
      dados_publicados = dados_publicados || m.antes,
      versao = versao + 1, atualizado_em = now()
    WHERE id = e.id RETURNING * INTO e;
    PERFORM app_private.sincronizar_projecao(e.id);
  END IF;
  UPDATE public.moderacoes_vitrine SET
    estado = CASE p_decisao WHEN 'manter' THEN 'mantida' WHEN 'pedir_correcao' THEN 'correcao_pedida' ELSE 'restaurada' END,
    decidida_por = usuario, decidida_em = now(), motivo = motivo_limpo
  WHERE id = m.id RETURNING * INTO m;
  PERFORM app_private.registrar_evento(e.id, 'moderacao_' || m.estado, e.situacao_vitrine, e.situacao_vitrine, usuario, 'ck',
    p_motivo => motivo_limpo, p_moderacao => m.id, p_chave => p_operation_key);
  PERFORM app_private.auditar(e.id, usuario, 'ck.moderacao.' || p_decisao, 'moderacoes_vitrine', m.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'ck_moderar_alteracao_direta', p_operation_key, assinatura,
    jsonb_build_object('moderacao_id', m.id, 'estado', m.estado, 'empresa_id', e.id));
END $$;

-- ---------------------------------------------------------------------------
-- 8. RLS e GRANT mínimo (nenhuma escrita direta; anônimo sem acesso)
-- ---------------------------------------------------------------------------

ALTER TABLE public.categorias_plataforma ENABLE ROW LEVEL SECURITY;
CREATE POLICY categorias_ler_ativas ON public.categorias_plataforma FOR SELECT TO authenticated USING (ativo);
GRANT SELECT ON public.categorias_plataforma TO authenticated;

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY empresas_ler_proprietario ON public.empresas FOR SELECT TO authenticated
  USING ((SELECT authz.eh_proprietario(id)));
-- Tabela inteira: a RLS já restringe ao proprietário (criada_por é a própria identidade dele).
GRANT SELECT ON public.empresas TO authenticated;

ALTER TABLE public.membros_empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY membros_ler_proprios ON public.membros_empresa FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT authz.usuario_atual()));
GRANT SELECT ON public.membros_empresa TO authenticated;

ALTER TABLE public.solicitacoes_publicacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY solicitacoes_ler ON public.solicitacoes_publicacao FOR SELECT TO authenticated
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
GRANT SELECT (id, empresa_id, tipo, estado, dados_publicos, enviada_em, decidida_em, motivo, campos_corrigir,
  origem_contestacao_id) ON public.solicitacoes_publicacao TO authenticated;

ALTER TABLE public.eventos_publicacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY eventos_ler ON public.eventos_publicacao FOR SELECT TO authenticated
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
-- Sem ator_auth_id: o gestor não vê qual pessoa da CK decidiu (a CK usa ck_historico_empresa).
GRANT SELECT (id, empresa_id, tipo, situacao_anterior, situacao_nova, solicitacao_id, contestacao_id, moderacao_id,
  papel_ator, motivo, gravidade, fundamento, mesmo_decisor, criado_em) ON public.eventos_publicacao TO authenticated;

ALTER TABLE public.contestacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY contestacoes_ler ON public.contestacoes FOR SELECT TO authenticated
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
GRANT SELECT (id, empresa_id, evento_decisao_id, tipo_decisao, motivo_gestor, estado, aberta_em, decidida_em,
  justificativa_ck, mesmo_decisor) ON public.contestacoes TO authenticated;

ALTER TABLE public.moderacoes_vitrine ENABLE ROW LEVEL SECURITY;
CREATE POLICY moderacoes_ler ON public.moderacoes_vitrine FOR SELECT TO authenticated
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
GRANT SELECT (id, empresa_id, antes, depois, estado, criada_em, decidida_em, motivo) ON public.moderacoes_vitrine TO authenticated;

ALTER TABLE public.public_empresa_cards ENABLE ROW LEVEL SECURITY;
-- M03: só o proprietário e a CK leem a projeção. Leitura pública (anonymous) no M10.
CREATE POLICY cards_ler ON public.public_empresa_cards FOR SELECT TO authenticated
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
GRANT SELECT ON public.public_empresa_cards TO authenticated;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'public.criar_empresa(jsonb, text)',
    'public.atualizar_empresa(uuid, jsonb, integer, text)',
    'public.enviar_vitrine_para_analise(uuid, integer, text)',
    'public.abrir_contestacao(uuid, text, text)',
    'public.sou_ck_admin()',
    'public.ck_listar_empresas()',
    'public.ck_historico_empresa(uuid)',
    'public.ck_decidir_solicitacao(uuid, text, text, text[], text)',
    'public.ck_suspender_vitrine(uuid, text, text, text, text)',
    'public.ck_reativar_vitrine(uuid, text, text)',
    'public.ck_assumir_contestacao(uuid, text)',
    'public.ck_decidir_contestacao(uuid, text, text, text)',
    'public.ck_moderar_alteracao_direta(uuid, text, text, text)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010003', 'Empresas, vitrine, análise CK, moderação, suspensão e contestação (M03)');

COMMIT;
