-- Rollback da 202611010006 (M04). Usar SOMENTE em ambiente sem dados reais.
-- Remove funcionários, perfis, convites e histórico da equipe; mantém proprietários.
-- Recria as funções do M03 com o texto exato da 202611010003.
BEGIN;
DROP FUNCTION IF EXISTS public.sair_da_empresa(uuid, text);
DROP FUNCTION IF EXISTS public.desligar_membro(uuid, text, text);
DROP FUNCTION IF EXISTS public.alterar_perfil_do_membro(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS public.recusar_convite(uuid, text);
DROP FUNCTION IF EXISTS public.aceitar_convite(uuid, text);
DROP FUNCTION IF EXISTS public.cancelar_convite(uuid, text);
DROP FUNCTION IF EXISTS public.convidar_funcionario(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.desativar_perfil_permissao(uuid, integer, text);
DROP FUNCTION IF EXISTS public.alterar_perfil_permissao(uuid, text, text, text[], integer, text);
DROP FUNCTION IF EXISTS public.criar_perfil_permissao(uuid, text, text, text[], text);
DROP FUNCTION IF EXISTS app_private.validar_nome_perfil(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.meus_convites();
DROP FUNCTION IF EXISTS public.equipe_historico(uuid);
DROP FUNCTION IF EXISTS public.equipe_membros(uuid);
DROP FUNCTION IF EXISTS public.empresa_dados_privados(uuid);
DROP FUNCTION IF EXISTS public.minhas_permissoes(uuid);
DROP FUNCTION IF EXISTS public.minhas_empresas();
DROP FUNCTION IF EXISTS public.ck_listar_empresas();

-- Políticas e permissões do M03
ALTER POLICY solicitacoes_ler ON public.solicitacoes_publicacao
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY eventos_ler ON public.eventos_publicacao
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY contestacoes_ler ON public.contestacoes
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY moderacoes_ler ON public.moderacoes_vitrine
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY cards_ler ON public.public_empresa_cards
  USING ((SELECT authz.eh_proprietario(empresa_id)) OR (SELECT authz.eh_ck_admin()));
ALTER POLICY empresas_ler_membros ON public.empresas RENAME TO empresas_ler_proprietario;
ALTER POLICY empresas_ler_proprietario ON public.empresas USING ((SELECT authz.eh_proprietario(id)));
REVOKE SELECT ON public.empresas FROM authenticated;
GRANT SELECT ON public.empresas TO authenticated;
DROP POLICY membros_ler ON public.membros_empresa;
CREATE POLICY membros_ler_proprios ON public.membros_empresa FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT authz.usuario_atual()));

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

CREATE OR REPLACE FUNCTION app_private.empresa_json(e public.empresas) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT to_jsonb(e) - 'criada_por'
    || jsonb_build_object(
         'relevantes_pendentes', app_private.relevantes_pendentes(e),
         'solicitacao_aberta', (SELECT to_jsonb(s) - 'decidida_por' - 'enviada_por'
                                  FROM public.solicitacoes_publicacao s
                                 WHERE s.empresa_id = e.id AND s.estado = 'aberta'))
$$;

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
REVOKE ALL ON FUNCTION app_private.empresa_do_proprietario(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ck_listar_empresas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_listar_empresas() TO authenticated;

DROP TABLE IF EXISTS public.eventos_equipe;
ALTER TABLE public.membros_empresa DROP CONSTRAINT IF EXISTS membros_empresa_perfil_coerente;
ALTER TABLE public.membros_empresa DROP CONSTRAINT IF EXISTS membros_empresa_encerramento_coerente;
DROP TABLE IF EXISTS public.convites_empresa;
DELETE FROM public.membros_empresa WHERE papel = 'funcionario' OR estado <> 'ativo';
ALTER TABLE public.membros_empresa
  DROP COLUMN perfil_permissao_id, DROP COLUMN versao, DROP COLUMN convite_id, DROP COLUMN encerrado_em,
  DROP COLUMN encerrado_por, DROP COLUMN motivo_encerramento, DROP COLUMN observacao_encerramento;
DROP INDEX IF EXISTS public.membros_empresa_um_ativo;
ALTER TABLE public.membros_empresa DROP CONSTRAINT membros_empresa_pkey;
ALTER TABLE public.membros_empresa DROP COLUMN id;
ALTER TABLE public.membros_empresa ADD PRIMARY KEY (empresa_id, auth_user_id);
ALTER TABLE public.membros_empresa DROP CONSTRAINT membros_empresa_papel_check;
ALTER TABLE public.membros_empresa ADD CONSTRAINT membros_empresa_papel_check CHECK (papel IN ('proprietario'));
ALTER TABLE public.membros_empresa DROP CONSTRAINT membros_empresa_estado_check;
ALTER TABLE public.membros_empresa ADD CONSTRAINT membros_empresa_estado_check CHECK (estado IN ('ativo', 'inativo'));
DROP TABLE IF EXISTS public.perfil_permissoes;
DROP TABLE IF EXISTS public.perfis_permissao;
DROP TABLE IF EXISTS public.permissoes_catalogo;

DROP FUNCTION IF EXISTS app_private.empresa_autorizada(uuid, text, text[]);
DROP FUNCTION IF EXISTS app_private.registrar_evento_equipe(uuid, text, text, text, uuid, uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS app_private.perfil_json(uuid);
DROP FUNCTION IF EXISTS app_private.nome_da_pessoa(text);
DROP FUNCTION IF EXISTS app_private.email_da_pessoa(text);
DROP FUNCTION IF EXISTS app_private.validar_permissoes(text[]);
DROP FUNCTION IF EXISTS app_private.verificar_delegacao(uuid, text, text[]);
DROP FUNCTION IF EXISTS app_private.exigir_permissoes(uuid, text, text[]);
DROP FUNCTION IF EXISTS authz.tem_permissao(uuid, text);
DROP FUNCTION IF EXISTS authz.eh_membro_ativo(uuid);
DROP FUNCTION IF EXISTS app_private.permissoes_de(uuid, text);
DROP FUNCTION IF EXISTS app_private.permissoes_do_perfil(uuid);
DROP FUNCTION IF EXISTS app_private.eh_proprietario_de(uuid, text);
DELETE FROM app_private.historico_migracoes WHERE id = '202611010006';
COMMIT;
