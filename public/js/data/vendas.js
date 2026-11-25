/**
 * Clientes da empresa, vendas, pedidos externos, a receber e recebimentos (M06) sobre a Neon Data API.
 *
 * Quem decide é o banco (migration 202611020002): permissão atual (M04), preço do catálogo (D6-05),
 * limite de desconto (D6-04), estoque nunca negativo (M05), sob encomenda com entrega pendente (D6-08),
 * versão e chave de operação. Dinheiro sai e volta em CENTAVOS inteiros; a tela só formata.
 * O navegador nunca envia preço nem total: só variação, quantidade e o desconto pedido.
 */
import { neon } from './sessao.js';

// --- Clientes da empresa --------------------------------------------------------
export const clientes = (empresaId, busca = null, limite = 50, deslocamento = 0) =>
  neon.rpc('clientes_da_empresa', { p_empresa_id: empresaId, p_busca: busca || null, p_limite: limite, p_deslocamento: deslocamento });
export const historicoCliente = (clienteId) => neon.rpc('historico_do_cliente', { p_cliente_id: clienteId });
export const criarCliente = (empresaId, dados, chave) => neon.rpc('criar_cliente', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const alterarCliente = (clienteId, dados, versao, chave) =>
  neon.rpc('alterar_cliente', { p_cliente_id: clienteId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const definirClienteAtivo = (clienteId, ativo, versao, chave) =>
  neon.rpc('definir_cliente_ativo', { p_cliente_id: clienteId, p_ativo: ativo, p_expected_version: versao, p_operation_key: chave });

// --- Desconto -------------------------------------------------------------------
export const meuLimiteDesconto = (empresaId) => neon.rpc('meu_limite_desconto', { p_empresa_id: empresaId });
export const definirDescontoMaximo = (perfilId, percentual, versao, chave) =>
  neon.rpc('definir_desconto_maximo', { p_perfil_id: perfilId, p_percentual: percentual, p_expected_version: versao, p_operation_key: chave });

// --- Vendas ---------------------------------------------------------------------
export const catalogoParaVenda = (empresaId, busca = null) => neon.rpc('catalogo_para_venda', { p_empresa_id: empresaId, p_busca: busca || null });
export const vendas = (empresaId, filtros = {}, limite = 50, deslocamento = 0) =>
  neon.rpc('vendas_da_empresa', { p_empresa_id: empresaId, p_filtros: filtros, p_limite: limite, p_deslocamento: deslocamento });
export const venda = (vendaId) => neon.rpc('venda_detalhe', { p_venda_id: vendaId });
export const operacoes = (empresaId, limite = 50) => neon.rpc('operacoes_da_empresa', { p_empresa_id: empresaId, p_limite: limite });

export const criarVenda = (empresaId, dados, itens, chave) =>
  neon.rpc('criar_venda', { p_empresa_id: empresaId, p_dados: dados, p_itens: itens, p_operation_key: chave });
export const alterarVenda = (vendaId, dados, itens, versao, chave) =>
  neon.rpc('alterar_venda', { p_venda_id: vendaId, p_dados: dados, p_itens: itens, p_expected_version: versao, p_operation_key: chave });
export const descartarVenda = (vendaId, versao, chave) =>
  neon.rpc('descartar_venda', { p_venda_id: vendaId, p_expected_version: versao, p_operation_key: chave });
export const confirmarVenda = (vendaId, pagamento, totalEsperado, versao, chave) =>
  neon.rpc('confirmar_venda', { p_venda_id: vendaId, p_pagamento: pagamento, p_total_esperado_centavos: totalEsperado, p_expected_version: versao, p_operation_key: chave });
export const registrarVendaDireta = (empresaId, dados, itens, pagamento, totalEsperado, chave) =>
  neon.rpc('registrar_venda_direta', { p_empresa_id: empresaId, p_dados: dados, p_itens: itens, p_pagamento: pagamento,
    p_total_esperado_centavos: totalEsperado, p_operation_key: chave });
export const registrarEntrega = (vendaId, versao, chave) =>
  neon.rpc('registrar_entrega', { p_venda_id: vendaId, p_expected_version: versao, p_operation_key: chave });
export const cancelarVenda = (vendaId, motivo, destinos, versao, chave) =>
  neon.rpc('cancelar_venda', { p_venda_id: vendaId, p_motivo: motivo, p_destinos: destinos, p_expected_version: versao, p_operation_key: chave });

// --- Recebimentos ---------------------------------------------------------------
// M07 (D7-16): a conta é opcional; sem ela, o valor vai para a conta padrão da empresa.
export const registrarRecebimento = (parcelaId, centavos, forma, data, chave, contaId = null) =>
  neon.rpc('registrar_recebimento', { p_parcela_id: parcelaId, p_valor_centavos: centavos, p_forma: forma, p_data: data || null, p_operation_key: chave,
    ...(contaId ? { p_conta_id: contaId } : {}) });
export const estornarRecebimento = (recebimentoId, motivo, chave) =>
  neon.rpc('estornar_recebimento', { p_recebimento_id: recebimentoId, p_motivo: motivo, p_operation_key: chave });
export const registrarDevolucaoValor = (tituloId, centavos, forma, motivo, chave, contaId = null) =>
  neon.rpc('registrar_devolucao_valor', { p_titulo_id: tituloId, p_valor_centavos: centavos, p_forma: forma, p_motivo: motivo || null, p_operation_key: chave,
    ...(contaId ? { p_conta_id: contaId } : {}) });

// --- Pedidos externos -----------------------------------------------------------
export const pedidosDaEmpresa = (empresaId, estado = null, limite = 50) =>
  neon.rpc('pedidos_da_empresa', { p_empresa_id: empresaId, p_estado: estado, p_limite: limite });
export const aceitarPedido = (pedidoId, versao, chave) => neon.rpc('aceitar_pedido', { p_pedido_id: pedidoId, p_expected_version: versao, p_operation_key: chave });
export const recusarPedido = (pedidoId, motivo, versao, chave) =>
  neon.rpc('recusar_pedido', { p_pedido_id: pedidoId, p_motivo: motivo, p_expected_version: versao, p_operation_key: chave });
export const cancelarPedido = (pedidoId, motivo, versao, chave) =>
  neon.rpc('cancelar_pedido', { p_pedido_id: pedidoId, p_motivo: motivo || null, p_expected_version: versao, p_operation_key: chave });
export const concluirPedido = (pedidoId, pagamento, versao, chave) =>
  neon.rpc('concluir_pedido', { p_pedido_id: pedidoId, p_pagamento: pagamento, p_expected_version: versao, p_operation_key: chave });

// Lado do cliente (conta com perfil Cliente)
export const empresasParaPedido = () => neon.rpc('empresas_para_pedido', {});
export const itensParaPedido = (empresaId) => neon.rpc('itens_para_pedido', { p_empresa_id: empresaId });
export const criarPedido = (empresaId, itens, observacao, chave) =>
  neon.rpc('criar_pedido', { p_empresa_id: empresaId, p_itens: itens, p_observacao: observacao || null, p_operation_key: chave });
export const meusPedidos = () => neon.rpc('meus_pedidos', {});

// --- Textos ---------------------------------------------------------------------
export const FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['debito', 'Cartão de débito'], ['credito', 'Cartão de crédito'],
  ['boleto', 'Boleto'], ['transferencia', 'Transferência'], ['outro', 'Outro']];
export const FORMA = Object.fromEntries(FORMAS);
export const ESTADO_VENDA = { rascunho: 'Rascunho', confirmada: 'Confirmada', cancelada: 'Cancelada' };
export const ENTREGA = { entregue: 'Entregue', pendente: 'Entrega pendente', cancelada: 'Entrega cancelada' };
export const ORIGEM = { balcao: 'Balcão', pedido: 'Pedido externo', externo: 'Pedido externo' };
export const PAGAMENTO = { aberto: 'A receber', parcial: 'Recebido em parte', liquidado: 'Recebido', cancelado: 'Cancelado' };
export const ESTADO_PEDIDO = { solicitado: 'Aguardando aceite', aceito: 'Aceito', recusado: 'Recusado', cancelado: 'Cancelado', concluido: 'Concluído' };
export const DESTINOS = [['voltou', 'Voltou ao estoque'], ['nao_voltou', 'Não voltou'], ['danificado', 'Voltou danificado (não volta à venda)']];
export const DESTINO = { ...Object.fromEntries(DESTINOS), nao_entregue: 'Não entregue (reserva liberada)' };
export const EVENTOS = {
  venda_rascunho_criado: 'Rascunho criado', venda_rascunho_alterado: 'Rascunho alterado', venda_confirmada: 'Venda confirmada',
  venda_entregue: 'Entrega registrada', venda_cancelada: 'Venda cancelada', recebimento_registrado: 'Recebimento registrado',
  recebimento_estornado: 'Recebimento estornado', valor_devolvido: 'Valor devolvido ao cliente',
};

/** Prévia do total (só exibição; o banco recalcula e confere o total esperado na confirmação). */
export function previaTotal(itens, descontoGeral = 0) {
  const subtotal = itens.reduce((t, i) => t + i.preco_centavos * i.quantidade, 0);
  const descontos = itens.reduce((t, i) => t + (i.desconto_centavos || 0), 0);
  return { subtotal, descontos: descontos + descontoGeral, total: subtotal - descontos - descontoGeral };
}

/** Divide um total em parcelas iguais em centavos; a diferença de arredondamento vai para a primeira. */
export function dividirParcelas(totalCentavos, n) {
  const base = Math.floor(totalCentavos / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? totalCentavos - base * n : 0));
}
export const fichaCliente = (clienteId) => neon.rpc('ficha_cliente', { p_cliente_id: clienteId });
