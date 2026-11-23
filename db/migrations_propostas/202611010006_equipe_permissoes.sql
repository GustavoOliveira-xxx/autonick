-- MIG-06: funcionários, vínculos empresariais e permissões (M04).
--
-- Fonte: docs/marcos/M04/MINI-ESPEC_M04.md e docs/adr/ADR-G04_Decisoes_M04.md.
-- Autorizada pelo idealizador em 01/11/2026 (branch `desenvolvimento`).
-- Depende de 202611010001 a 202611010005.
--
-- Princípios:
--  - permissão conferida no banco a cada requisição, pelo vínculo ATUAL (RF-029);
--  - proprietário tem todas as permissões da própria empresa;
--  - gestor designado só concede o que tem e não altera o próprio acesso (D4-2);
--  - catálogo fechado: nenhuma permissão da CK pode ser concedida por empresa;
--  - dados privados da empresa e dados de colegas só com permissão;
--  - toda escrita por RPC com chave de operação, versão e auditoria.
--
-- Rollback (somente sem dados reais): 202611010006_equipe_permissoes.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Catálogo de permissões (RF-026)
-- ---------------------------------------------------------------------------

CREATE TABLE public.permissoes_catalogo (
  codigo      text PRIMARY KEY CHECK (codigo ~ '^[a-z]+\.[a-z_]+$'),
  modulo      text NOT NULL,
  modulo_nome text NOT NULL,
  acao        text NOT NULL,
  acao_nome   text NOT NULL,
  descricao   text NOT NULL,
  sensivel    boolean NOT NULL DEFAULT false,
  ordem       integer NOT NULL
);

INSERT INTO public.permissoes_catalogo (codigo, modulo, modulo_nome, acao, acao_nome, descricao, sensivel, ordem) VALUES
  ('empresa.visualizar', 'empresa', 'Dados da empresa', 'visualizar', 'Ver dados privados', 'Ver documento, endereço, e-mail de contato e observações internas.', true, 10),
  ('empresa.alterar', 'empresa', 'Dados da empresa', 'alterar', 'Alterar dados privados', 'Alterar documento, endereço, e-mail de contato e observações internas.', true, 11),
  ('vitrine.visualizar', 'vitrine', 'Vitrine', 'visualizar', 'Ver vitrine', 'Ver a situação da vitrine, os envios para análise e o histórico.', false, 20),
  ('vitrine.alterar', 'vitrine', 'Vitrine', 'alterar', 'Editar e enviar vitrine', 'Editar os dados públicos, enviar para análise da CK e contestar decisões.', false, 21),
  ('equipe.visualizar', 'equipe', 'Equipe e acessos', 'visualizar', 'Ver equipe', 'Ver funcionários, e-mails, convites, perfis de acesso e histórico da equipe.', true, 30),
  ('equipe.convidar', 'equipe', 'Equipe e acessos', 'convidar', 'Convidar', 'Convidar pessoas e cancelar convites.', true, 31),
  ('equipe.alterar', 'equipe', 'Equipe e acessos', 'alterar', 'Gerenciar perfis e acessos', 'Criar e alterar perfis de acesso e trocar o perfil dos funcionários.', true, 32),
  ('equipe.revogar', 'equipe', 'Equipe e acessos', 'revogar', 'Desligar', 'Encerrar o acesso de funcionários.', true, 33),
  ('clientes.visualizar', 'clientes', 'Clientes', 'visualizar', 'Ver clientes', 'Ver cadastro e dados de contato dos clientes da empresa.', true, 40),
  ('clientes.criar', 'clientes', 'Clientes', 'criar', 'Cadastrar clientes', 'Cadastrar clientes da empresa.', true, 41),
  ('clientes.alterar', 'clientes', 'Clientes', 'alterar', 'Alterar clientes', 'Alterar o cadastro de clientes.', true, 42),
  ('clientes.exportar', 'clientes', 'Clientes', 'exportar', 'Exportar clientes', 'Exportar a lista de clientes.', true, 43),
  ('produtos.visualizar', 'produtos', 'Produtos', 'visualizar', 'Ver produtos', 'Ver produtos, variações e preços de venda.', false, 50),
  ('produtos.criar', 'produtos', 'Produtos', 'criar', 'Cadastrar produtos', 'Cadastrar produtos e variações.', false, 51),
  ('produtos.alterar', 'produtos', 'Produtos', 'alterar', 'Alterar produtos', 'Alterar dados de produtos, exceto preço.', false, 52),
  ('produtos.alterar_preco', 'produtos', 'Produtos', 'alterar_preco', 'Alterar preço', 'Alterar o preço de venda.', false, 53),
  ('produtos.ver_custo', 'produtos', 'Produtos', 'ver_custo', 'Ver custo', 'Ver o custo dos produtos.', true, 54),
  ('produtos.exportar', 'produtos', 'Produtos', 'exportar', 'Exportar produtos', 'Exportar a lista de produtos.', true, 55),
  ('estoque.visualizar', 'estoque', 'Estoque', 'visualizar', 'Ver estoque', 'Ver saldos e movimentações.', false, 60),
  ('estoque.propor', 'estoque', 'Estoque', 'propor', 'Lançar movimentação', 'Registrar entradas, saídas e ajustes para confirmação.', false, 61),
  ('estoque.aprovar', 'estoque', 'Estoque', 'aprovar', 'Confirmar movimentação', 'Confirmar movimentações e ajustes de estoque.', false, 62),
  ('estoque.exportar', 'estoque', 'Estoque', 'exportar', 'Exportar estoque', 'Exportar saldos e movimentações.', true, 63),
  ('pedidos.visualizar', 'pedidos', 'Pedidos', 'visualizar', 'Ver pedidos', 'Ver pedidos recebidos.', false, 70),
  ('pedidos.aprovar', 'pedidos', 'Pedidos', 'aprovar', 'Aceitar ou recusar', 'Aceitar ou recusar pedidos.', false, 71),
  ('pedidos.cancelar', 'pedidos', 'Pedidos', 'cancelar', 'Cancelar pedidos', 'Cancelar pedidos com justificativa.', false, 72),
  ('pedidos.exportar', 'pedidos', 'Pedidos', 'exportar', 'Exportar pedidos', 'Exportar pedidos.', true, 73),
  ('vendas.visualizar', 'vendas', 'Vendas', 'visualizar', 'Ver vendas', 'Ver vendas registradas.', false, 80),
  ('vendas.criar', 'vendas', 'Vendas', 'criar', 'Registrar vendas', 'Iniciar e registrar vendas.', false, 81),
  ('vendas.aprovar', 'vendas', 'Vendas', 'aprovar', 'Confirmar vendas', 'Confirmar vendas.', false, 82),
  ('vendas.cancelar', 'vendas', 'Vendas', 'cancelar', 'Cancelar vendas', 'Cancelar vendas com justificativa.', false, 83),
  ('vendas.aplicar_desconto', 'vendas', 'Vendas', 'aplicar_desconto', 'Aplicar desconto', 'Aplicar descontos em vendas.', false, 84),
  ('vendas.exportar', 'vendas', 'Vendas', 'exportar', 'Exportar vendas', 'Exportar vendas.', true, 85),
  ('orcamentos.visualizar', 'orcamentos', 'Orçamentos', 'visualizar', 'Ver orçamentos', 'Ver orçamentos.', false, 90),
  ('orcamentos.criar', 'orcamentos', 'Orçamentos', 'criar', 'Emitir orçamentos', 'Emitir orçamentos.', false, 91),
  ('orcamentos.aprovar', 'orcamentos', 'Orçamentos', 'aprovar', 'Aprovar orçamentos', 'Aprovar orçamentos antes do envio.', false, 92),
  ('orcamentos.cancelar', 'orcamentos', 'Orçamentos', 'cancelar', 'Cancelar orçamentos', 'Cancelar orçamentos.', false, 93),
  ('orcamentos.exportar', 'orcamentos', 'Orçamentos', 'exportar', 'Exportar orçamentos', 'Exportar orçamentos.', true, 94),
  ('servicos.visualizar', 'servicos', 'Ordens de serviço', 'visualizar', 'Ver ordens de serviço', 'Ver ordens de serviço.', false, 100),
  ('servicos.alterar', 'servicos', 'Ordens de serviço', 'alterar', 'Executar e atualizar', 'Executar ordens de serviço e atualizar etapas.', false, 101),
  ('servicos.cancelar', 'servicos', 'Ordens de serviço', 'cancelar', 'Cancelar ordens', 'Cancelar ordens de serviço com justificativa.', false, 102),
  ('financeiro.visualizar', 'financeiro', 'Financeiro', 'visualizar', 'Ver financeiro', 'Ver contas, caixas, títulos e saldos.', true, 110),
  ('financeiro.criar', 'financeiro', 'Financeiro', 'criar', 'Lançar', 'Lançar contas a pagar e a receber.', true, 111),
  ('financeiro.aprovar', 'financeiro', 'Financeiro', 'aprovar', 'Registrar pagamentos', 'Registrar pagamentos e recebimentos.', true, 112),
  ('financeiro.cancelar', 'financeiro', 'Financeiro', 'cancelar', 'Estornar', 'Estornar lançamentos com justificativa.', true, 113),
  ('financeiro.fechar', 'financeiro', 'Financeiro', 'fechar', 'Fechar período', 'Fechar períodos financeiros.', true, 114),
  ('financeiro.exportar', 'financeiro', 'Financeiro', 'exportar', 'Exportar financeiro', 'Exportar dados financeiros.', true, 115),
  ('relatorios.visualizar', 'relatorios', 'Relatórios', 'visualizar', 'Ver relatórios', 'Ver relatórios gerenciais.', false, 120),
  ('relatorios.exportar', 'relatorios', 'Relatórios', 'exportar', 'Exportar relatórios', 'Exportar relatórios.', true, 121);

-- ---------------------------------------------------------------------------
-- 2. Perfis de acesso, vínculos, convites e histórico da equipe
-- ---------------------------------------------------------------------------

CREATE TABLE public.perfis_permissao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas (id),
  nome          text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 60),
  descricao     text CHECK (char_length(descricao) <= 300),
  ativo         boolean NOT NULL DEFAULT true,
  versao        integer NOT NULL DEFAULT 1,
  criado_por    text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX perfis_permissao_nome_unico ON public.perfis_permissao (empresa_id, lower(nome)) WHERE ativo;

CREATE TABLE public.perfil_permissoes (
  perfil_id uuid NOT NULL REFERENCES public.perfis_permissao (id),
  codigo    text NOT NULL REFERENCES public.permissoes_catalogo (codigo),
  PRIMARY KEY (perfil_id, codigo)
);

-- Vínculo: proprietário (M03) ou funcionário (M04). Encerrados ficam para o histórico.
ALTER TABLE public.membros_empresa ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.membros_empresa DROP CONSTRAINT membros_empresa_pkey;
ALTER TABLE public.membros_empresa ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX membros_empresa_um_ativo ON public.membros_empresa (empresa_id, auth_user_id) WHERE estado = 'ativo';
ALTER TABLE public.membros_empresa DROP CONSTRAINT membros_empresa_papel_check;
ALTER TABLE public.membros_empresa ADD CONSTRAINT membros_empresa_papel_check CHECK (papel IN ('proprietario', 'funcionario'));
ALTER TABLE public.membros_empresa DROP CONSTRAINT membros_empresa_estado_check;
ALTER TABLE public.membros_empresa ADD CONSTRAINT membros_empresa_estado_check CHECK (estado IN ('ativo', 'encerrado'));
ALTER TABLE public.membros_empresa
  ADD COLUMN perfil_permissao_id uuid REFERENCES public.perfis_permissao (id),
  ADD COLUMN versao integer NOT NULL DEFAULT 1,
  ADD COLUMN convite_id uuid,
  ADD COLUMN encerrado_em timestamptz,
  ADD COLUMN encerrado_por text,
  ADD COLUMN motivo_encerramento text CHECK (motivo_encerramento IN ('desligado', 'saiu')),
  ADD COLUMN observacao_encerramento text CHECK (char_length(observacao_encerramento) <= 300),
  ADD CONSTRAINT membros_empresa_perfil_coerente CHECK (
    (papel = 'proprietario' AND perfil_permissao_id IS NULL)
    OR (papel = 'funcionario' AND perfil_permissao_id IS NOT NULL)),
  ADD CONSTRAINT membros_empresa_encerramento_coerente CHECK (
    (estado = 'ativo') = (encerrado_em IS NULL));
CREATE INDEX membros_empresa_perfil_idx ON public.membros_empresa (perfil_permissao_id) WHERE estado = 'ativo';

CREATE TABLE public.convites_empresa (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas (id),
  email               text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254),
  perfil_permissao_id uuid NOT NULL REFERENCES public.perfis_permissao (id),
  estado              text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aceito', 'recusado', 'cancelado', 'expirado')),
  criado_por          text NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  expira_em           timestamptz NOT NULL DEFAULT now() + interval '7 days',
  decidido_por        text,
  decidido_em         timestamptz,
  membro_id           uuid REFERENCES public.membros_empresa (id)
);
CREATE UNIQUE INDEX convites_um_pendente ON public.convites_empresa (empresa_id, email) WHERE estado = 'pendente';
CREATE INDEX convites_por_email ON public.convites_empresa (email) WHERE estado = 'pendente';
CREATE TRIGGER convites_sem_exclusao BEFORE DELETE ON public.convites_empresa
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

CREATE TABLE public.eventos_equipe (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas (id),
  tipo           text NOT NULL,
  ator_auth_id   text NOT NULL,
  alvo_auth_id   text,
  membro_id      uuid,
  convite_id     uuid,
  perfil_id      uuid,
  detalhes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  operation_key  text,
  criado_em      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX eventos_equipe_empresa ON public.eventos_equipe (empresa_id, criado_em);
CREATE TRIGGER eventos_equipe_somente_insercao BEFORE UPDATE OR DELETE ON public.eventos_equipe
  FOR EACH ROW EXECUTE FUNCTION app_private.impedir_alteracao_historico();

-- ---------------------------------------------------------------------------
-- 3. Permissões efetivas (lidas do banco a cada requisição)
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_private.eh_proprietario_de(p_empresa_id uuid, p_usuario text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.membros_empresa
                  WHERE empresa_id = p_empresa_id AND auth_user_id = p_usuario
                    AND papel = 'proprietario' AND estado = 'ativo')
$$;

CREATE FUNCTION app_private.permissoes_do_perfil(p_perfil_id uuid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(array_agg(codigo ORDER BY codigo), ARRAY[]::text[])
    FROM public.perfil_permissoes WHERE perfil_id = p_perfil_id
$$;

CREATE FUNCTION app_private.permissoes_de(p_empresa_id uuid, p_usuario text) RETURNS text[]
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN app_private.eh_proprietario_de(p_empresa_id, p_usuario)
      THEN (SELECT array_agg(codigo ORDER BY codigo) FROM public.permissoes_catalogo)
    ELSE coalesce((
      SELECT app_private.permissoes_do_perfil(m.perfil_permissao_id)
        FROM public.membros_empresa m
        JOIN public.perfis_permissao p ON p.id = m.perfil_permissao_id AND p.ativo
       WHERE m.empresa_id = p_empresa_id AND m.auth_user_id = p_usuario
         AND m.papel = 'funcionario' AND m.estado = 'ativo'), ARRAY[]::text[])
  END
$$;

CREATE FUNCTION authz.eh_membro_ativo(p_empresa_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.membros_empresa
                  WHERE empresa_id = p_empresa_id AND auth_user_id = (SELECT authz.usuario_atual())
                    AND estado = 'ativo')
$$;

CREATE FUNCTION authz.tem_permissao(p_empresa_id uuid, p_codigo text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_codigo = ANY (app_private.permissoes_de(p_empresa_id, (SELECT authz.usuario_atual())))
$$;

CREATE FUNCTION app_private.exigir_permissoes(p_empresa_id uuid, p_usuario text, p_codigos text[]) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa
                  WHERE empresa_id = p_empresa_id AND auth_user_id = p_usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.permissoes_de(p_empresa_id, p_usuario) @> p_codigos) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite esta ação nesta empresa.');
  END IF;
END $$;

-- D4-2: gestor designado só concede ou altera permissões que ele mesmo tem.
CREATE FUNCTION app_private.verificar_delegacao(p_empresa_id uuid, p_ator text, p_permissoes text[]) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF app_private.eh_proprietario_de(p_empresa_id, p_ator) THEN
    RETURN;
  END IF;
  IF NOT (app_private.permissoes_de(p_empresa_id, p_ator) @> coalesce(p_permissoes, ARRAY[]::text[])) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Você só pode conceder ou alterar permissões que você mesmo tem.');
  END IF;
END $$;

CREATE FUNCTION app_private.validar_permissoes(p_permissoes text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  desconhecida text;
  resultado text[];
BEGIN
  SELECT array_agg(DISTINCT c ORDER BY c) INTO resultado FROM unnest(coalesce(p_permissoes, ARRAY[]::text[])) AS c;
  IF resultado IS NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha pelo menos uma permissão.', 'permissoes');
  END IF;
  SELECT c INTO desconhecida FROM unnest(resultado) AS c
   WHERE NOT EXISTS (SELECT 1 FROM public.permissoes_catalogo WHERE codigo = c) LIMIT 1;
  IF desconhecida IS NOT NULL THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Permissão desconhecida: ' || desconhecida, 'permissoes');
  END IF;
  RETURN resultado;
END $$;

CREATE FUNCTION app_private.email_da_pessoa(p_usuario text) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT lower(u.email) FROM neon_auth."user" u WHERE u.id::text = p_usuario $$;

CREATE FUNCTION app_private.nome_da_pessoa(p_usuario text) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT nome FROM public.perfis_identidade WHERE auth_user_id = p_usuario AND tipo_conta = 'business'),
    (SELECT nullif(btrim(u.name), '') FROM neon_auth."user" u WHERE u.id::text = p_usuario),
    'Pessoa sem nome')
$$;

CREATE FUNCTION app_private.perfil_json(p_perfil_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', p.id, 'empresa_id', p.empresa_id, 'nome', p.nome, 'descricao', p.descricao,
    'ativo', p.ativo, 'versao', p.versao, 'permissoes', to_jsonb(app_private.permissoes_do_perfil(p.id)))
    FROM public.perfis_permissao p WHERE p.id = p_perfil_id
$$;

CREATE FUNCTION app_private.registrar_evento_equipe(p_empresa uuid, p_tipo text, p_ator text, p_alvo text,
  p_membro uuid, p_convite uuid, p_perfil uuid, p_detalhes jsonb, p_chave text)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$
  INSERT INTO public.eventos_equipe (empresa_id, tipo, ator_auth_id, alvo_auth_id, membro_id, convite_id, perfil_id, detalhes, operation_key)
  VALUES (p_empresa, p_tipo, p_ator, p_alvo, p_membro, p_convite, p_perfil, coalesce(p_detalhes, '{}'::jsonb), p_chave)
$$;

-- Carrega a empresa com trava, exigindo as permissões indicadas.
CREATE FUNCTION app_private.empresa_autorizada(p_empresa_id uuid, p_usuario text, p_codigos text[]) RETURNS public.empresas
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  e public.empresas;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, p_usuario, p_codigos);
  SELECT * INTO e FROM public.empresas WHERE id = p_empresa_id FOR UPDATE;
  RETURN e;
END $$;

-- Resposta das RPCs de empresa: sem campos privados para quem não tem empresa.visualizar.
CREATE OR REPLACE FUNCTION app_private.empresa_json(e public.empresas) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT (to_jsonb(e) - 'criada_por'
           - CASE WHEN app_private.permissoes_de(e.id, (SELECT authz.usuario_atual())) @> ARRAY['empresa.visualizar']
                  THEN ARRAY[]::text[] ELSE app_private.campos_privados() END)
    || jsonb_build_object(
         'relevantes_pendentes', app_private.relevantes_pendentes(e),
         'solicitacao_aberta', (SELECT to_jsonb(s) - 'decidida_por' - 'enviada_por'
                                  FROM public.solicitacoes_publicacao s
                                 WHERE s.empresa_id = e.id AND s.estado = 'aberta'))
$$;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION authz.eh_membro_ativo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.eh_membro_ativo(uuid) TO authenticated;
REVOKE ALL ON FUNCTION authz.tem_permissao(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.tem_permissao(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPCs da vitrine e da empresa passam a seguir permissão (Q10 do M03)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atualizar_empresa(p_empresa_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
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
  exigidas text[] := ARRAY[]::text[];
BEGIN
  anterior := app_private.idem_inicio(usuario, 'atualizar_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  IF p_dados IS NOT NULL AND jsonb_typeof(p_dados) = 'object' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_dados) k WHERE k = ANY (app_private.campos_privados())) THEN
      exigidas := array_append(exigidas, 'empresa.alterar');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_dados) k WHERE NOT k = ANY (app_private.campos_privados())) THEN
      exigidas := array_append(exigidas, 'vitrine.alterar');
    END IF;
  END IF;
  atual := app_private.empresa_autorizada(p_empresa_id, usuario, exigidas);
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
  -- M04: com funcionários, a autoria de cada alteração fica registrada (RF-030). Só os nomes dos campos.
  PERFORM app_private.auditar(p_empresa_id, usuario, 'empresa.alterada', 'empresas', p_empresa_id,
    jsonb_build_object('campos', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_object_keys(p_dados) k)));

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

CREATE OR REPLACE FUNCTION public.enviar_vitrine_para_analise(p_empresa_id uuid, p_expected_version integer, p_operation_key text)
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
  e := app_private.empresa_autorizada(p_empresa_id, usuario, ARRAY['vitrine.alterar']);
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

CREATE OR REPLACE FUNCTION public.abrir_contestacao(p_empresa_id uuid, p_motivo text, p_operation_key text)
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
  e := app_private.empresa_autorizada(p_empresa_id, usuario, ARRAY['vitrine.alterar']);
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

DROP FUNCTION app_private.empresa_do_proprietario(uuid, text);

-- A lista da CK passa a mostrar a marcação de dados de teste (decisão do M03).
DROP FUNCTION public.ck_listar_empresas();
CREATE FUNCTION public.ck_listar_empresas()
RETURNS TABLE (id uuid, nome_publico text, cidade text, uf text, categoria_id uuid, modalidade text,
               situacao_vitrine text, suspensao_gravidade text, suspensao_fundamento text,
               solicitacao_aberta uuid, versao integer, criado_em timestamptz, dado_de_teste boolean)
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
           e.versao, e.criado_em, e.dado_de_teste
      FROM public.empresas e
     ORDER BY e.criado_em DESC;
END $$;

-- ---------------------------------------------------------------------------
-- 5. RPCs de consulta para o membro
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.minhas_empresas()
RETURNS TABLE (empresa_id uuid, nome_publico text, cidade text, uf text, situacao_vitrine text,
               dado_de_teste boolean, papel text, perfil_nome text, membro_desde timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  RETURN QUERY
    SELECT e.id, e.nome_publico, e.cidade, e.uf, e.situacao_vitrine, e.dado_de_teste, m.papel, p.nome, m.criado_em
      FROM public.membros_empresa m
      JOIN public.empresas e ON e.id = m.empresa_id
      LEFT JOIN public.perfis_permissao p ON p.id = m.perfil_permissao_id
     WHERE m.auth_user_id = usuario AND m.estado = 'ativo'
     ORDER BY e.nome_publico;
END $$;

CREATE FUNCTION public.minhas_permissoes(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  m public.membros_empresa;
BEGIN
  SELECT * INTO m FROM public.membros_empresa
   WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo';
  IF NOT FOUND THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  RETURN jsonb_build_object('membro_id', m.id, 'papel', m.papel, 'perfil_id', m.perfil_permissao_id,
    'perfil_nome', (SELECT nome FROM public.perfis_permissao WHERE id = m.perfil_permissao_id),
    'permissoes', to_jsonb(app_private.permissoes_de(p_empresa_id, usuario)));
END $$;

CREATE FUNCTION public.empresa_dados_privados(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['empresa.visualizar']);
  RETURN (SELECT jsonb_build_object('documento', e.documento, 'email_contato', e.email_contato,
            'endereco_privado', e.endereco_privado, 'observacoes_internas', e.observacoes_internas)
            FROM public.empresas e WHERE e.id = p_empresa_id);
END $$;

CREATE FUNCTION public.equipe_membros(p_empresa_id uuid)
RETURNS TABLE (membro_id uuid, nome text, email text, papel text, perfil_id uuid, perfil_nome text,
               estado text, desde timestamptz, encerrado_em timestamptz, motivo_encerramento text,
               versao integer, eu boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['equipe.visualizar']);
  RETURN QUERY
    SELECT m.id, app_private.nome_da_pessoa(m.auth_user_id), app_private.email_da_pessoa(m.auth_user_id),
           m.papel, m.perfil_permissao_id, p.nome, m.estado, m.criado_em, m.encerrado_em, m.motivo_encerramento,
           m.versao, m.auth_user_id = usuario
      FROM public.membros_empresa m
      LEFT JOIN public.perfis_permissao p ON p.id = m.perfil_permissao_id
     WHERE m.empresa_id = p_empresa_id
     ORDER BY (m.estado = 'ativo') DESC, (m.papel = 'proprietario') DESC, m.criado_em;
END $$;

CREATE FUNCTION public.equipe_historico(p_empresa_id uuid)
RETURNS TABLE (id uuid, tipo text, ator_nome text, alvo_nome text, detalhes jsonb, criado_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['equipe.visualizar']);
  RETURN QUERY
    SELECT ev.id, ev.tipo, app_private.nome_da_pessoa(ev.ator_auth_id),
           CASE WHEN ev.alvo_auth_id IS NULL THEN NULL ELSE app_private.nome_da_pessoa(ev.alvo_auth_id) END,
           ev.detalhes, ev.criado_em
      FROM public.eventos_equipe ev
     WHERE ev.empresa_id = p_empresa_id
     ORDER BY ev.criado_em DESC;
END $$;

CREATE FUNCTION public.meus_convites()
RETURNS TABLE (convite_id uuid, empresa_id uuid, empresa_nome text, perfil_nome text, expira_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  meu_email text;
BEGIN
  SELECT lower(u.email) INTO meu_email FROM neon_auth."user" u WHERE u.id::text = usuario AND u."emailVerified";
  IF meu_email IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c.id, c.empresa_id, e.nome_publico, p.nome, c.expira_em
      FROM public.convites_empresa c
      JOIN public.empresas e ON e.id = c.empresa_id
      JOIN public.perfis_permissao p ON p.id = c.perfil_permissao_id AND p.ativo
     WHERE c.email = meu_email AND c.estado = 'pendente' AND c.expira_em > now()
       AND NOT EXISTS (SELECT 1 FROM public.membros_empresa m
                        WHERE m.empresa_id = c.empresa_id AND m.auth_user_id = usuario AND m.estado = 'ativo')
     ORDER BY c.criado_em;
END $$;

-- ---------------------------------------------------------------------------
-- 6. RPCs de perfis de acesso
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_private.validar_nome_perfil(p_empresa_id uuid, p_nome text, p_descricao text, p_ignorar uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF p_nome IS NULL OR char_length(btrim(p_nome)) NOT BETWEEN 2 AND 60 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Dê um nome ao perfil (2 a 60 caracteres).', 'nome');
  END IF;
  IF char_length(p_descricao) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A descrição pode ter até 300 caracteres.', 'descricao');
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfis_permissao
              WHERE empresa_id = p_empresa_id AND ativo AND lower(nome) = lower(btrim(p_nome))
                AND id IS DISTINCT FROM p_ignorar) THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Já existe um perfil com esse nome nesta empresa.', 'nome');
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.validar_nome_perfil(uuid, text, text, uuid) FROM PUBLIC;

CREATE FUNCTION public.criar_perfil_permissao(p_empresa_id uuid, p_nome text, p_descricao text, p_permissoes text[], p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_nome, p_descricao, array_to_string(p_permissoes, ',')));
  anterior jsonb;
  perms text[];
  novo public.perfis_permissao;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'criar_perfil_permissao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['equipe.alterar']);
  perms := app_private.validar_permissoes(p_permissoes);
  PERFORM app_private.verificar_delegacao(p_empresa_id, usuario, perms);
  PERFORM app_private.validar_nome_perfil(p_empresa_id, p_nome, nullif(btrim(coalesce(p_descricao, '')), ''), NULL);
  INSERT INTO public.perfis_permissao (empresa_id, nome, descricao, criado_por)
  VALUES (p_empresa_id, btrim(p_nome), nullif(btrim(coalesce(p_descricao, '')), ''), usuario)
  RETURNING * INTO novo;
  INSERT INTO public.perfil_permissoes (perfil_id, codigo) SELECT novo.id, unnest(perms);
  PERFORM app_private.registrar_evento_equipe(p_empresa_id, 'perfil_criado', usuario, NULL, NULL, NULL, novo.id,
    jsonb_build_object('nome', novo.nome, 'permissoes', to_jsonb(perms)), p_operation_key);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'equipe.perfil_criado', 'perfis_permissao', novo.id,
    jsonb_build_object('permissoes', to_jsonb(perms)));
  RETURN app_private.idem_fim(usuario, 'criar_perfil_permissao', p_operation_key, assinatura, app_private.perfil_json(novo.id));
END $$;

CREATE FUNCTION public.alterar_perfil_permissao(p_perfil_id uuid, p_nome text, p_descricao text, p_permissoes text[],
  p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_perfil_id, p_nome, p_descricao, array_to_string(p_permissoes, ','), p_expected_version));
  anterior jsonb;
  p public.perfis_permissao;
  perms text[];
  antigas text[];
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_perfil_permissao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO p FROM public.perfis_permissao WHERE id = p_perfil_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Perfil de acesso não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['equipe.alterar']);
  IF NOT p.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este perfil está desativado.');
  END IF;
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este perfil foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  IF NOT app_private.eh_proprietario_de(p.empresa_id, usuario) AND EXISTS (
       SELECT 1 FROM public.membros_empresa WHERE empresa_id = p.empresa_id AND auth_user_id = usuario
          AND estado = 'ativo' AND perfil_permissao_id = p.id) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Você não pode alterar o perfil que você mesmo usa. Peça a outra pessoa que administre a equipe.');
  END IF;
  perms := app_private.validar_permissoes(p_permissoes);
  antigas := app_private.permissoes_do_perfil(p.id);
  PERFORM app_private.verificar_delegacao(p.empresa_id, usuario, perms || antigas);
  PERFORM app_private.validar_nome_perfil(p.empresa_id, p_nome, nullif(btrim(coalesce(p_descricao, '')), ''), p.id);
  UPDATE public.perfis_permissao SET nome = btrim(p_nome), descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
    versao = versao + 1, atualizado_em = now()
  WHERE id = p.id;
  DELETE FROM public.perfil_permissoes WHERE perfil_id = p.id;
  INSERT INTO public.perfil_permissoes (perfil_id, codigo) SELECT p.id, unnest(perms);
  PERFORM app_private.registrar_evento_equipe(p.empresa_id, 'perfil_alterado', usuario, NULL, NULL, NULL, p.id,
    jsonb_build_object('nome_antes', p.nome, 'nome_depois', btrim(p_nome),
      'incluidas', to_jsonb(ARRAY(SELECT unnest(perms) EXCEPT SELECT unnest(antigas) ORDER BY 1)),
      'retiradas', to_jsonb(ARRAY(SELECT unnest(antigas) EXCEPT SELECT unnest(perms) ORDER BY 1))), p_operation_key);
  PERFORM app_private.auditar(p.empresa_id, usuario, 'equipe.perfil_alterado', 'perfis_permissao', p.id,
    jsonb_build_object('antes', to_jsonb(antigas), 'depois', to_jsonb(perms)));
  RETURN app_private.idem_fim(usuario, 'alterar_perfil_permissao', p_operation_key, assinatura, app_private.perfil_json(p.id));
END $$;

CREATE FUNCTION public.desativar_perfil_permissao(p_perfil_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_perfil_id, p_expected_version));
  anterior jsonb;
  p public.perfis_permissao;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'desativar_perfil_permissao', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO p FROM public.perfis_permissao WHERE id = p_perfil_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Perfil de acesso não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(p.empresa_id, usuario, ARRAY['equipe.alterar']);
  IF NOT p.ativo THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este perfil já está desativado.');
  END IF;
  IF p.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Este perfil foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  PERFORM app_private.verificar_delegacao(p.empresa_id, usuario, app_private.permissoes_do_perfil(p.id));
  IF EXISTS (SELECT 1 FROM public.membros_empresa WHERE perfil_permissao_id = p.id AND estado = 'ativo')
     OR EXISTS (SELECT 1 FROM public.convites_empresa WHERE perfil_permissao_id = p.id AND estado = 'pendente' AND expira_em > now()) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Há pessoas ou convites usando este perfil. Troque o perfil delas antes de desativá-lo.');
  END IF;
  UPDATE public.perfis_permissao SET ativo = false, versao = versao + 1, atualizado_em = now() WHERE id = p.id;
  PERFORM app_private.registrar_evento_equipe(p.empresa_id, 'perfil_desativado', usuario, NULL, NULL, NULL, p.id,
    jsonb_build_object('nome', p.nome), p_operation_key);
  PERFORM app_private.auditar(p.empresa_id, usuario, 'equipe.perfil_desativado', 'perfis_permissao', p.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'desativar_perfil_permissao', p_operation_key, assinatura, app_private.perfil_json(p.id));
END $$;

-- ---------------------------------------------------------------------------
-- 7. RPCs de convites e vínculos
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.convidar_funcionario(p_empresa_id uuid, p_email text, p_perfil_id uuid, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  email_limpo text := lower(btrim(coalesce(p_email, '')));
  assinatura text := md5(concat_ws('|', p_empresa_id, email_limpo, p_perfil_id));
  anterior jsonb;
  perfil public.perfis_permissao;
  convite public.convites_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'convidar_funcionario', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['equipe.convidar']);
  IF email_limpo !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(email_limpo) > 254 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um e-mail válido.', 'email');
  END IF;
  SELECT * INTO perfil FROM public.perfis_permissao WHERE id = p_perfil_id AND empresa_id = p_empresa_id AND ativo;
  IF NOT FOUND THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um perfil de acesso ativo desta empresa.', 'perfil_id');
  END IF;
  PERFORM app_private.verificar_delegacao(p_empresa_id, usuario, app_private.permissoes_do_perfil(perfil.id));
  IF EXISTS (SELECT 1 FROM public.membros_empresa m
              WHERE m.empresa_id = p_empresa_id AND m.estado = 'ativo'
                AND app_private.email_da_pessoa(m.auth_user_id) = email_limpo) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Essa pessoa já faz parte da equipe.');
  END IF;
  UPDATE public.convites_empresa SET estado = 'expirado'
   WHERE empresa_id = p_empresa_id AND email = email_limpo AND estado = 'pendente' AND expira_em <= now();
  IF EXISTS (SELECT 1 FROM public.convites_empresa WHERE empresa_id = p_empresa_id AND email = email_limpo AND estado = 'pendente') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Já existe um convite pendente para esse e-mail.');
  END IF;
  INSERT INTO public.convites_empresa (empresa_id, email, perfil_permissao_id, criado_por)
  VALUES (p_empresa_id, email_limpo, perfil.id, usuario) RETURNING * INTO convite;
  PERFORM app_private.registrar_evento_equipe(p_empresa_id, 'convite_criado', usuario, NULL, NULL, convite.id, perfil.id,
    jsonb_build_object('email', email_limpo, 'perfil', perfil.nome), p_operation_key);
  PERFORM app_private.auditar(p_empresa_id, usuario, 'equipe.convite_criado', 'convites_empresa', convite.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'convidar_funcionario', p_operation_key, assinatura,
    jsonb_build_object('id', convite.id, 'email', convite.email, 'perfil_id', perfil.id, 'perfil_nome', perfil.nome,
      'estado', convite.estado, 'expira_em', convite.expira_em));
END $$;

CREATE FUNCTION public.cancelar_convite(p_convite_id uuid, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_convite_id::text);
  anterior jsonb;
  c public.convites_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'cancelar_convite', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.convites_empresa WHERE id = p_convite_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Convite não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['equipe.convidar']);
  IF c.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este convite não está mais pendente.');
  END IF;
  UPDATE public.convites_empresa SET estado = 'cancelado', decidido_por = usuario, decidido_em = now() WHERE id = c.id;
  PERFORM app_private.registrar_evento_equipe(c.empresa_id, 'convite_cancelado', usuario, NULL, NULL, c.id, c.perfil_permissao_id,
    jsonb_build_object('email', c.email), p_operation_key);
  PERFORM app_private.auditar(c.empresa_id, usuario, 'equipe.convite_cancelado', 'convites_empresa', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'cancelar_convite', p_operation_key, assinatura,
    jsonb_build_object('id', c.id, 'estado', 'cancelado'));
END $$;

CREATE FUNCTION public.aceitar_convite(p_convite_id uuid, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_convite_id::text);
  anterior jsonb;
  meu_email text;
  meu_nome text;
  c public.convites_empresa;
  m public.membros_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'aceitar_convite', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT lower(u.email), nullif(btrim(u.name), '') INTO meu_email, meu_nome
    FROM neon_auth."user" u WHERE u.id::text = usuario AND u."emailVerified";
  IF meu_email IS NULL THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Confirme seu e-mail para aceitar convites.');
  END IF;
  SELECT * INTO c FROM public.convites_empresa WHERE id = p_convite_id FOR UPDATE;
  IF NOT FOUND OR c.email <> meu_email THEN
    PERFORM app_private.erro('NOT_FOUND', 'Convite não encontrado para a sua conta.');
  END IF;
  IF c.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este convite não está mais disponível.');
  END IF;
  IF c.expira_em <= now() THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este convite expirou. Peça um novo convite a quem administra a empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfis_permissao WHERE id = c.perfil_permissao_id AND ativo) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O perfil deste convite foi desativado. Peça um novo convite.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = c.empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Você já faz parte desta empresa.');
  END IF;
  -- O perfil Business nasce no aceite do convite, se ainda não existir (BDD-001 §4).
  IF NOT EXISTS (SELECT 1 FROM public.perfis_identidade WHERE auth_user_id = usuario AND tipo_conta = 'business') THEN
    INSERT INTO public.perfis_identidade (auth_user_id, tipo_conta, nome)
    VALUES (usuario, 'business', CASE WHEN char_length(coalesce(meu_nome, '')) >= 2 THEN left(meu_nome, 120) ELSE 'Funcionário' END);
  END IF;
  INSERT INTO public.membros_empresa (empresa_id, auth_user_id, papel, perfil_permissao_id, convite_id)
  VALUES (c.empresa_id, usuario, 'funcionario', c.perfil_permissao_id, c.id) RETURNING * INTO m;
  UPDATE public.convites_empresa SET estado = 'aceito', decidido_por = usuario, decidido_em = now(), membro_id = m.id WHERE id = c.id;
  PERFORM app_private.registrar_evento_equipe(c.empresa_id, 'convite_aceito', usuario, usuario, m.id, c.id, c.perfil_permissao_id,
    '{}'::jsonb, p_operation_key);
  PERFORM app_private.auditar(c.empresa_id, usuario, 'equipe.membro_entrou', 'membros_empresa', m.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'aceitar_convite', p_operation_key, assinatura,
    jsonb_build_object('membro_id', m.id, 'empresa_id', c.empresa_id,
      'empresa_nome', (SELECT nome_publico FROM public.empresas WHERE id = c.empresa_id),
      'perfil_nome', (SELECT nome FROM public.perfis_permissao WHERE id = c.perfil_permissao_id)));
END $$;

CREATE FUNCTION public.recusar_convite(p_convite_id uuid, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_convite_id::text);
  anterior jsonb;
  meu_email text;
  c public.convites_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'recusar_convite', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT lower(u.email) INTO meu_email FROM neon_auth."user" u WHERE u.id::text = usuario AND u."emailVerified";
  SELECT * INTO c FROM public.convites_empresa WHERE id = p_convite_id FOR UPDATE;
  IF meu_email IS NULL OR NOT FOUND OR c.email <> meu_email THEN
    PERFORM app_private.erro('NOT_FOUND', 'Convite não encontrado para a sua conta.');
  END IF;
  IF c.estado <> 'pendente' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este convite não está mais disponível.');
  END IF;
  UPDATE public.convites_empresa SET estado = 'recusado', decidido_por = usuario, decidido_em = now() WHERE id = c.id;
  PERFORM app_private.registrar_evento_equipe(c.empresa_id, 'convite_recusado', usuario, usuario, NULL, c.id, c.perfil_permissao_id,
    '{}'::jsonb, p_operation_key);
  RETURN app_private.idem_fim(usuario, 'recusar_convite', p_operation_key, assinatura, jsonb_build_object('id', c.id, 'estado', 'recusado'));
END $$;

CREATE FUNCTION public.alterar_perfil_do_membro(p_membro_id uuid, p_perfil_id uuid, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_membro_id, p_perfil_id, p_expected_version));
  anterior jsonb;
  m public.membros_empresa;
  novo public.perfis_permissao;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_perfil_do_membro', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.membros_empresa WHERE id = p_membro_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Vínculo não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(m.empresa_id, usuario, ARRAY['equipe.alterar']);
  IF m.estado <> 'ativo' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este vínculo já foi encerrado.');
  END IF;
  IF m.papel = 'proprietario' THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'O acesso do proprietário não pode ser alterado.');
  END IF;
  IF m.auth_user_id = usuario THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Você não pode alterar o seu próprio acesso. Peça a outra pessoa que administre a equipe.');
  END IF;
  IF m.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'O acesso desta pessoa foi alterado por outra pessoa. Atualize antes de continuar.');
  END IF;
  SELECT * INTO novo FROM public.perfis_permissao WHERE id = p_perfil_id AND empresa_id = m.empresa_id AND ativo;
  IF NOT FOUND THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha um perfil de acesso ativo desta empresa.', 'perfil_id');
  END IF;
  PERFORM app_private.verificar_delegacao(m.empresa_id, usuario,
    app_private.permissoes_do_perfil(novo.id) || app_private.permissoes_do_perfil(m.perfil_permissao_id));
  UPDATE public.membros_empresa SET perfil_permissao_id = novo.id, versao = versao + 1 WHERE id = m.id;
  PERFORM app_private.registrar_evento_equipe(m.empresa_id, 'membro_perfil_alterado', usuario, m.auth_user_id, m.id, NULL, novo.id,
    jsonb_build_object('perfil_antes', (SELECT nome FROM public.perfis_permissao WHERE id = m.perfil_permissao_id), 'perfil_depois', novo.nome),
    p_operation_key);
  PERFORM app_private.auditar(m.empresa_id, usuario, 'equipe.membro_perfil_alterado', 'membros_empresa', m.id,
    jsonb_build_object('perfil_antes', m.perfil_permissao_id, 'perfil_depois', novo.id));
  RETURN app_private.idem_fim(usuario, 'alterar_perfil_do_membro', p_operation_key, assinatura,
    jsonb_build_object('membro_id', m.id, 'perfil_id', novo.id, 'perfil_nome', novo.nome, 'versao', m.versao + 1));
END $$;

CREATE FUNCTION public.desligar_membro(p_membro_id uuid, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_membro_id, p_motivo));
  anterior jsonb;
  m public.membros_empresa;
  observacao text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  anterior := app_private.idem_inicio(usuario, 'desligar_membro', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.membros_empresa WHERE id = p_membro_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Vínculo não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(m.empresa_id, usuario, ARRAY['equipe.revogar']);
  IF m.estado <> 'ativo' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Este vínculo já foi encerrado.');
  END IF;
  IF m.papel = 'proprietario' THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'O proprietário não pode ser desligado.');
  END IF;
  IF m.auth_user_id = usuario THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Para encerrar o seu próprio vínculo, use "Sair da empresa".');
  END IF;
  IF char_length(observacao) > 300 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O motivo pode ter até 300 caracteres.', 'motivo');
  END IF;
  PERFORM app_private.verificar_delegacao(m.empresa_id, usuario, app_private.permissoes_do_perfil(m.perfil_permissao_id));
  UPDATE public.membros_empresa SET estado = 'encerrado', encerrado_em = now(), encerrado_por = usuario,
    motivo_encerramento = 'desligado', observacao_encerramento = observacao, versao = versao + 1
  WHERE id = m.id;
  PERFORM app_private.registrar_evento_equipe(m.empresa_id, 'membro_desligado', usuario, m.auth_user_id, m.id, NULL, m.perfil_permissao_id,
    jsonb_build_object('motivo', observacao), p_operation_key);
  PERFORM app_private.auditar(m.empresa_id, usuario, 'equipe.membro_desligado', 'membros_empresa', m.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'desligar_membro', p_operation_key, assinatura,
    jsonb_build_object('membro_id', m.id, 'estado', 'encerrado'));
END $$;

CREATE FUNCTION public.sair_da_empresa(p_empresa_id uuid, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(p_empresa_id::text);
  anterior jsonb;
  m public.membros_empresa;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'sair_da_empresa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO m FROM public.membros_empresa
   WHERE empresa_id = p_empresa_id AND auth_user_id = usuario AND estado = 'ativo' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF m.papel = 'proprietario' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'O proprietário não pode sair da empresa. A transferência de propriedade ainda não está disponível.');
  END IF;
  UPDATE public.membros_empresa SET estado = 'encerrado', encerrado_em = now(), encerrado_por = usuario,
    motivo_encerramento = 'saiu', versao = versao + 1
  WHERE id = m.id;
  PERFORM app_private.registrar_evento_equipe(m.empresa_id, 'membro_saiu', usuario, usuario, m.id, NULL, m.perfil_permissao_id,
    '{}'::jsonb, p_operation_key);
  PERFORM app_private.auditar(m.empresa_id, usuario, 'equipe.membro_saiu', 'membros_empresa', m.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'sair_da_empresa', p_operation_key, assinatura,
    jsonb_build_object('membro_id', m.id, 'estado', 'encerrado'));
END $$;

-- ---------------------------------------------------------------------------
-- 8. RLS e GRANT (nenhuma escrita direta; anônimo sem acesso)
-- ---------------------------------------------------------------------------

ALTER TABLE public.permissoes_catalogo ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalogo_ler ON public.permissoes_catalogo FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.permissoes_catalogo TO authenticated;

ALTER TABLE public.perfis_permissao ENABLE ROW LEVEL SECURITY;
CREATE POLICY perfis_permissao_ler ON public.perfis_permissao FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'equipe.visualizar')));
GRANT SELECT (id, empresa_id, nome, descricao, ativo, versao, criado_em, atualizado_em) ON public.perfis_permissao TO authenticated;

ALTER TABLE public.perfil_permissoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY perfil_permissoes_ler ON public.perfil_permissoes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.perfis_permissao p WHERE p.id = perfil_id));
GRANT SELECT ON public.perfil_permissoes TO authenticated;

ALTER TABLE public.convites_empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY convites_ler ON public.convites_empresa FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'equipe.visualizar')));
GRANT SELECT (id, empresa_id, email, perfil_permissao_id, estado, criado_em, expira_em, decidido_em) ON public.convites_empresa TO authenticated;

ALTER TABLE public.eventos_equipe ENABLE ROW LEVEL SECURITY;
CREATE POLICY eventos_equipe_ler ON public.eventos_equipe FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'equipe.visualizar')));
GRANT SELECT (id, empresa_id, tipo, membro_id, convite_id, perfil_id, detalhes, criado_em) ON public.eventos_equipe TO authenticated;

-- Vínculos: a própria linha ou, com equipe.visualizar, os da empresa.
DROP POLICY membros_ler_proprios ON public.membros_empresa;
CREATE POLICY membros_ler ON public.membros_empresa FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT authz.usuario_atual()) OR (SELECT authz.tem_permissao(empresa_id, 'equipe.visualizar')));

-- Empresas: qualquer membro ativo lê os dados não privados; os privados só pela RPC com empresa.visualizar.
ALTER POLICY empresas_ler_proprietario ON public.empresas USING ((SELECT authz.eh_membro_ativo(id)));
ALTER POLICY empresas_ler_proprietario ON public.empresas RENAME TO empresas_ler_membros;
REVOKE SELECT ON public.empresas FROM authenticated;
GRANT SELECT (id, nome_publico, modalidade, categoria_id, cidade, uf, bairro, area_atendimento, telefone_publico,
  whatsapp_publico, email_publico, descricao_publica, horario_funcionamento, situacao_erp, situacao_vitrine,
  suspensao_gravidade, suspensao_fundamento, dados_publicados, versao, criada_por, criado_em, atualizado_em,
  dado_de_teste) ON public.empresas TO authenticated;

-- Vitrine (M03): leitura passa de "proprietário" para "vitrine.visualizar".
ALTER POLICY solicitacoes_ler ON public.solicitacoes_publicacao
  USING ((SELECT authz.tem_permissao(empresa_id, 'vitrine.visualizar')) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY eventos_ler ON public.eventos_publicacao
  USING ((SELECT authz.tem_permissao(empresa_id, 'vitrine.visualizar')) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY contestacoes_ler ON public.contestacoes
  USING ((SELECT authz.tem_permissao(empresa_id, 'vitrine.visualizar')) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY moderacoes_ler ON public.moderacoes_vitrine
  USING ((SELECT authz.tem_permissao(empresa_id, 'vitrine.visualizar')) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY cards_ler ON public.public_empresa_cards
  USING ((SELECT authz.tem_permissao(empresa_id, 'vitrine.visualizar')) OR (SELECT authz.eh_ck_admin()));

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'public.ck_listar_empresas()',
    'public.minhas_empresas()',
    'public.minhas_permissoes(uuid)',
    'public.empresa_dados_privados(uuid)',
    'public.equipe_membros(uuid)',
    'public.equipe_historico(uuid)',
    'public.meus_convites()',
    'public.criar_perfil_permissao(uuid, text, text, text[], text)',
    'public.alterar_perfil_permissao(uuid, text, text, text[], integer, text)',
    'public.desativar_perfil_permissao(uuid, integer, text)',
    'public.convidar_funcionario(uuid, text, uuid, text)',
    'public.cancelar_convite(uuid, text)',
    'public.aceitar_convite(uuid, text)',
    'public.recusar_convite(uuid, text)',
    'public.alterar_perfil_do_membro(uuid, uuid, integer, text)',
    'public.desligar_membro(uuid, text, text)',
    'public.sair_da_empresa(uuid, text)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611010006', 'Funcionários, vínculos empresariais e permissões (M04)');

COMMIT;
