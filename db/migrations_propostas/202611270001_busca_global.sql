-- 202611270001_busca_global: E05 (evolução integrada). Busca global da empresa (paleta Ctrl+K).
-- Uma leitura que procura em clientes, produtos, serviços oferecidos, ordens de serviço, solicitações, vendas e fornecedores.
-- Cada grupo só aparece para quem tem a permissão de ver aquela área; nada de outras empresas; texto de 2 a 80 caracteres (ou um número de um dígito);
-- até 6 resultados por grupo. Sem acento e sem diferença de maiúsculas. Número ("123" ou "nº 123") procura pelo número.
BEGIN;

CREATE FUNCTION app_private.sem_acento(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT lower(translate(coalesce(t, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

CREATE FUNCTION public.busca_global(p_empresa_id uuid, p_texto text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  perms text[];
  v_termo text := btrim(coalesce(p_texto, ''));
  v_padrao text;
  v_numero integer;
  r jsonb := '{}'::jsonb;
  pode_os boolean;
BEGIN
  IF NOT app_private.eh_membro(p_empresa_id, usuario) THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF char_length(v_termo) > 80 OR char_length(v_termo) < 2 AND v_termo !~ '^\d$' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Digite de 2 a 80 caracteres para buscar.', 'texto');
  END IF;
  perms := app_private.permissoes_de(p_empresa_id, usuario);
  v_padrao := '%' || replace(replace(replace(app_private.sem_acento(v_termo), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  IF v_termo ~ '^(n[ºo°.]?\s*)?#?\d{1,9}$' THEN v_numero := substring(v_termo FROM '\d+')::integer; END IF;

  IF 'clientes.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('clientes', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', c.id, 'titulo', c.nome, 'detalhe', concat_ws(' · ', c.telefone, c.email)) x
        FROM public.clientes_empresa c WHERE c.empresa_id = p_empresa_id AND c.ativo
         AND (app_private.sem_acento(c.nome) LIKE v_padrao OR c.telefone LIKE '%' || regexp_replace(v_termo, '\D', '', 'g') || '%' AND regexp_replace(v_termo, '\D', '', 'g') <> ''
              OR app_private.sem_acento(c.email) LIKE v_padrao)
       ORDER BY c.nome LIMIT 6) s), '[]'::jsonb));
  END IF;
  IF perms && ARRAY['produtos.visualizar', 'estoque.visualizar'] THEN
    r := r || jsonb_build_object('produtos', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', p.id, 'titulo', p.nome, 'detalhe', CASE WHEN p.ativo THEN NULL ELSE 'Desativado' END) x
        FROM public.produtos p WHERE p.empresa_id = p_empresa_id
         AND (app_private.sem_acento(p.nome) LIKE v_padrao OR EXISTS (SELECT 1 FROM public.produto_variacoes v WHERE v.produto_id = p.id AND lower(v.sku) LIKE v_padrao))
       ORDER BY p.ativo DESC, p.nome LIMIT 6) s), '[]'::jsonb));
  END IF;
  IF 'catalogo_servicos.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('servicos', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', s.id, 'titulo', s.nome, 'detalhe', CASE WHEN s.ativo THEN NULL ELSE 'Desativado' END) x
        FROM public.servicos s WHERE s.empresa_id = p_empresa_id AND app_private.sem_acento(s.nome) LIKE v_padrao
       ORDER BY s.ativo DESC, s.nome LIMIT 6) s), '[]'::jsonb));
  END IF;
  pode_os := 'servicos.visualizar' = ANY (perms);
  IF pode_os THEN
    r := r || jsonb_build_object('ordens', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', o.id, 'titulo', format('OS nº %s · %s', o.numero, o.servico_nome), 'detalhe', o.cliente_nome, 'estado', o.estado) x
        FROM public.ordens_servico o WHERE o.empresa_id = p_empresa_id
         AND (o.numero = v_numero OR app_private.sem_acento(o.cliente_nome) LIKE v_padrao OR app_private.sem_acento(o.servico_nome) LIKE v_padrao)
       ORDER BY (o.numero = v_numero) DESC NULLS LAST, o.criado_em DESC LIMIT 6) s), '[]'::jsonb));
  END IF;
  IF perms && ARRAY['orcamentos.visualizar', 'servicos.visualizar'] THEN
    r := r || jsonb_build_object('solicitacoes', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', s.id, 'titulo', format('Solicitação nº %s · %s', s.numero, s.servico_nome), 'detalhe', s.cliente_nome, 'estado', s.estado) x
        FROM public.solicitacoes_servico s WHERE s.empresa_id = p_empresa_id
         AND (s.numero = v_numero OR app_private.sem_acento(s.cliente_nome) LIKE v_padrao OR app_private.sem_acento(s.servico_nome) LIKE v_padrao)
       ORDER BY (s.numero = v_numero) DESC NULLS LAST, s.criado_em DESC LIMIT 6) s), '[]'::jsonb));
  END IF;
  IF 'vendas.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('vendas', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', v.id, 'titulo', format('Venda nº %s', v.numero), 'detalhe', v.cliente_nome, 'estado', v.estado) x
        FROM public.vendas v WHERE v.empresa_id = p_empresa_id
         AND (v.numero = v_numero OR app_private.sem_acento(v.cliente_nome) LIKE v_padrao)
       ORDER BY (v.numero = v_numero) DESC NULLS LAST, v.criado_em DESC LIMIT 6) s), '[]'::jsonb));
  END IF;
  IF 'fornecedores.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('fornecedores', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', f.id, 'titulo', f.nome, 'detalhe', CASE WHEN f.ativo THEN NULL ELSE 'Desativado' END) x
        FROM public.fornecedores f WHERE f.empresa_id = p_empresa_id AND app_private.sem_acento(f.nome) LIKE v_padrao
       ORDER BY f.ativo DESC, f.nome LIMIT 6) s), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('texto', v_termo, 'grupos', r);
END $$;

REVOKE ALL ON FUNCTION app_private.sem_acento(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.busca_global(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.busca_global(uuid, text) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611270001', 'E05: busca global da empresa (clientes, produtos, serviços, OS, solicitações, vendas, fornecedores), cada grupo só com a permissão da área');

COMMIT;
