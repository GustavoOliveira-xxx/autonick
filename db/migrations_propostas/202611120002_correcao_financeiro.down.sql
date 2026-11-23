-- Rollback da migration 202611120002 (correção do M07). Só no branch `desenvolvimento`.
-- Recusa se a categoria de insumos já tiver uso (títulos, lançamentos ou recorrências), para não perder classificação.
-- Os dados gravados nas conferências (quem conferiu e quando) ficam no histórico dos fechamentos.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.titulos_financeiros t JOIN public.categorias_financeiras c ON c.id = t.categoria_id WHERE c.codigo_sistema = 'insumos')
     OR EXISTS (SELECT 1 FROM public.lancamentos_financeiros l JOIN public.categorias_financeiras c ON c.id = l.categoria_id WHERE c.codigo_sistema = 'insumos')
     OR EXISTS (SELECT 1 FROM public.despesas_recorrentes r JOIN public.categorias_financeiras c ON c.id = r.categoria_id WHERE c.codigo_sistema = 'insumos') THEN
    RAISE EXCEPTION 'A categoria de insumos já está em uso: o rollback de 202611120002 apagaria a classificação.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_private.garantir_categorias(p_empresa uuid) RETURNS void
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'vendas') THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('categorias|' || p_empresa::text, 0));
  INSERT INTO public.categorias_financeiras (empresa_id, tipo, nome, codigo_sistema, ordem)
  SELECT p_empresa, c.tipo, c.nome, c.codigo, c.ordem FROM (VALUES
    ('receita', 'Vendas', 'vendas', 1), ('receita', 'Outras receitas', NULL, 90),
    ('despesa', 'Compras de mercadorias e insumos', 'compras', 1), ('despesa', 'Aluguel', NULL, 10),
    ('despesa', 'Energia, água e internet', NULL, 11), ('despesa', 'Salários e encargos', NULL, 12),
    ('despesa', 'Impostos e taxas', NULL, 13), ('despesa', 'Transporte', NULL, 14), ('despesa', 'Manutenção', NULL, 15),
    ('despesa', 'Divulgação', NULL, 16), ('despesa', 'Tarifas bancárias', NULL, 17), ('despesa', 'Outras despesas', NULL, 90)
  ) AS c (tipo, nome, codigo, ordem)
  WHERE NOT EXISTS (SELECT 1 FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'vendas');
END $$;
CREATE OR REPLACE FUNCTION public.alterar_categoria_financeira(p_categoria_id uuid, p_dados jsonb, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_categoria_id, p_dados::text, p_expected_version));
  anterior jsonb;
  c public.categorias_financeiras;
  v_nome text;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'alterar_categoria_financeira', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.categorias_financeiras WHERE id = p_categoria_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Categoria não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['nome']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta categoria mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF c.codigo_sistema IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Categorias do sistema (Vendas e Compras) não são renomeadas nem desativadas.');
  END IF;
  v_nome := app_private.ler_texto(p_dados->>'nome', 2, 60, 'nome', 'Dê um nome à categoria (2 a 60 caracteres).');
  IF c.ativa THEN
    PERFORM app_private.nome_categoria_livre(c.empresa_id, c.tipo, v_nome, c.id);
  END IF;
  UPDATE public.categorias_financeiras SET nome = v_nome, versao = versao + 1 WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.categoria_alterada', 'categorias_financeiras', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'alterar_categoria_financeira', p_operation_key, assinatura, app_private.categoria_json(c));
END $$;
CREATE OR REPLACE FUNCTION public.definir_categoria_ativa(p_categoria_id uuid, p_ativa boolean, p_expected_version integer, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_categoria_id, p_ativa, p_expected_version));
  anterior jsonb;
  c public.categorias_financeiras;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'definir_categoria_ativa', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.categorias_financeiras WHERE id = p_categoria_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Categoria não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  IF c.versao <> p_expected_version THEN
    PERFORM app_private.erro('VERSION_CONFLICT', 'Esta categoria mudou desde que você abriu a tela. Atualize e tente de novo.');
  END IF;
  IF c.codigo_sistema IS NOT NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Categorias do sistema (Vendas e Compras) não são renomeadas nem desativadas.');
  END IF;
  IF c.ativa = p_ativa THEN
    PERFORM app_private.erro('STATE_CONFLICT', CASE WHEN p_ativa THEN 'A categoria já está ativa.' ELSE 'A categoria já está desativada.' END);
  END IF;
  IF NOT p_ativa AND EXISTS (SELECT 1 FROM public.despesas_recorrentes WHERE categoria_id = c.id AND ativa) THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Uma despesa recorrente ativa usa esta categoria. Altere ou pause a recorrência antes.');
  END IF;
  IF p_ativa THEN
    PERFORM app_private.nome_categoria_livre(c.empresa_id, c.tipo, c.nome, c.id);
  END IF;
  UPDATE public.categorias_financeiras SET ativa = p_ativa, versao = versao + 1 WHERE id = c.id RETURNING * INTO c;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.categoria_' || CASE WHEN p_ativa THEN 'reativada' ELSE 'desativada' END,
    'categorias_financeiras', c.id, '{}'::jsonb);
  RETURN app_private.idem_fim(usuario, 'definir_categoria_ativa', p_operation_key, assinatura, app_private.categoria_json(c));
END $$;
CREATE OR REPLACE FUNCTION public.compras_para_conta_pagar(p_empresa_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.criar']);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'data_compra', c.data_compra, 'numero_documento', c.numero_documento,
      'fornecedor', f.nome, 'custo_total_centavos', app_private.para_centavos(c.custo_total), 'estado', c.estado) ORDER BY c.data_compra DESC)
    FROM public.compras_fornecedor c LEFT JOIN public.fornecedores f ON f.id = c.fornecedor_id
   WHERE c.empresa_id = p_empresa_id AND c.estado IN ('registrada', 'recebida') AND coalesce(c.custo_total, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.titulos_financeiros t WHERE t.origem_tipo = 'compra' AND t.origem_id = c.id AND t.estado <> 'cancelado')),
    '[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.gerar_titulo_compra(p_compra_id uuid, p_dados jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_compra_id, p_dados::text));
  anterior jsonb;
  c public.compras_fornecedor;
  v_cat uuid;
  v_comp date;
  v_total numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'gerar_titulo_compra', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO c FROM public.compras_fornecedor WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Compra não encontrada.');
  END IF;
  PERFORM app_private.exigir_permissoes(c.empresa_id, usuario, ARRAY['financeiro.criar']);
  PERFORM app_private.exigir_chaves(p_dados, ARRAY['categoria_id', 'competencia', 'valor_centavos', 'vencimento', 'parcelas']);
  IF c.estado NOT IN ('registrada', 'recebida') OR coalesce(c.custo_total, 0) = 0 THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só compras registradas e com custo informado geram conta a pagar.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE origem_tipo = 'compra' AND origem_id = c.id AND estado <> 'cancelado') THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta compra já tem uma conta a pagar.');
  END IF;
  v_cat := CASE WHEN p_dados ? 'categoria_id'
    THEN app_private.categoria_valida(c.empresa_id, app_private.ler_uuid(p_dados->>'categoria_id', 'categoria_id'), 'despesa')
    ELSE app_private.categoria_sistema(c.empresa_id, 'compras') END;
  v_comp := coalesce(app_private.ler_data(p_dados->>'competencia', 'competencia'), c.data_compra);
  PERFORM app_private.exigir_competencia_aberta(c.empresa_id, v_comp);
  INSERT INTO public.titulos_financeiros (empresa_id, tipo, origem_tipo, origem_id, descricao, total, categoria_id, competencia,
    contraparte_tipo, fornecedor_id, criado_por)
  VALUES (c.empresa_id, 'pagar', 'compra', c.id,
    left(concat_ws(' ', 'Compra', CASE WHEN c.numero_documento IS NOT NULL THEN 'nº ' || c.numero_documento END,
      'de ' || to_char(c.data_compra, 'DD/MM/YYYY')), 120),
    0, v_cat, v_comp, CASE WHEN c.fornecedor_id IS NOT NULL THEN 'fornecedor' END, c.fornecedor_id, usuario)
  RETURNING id INTO v_id;
  v_total := app_private.gravar_parcelas(c.empresa_id, v_id,
    CASE WHEN p_dados ? 'parcelas' OR p_dados ? 'valor_centavos' THEN p_dados
         ELSE jsonb_build_object('valor_centavos', app_private.para_centavos(c.custo_total),
                                 'vencimento', coalesce(p_dados->>'vencimento', app_private.hoje_sp()::text)) END);
  IF v_total <> c.custo_total THEN
    PERFORM app_private.erro('VALIDATION_ERROR', format('A soma das parcelas (%s) precisa ser igual ao custo da compra (%s).',
      app_private.brl(v_total), app_private.brl(c.custo_total)), 'parcelas');
  END IF;
  PERFORM app_private.auditar(c.empresa_id, usuario, 'financeiro.titulo_de_compra', 'titulos_financeiros', v_id,
    jsonb_build_object('compra_id', c.id, 'total_centavos', app_private.para_centavos(v_total)));
  RETURN app_private.idem_fim(usuario, 'gerar_titulo_compra', p_operation_key, assinatura, app_private.titulo_json(v_id));
END $$;
CREATE OR REPLACE FUNCTION public.fechar_periodo(p_empresa_id uuid, p_mes date, p_conferencias jsonb, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_empresa_id, p_mes, coalesce(p_conferencias, '[]'::jsonb)::text));
  anterior jsonb;
  v_proximo date;
  v_fim date;
  v_id uuid := gen_random_uuid();
  e jsonb;
  c public.contas_financeiras;
  v_contado numeric;
  v_esperado numeric;
  v_dif numeric;
  v_motivo text;
  v_conf jsonb := '[]'::jsonb;
  v_saldos jsonb;
  v_resumo jsonb;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'fechar_periodo', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.fechar']);
  INSERT INTO app_private.controle_financeiro (empresa_id) VALUES (p_empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  -- Trava exclusiva: espera os lançamentos em andamento e impede novos até o fim do fechamento.
  PERFORM 1 FROM app_private.controle_financeiro WHERE empresa_id = p_empresa_id FOR UPDATE;
  v_proximo := app_private.proximo_mes_a_fechar(p_empresa_id);
  IF v_proximo IS NULL THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Ainda não há registros financeiros para fechar.');
  END IF;
  IF p_mes IS NULL OR date_trunc('month', p_mes)::date <> v_proximo THEN
    PERFORM app_private.erro('STATE_CONFLICT', format('Os meses são fechados em ordem. O próximo a fechar é %s.', to_char(v_proximo, 'MM/YYYY')), 'mes');
  END IF;
  v_fim := (v_proximo + interval '1 month - 1 day')::date;
  IF v_fim >= app_private.hoje_sp() THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só é possível fechar um mês depois que ele termina.', 'mes');
  END IF;
  IF p_conferencias IS NOT NULL AND jsonb_typeof(p_conferencias) <> 'array' THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Conferências inválidas.', 'conferencias');
  END IF;
  -- Conferência opcional do caixa físico (D7-11). Diferença vira ajuste com motivo, datado do último dia do mês,
  -- e só o proprietário registra diferença (D7-17).
  FOR e IN SELECT value FROM jsonb_array_elements(coalesce(p_conferencias, '[]'::jsonb)) LOOP
    c := app_private.conta_valida(p_empresa_id, app_private.ler_uuid(e->>'conta_id', 'conta_id'));
    IF c.tipo <> 'caixa' THEN
      PERFORM app_private.erro('VALIDATION_ERROR', format('"%s" não é caixa físico; a conferência é só do dinheiro em espécie.', c.nome), 'conta_id');
    END IF;
    IF v_conf @> jsonb_build_array(jsonb_build_object('conta_id', c.id)) THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Cada caixa é conferido uma vez.', 'conta_id');
    END IF;
    v_contado := app_private.centavos(e->'contado_centavos', 'contado_centavos', true, 0);
    v_esperado := app_private.saldo_em(c.id, v_fim);
    v_dif := v_contado - v_esperado;
    v_motivo := NULL;
    IF v_dif <> 0 THEN
      PERFORM app_private.exigir_proprietario(p_empresa_id, usuario, 'Só o proprietário registra diferença na conferência do caixa.');
      v_motivo := app_private.ler_texto(e->>'motivo', 10, 300, 'motivo', 'Explique a diferença do caixa (10 a 300 caracteres).');
      PERFORM app_private.lancar(p_empresa_id, c.id, v_fim, CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END, abs(v_dif),
        'ajuste_conferencia', 'ajuste', NULL, 'fechamento', v_id, NULL, NULL, 'Conferência de caixa: ' || v_motivo, NULL, usuario, p_operation_key);
    END IF;
    v_conf := v_conf || jsonb_build_object('conta_id', c.id, 'conta', c.nome, 'esperado_centavos', app_private.para_centavos(v_esperado),
      'contado_centavos', app_private.para_centavos(v_contado), 'diferenca_centavos', app_private.para_centavos(v_dif), 'motivo', v_motivo);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('conta_id', ct.id, 'conta', ct.nome, 'tipo', ct.tipo,
      'saldo_centavos', app_private.para_centavos(app_private.saldo_em(ct.id, v_fim))) ORDER BY ct.nome), '[]'::jsonb)
    INTO v_saldos FROM public.contas_financeiras ct WHERE ct.empresa_id = p_empresa_id;
  v_resumo := app_private.resumo_periodo(p_empresa_id, v_proximo, v_fim, true)
    || jsonb_build_object('pendencias', app_private.pendencias_do_mes(p_empresa_id, v_proximo));
  INSERT INTO public.fechamentos_financeiros (id, empresa_id, mes, saldos, resumo, conferencias, fechado_por, operation_key)
  VALUES (v_id, p_empresa_id, v_proximo, v_saldos, v_resumo, v_conf, usuario, p_operation_key);
  UPDATE app_private.controle_financeiro SET fechado_ate = v_fim, atualizado_em = now() WHERE empresa_id = p_empresa_id;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.periodo_fechado', 'fechamentos_financeiros', v_id,
    jsonb_build_object('mes', v_proximo, 'conferencias', jsonb_array_length(v_conf)));
  RETURN app_private.idem_fim(usuario, 'fechar_periodo', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'mes', v_proximo, 'fechado_ate', v_fim, 'saldos', v_saldos, 'conferencias', v_conf));
END $$;
CREATE OR REPLACE FUNCTION app_private.resumo_periodo(p_empresa uuid, p_de date, p_ate date, p_ver_custo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  f record;
  v_inicial numeric;
  v_compras uuid := (SELECT id FROM public.categorias_financeiras WHERE empresa_id = p_empresa AND codigo_sistema = 'compras');
  v_vendas numeric;
  v_canceladas numeric;
  v_outras numeric;
  v_despesas numeric;
  v_compras_valor numeric;
  v_cmv numeric;
  v_cmv_estorno numeric;
  v_cob_valor numeric;
  v_cob_total numeric;
  v_receita numeric;
  v_resultado jsonb;
BEGIN
  SELECT coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END), 0) INTO v_inicial
    FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa AND data < p_de;
  SELECT
    coalesce(sum(valor) FILTER (WHERE natureza = 'receita' AND sentido = 'entrada'), 0) AS receitas_entradas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'receita' AND sentido = 'saida'), 0) AS receitas_saidas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'despesa' AND sentido = 'saida'), 0) AS despesas_saidas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'despesa' AND sentido = 'entrada'), 0) AS despesas_entradas,
    coalesce(sum(valor) FILTER (WHERE natureza = 'interna' AND sentido = 'saida'), 0) AS transferido,
    coalesce(sum(valor) FILTER (WHERE natureza = 'interna' AND sentido = 'entrada'), 0) AS transferido_entrada,
    -- Estorno de aporte reduz os aportes; estorno de retirada reduz as retiradas (nunca vira o oposto).
    coalesce(sum(CASE WHEN l.tipo = 'estorno' THEN -valor ELSE valor END) FILTER (WHERE coalesce(o_tipo, l.tipo) = 'aporte'), 0) AS aportes,
    coalesce(sum(CASE WHEN l.tipo = 'estorno' THEN -valor ELSE valor END) FILTER (WHERE coalesce(o_tipo, l.tipo) = 'retirada'), 0) AS retiradas,
    coalesce(sum(CASE WHEN sentido = 'entrada' THEN valor ELSE -valor END) FILTER (WHERE natureza = 'ajuste'), 0) AS ajustes
    INTO f FROM (SELECT x.*, (SELECT o.tipo FROM public.lancamentos_financeiros o WHERE o.id = x.estorno_de) AS o_tipo
                   FROM public.lancamentos_financeiros x WHERE x.empresa_id = p_empresa AND x.data BETWEEN p_de AND p_ate) l;

  -- Vendas: entram no mês da confirmação e saem no mês do cancelamento (o mês fechado não muda depois).
  SELECT coalesce(sum(total), 0) INTO v_vendas FROM public.vendas
   WHERE empresa_id = p_empresa AND estado IN ('confirmada', 'cancelada') AND confirmada_em IS NOT NULL
     AND (confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
  SELECT coalesce(sum(total), 0) INTO v_canceladas FROM public.vendas
   WHERE empresa_id = p_empresa AND estado = 'cancelada' AND (cancelada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
  -- Outras receitas: contas a receber manuais pela competência (menos as canceladas no período) e receitas avulsas.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_outras FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'receber' AND origem_tipo = 'manual';
  v_outras := v_outras + coalesce((SELECT sum(CASE WHEN l.sentido = 'entrada' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate
     AND (l.tipo = 'receita_avulsa' OR o.tipo = 'receita_avulsa')), 0);
  -- Despesas: contas a pagar pela competência (menos canceladas no período) e despesas avulsas, exceto compras de mercadorias.
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_despesas FROM public.titulos_financeiros
   WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id IS DISTINCT FROM v_compras;
  v_despesas := v_despesas + coalesce((SELECT sum(CASE WHEN l.sentido = 'saida' THEN l.valor ELSE -l.valor END)
    FROM public.lancamentos_financeiros l LEFT JOIN public.lancamentos_financeiros o ON o.id = l.estorno_de
   WHERE l.empresa_id = p_empresa AND l.data BETWEEN p_de AND p_ate AND l.categoria_id IS DISTINCT FROM v_compras
     AND (l.tipo = 'despesa_avulsa' OR o.tipo = 'despesa_avulsa')), 0);
  SELECT coalesce(sum(total) FILTER (WHERE competencia BETWEEN p_de AND p_ate), 0)
       - coalesce(sum(total) FILTER (WHERE estado = 'cancelado' AND (cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), 0)
    INTO v_compras_valor FROM public.titulos_financeiros WHERE empresa_id = p_empresa AND tipo = 'pagar' AND categoria_id = v_compras;
  v_receita := v_vendas - v_canceladas + v_outras;

  IF p_ver_custo THEN
    -- D7-15: custo do momento da venda; itens sem custo reduzem a cobertura e o resultado é chamado de parcial.
    SELECT coalesce(sum(vi.custo_unitario * vi.quantidade), 0), coalesce(sum(vi.valor) FILTER (WHERE vi.custo_unitario IS NOT NULL), 0),
           coalesce(sum(vi.valor), 0)
      INTO v_cmv, v_cob_valor, v_cob_total
      FROM public.venda_itens vi JOIN public.vendas v ON v.id = vi.venda_id
     WHERE v.empresa_id = p_empresa AND v.estado IN ('confirmada', 'cancelada') AND v.confirmada_em IS NOT NULL
       AND (v.confirmada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
    SELECT coalesce(sum(vi.custo_unitario * vi.quantidade), 0) INTO v_cmv_estorno
      FROM public.venda_itens vi JOIN public.vendas v ON v.id = vi.venda_id
     WHERE v.empresa_id = p_empresa AND v.estado = 'cancelada' AND vi.destino_cancelamento IN ('voltou', 'nao_entregue')
       AND (v.cancelada_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate;
    v_cmv := v_cmv - v_cmv_estorno;
    v_resultado := jsonb_build_object('disponivel', true,
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'custo_mercadorias_vendidas_centavos', app_private.para_centavos(v_cmv),
      'margem_bruta_centavos', app_private.para_centavos(v_vendas - v_canceladas - v_cmv),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'resultado_estimado_centavos', app_private.para_centavos(v_receita - v_cmv - v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor),
      'cobertura_custo_percentual', CASE WHEN v_cob_total = 0 THEN NULL ELSE round(100 * v_cob_valor / v_cob_total, 1) END,
      'parcial', v_cob_total > 0 AND v_cob_valor < v_cob_total);
  ELSE
    v_resultado := jsonb_build_object('disponivel', false,
      'motivo', 'O resultado usa o custo das mercadorias vendidas, e seu acesso não permite ver custos.',
      'receita_vendas_centavos', app_private.para_centavos(v_vendas),
      'vendas_canceladas_centavos', app_private.para_centavos(v_canceladas),
      'outras_receitas_centavos', app_private.para_centavos(v_outras),
      'despesas_centavos', app_private.para_centavos(v_despesas),
      'compras_mercadorias_centavos', app_private.para_centavos(v_compras_valor));
  END IF;
  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'fluxo', jsonb_build_object(
      'saldo_inicial_centavos', app_private.para_centavos(v_inicial),
      'receitas_recebidas_centavos', app_private.para_centavos(f.receitas_entradas),
      'devolucoes_e_estornos_de_receita_centavos', app_private.para_centavos(f.receitas_saidas),
      'despesas_pagas_centavos', app_private.para_centavos(f.despesas_saidas),
      'estornos_de_despesa_centavos', app_private.para_centavos(f.despesas_entradas),
      'transferido_entre_contas_centavos', app_private.para_centavos(f.transferido),
      'aportes_centavos', app_private.para_centavos(f.aportes),
      'retiradas_centavos', app_private.para_centavos(f.retiradas),
      'ajustes_centavos', app_private.para_centavos(f.ajustes),
      'variacao_operacional_centavos', app_private.para_centavos(f.receitas_entradas - f.receitas_saidas - f.despesas_saidas + f.despesas_entradas),
      'saldo_final_centavos', app_private.para_centavos(v_inicial + f.receitas_entradas - f.receitas_saidas - f.despesas_saidas
        + f.despesas_entradas + f.transferido_entrada - f.transferido + f.aportes - f.retiradas + f.ajustes),
      'metodo', 'Regime de caixa: soma do que entrou e saiu das contas, pela data de cada lançamento. Transferências entre contas '
        || 'não mudam o total; aportes e retiradas do proprietário aparecem separados e não são receita nem despesa.'),
    'resultado', v_resultado || jsonb_build_object(
      'metodo', 'Competência simplificada: vendas confirmadas no período (canceladas saem no mês do cancelamento), mais outras '
        || 'receitas, menos o custo das mercadorias vendidas (custo informado no momento da venda) e as despesas do mês de '
        || 'referência. Compras de mercadorias viram custo quando o produto é vendido. Transferências, aportes e retiradas '
        || 'não entram. Custos indiretos não são rateados.',
      'aviso', 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.'));
END $$;
CREATE OR REPLACE FUNCTION public.painel_financeiro(p_empresa_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_hoje date := app_private.hoje_sp();
  v_ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  p := app_private.ler_periodo(p_de, p_ate);
  v_ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  RETURN app_private.resumo_periodo(p_empresa_id, p.de, p.ate, v_ver_custo) || jsonb_build_object(
    'contas', coalesce((SELECT jsonb_agg(app_private.conta_json(c) ORDER BY c.padrao DESC, c.nome)
      FROM public.contas_financeiras c WHERE c.empresa_id = p_empresa_id AND c.ativa), '[]'::jsonb),
    'consolidado_centavos', (SELECT app_private.para_centavos(coalesce(sum(saldo), 0)) FROM public.contas_financeiras WHERE empresa_id = p_empresa_id),
    'a_receber', (SELECT jsonb_build_object('aberto_centavos', app_private.para_centavos(coalesce(sum(pa.saldo), 0)),
        'vencido_centavos', app_private.para_centavos(coalesce(sum(pa.saldo) FILTER (WHERE pa.vencimento < v_hoje), 0)),
        'parcelas_vencidas', count(*) FILTER (WHERE pa.vencimento < v_hoje))
      FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
     WHERE t.empresa_id = p_empresa_id AND t.tipo = 'receber' AND pa.estado IN ('aberta', 'parcial')),
    'a_pagar', (SELECT jsonb_build_object('aberto_centavos', app_private.para_centavos(coalesce(sum(pa.saldo), 0)),
        'vencido_centavos', app_private.para_centavos(coalesce(sum(pa.saldo) FILTER (WHERE pa.vencimento < v_hoje), 0)),
        'parcelas_vencidas', count(*) FILTER (WHERE pa.vencimento < v_hoje),
        'vence_em_7_dias_centavos', app_private.para_centavos(coalesce(sum(pa.saldo) FILTER (WHERE pa.vencimento BETWEEN v_hoje AND v_hoje + 7), 0)))
      FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
     WHERE t.empresa_id = p_empresa_id AND t.tipo = 'pagar' AND pa.estado IN ('aberta', 'parcial')),
    'devolucoes_a_fazer_centavos', (SELECT app_private.para_centavos(coalesce(sum(a_devolver), 0)) FROM public.titulos_financeiros
      WHERE empresa_id = p_empresa_id AND a_devolver > 0),
    'previsto_a_pagar_centavos', (SELECT app_private.para_centavos(coalesce(sum(r.valor), 0))
      FROM public.despesas_recorrentes r, app_private.competencias_da_regra(r, (date_trunc('month', v_hoje) + interval '1 month')::date,
        (date_trunc('month', v_hoje) + interval '3 months')::date) AS m WHERE r.empresa_id = p_empresa_id AND r.ativa),
    'fechado_ate', (SELECT fechado_ate FROM app_private.controle_financeiro WHERE empresa_id = p_empresa_id),
    've_custo', v_ver_custo,
    'fontes', jsonb_build_object(
      'contas', 'Saldo de cada conta = soma de todos os lançamentos registrados nela.',
      'a_receber_a_pagar', 'Parcelas abertas; "vencido" é calculado hoje, no horário de São Paulo.',
      'previsto', 'Despesas recorrentes ativas dos próximos 3 meses, ainda não geradas.'),
    'aviso_registro', 'Valores registrados manualmente na AutoniCK. Nenhum dinheiro é movimentado pelo sistema.');
END $$;
CREATE OR REPLACE FUNCTION public.relatorio_financeiro(p_empresa_id uuid, p_tipo text, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_hoje date := app_private.hoje_sp();
  v_linhas jsonb;
  v_metodo text;
  v_ver_custo boolean;
BEGIN
  PERFORM app_private.exigir_financeiro(p_empresa_id, usuario);
  p := app_private.ler_periodo(p_de, p_ate);
  v_ver_custo := app_private.tem(p_empresa_id, usuario, 'produtos.ver_custo');
  IF p_tipo = 'categorias' THEN
    v_metodo := 'Regime de caixa: lançamentos do período por categoria. Transferências, aportes e retiradas aparecem sem categoria, separados.';
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'natureza', x->>'categoria'), '[]'::jsonb) INTO v_linhas FROM (
      SELECT jsonb_build_object('natureza', l.natureza, 'categoria', coalesce(c.nome, CASE l.natureza WHEN 'interna' THEN 'Transferências entre contas'
          WHEN 'proprietario' THEN 'Proprietário (aportes e retiradas)' ELSE 'Ajustes e saldos iniciais' END),
        'entradas_centavos', app_private.para_centavos(coalesce(sum(l.valor) FILTER (WHERE l.sentido = 'entrada'), 0)),
        'saidas_centavos', app_private.para_centavos(coalesce(sum(l.valor) FILTER (WHERE l.sentido = 'saida'), 0)),
        'liquido_centavos', app_private.para_centavos(coalesce(sum(CASE WHEN l.sentido = 'entrada' THEN l.valor ELSE -l.valor END), 0)),
        'lancamentos', count(*)) AS x
        FROM public.lancamentos_financeiros l LEFT JOIN public.categorias_financeiras c ON c.id = l.categoria_id
       WHERE l.empresa_id = p_empresa_id AND l.data BETWEEN p.de AND p.ate
       GROUP BY l.natureza, c.nome) q;
  ELSIF p_tipo = 'contas' THEN
    v_metodo := 'Por conta: saldo antes do período, entradas, saídas e saldo no fim do período.';
    SELECT coalesce(jsonb_agg(jsonb_build_object('conta', c.nome, 'tipo', c.tipo, 'ativa', c.ativa,
        'saldo_inicial_centavos', app_private.para_centavos(app_private.saldo_em(c.id, p.de - 1)),
        'entradas_centavos', app_private.para_centavos(coalesce((SELECT sum(valor) FROM public.lancamentos_financeiros
           WHERE conta_id = c.id AND sentido = 'entrada' AND data BETWEEN p.de AND p.ate), 0)),
        'saidas_centavos', app_private.para_centavos(coalesce((SELECT sum(valor) FROM public.lancamentos_financeiros
           WHERE conta_id = c.id AND sentido = 'saida' AND data BETWEEN p.de AND p.ate), 0)),
        'saldo_final_centavos', app_private.para_centavos(app_private.saldo_em(c.id, p.ate))) ORDER BY c.nome), '[]'::jsonb)
      INTO v_linhas FROM public.contas_financeiras c WHERE c.empresa_id = p_empresa_id;
  ELSIF p_tipo = 'vencimentos' THEN
    v_metodo := 'Parcelas abertas por faixa de vencimento, contadas a partir de hoje (horário de São Paulo).';
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'tipo', (x->>'ordem')::int), '[]'::jsonb) INTO v_linhas FROM (
      SELECT jsonb_build_object('tipo', tt.tipo, 'faixa', fx.nome, 'ordem', fx.ordem,
        'parcelas', count(pa.id), 'saldo_centavos', app_private.para_centavos(coalesce(sum(pa.saldo), 0))) AS x
        FROM (VALUES (1, 'Vencidas'), (2, 'Próximos 7 dias'), (3, 'De 8 a 30 dias'), (4, 'Depois de 30 dias')) AS fx (ordem, nome)
        CROSS JOIN (VALUES ('receber'), ('pagar')) AS tt (tipo)
        LEFT JOIN (SELECT pa.*, t.tipo AS titulo_tipo FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id
                    WHERE t.empresa_id = p_empresa_id AND pa.estado IN ('aberta', 'parcial')) pa
          ON pa.titulo_tipo = tt.tipo AND CASE fx.ordem
            WHEN 1 THEN pa.vencimento < v_hoje WHEN 2 THEN pa.vencimento BETWEEN v_hoje AND v_hoje + 7
            WHEN 3 THEN pa.vencimento BETWEEN v_hoje + 8 AND v_hoje + 30 ELSE pa.vencimento > v_hoje + 30 END
       GROUP BY tt.tipo, fx.ordem, fx.nome) q;
  ELSIF p_tipo = 'mensal' THEN
    v_metodo := 'Mês a mês: fluxo de caixa e resultado gerencial estimado, com os mesmos métodos do painel.';
    IF p.ate - p.de > 370 THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'O relatório mensal cobre no máximo 12 meses.', 'ate');
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('mes', m,
        'resumo', app_private.resumo_periodo(p_empresa_id, greatest(m, p.de), least((m + interval '1 month - 1 day')::date, p.ate), v_ver_custo))
        ORDER BY m), '[]'::jsonb)
      INTO v_linhas FROM (SELECT generate_series(date_trunc('month', p.de), date_trunc('month', p.ate), interval '1 month')::date AS m) g;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Relatório desconhecido.', 'tipo');
  END IF;
  RETURN jsonb_build_object('tipo', p_tipo, 'periodo', jsonb_build_object('de', p.de, 'ate', p.ate), 'linhas', v_linhas, 'metodo', v_metodo,
    'aviso', 'Estimativa gerencial. Não é contabilidade oficial nem substitui um contador.');
END $$;
CREATE OR REPLACE FUNCTION public.exportar_financeiro(p_empresa_id uuid, p_tipo text, p_de date DEFAULT NULL, p_ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  p record;
  v_colunas jsonb;
  v_linhas jsonb;
BEGIN
  PERFORM app_private.exigir_permissoes(p_empresa_id, usuario, ARRAY['financeiro.visualizar', 'financeiro.exportar']);
  p := app_private.ler_periodo(p_de, p_ate);
  IF p_tipo = 'lancamentos' THEN
    v_colunas := '["Data","Conta","Tipo","Natureza","Categoria","Entrada (R$)","Saída (R$)","Descrição","Origem","Estorno de","Registrado por"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(l.data, c.nome, l.tipo, l.natureza, cat.nome,
        CASE WHEN l.sentido = 'entrada' THEN app_private.para_centavos(l.valor) END,
        CASE WHEN l.sentido = 'saida' THEN app_private.para_centavos(l.valor) END,
        coalesce(l.descricao, t.descricao), l.origem_tipo, l.estorno_de, app_private.nome_da_pessoa(l.autor))
        ORDER BY l.data, l.criado_em), '[]'::jsonb)
      INTO v_linhas FROM (SELECT * FROM public.lancamentos_financeiros WHERE empresa_id = p_empresa_id AND data BETWEEN p.de AND p.ate
                           ORDER BY data, criado_em LIMIT 5000) l
      JOIN public.contas_financeiras c ON c.id = l.conta_id
      LEFT JOIN public.categorias_financeiras cat ON cat.id = l.categoria_id
      LEFT JOIN public.titulos_financeiros t ON t.id = l.titulo_id;
  ELSIF p_tipo = 'titulos' THEN
    v_colunas := '["Tipo","Descrição","Categoria","Referência","Contraparte","Parcela","Vencimento","Valor (R$)","Saldo (R$)","Situação"]';
    SELECT coalesce(jsonb_agg(jsonb_build_array(t.tipo, t.descricao, cat.nome, t.competencia, coalesce(ce.nome, fo.nome, t.contraparte_texto),
        pa.sequencia, pa.vencimento, app_private.para_centavos(pa.valor), app_private.para_centavos(pa.saldo),
        app_private.estado_exibicao(pa.estado, pa.vencimento, pa.estado = 'parcial')) ORDER BY pa.vencimento, t.descricao, pa.sequencia), '[]'::jsonb)
      INTO v_linhas FROM public.titulos_financeiros t
      JOIN public.parcelas_financeiras pa ON pa.titulo_id = t.id
      LEFT JOIN public.categorias_financeiras cat ON cat.id = t.categoria_id
      LEFT JOIN public.clientes_empresa ce ON ce.id = t.cliente_empresa_id
      LEFT JOIN public.fornecedores fo ON fo.id = t.fornecedor_id
     WHERE t.empresa_id = p_empresa_id AND (pa.vencimento BETWEEN p.de AND p.ate OR t.competencia BETWEEN p.de AND p.ate);
  ELSIF p_tipo IN ('categorias', 'contas') THEN
    v_linhas := (public.relatorio_financeiro(p_empresa_id, p_tipo, p.de, p.ate))->'linhas';
    IF p_tipo = 'categorias' THEN
      v_colunas := '["Natureza","Categoria","Entradas (R$)","Saídas (R$)","Líquido (R$)","Lançamentos"]';
      SELECT coalesce(jsonb_agg(jsonb_build_array(x->'natureza', x->'categoria', x->'entradas_centavos', x->'saidas_centavos',
        x->'liquido_centavos', x->'lancamentos')), '[]'::jsonb) INTO v_linhas FROM jsonb_array_elements(v_linhas) x;
    ELSE
      v_colunas := '["Conta","Tipo","Saldo inicial (R$)","Entradas (R$)","Saídas (R$)","Saldo final (R$)"]';
      SELECT coalesce(jsonb_agg(jsonb_build_array(x->'conta', x->'tipo', x->'saldo_inicial_centavos', x->'entradas_centavos',
        x->'saidas_centavos', x->'saldo_final_centavos')), '[]'::jsonb) INTO v_linhas FROM jsonb_array_elements(v_linhas) x;
    END IF;
  ELSE
    PERFORM app_private.erro('VALIDATION_ERROR', 'Exportação desconhecida.', 'tipo');
  END IF;
  PERFORM app_private.auditar(p_empresa_id, usuario, 'financeiro.exportacao', 'lancamentos_financeiros', NULL,
    jsonb_build_object('tipo', p_tipo, 'de', p.de, 'ate', p.ate, 'linhas', jsonb_array_length(v_linhas)));
  RETURN jsonb_build_object('tipo', p_tipo, 'periodo', jsonb_build_object('de', p.de, 'ate', p.ate), 'colunas', v_colunas,
    'linhas', v_linhas, 'valores_em_centavos', true, 'limite_atingido', jsonb_array_length(v_linhas) >= 5000);
END $$;

DROP FUNCTION public.divergencias_caixa(uuid, date, date);
DROP FUNCTION app_private.divergencias_resumo(uuid);
DROP FUNCTION app_private.conferencias_caixa(uuid, date, date);
DROP FUNCTION app_private.classe_compra(uuid);
DROP FUNCTION app_private.valor_insumos_compra(uuid);

ALTER TABLE app_private.controle_financeiro DROP COLUMN reconhecimento_insumos;

ALTER TABLE public.categorias_financeiras DISABLE TRIGGER categorias_sem_exclusao;
DELETE FROM public.categorias_financeiras WHERE codigo_sistema = 'insumos';
ALTER TABLE public.categorias_financeiras ENABLE TRIGGER categorias_sem_exclusao;
UPDATE public.categorias_financeiras SET nome = 'Compras de mercadorias e insumos', versao = versao + 1
 WHERE codigo_sistema = 'compras' AND nome = 'Compras para revenda';

ALTER TABLE public.categorias_financeiras DROP CONSTRAINT categorias_sistema_tipo;
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_sistema_tipo CHECK (codigo_sistema IS NULL
  OR (codigo_sistema = 'vendas' AND tipo = 'receita') OR (codigo_sistema = 'compras' AND tipo = 'despesa'));
ALTER TABLE public.categorias_financeiras DROP CONSTRAINT categorias_financeiras_codigo_sistema_check;
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_codigo_sistema_check
  CHECK (codigo_sistema IN ('vendas', 'compras'));

DELETE FROM app_private.historico_migracoes WHERE id = '202611120002';

COMMIT;
