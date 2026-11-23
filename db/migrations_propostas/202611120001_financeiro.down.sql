-- Rollback da 202611120001 (M07). Somente no branch de desenvolvimento, sem dados reais.
-- Recusa se já houver dado próprio do M07 (lançamento que não seja a carga do M06, pagamento, transferência, conta além da
-- padrão, título que não seja de venda, recorrência ou fechamento): nesse caso a reversão exige decisão humana.
-- Os lançamentos de carga do M06 são descartados (os recebimentos continuam íntegros). A auditoria é preservada.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE NOT carga_m06)
     OR EXISTS (SELECT 1 FROM public.pagamentos)
     OR EXISTS (SELECT 1 FROM public.transferencias_financeiras)
     OR EXISTS (SELECT 1 FROM public.despesas_recorrentes)
     OR EXISTS (SELECT 1 FROM public.fechamentos_financeiros)
     OR EXISTS (SELECT 1 FROM public.titulos_financeiros WHERE origem_tipo <> 'venda')
     OR EXISTS (SELECT 1 FROM public.contas_financeiras WHERE NOT padrao OR tipo <> 'caixa') THEN
    RAISE EXCEPTION 'Rollback recusado: já há lançamentos, pagamentos, transferências, contas, títulos, recorrências ou fechamentos do M07.'
      USING HINT = 'STATE_CONFLICT';
  END IF;
END $$;

DROP TRIGGER recebimentos_geram_lancamento ON public.recebimentos;
DROP TRIGGER titulos_completar ON public.titulos_financeiros;
DROP TRIGGER contas_sem_exclusao ON public.contas_financeiras;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname || '.' || p.proname = ANY (ARRAY['app_private.proteger_fechamento', 'app_private.hoje_sp', 'app_private.brl', 'app_private.travar_periodo', 'app_private.exigir_data_aberta', 'app_private.exigir_competencia_aberta', 'app_private.garantir_categorias', 'app_private.categoria_sistema', 'app_private.categoria_valida', 'app_private.conta_valida', 'app_private.lancar', 'app_private.menor_saldo_desde', 'app_private.lancar_estorno', 'app_private.lancar_recebimento', 'app_private.recebimento_lanca', 'app_private.pagamento_lanca', 'app_private.completar_titulo', 'app_private.carregar_lancamentos_m06', 'app_private.exigir_chaves', 'app_private.ler_uuid', 'app_private.ler_data', 'app_private.ler_texto', 'app_private.exigir_proprietario', 'app_private.receber_parcela', 'app_private.conta_json', 'app_private.nome_conta_livre', 'app_private.categoria_json', 'app_private.nome_categoria_livre', 'app_private.estado_exibicao', 'app_private.titulo_json', 'app_private.gravar_parcelas', 'app_private.lancamento_json', 'app_private.executar_transferencia', 'app_private.transferencia_json', 'app_private.vencimento_no_mes', 'app_private.competencias_da_regra', 'app_private.recorrencia_json', 'app_private.validar_recorrencia', 'app_private.saldo_em', 'app_private.proximo_mes_a_fechar', 'app_private.pendencias_do_mes', 'app_private.exigir_financeiro', 'app_private.ler_periodo', 'app_private.resumo_periodo', 'app_private.reconciliacao']) LOOP
    EXECUTE format('DROP FUNCTION %s CASCADE', f);
  END LOOP;
END $$;
DROP FUNCTION public.criar_conta(uuid, jsonb, text);
DROP FUNCTION public.alterar_conta(uuid, jsonb, integer, text);
DROP FUNCTION public.definir_conta_ativa(uuid, boolean, integer, text);
DROP FUNCTION public.definir_conta_padrao(uuid, integer, text);
DROP FUNCTION public.criar_categoria_financeira(uuid, jsonb, text);
DROP FUNCTION public.alterar_categoria_financeira(uuid, jsonb, integer, text);
DROP FUNCTION public.definir_categoria_ativa(uuid, boolean, integer, text);
DROP FUNCTION public.criar_titulo(uuid, jsonb, text);
DROP FUNCTION public.cancelar_titulo(uuid, text, integer, text);
DROP FUNCTION public.registrar_pagamento(uuid, bigint, uuid, text, date, text);
DROP FUNCTION public.estornar_pagamento(uuid, text, text);
DROP FUNCTION public.registrar_lancamento(uuid, jsonb, text);
DROP FUNCTION public.registrar_movimento_proprietario(uuid, jsonb, text);
DROP FUNCTION public.estornar_lancamento(uuid, text, text);
DROP FUNCTION public.transferir(uuid, jsonb, text);
DROP FUNCTION public.estornar_transferencia(uuid, text, text);
DROP FUNCTION public.criar_recorrencia(uuid, jsonb, text);
DROP FUNCTION public.alterar_recorrencia(uuid, jsonb, integer, text);
DROP FUNCTION public.definir_recorrencia_ativa(uuid, boolean, integer, text);
DROP FUNCTION public.gerar_recorrencias(uuid);
DROP FUNCTION public.compras_para_conta_pagar(uuid);
DROP FUNCTION public.gerar_titulo_compra(uuid, jsonb, text);
DROP FUNCTION public.fechar_periodo(uuid, date, jsonb, text);
DROP FUNCTION public.reabrir_periodo(uuid, text, text);
DROP FUNCTION public.contas_da_empresa(uuid);
DROP FUNCTION public.categorias_financeiras_da_empresa(uuid);
DROP FUNCTION public.titulos_da_empresa(uuid, jsonb, integer, integer);
DROP FUNCTION public.titulo_detalhe(uuid);
DROP FUNCTION public.lancamentos_da_empresa(uuid, jsonb, integer, integer);
DROP FUNCTION public.recorrencias_da_empresa(uuid);
DROP FUNCTION public.painel_financeiro(uuid, date, date);
DROP FUNCTION public.situacao_fechamento(uuid);
DROP FUNCTION public.relatorio_financeiro(uuid, text, date, date);
DROP FUNCTION public.exportar_financeiro(uuid, text, date, date);
DROP FUNCTION public.reconciliar_financeiro(uuid);
DROP FUNCTION public.registrar_recebimento(uuid, bigint, text, date, text, uuid);
DROP FUNCTION public.registrar_devolucao_valor(uuid, bigint, text, text, text, uuid);

DROP TABLE public.fechamentos_financeiros;
DROP TABLE app_private.controle_financeiro;
DROP INDEX public.titulos_recorrencia_competencia;
DROP TABLE public.despesas_recorrentes;
DROP TABLE public.transferencias_financeiras;
DROP TABLE public.pagamentos;
DROP TABLE public.lancamentos_financeiros;

-- Títulos voltam ao desenho do M06.
DROP INDEX public.titulos_uma_por_venda;
DROP INDEX public.titulos_uma_por_compra;
DROP INDEX public.titulos_lista;
ALTER TABLE public.titulos_financeiros
  DROP CONSTRAINT titulos_categoria_obrigatoria, DROP CONSTRAINT titulos_categoria_fk, DROP CONSTRAINT titulos_cliente_fk,
  DROP CONSTRAINT titulos_fornecedor_fk, DROP CONSTRAINT titulos_origem_coerente, DROP CONSTRAINT titulos_tipo_origem,
  DROP CONSTRAINT titulos_devolucao_so_receber, DROP CONSTRAINT titulos_contraparte_coerente,
  DROP COLUMN categoria_id, DROP COLUMN competencia, DROP COLUMN contraparte_tipo, DROP COLUMN cliente_empresa_id,
  DROP COLUMN fornecedor_id, DROP COLUMN contraparte_texto, DROP COLUMN motivo_cancelamento, DROP COLUMN criado_por, DROP COLUMN cancelado_por;
ALTER TABLE public.titulos_financeiros ALTER COLUMN origem_id SET NOT NULL;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_empresa_id_origem_tipo_origem_id_key UNIQUE (empresa_id, origem_tipo, origem_id);
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_tipo_check;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_tipo_check CHECK (tipo IN ('receber'));
ALTER TABLE public.titulos_financeiros DROP CONSTRAINT titulos_financeiros_origem_tipo_check;
ALTER TABLE public.titulos_financeiros ADD CONSTRAINT titulos_financeiros_origem_tipo_check CHECK (origem_tipo IN ('venda'));
DROP TABLE public.categorias_financeiras;

-- Contas voltam ao desenho do M06.
DROP INDEX public.contas_nome_unico;
ALTER TABLE public.contas_financeiras DROP CONSTRAINT contas_caixa_nunca_negativo, DROP CONSTRAINT contas_saldo_permitido,
  DROP COLUMN permite_negativo, DROP COLUMN saldo, DROP COLUMN versao, DROP COLUMN criado_por, DROP COLUMN atualizado_em;
ALTER TABLE public.contas_financeiras DROP CONSTRAINT contas_financeiras_tipo_check;
ALTER TABLE public.contas_financeiras ADD CONSTRAINT contas_financeiras_tipo_check CHECK (tipo IN ('caixa'));

-- Funções do M06 na forma original.
CREATE FUNCTION app_private.receber_parcela(p_parcela uuid, p_valor numeric, p_forma text, p_data date,
  p_usuario text, p_chave text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  pa public.parcelas_financeiras;
  t public.titulos_financeiros;
  v_rec uuid;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO pa FROM public.parcelas_financeiras WHERE id = p_parcela FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = pa.titulo_id FOR UPDATE;
  IF t.estado = 'cancelado' OR pa.estado = 'cancelada' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Esta venda foi cancelada; não recebe mais valores.');
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma de pagamento.', 'forma');
  END IF;
  IF p_data IS NULL OR p_data > v_hoje OR p_data < v_hoje - 3650 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'A data do recebimento não pode estar no futuro.', 'data');
  END IF;
  IF p_valor > pa.saldo THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor é maior que o saldo da parcela (R$ %s).', to_char(pa.saldo, 'FM999G999G990D00')), 'valor_centavos');
  END IF;
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, autor, operation_key)
  VALUES (pa.empresa_id, t.id, pa.id, app_private.conta_caixa(pa.empresa_id), 'recebimento', p_valor, p_forma, p_data, p_usuario, p_chave)
  RETURNING id INTO v_rec;
  UPDATE public.parcelas_financeiras SET saldo = saldo - p_valor,
    estado = CASE WHEN saldo - p_valor = 0 THEN 'liquidada' ELSE 'parcial' END, versao = versao + 1
   WHERE id = pa.id;
  UPDATE public.titulos_financeiros SET recebido = recebido + p_valor,
    estado = CASE WHEN recebido + p_valor = total THEN 'liquidado' ELSE 'parcial' END, versao = versao + 1
   WHERE id = t.id;
  PERFORM app_private.evento_comercial(pa.empresa_id, 'recebimento_registrado', p_usuario, 'titulo', t.id,
    jsonb_build_object('parcela', pa.sequencia, 'valor_centavos', app_private.para_centavos(p_valor), 'forma', p_forma), p_chave);
  PERFORM app_private.auditar(pa.empresa_id, p_usuario, 'venda.recebimento', 'recebimentos', v_rec,
    jsonb_build_object('valor_centavos', app_private.para_centavos(p_valor), 'forma', p_forma));
  RETURN jsonb_build_object('recebimento_id', v_rec, 'parcela_id', pa.id, 'saldo_parcela_centavos', app_private.para_centavos(pa.saldo - p_valor),
    'saldo_titulo_centavos', app_private.para_centavos(t.total - t.recebido - p_valor));
END $$;

CREATE OR REPLACE FUNCTION app_private.confirmar_venda_nucleo(p_venda uuid, p_usuario text, p_pagamento jsonb,
  p_total_esperado bigint, p_chave text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v public.vendas;
  it record;
  s public.saldos_estoque;
  vv record;
  v_numero integer;
  v_titulo uuid;
  v_saidas jsonb := '[]'::jsonb;
  v_pendentes jsonb := '[]'::jsonb;
  v_reserva jsonb;
  v_receb jsonb;
  v_inicial numeric;
  v_parcela uuid;
BEGIN
  IF coalesce(p_pagamento->>'condicao', 'a_vista') NOT IN ('a_vista', 'parcelado') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Condição de pagamento inválida.', 'condicao');
  END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda FOR UPDATE;
  PERFORM app_private.travar_saldos_venda(v.id);
  -- Balcão: preço atual do catálogo (D6-05) e recusa de pausado/desativado (D6-07) no momento da confirmação.
  -- Pedido já aceito: mantém o preço combinado no pedido; a pausa posterior não desfaz o que foi aceito.
  IF v.origem = 'balcao' THEN
    FOR it IN SELECT * FROM public.venda_itens WHERE venda_id = v.id ORDER BY variacao_id LOOP
      SELECT * INTO vv FROM app_private.variacao_vendavel(v.empresa_id, it.variacao_id);
      IF (vv.v).preco <> it.preco_unitario OR (vv.p).sob_encomenda <> it.sob_encomenda THEN
        UPDATE public.venda_itens SET preco_unitario = (vv.v).preco, sob_encomenda = (vv.p).sob_encomenda
         WHERE venda_id = v.id AND variacao_id = it.variacao_id;
      END IF;
    END LOOP;
  END IF;
  IF v.origem = 'balcao' THEN
    UPDATE public.vendas x SET subtotal = q.subtotal, desconto_itens = q.descontos, total = q.subtotal - q.descontos - x.desconto_geral
      FROM (SELECT sum(quantidade * preco_unitario) AS subtotal, sum(desconto) AS descontos FROM public.venda_itens WHERE venda_id = v.id) q
     WHERE x.id = v.id RETURNING x.* INTO v;
  END IF;
  IF v.total < 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'O desconto ficou maior que o valor da venda. Revise os itens.', 'desconto');
  END IF;
  IF p_total_esperado IS NOT NULL AND app_private.para_centavos(v.total) <> p_total_esperado THEN
    PERFORM app_private.erro('STATE_CONFLICT',
      format('O total mudou para R$ %s (preço atualizado no catálogo). Revise antes de confirmar.', to_char(v.total, 'FM999G999G990D00')),
      'total');
  END IF;
  IF v.origem = 'balcao' THEN
    PERFORM app_private.conferir_desconto(v, p_usuario);
  END IF;
  -- Estoque: entrega no ato quando há físico disponível; sob encomenda sem físico fica pendente (D6-08).
  FOR it IN SELECT i.*, (SELECT custo_atual FROM public.produto_variacoes WHERE id = i.variacao_id) AS custo
              FROM public.venda_itens i WHERE i.venda_id = v.id ORDER BY i.variacao_id LOOP
    SELECT * INTO s FROM public.saldos_estoque WHERE variacao_id = it.variacao_id;
    IF s.disponivel >= it.quantidade THEN
      v_saidas := v_saidas || jsonb_build_object('variacao_id', it.variacao_id, 'delta', -it.quantidade);
      UPDATE public.venda_itens SET entrega = 'entregue', entregue_em = now(), custo_unitario = it.custo
       WHERE venda_id = v.id AND variacao_id = it.variacao_id;
    ELSIF it.sob_encomenda THEN
      v_pendentes := v_pendentes || jsonb_build_object('variacao_id', it.variacao_id, 'quantidade', it.quantidade);
      UPDATE public.venda_itens SET entrega = 'pendente', custo_unitario = it.custo
       WHERE venda_id = v.id AND variacao_id = it.variacao_id;
    ELSE
      PERFORM app_private.erro('INSUFFICIENT_STOCK',
        format('Estoque insuficiente: há %s disponíveis de %s (%s).', s.disponivel, it.nome_snapshot, it.rotulo_snapshot),
        it.variacao_id::text);
    END IF;
  END LOOP;
  IF jsonb_array_length(v_saidas) > 0 THEN
    PERFORM app_private.aplicar_itens(v.empresa_id, p_usuario, 'saida', v_saidas, format('Venda (entrega no ato)'),
      'venda', v.id, NULL, p_chave);
  END IF;
  IF jsonb_array_length(v_pendentes) > 0 THEN
    -- Sob encomenda: reserva só as unidades que existem; o restante aparece como "a produzir".
    v_reserva := app_private.reservar_estoque(v.empresa_id, p_usuario, 'venda', v.id, v_pendentes, p_chave);
  END IF;
  INSERT INTO app_private.contadores_empresa (empresa_id) VALUES (v.empresa_id) ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE app_private.contadores_empresa SET proxima_venda = proxima_venda + 1 WHERE empresa_id = v.empresa_id
  RETURNING proxima_venda - 1 INTO v_numero;
  UPDATE public.vendas SET estado = 'confirmada', numero = v_numero,
    entrega = CASE WHEN jsonb_array_length(v_pendentes) > 0 THEN 'pendente' ELSE 'entregue' END,
    condicao = coalesce(p_pagamento->>'condicao', 'a_vista'), confirmada_por = p_usuario, confirmada_em = now(),
    versao = versao + 1, atualizado_em = now()
   WHERE id = v.id RETURNING * INTO v;
  v_titulo := app_private.criar_titulo_venda(v, p_pagamento);
  IF p_pagamento ? 'recebimento_inicial' AND jsonb_typeof(p_pagamento->'recebimento_inicial') = 'object' THEN
    IF NOT (app_private.tem(v.empresa_id, p_usuario, 'vendas.registrar_recebimento') OR app_private.tem(v.empresa_id, p_usuario, 'financeiro.aprovar')) THEN
      PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar recebimentos.', 'recebimento_inicial');
    END IF;
    v_inicial := app_private.centavos(p_pagamento->'recebimento_inicial'->'valor_centavos', 'valor_centavos', true, 1);
    SELECT id INTO v_parcela FROM public.parcelas_financeiras WHERE titulo_id = v_titulo ORDER BY sequencia LIMIT 1;
    IF v_parcela IS NULL THEN
      PERFORM app_private.erro('VALIDATION_ERROR', 'Esta venda não tem valor a receber.', 'recebimento_inicial');
    END IF;
    v_receb := app_private.receber_parcela(v_parcela, v_inicial, p_pagamento->'recebimento_inicial'->>'forma',
      (now() AT TIME ZONE 'America/Sao_Paulo')::date, p_usuario, p_chave);
  END IF;
  PERFORM app_private.evento_comercial(v.empresa_id, 'venda_confirmada', p_usuario, 'venda', v.id,
    jsonb_build_object('numero', v.numero, 'total_centavos', app_private.para_centavos(v.total), 'origem', v.origem,
      'pendentes', jsonb_array_length(v_pendentes)), p_chave);
  PERFORM app_private.auditar(v.empresa_id, p_usuario, 'venda.confirmada', 'vendas', v.id,
    jsonb_build_object('numero', v.numero, 'total_centavos', app_private.para_centavos(v.total),
      'desconto_centavos', app_private.para_centavos(v.desconto_itens + v.desconto_geral)));
  RETURN jsonb_build_object('id', v.id, 'numero', v.numero, 'estado', v.estado, 'entrega', v.entrega,
    'total_centavos', app_private.para_centavos(v.total), 'titulo_id', v_titulo, 'reserva', v_reserva, 'recebimento', v_receb,
    'versao', v.versao);
END $$;

CREATE FUNCTION public.registrar_recebimento(p_parcela_id uuid, p_valor_centavos bigint, p_forma text, p_data date, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_parcela_id, p_valor_centavos, p_forma, p_data));
  anterior jsonb;
  v_empresa uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_recebimento', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT empresa_id INTO v_empresa FROM public.parcelas_financeiras WHERE id = p_parcela_id;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Parcela não encontrada.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = v_empresa AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.tem(v_empresa, usuario, 'vendas.registrar_recebimento') OR app_private.tem(v_empresa, usuario, 'financeiro.aprovar')) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar recebimentos.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  RETURN app_private.idem_fim(usuario, 'registrar_recebimento', p_operation_key, assinatura,
    app_private.receber_parcela(p_parcela_id, round(p_valor_centavos::numeric / 100, 2), p_forma,
      coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date), usuario, p_operation_key));
END $$;

CREATE FUNCTION public.registrar_devolucao_valor(p_titulo_id uuid, p_valor_centavos bigint, p_forma text, p_motivo text, p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  usuario text := app_private.exigir_usuario();
  assinatura text := md5(concat_ws('|', p_titulo_id, p_valor_centavos, p_forma, p_motivo));
  anterior jsonb;
  t public.titulos_financeiros;
  v_valor numeric;
  v_id uuid;
BEGIN
  anterior := app_private.idem_inicio(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura);
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  SELECT * INTO t FROM public.titulos_financeiros WHERE id = p_titulo_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_private.erro('NOT_FOUND', 'Registro financeiro não encontrado.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros_empresa WHERE empresa_id = t.empresa_id AND auth_user_id = usuario AND estado = 'ativo') THEN
    PERFORM app_private.erro('TENANT_FORBIDDEN', 'Você não tem acesso a esta empresa.');
  END IF;
  IF NOT (app_private.tem(t.empresa_id, usuario, 'vendas.registrar_recebimento') OR app_private.tem(t.empresa_id, usuario, 'financeiro.aprovar')) THEN
    PERFORM app_private.erro('FORBIDDEN_ACTION', 'Seu acesso não permite registrar devoluções de valor.');
  END IF;
  IF t.estado <> 'cancelado' THEN
    PERFORM app_private.erro('STATE_CONFLICT', 'Só há devolução de valor em venda cancelada.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0 THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Informe um valor maior que zero.', 'valor_centavos');
  END IF;
  v_valor := round(p_valor_centavos::numeric / 100, 2);
  IF v_valor > t.a_devolver THEN
    PERFORM app_private.erro('PAYMENT_EXCEEDS_BALANCE',
      format('O valor passa do que falta devolver (R$ %s).', to_char(t.a_devolver, 'FM999G999G990D00')), 'valor_centavos');
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro') THEN
    PERFORM app_private.erro('VALIDATION_ERROR', 'Escolha a forma da devolução.', 'forma');
  END IF;
  INSERT INTO public.recebimentos (empresa_id, titulo_id, parcela_id, conta_id, tipo, valor, forma, data, motivo, autor, operation_key)
  VALUES (t.empresa_id, t.id, NULL, app_private.conta_caixa(t.empresa_id), 'devolucao', v_valor, p_forma,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date, nullif(btrim(coalesce(p_motivo, '')), ''), usuario, p_operation_key) RETURNING id INTO v_id;
  UPDATE public.titulos_financeiros SET a_devolver = a_devolver - v_valor, versao = versao + 1 WHERE id = t.id;
  PERFORM app_private.evento_comercial(t.empresa_id, 'valor_devolvido', usuario, 'titulo', t.id,
    jsonb_build_object('valor_centavos', p_valor_centavos, 'forma', p_forma), p_operation_key);
  PERFORM app_private.auditar(t.empresa_id, usuario, 'venda.valor_devolvido', 'recebimentos', v_id, jsonb_build_object('valor_centavos', p_valor_centavos));
  RETURN app_private.idem_fim(usuario, 'registrar_devolucao_valor', p_operation_key, assinatura,
    jsonb_build_object('id', v_id, 'a_devolver_centavos', app_private.para_centavos(t.a_devolver - v_valor)));
END $$;

REVOKE ALL ON FUNCTION app_private.receber_parcela(uuid, numeric, text, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_recebimento(uuid, bigint, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento(uuid, bigint, text, date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_devolucao_valor(uuid, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao_valor(uuid, bigint, text, text, text) TO authenticated;

-- Políticas e GRANTs do M06.
GRANT SELECT ON public.contas_financeiras TO authenticated;
DROP POLICY titulos_ler ON public.titulos_financeiros;
CREATE POLICY titulos_ler ON public.titulos_financeiros FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
GRANT SELECT ON public.titulos_financeiros TO authenticated;
DROP POLICY parcelas_ler ON public.parcelas_financeiras;
CREATE POLICY parcelas_ler ON public.parcelas_financeiras FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));
DROP POLICY recebimentos_ler ON public.recebimentos;
CREATE POLICY recebimentos_ler ON public.recebimentos FOR SELECT TO authenticated
  USING ((SELECT authz.tem_permissao(empresa_id, 'vendas.visualizar')) OR (SELECT authz.tem_permissao(empresa_id, 'financeiro.visualizar')));

DELETE FROM app_private.historico_migracoes WHERE id = '202611120001';

COMMIT;
