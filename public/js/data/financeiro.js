/**
 * Financeiro (M07) sobre a Neon Data API: contas e caixas, livro-caixa, contas a pagar e a receber, recorrências,
 * transferências, aportes e retiradas, fechamento mensal, painel, relatórios e exportação.
 *
 * Quem decide é o banco (migration 202611120001): permissão atual (M04), período aberto (D7-13), saldo que nunca
 * fica negativo onde não é permitido (D7-03), chave de operação, versão. Dinheiro sai e volta em CENTAVOS inteiros.
 * Todos os valores são REGISTROS manuais e demonstrativos: nenhum dinheiro é movimentado (RF-140).
 */
import { neon } from './sessao.js';

const com = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// --- Contas e categorias --------------------------------------------------------
export const contas = (empresaId) => neon.rpc('contas_da_empresa', { p_empresa_id: empresaId });
export const criarConta = (empresaId, dados, chave) => neon.rpc('criar_conta', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const alterarConta = (contaId, dados, versao, chave) =>
  neon.rpc('alterar_conta', { p_conta_id: contaId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const definirContaAtiva = (contaId, ativa, versao, chave) =>
  neon.rpc('definir_conta_ativa', { p_conta_id: contaId, p_ativa: ativa, p_expected_version: versao, p_operation_key: chave });
export const definirContaPadrao = (contaId, versao, chave) =>
  neon.rpc('definir_conta_padrao', { p_conta_id: contaId, p_expected_version: versao, p_operation_key: chave });
export const categorias = (empresaId) => neon.rpc('categorias_financeiras_da_empresa', { p_empresa_id: empresaId });
export const criarCategoria = (empresaId, dados, chave) =>
  neon.rpc('criar_categoria_financeira', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const alterarCategoria = (categoriaId, dados, versao, chave) =>
  neon.rpc('alterar_categoria_financeira', { p_categoria_id: categoriaId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const definirCategoriaAtiva = (categoriaId, ativa, versao, chave) =>
  neon.rpc('definir_categoria_ativa', { p_categoria_id: categoriaId, p_ativa: ativa, p_expected_version: versao, p_operation_key: chave });

// --- Contas a pagar e a receber -------------------------------------------------
export const titulos = (empresaId, filtros = {}, limite = 50, deslocamento = 0) =>
  neon.rpc('titulos_da_empresa', { p_empresa_id: empresaId, p_filtros: filtros, p_limite: limite, p_deslocamento: deslocamento });
export const titulo = (tituloId) => neon.rpc('titulo_detalhe', { p_titulo_id: tituloId });
export const criarTitulo = (empresaId, dados, chave) => neon.rpc('criar_titulo', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const cancelarTitulo = (tituloId, motivo, versao, chave) =>
  neon.rpc('cancelar_titulo', { p_titulo_id: tituloId, p_motivo: motivo, p_expected_version: versao, p_operation_key: chave });
export const registrarRecebimento = (parcelaId, centavos, forma, data, chave, contaId) =>
  neon.rpc('registrar_recebimento', com({ p_parcela_id: parcelaId, p_valor_centavos: centavos, p_forma: forma, p_data: data || null,
    p_operation_key: chave, p_conta_id: contaId || undefined }));
export const estornarRecebimento = (recebimentoId, motivo, chave) =>
  neon.rpc('estornar_recebimento', { p_recebimento_id: recebimentoId, p_motivo: motivo, p_operation_key: chave });
export const registrarPagamento = (parcelaId, centavos, contaId, forma, data, chave) =>
  neon.rpc('registrar_pagamento', { p_parcela_id: parcelaId, p_valor_centavos: centavos, p_conta_id: contaId, p_forma: forma, p_data: data || null,
    p_operation_key: chave });
export const estornarPagamento = (pagamentoId, motivo, chave) =>
  neon.rpc('estornar_pagamento', { p_pagamento_id: pagamentoId, p_motivo: motivo, p_operation_key: chave });
export const comprasParaContaPagar = (empresaId) => neon.rpc('compras_para_conta_pagar', { p_empresa_id: empresaId });
export const gerarTituloCompra = (compraId, dados, chave) => neon.rpc('gerar_titulo_compra', { p_compra_id: compraId, p_dados: dados, p_operation_key: chave });

// --- Livro-caixa ----------------------------------------------------------------
export const lancamentos = (empresaId, filtros = {}, limite = 50, deslocamento = 0) =>
  neon.rpc('lancamentos_da_empresa', { p_empresa_id: empresaId, p_filtros: filtros, p_limite: limite, p_deslocamento: deslocamento });
export const registrarLancamento = (empresaId, dados, chave) => neon.rpc('registrar_lancamento', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const estornarLancamento = (lancamentoId, motivo, chave) =>
  neon.rpc('estornar_lancamento', { p_lancamento_id: lancamentoId, p_motivo: motivo, p_operation_key: chave });
export const transferir = (empresaId, dados, chave) => neon.rpc('transferir', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const estornarTransferencia = (transferenciaId, motivo, chave) =>
  neon.rpc('estornar_transferencia', { p_transferencia_id: transferenciaId, p_motivo: motivo, p_operation_key: chave });
export const registrarMovimentoProprietario = (empresaId, dados, chave) =>
  neon.rpc('registrar_movimento_proprietario', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });

// --- Recorrências ---------------------------------------------------------------
export const recorrencias = (empresaId) => neon.rpc('recorrencias_da_empresa', { p_empresa_id: empresaId });
export const criarRecorrencia = (empresaId, dados, chave) => neon.rpc('criar_recorrencia', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const alterarRecorrencia = (id, dados, versao, chave) =>
  neon.rpc('alterar_recorrencia', { p_recorrencia_id: id, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const definirRecorrenciaAtiva = (id, ativa, versao, chave) =>
  neon.rpc('definir_recorrencia_ativa', { p_recorrencia_id: id, p_ativa: ativa, p_expected_version: versao, p_operation_key: chave });
export const gerarRecorrencias = (empresaId) => neon.rpc('gerar_recorrencias', { p_empresa_id: empresaId });

// --- Fechamento, painel e relatórios --------------------------------------------
export const situacaoFechamento = (empresaId) => neon.rpc('situacao_fechamento', { p_empresa_id: empresaId });
export const fecharPeriodo = (empresaId, mes, conferencias, chave) =>
  neon.rpc('fechar_periodo', { p_empresa_id: empresaId, p_mes: mes, p_conferencias: conferencias, p_operation_key: chave });
export const reabrirPeriodo = (empresaId, motivo, chave) => neon.rpc('reabrir_periodo', { p_empresa_id: empresaId, p_motivo: motivo, p_operation_key: chave });
export const painel = (empresaId, de = null, ate = null) => neon.rpc('painel_financeiro', { p_empresa_id: empresaId, p_de: de, p_ate: ate });
export const relatorio = (empresaId, tipo, de = null, ate = null) =>
  neon.rpc('relatorio_financeiro', { p_empresa_id: empresaId, p_tipo: tipo, p_de: de, p_ate: ate });
export const exportar = (empresaId, tipo, de = null, ate = null) =>
  neon.rpc('exportar_financeiro', { p_empresa_id: empresaId, p_tipo: tipo, p_de: de, p_ate: ate });
export const reconciliar = (empresaId) => neon.rpc('reconciliar_financeiro', { p_empresa_id: empresaId });
