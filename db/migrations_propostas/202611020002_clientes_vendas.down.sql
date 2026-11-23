-- Rollback da 202611020002 (M06). Somente no branch de desenvolvimento, sem dados reais.
-- Recusa se já houver venda confirmada ou cancelada, pedido respondido ou movimentação de estoque de venda:
-- nesse caso o estoque e o financeiro já dependem do M06 e a reversão exige decisão humana.
-- A auditoria (app_private.eventos_auditoria) é preservada.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.vendas WHERE estado <> 'rascunho')
     OR EXISTS (SELECT 1 FROM public.pedidos WHERE estado <> 'solicitado')
     OR EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE origem_tipo IN ('venda', 'devolucao_venda'))
     OR EXISTS (SELECT 1 FROM public.reservas_estoque WHERE origem_tipo IN ('venda', 'pedido') AND estado = 'ativa') THEN
    RAISE EXCEPTION 'Rollback recusado: já há vendas, pedidos respondidos, reservas ou movimentações do M06.'
      USING HINT = 'STATE_CONFLICT';
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname || '.' || p.proname = ANY (ARRAY[
    'app_private.proteger_itens_venda',    'app_private.proteger_venda',    'app_private.evento_comercial',    'app_private.conta_caixa',    'app_private.variacao_vendavel',    'app_private.ler_itens',    'app_private.limite_desconto',    'app_private.gravar_itens_venda',    'app_private.conferir_desconto',    'app_private.criar_titulo_venda',    'app_private.receber_parcela',    'app_private.encerrar_reserva_item',    'app_private.travar_saldos_venda',    'app_private.confirmar_venda_nucleo',    'app_private.validar_cliente',    'public.criar_cliente',    'public.alterar_cliente',    'public.definir_cliente_ativo',    'public.clientes_da_empresa',    'public.historico_do_cliente',    'public.definir_desconto_maximo',    'public.meu_limite_desconto',    'app_private.dados_venda',    'app_private.resumo_venda',    'app_private.criar_rascunho',    'public.criar_venda',    'public.alterar_venda',    'public.descartar_venda',    'public.confirmar_venda',    'public.registrar_venda_direta',    'public.registrar_entrega',    'public.cancelar_venda',    'public.registrar_recebimento',    'public.estornar_recebimento',    'public.registrar_devolucao_valor',    'app_private.empresa_recebe_pedido',    'app_private.exigir_perfil_cliente',    'app_private.resumo_pedido',    'public.empresas_para_pedido',    'public.itens_para_pedido',    'public.criar_pedido',    'public.aceitar_pedido',    'public.recusar_pedido',    'public.cancelar_pedido',    'public.concluir_pedido',    'app_private.situacao_pagamento',    'public.catalogo_para_venda',    'public.vendas_da_empresa',    'public.venda_detalhe',    'public.pedidos_da_empresa',    'public.meus_pedidos',    'public.operacoes_da_empresa',    'authz.eh_meu_pedido']) LOOP
    EXECUTE format('DROP FUNCTION %s CASCADE', f);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.recebimentos;
DROP TABLE IF EXISTS public.parcelas_financeiras;
DROP TABLE IF EXISTS public.titulos_financeiros;
DROP TABLE IF EXISTS public.contas_financeiras;
DROP TABLE IF EXISTS public.eventos_comerciais;
DROP TABLE IF EXISTS public.venda_itens;
ALTER TABLE IF EXISTS public.pedidos DROP CONSTRAINT IF EXISTS pedidos_empresa_id_venda_id_fkey;
DROP TABLE IF EXISTS public.vendas;
DROP TABLE IF EXISTS public.pedido_itens;
DROP TABLE IF EXISTS public.pedidos;
DROP TABLE IF EXISTS app_private.contadores_empresa;
DROP TABLE IF EXISTS public.clientes_empresa;

ALTER TABLE public.movimentacoes_estoque DROP CONSTRAINT movimentacoes_estoque_origem_tipo_check;
ALTER TABLE public.movimentacoes_estoque ADD CONSTRAINT movimentacoes_estoque_origem_tipo_check
  CHECK (origem_tipo IN ('proposta', 'estorno', 'reserva'));

ALTER TABLE public.perfis_permissao DROP COLUMN IF EXISTS desconto_maximo_percentual;
DELETE FROM public.perfil_permissoes WHERE codigo = 'vendas.registrar_recebimento';
DELETE FROM public.permissoes_catalogo WHERE codigo = 'vendas.registrar_recebimento';

DELETE FROM app_private.historico_migracoes WHERE id = '202611020002';

COMMIT;
