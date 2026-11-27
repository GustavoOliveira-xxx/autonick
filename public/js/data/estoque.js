/**
 * Produtos, variações, estoque, fornecedores e compras (M05) sobre a Neon Data API.
 *
 * Quem decide é o banco (migration 202611010008): permissão atual do M04, saldo
 * nunca negativo, aprovação, estorno, versão e chave de operação. Dinheiro sai e
 * volta em CENTAVOS inteiros (C-13); a tela só formata.
 */
import { neon } from './sessao.js';

const enc = encodeURIComponent;

// --- Leituras -------------------------------------------------------------------
export const produtosDaEmpresa = (empresaId) => neon.rpc('produtos_da_empresa', { p_empresa_id: empresaId });
export const alertasEstoque = (empresaId) => neon.rpc('alertas_estoque', { p_empresa_id: empresaId });
export const historicoMovimentacoes = (empresaId, variacaoId = null, limite = 100) =>
  neon.rpc('historico_movimentacoes', { p_empresa_id: empresaId, p_variacao_id: variacaoId, p_limite: limite });
export const propostas = (empresaId, estado = 'pendente') => neon.rpc('propostas_da_empresa', { p_empresa_id: empresaId, p_estado: estado });
export const custosDaVariacao = (variacaoId) => neon.rpc('custos_da_variacao', { p_variacao_id: variacaoId });
export const compras = (empresaId) => neon.rpc('compras_da_empresa', { p_empresa_id: empresaId });
export const fornecedores = (empresaId) =>
  neon.consultar(`/fornecedores?empresa_id=eq.${enc(empresaId)}&select=id,nome,documento,telefone,email,observacoes,ativo,versao&order=nome.asc`);
export const fornecedoresDaEmpresa = (empresaId, busca = null, situacao = 'ativos') =>
  neon.rpc('fornecedores_da_empresa', { p_empresa_id: empresaId, p_busca: busca || null, p_situacao: situacao });
export const historicoPrecos = (variacaoId) =>
  neon.consultar(`/historico_precos?variacao_id=eq.${enc(variacaoId)}&select=preco_anterior,preco_novo,motivo,criado_em&order=criado_em.desc`);

// --- Produtos e variações -------------------------------------------------------------
export const criarProduto = (empresaId, dados, variacoes, chave) =>
  neon.rpc('criar_produto', { p_empresa_id: empresaId, p_dados: dados, p_variacoes: variacoes, p_operation_key: chave });
export const alterarProduto = (produtoId, dados, versao, chave) =>
  neon.rpc('alterar_produto', { p_produto_id: produtoId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const pausarVenda = (produtoId, pausar, motivo, versao, chave) =>
  neon.rpc('pausar_venda_produto', { p_produto_id: produtoId, p_pausar: pausar, p_motivo: motivo || null, p_expected_version: versao, p_operation_key: chave });
export const definirProdutoAtivo = (produtoId, ativo, versao, chave) =>
  neon.rpc('definir_produto_ativo', { p_produto_id: produtoId, p_ativo: ativo, p_expected_version: versao, p_operation_key: chave });
export const adicionarVariacao = (produtoId, dados, chave) =>
  neon.rpc('adicionar_variacao', { p_produto_id: produtoId, p_dados: dados, p_operation_key: chave });
export const alterarVariacao = (variacaoId, dados, versao, chave) =>
  neon.rpc('alterar_variacao', { p_variacao_id: variacaoId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const definirVariacaoAtiva = (variacaoId, ativo, versao, chave) =>
  neon.rpc('definir_variacao_ativa', { p_variacao_id: variacaoId, p_ativo: ativo, p_expected_version: versao, p_operation_key: chave });
export const alterarPreco = (variacaoId, centavos, motivo, versao, chave) =>
  neon.rpc('alterar_preco', { p_variacao_id: variacaoId, p_preco_centavos: centavos, p_motivo: motivo || null, p_expected_version: versao, p_operation_key: chave });
export const alterarCusto = (variacaoId, centavos, motivo, versao, chave) =>
  neon.rpc('alterar_custo', { p_variacao_id: variacaoId, p_custo_centavos: centavos, p_motivo: motivo, p_expected_version: versao, p_operation_key: chave });

// --- Movimentações ------------------------------------------------------------------------
/** Quem tem `estoque.aprovar` registra direto (D5-04); os demais propõem. */
export const movimentar = (direto, empresaId, tipo, itens, motivo, chave) =>
  neon.rpc(direto ? 'registrar_movimentacao' : 'propor_movimentacao',
    { p_empresa_id: empresaId, p_tipo: tipo, p_itens: itens, p_motivo: motivo || null, p_operation_key: chave });
export const aprovarProposta = (id, versao, chave) =>
  neon.rpc('aprovar_proposta', { p_proposta_id: id, p_expected_version: versao, p_operation_key: chave });
export const decidirSemAplicar = (id, decisao, motivo, versao, chave) =>
  neon.rpc('decidir_proposta_sem_aplicar', { p_proposta_id: id, p_decisao: decisao, p_motivo: motivo || null, p_expected_version: versao, p_operation_key: chave });
export const estornar = (movimentacaoId, motivo, chave) =>
  neon.rpc('estornar_movimentacao', { p_movimentacao_id: movimentacaoId, p_motivo: motivo, p_operation_key: chave });

// --- Fornecedores e compras -----------------------------------------------------------------
export const criarFornecedor = (empresaId, dados, chave) =>
  neon.rpc('criar_fornecedor', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const alterarFornecedor = (id, dados, versao, chave) =>
  neon.rpc('alterar_fornecedor', { p_fornecedor_id: id, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const criarCompra = (empresaId, dados, itens, chave) =>
  neon.rpc('criar_compra', { p_empresa_id: empresaId, p_dados: dados, p_itens: itens, p_operation_key: chave });
export const registrarCompra = (id, versao, chave) =>
  neon.rpc('registrar_compra', { p_compra_id: id, p_expected_version: versao, p_operation_key: chave });
export const cancelarCompra = (id, motivo, versao, chave) =>
  neon.rpc('cancelar_compra', { p_compra_id: id, p_motivo: motivo, p_expected_version: versao, p_operation_key: chave });

// --- Textos ---------------------------------------------------------------------------
export const FINALIDADES = { comercializavel: 'Comercializável', uso_interno: 'Uso interno (insumo)' };
export const TIPOS_MOVIMENTACAO = {
  saldo_inicial: 'Estoque inicial', entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste', estorno: 'Estorno',
};
export const ESTADOS_PROPOSTA = { pendente: 'Aguardando aprovação', aprovada: 'Aplicada', rejeitada: 'Rejeitada', cancelada: 'Cancelada' };
export const ESTADOS_COMPRA = { rascunho: 'Rascunho', registrada: 'Aguardando aprovação da entrada', recebida: 'Recebida', cancelada: 'Cancelada' };
