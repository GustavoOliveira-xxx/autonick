-- 202611270003_atividades: E05 (evolução integrada). Central de atividades da empresa.
-- Lê o registro de auditoria (que já existia e não muda): quem fez o quê e quando. Cada tipo de evento só aparece para quem
-- pode ver a área correspondente; eventos da moderação da CK e da plataforma não aparecem. Paginação por data (antes de).
BEGIN;

CREATE FUNCTION app_private.permissao_da_atividade(p_tipo text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE split_part(p_tipo, '.', 1)
    WHEN 'venda' THEN ARRAY['vendas.visualizar']
    WHEN 'pedido' THEN ARRAY['pedidos.visualizar']
    WHEN 'orcamentos' THEN ARRAY['orcamentos.visualizar']
    WHEN 'servicos' THEN ARRAY['servicos.visualizar', 'catalogo_servicos.visualizar']
    WHEN 'financeiro' THEN ARRAY['financeiro.visualizar']
    WHEN 'estoque' THEN ARRAY['estoque.visualizar']
    WHEN 'produto' THEN ARRAY['produtos.visualizar', 'estoque.visualizar']
    WHEN 'agenda' THEN ARRAY['agenda.visualizar']
    WHEN 'arquivo' THEN ARRAY['empresa.visualizar']
    WHEN 'empresa' THEN ARRAY['empresa.visualizar']
    WHEN 'perfil' THEN ARRAY['equipe.visualizar']
    WHEN 'equipe' THEN ARRAY['equipe.visualizar']
    WHEN 'clientes' THEN ARRAY['clientes.visualizar']
    WHEN 'cliente' THEN ARRAY['clientes.visualizar']
    ELSE NULL END
$$;

CREATE FUNCTION public.atividades_da_empresa(p_empresa_id uuid, p_antes timestamptz DEFAULT NULL, p_limite integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  perms text[];
  itens jsonb;
BEGIN
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 100 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Peça de 1 a 100 atividades.', 'limite');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'criado_em')::timestamptz DESC), '[]'::jsonb) INTO itens FROM (
    SELECT jsonb_build_object('id', e.id, 'tipo', e.tipo_acao, 'recurso_tipo', e.recurso_tipo, 'recurso_id', e.recurso_id,
      'ator', coalesce(app_private.nome_da_pessoa(e.ator_auth_id), 'Pessoa removida'), 'voce', e.ator_auth_id = usuario,
      'dados', e.dados_minimizados, 'criado_em', e.criado_em) x
      FROM app_private.eventos_auditoria e
     WHERE e.empresa_id = p_empresa_id
       AND (p_antes IS NULL OR e.criado_em < p_antes)
       AND app_private.permissao_da_atividade(e.tipo_acao) && perms
     ORDER BY e.criado_em DESC
     LIMIT p_limite) s;
  RETURN jsonb_build_object('itens', itens, 'mais', jsonb_array_length(itens) = p_limite);
END $$;

CREATE INDEX IF NOT EXISTS eventos_auditoria_empresa_data ON app_private.eventos_auditoria (empresa_id, criado_em DESC);

REVOKE ALL ON FUNCTION app_private.permissao_da_atividade(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atividades_da_empresa(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atividades_da_empresa(uuid, timestamptz, integer) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611270003', 'E05: central de atividades da empresa (registro de auditoria filtrado pela permissão de cada área)');

COMMIT;
