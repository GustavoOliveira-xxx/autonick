-- 202611300001_ck_central: E09 (evolução integrada). Central administrativa da CK.
-- 1) ck_limites passa a devolver categoria, nome, unidade, valor padrão e versão (colunas criadas em 202611250001),
--    para a central de parâmetros agrupar e oferecer "restaurar o padrão" (a mudança continua por ck_definir_limite, com motivo).
-- 2) ck_saude: banco (versão, tamanho), migrations aplicadas, armazenamento de arquivos (metadados) e filas pendentes.
-- 3) ck_auditoria: ações administrativas da CK e da moderação (registro de auditoria que já existia), com paginação.
-- Tudo só para a administração CK. Nada é alterado nos dados.
BEGIN;

CREATE OR REPLACE FUNCTION public.ck_limites() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê os limites da plataforma.');
  END IF;
  RETURN (SELECT jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor, 'minimo', minimo, 'maximo', maximo, 'descricao', descricao,
    'atualizado_em', atualizado_em, 'categoria', categoria, 'nome', coalesce(nome, chave), 'unidade', unidade, 'valor_padrao', valor_padrao,
    'versao', versao) ORDER BY categoria, coalesce(nome, chave)) FROM app_private.limites_plataforma);
END $$;

CREATE FUNCTION public.ck_saude() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê a saúde da plataforma.');
  END IF;
  RETURN jsonb_build_object(
    'verificado_em', now(),
    'banco', jsonb_build_object('versao', current_setting('server_version'), 'tamanho_bytes', pg_database_size(current_database()),
      'fuso', current_setting('TimeZone')),
    'migracoes', jsonb_build_object('total', (SELECT count(*) FROM app_private.historico_migracoes),
      'ultimas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'descricao', h.descricao)), '[]'::jsonb)
                    FROM (SELECT id, descricao FROM app_private.historico_migracoes ORDER BY id DESC LIMIT 5) h)),
    'arquivos', (SELECT jsonb_build_object('ativos', count(*) FILTER (WHERE estado = 'ativo'),
      'bytes_ativos', coalesce(sum(tamanho_bytes) FILTER (WHERE estado = 'ativo'), 0),
      'removidos_em_retencao', count(*) FILTER (WHERE estado = 'removido' AND removido_em > now() - interval '30 days')) FROM public.arquivos),
    'contagens', jsonb_build_object(
      'empresas', (SELECT count(*) FROM public.empresas WHERE NOT coalesce(dado_de_teste, false)),
      'empresas_de_teste', (SELECT count(*) FROM public.empresas WHERE coalesce(dado_de_teste, false)),
      'vitrines_publicadas', (SELECT count(*) FROM public.empresas WHERE situacao_vitrine = 'publicada')),
    'filas', jsonb_build_object(
      'publicacao', (SELECT count(*) FROM public.solicitacoes_publicacao WHERE estado = 'aberta'),
      'contestacoes', (SELECT count(*) FROM public.contestacoes WHERE estado IN ('aberta', 'em_revisao')),
      'moderacoes', (SELECT count(*) FROM public.moderacoes_vitrine WHERE estado = 'pendente')));
END $$;

CREATE FUNCTION public.ck_auditoria(p_antes timestamptz DEFAULT NULL, p_limite integer DEFAULT 40) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  itens jsonb;
BEGIN
  PERFORM app_private.exigir_usuario();
  IF NOT (SELECT authz.eh_ck_admin()) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Só a administração CK vê a auditoria administrativa.');
  END IF;
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 100 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Peça de 1 a 100 registros.', 'limite');
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'criado_em')::timestamptz DESC), '[]'::jsonb) INTO itens FROM (
    SELECT jsonb_build_object('id', e.id, 'tipo', e.tipo_acao, 'recurso_tipo', e.recurso_tipo, 'recurso_id', e.recurso_id,
      'empresa', (SELECT nome_publico FROM public.empresas WHERE id = e.empresa_id),
      'ator', coalesce(app_private.nome_da_pessoa(e.ator_auth_id), 'Sistema'), 'dados', e.dados_minimizados, 'criado_em', e.criado_em) x
      FROM app_private.eventos_auditoria e
     WHERE (e.tipo_acao LIKE 'ck.%' OR e.tipo_acao LIKE 'ck_admin.%' OR e.tipo_acao LIKE 'moderacao.%')
       AND (p_antes IS NULL OR e.criado_em < p_antes)
     ORDER BY e.criado_em DESC LIMIT p_limite) s;
  RETURN jsonb_build_object('itens', itens, 'mais', jsonb_array_length(itens) = p_limite);
END $$;

REVOKE ALL ON FUNCTION public.ck_saude(), public.ck_auditoria(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ck_saude(), public.ck_auditoria(timestamptz, integer) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611300001', 'E09: central de parâmetros (ck_limites com categoria, nome, unidade e padrão), saúde da plataforma e auditoria administrativa da CK');

COMMIT;
