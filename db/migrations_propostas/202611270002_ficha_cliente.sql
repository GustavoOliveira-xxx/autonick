-- 202611270002_ficha_cliente: E05 (evolução integrada). Ficha do cliente da empresa numa leitura.
-- Resumo (vendas confirmadas, total, última compra), vendas, pedidos, orçamentos e ordens de serviço do cliente.
-- Exige ver clientes; cada seção só vem com a permissão da área (sem permissão, a seção não aparece no retorno).
BEGIN;

CREATE FUNCTION public.ficha_cliente(p_cliente_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  c public.clientes_empresa;
  perms text[];
  r jsonb;
BEGIN
  SELECT * INTO c FROM public.clientes_empresa WHERE id = p_cliente_id;
  IF NOT FOUND OR NOT app_private.eh_membro(c.empresa_id, usuario) THEN
    PERFORM app_private.erro('NOT_FOUND', 'Cliente não encontrado.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['clientes.visualizar']);
  perms := app_private.permissoes_de(c.empresa_id, usuario);
  r := jsonb_build_object('cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
    'observacoes', c.observacoes, 'ativo', c.ativo, 'conta_vinculada', c.perfil_cliente_id IS NOT NULL, 'desde', c.criado_em, 'versao', c.versao));
  IF 'vendas.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object(
      'resumo', (SELECT jsonb_build_object('vendas', count(*), 'total_centavos', coalesce(sum(app_private.para_centavos(v.total)), 0),
          'ultima_compra', max(v.confirmada_em))
        FROM public.vendas v WHERE v.cliente_empresa_id = c.id AND v.estado = 'confirmada'),
      'vendas', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado,
          'total_centavos', app_private.para_centavos(v.total), 'data', coalesce(v.confirmada_em, v.criado_em)) x
        FROM public.vendas v WHERE v.cliente_empresa_id = c.id AND v.estado <> 'rascunho' ORDER BY coalesce(v.confirmada_em, v.criado_em) DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  IF 'pedidos.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('pedidos', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', p.id, 'estado', p.estado,
        'total_centavos', app_private.para_centavos(p.total_estimado), 'data', p.criado_em) x
      FROM public.pedidos p WHERE p.cliente_empresa_id = c.id ORDER BY p.criado_em DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  IF perms && ARRAY['orcamentos.visualizar', 'servicos.visualizar'] THEN
    r := r || jsonb_build_object('solicitacoes', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', s.id, 'numero', s.numero,
        'servico', s.servico_nome, 'estado', s.estado, 'data', s.criado_em) x
      FROM public.solicitacoes_servico s WHERE s.empresa_id = c.empresa_id AND s.cliente_id = c.id ORDER BY s.criado_em DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  IF 'servicos.visualizar' = ANY (perms) THEN
    r := r || jsonb_build_object('ordens', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', o.id, 'numero', o.numero,
        'servico', o.servico_nome, 'estado', o.estado, 'data', o.criado_em) x
      FROM public.ordens_servico o WHERE o.empresa_id = c.empresa_id AND o.cliente_id = c.id ORDER BY o.criado_em DESC LIMIT 30) s), '[]'::jsonb));
  END IF;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.ficha_cliente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ficha_cliente(uuid) TO authenticated;

INSERT INTO app_private.historico_migracoes (id, descricao)
VALUES ('202611270002', 'E05: ficha do cliente (resumo, vendas, pedidos, orçamentos e OS), cada seção só com a permissão da área');

COMMIT;
