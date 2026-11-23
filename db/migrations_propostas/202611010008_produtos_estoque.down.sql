-- Rollback da 202611010008 (M05). Somente no branch de desenvolvimento, sem dados reais:
-- remove produtos, estoque, fornecedores, compras e históricos do M05. A auditoria (app_private.eventos_auditoria) é preservada.
BEGIN;

DROP FUNCTION IF EXISTS public.criar_produto(uuid, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.alterar_produto(uuid, jsonb, integer, text);
DROP FUNCTION IF EXISTS public.pausar_venda_produto(uuid, boolean, text, integer, text);
DROP FUNCTION IF EXISTS public.definir_produto_ativo(uuid, boolean, integer, text);
DROP FUNCTION IF EXISTS public.adicionar_variacao(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.alterar_variacao(uuid, jsonb, integer, text);
DROP FUNCTION IF EXISTS public.definir_variacao_ativa(uuid, boolean, integer, text);
DROP FUNCTION IF EXISTS public.alterar_preco(uuid, bigint, text, integer, text);
DROP FUNCTION IF EXISTS public.alterar_custo(uuid, bigint, text, integer, text);
DROP FUNCTION IF EXISTS public.propor_movimentacao(uuid, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.registrar_movimentacao(uuid, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.aprovar_proposta(uuid, integer, text);
DROP FUNCTION IF EXISTS public.decidir_proposta_sem_aplicar(uuid, text, text, integer, text);
DROP FUNCTION IF EXISTS public.estornar_movimentacao(uuid, text, text);
DROP FUNCTION IF EXISTS public.criar_fornecedor(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.alterar_fornecedor(uuid, jsonb, integer, text);
DROP FUNCTION IF EXISTS public.criar_compra(uuid, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.registrar_compra(uuid, integer, text);
DROP FUNCTION IF EXISTS public.cancelar_compra(uuid, text, integer, text);
DROP FUNCTION IF EXISTS public.produtos_da_empresa(uuid);
DROP FUNCTION IF EXISTS public.alertas_estoque(uuid);
DROP FUNCTION IF EXISTS public.historico_movimentacoes(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.propostas_da_empresa(uuid, text);
DROP FUNCTION IF EXISTS public.custos_da_variacao(uuid);
DROP FUNCTION IF EXISTS public.compras_da_empresa(uuid);
DROP FUNCTION IF EXISTS public.reconciliar_estoque(uuid);

DROP FUNCTION IF EXISTS app_private.reservar_estoque(uuid, text, text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS app_private.liberar_reservas(uuid, text, text, uuid, text);
DROP FUNCTION IF EXISTS app_private.consumir_reservas(uuid, text, text, uuid, text);
DROP FUNCTION IF EXISTS app_private.divergencias_estoque(uuid);
DROP FUNCTION IF EXISTS app_private.validar_fornecedor(public.fornecedores, jsonb);
DROP FUNCTION IF EXISTS app_private.criar_proposta(uuid, text, text, jsonb, text, uuid, boolean, text);
DROP FUNCTION IF EXISTS app_private.itens_para_aplicar(uuid, text);
DROP FUNCTION IF EXISTS app_private.aplicar_itens(uuid, text, text, jsonb, text, text, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS app_private.criar_variacao(uuid, uuid, text, jsonb, boolean);
DROP FUNCTION IF EXISTS app_private.aplicar_dados_produto(public.produtos, jsonb, boolean);
DROP FUNCTION IF EXISTS app_private.produto_da_empresa_trava(uuid);
DROP FUNCTION IF EXISTS app_private.variacao_da_empresa(uuid, uuid);
DROP FUNCTION IF EXISTS app_private.tem(uuid, text, text);
DROP FUNCTION IF EXISTS app_private.registrar_evento_estoque(uuid, text, text, text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS app_private.rotulo_variacao(jsonb, boolean);
DROP FUNCTION IF EXISTS app_private.normalizar_atributos(jsonb);
DROP FUNCTION IF EXISTS app_private.quantidade(jsonb, text, boolean);
DROP FUNCTION IF EXISTS app_private.para_centavos(numeric);
DROP FUNCTION IF EXISTS app_private.centavos(jsonb, text, boolean, bigint);

DROP TABLE IF EXISTS public.eventos_estoque;
DROP TABLE IF EXISTS public.historico_custos;
DROP TABLE IF EXISTS public.historico_precos;
DROP TABLE IF EXISTS public.reservas_estoque;
DROP TABLE IF EXISTS public.movimentacoes_estoque;
DROP TABLE IF EXISTS public.proposta_itens;
ALTER TABLE IF EXISTS public.compras_fornecedor DROP CONSTRAINT IF EXISTS compras_fornecedor_empresa_id_proposta_id_fkey;
DROP TABLE IF EXISTS public.propostas_movimentacao;
DROP TABLE IF EXISTS public.compra_itens;
DROP TABLE IF EXISTS public.compras_fornecedor;
DROP TABLE IF EXISTS public.saldos_estoque;
DROP TABLE IF EXISTS public.produto_variacoes;
DROP TABLE IF EXISTS public.produtos;
DROP TABLE IF EXISTS public.fornecedores;

DELETE FROM public.perfil_permissoes WHERE codigo IN ('fornecedores.visualizar', 'fornecedores.alterar');
DELETE FROM public.permissoes_catalogo WHERE codigo IN ('fornecedores.visualizar', 'fornecedores.alterar');
DELETE FROM app_private.historico_migracoes WHERE id = '202611010008';

COMMIT;
