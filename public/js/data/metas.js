/** Metas mensais (E06): o realizado vem do banco, calculado das vendas e OS reais. */
import { neon } from './sessao.js';

export const metasDaEmpresa = (empresaId, mes = null) => neon.rpc('metas_da_empresa', { p_empresa_id: empresaId, p_mes: mes });
export const definirMeta = (empresaId, tipo, mes, alvo, chave) =>
  neon.rpc('definir_meta', { p_empresa_id: empresaId, p_tipo: tipo, p_mes: mes, p_alvo: alvo, p_operation_key: chave });
export const TIPOS_META = {
  receita_vendas: { nome: 'Receita de vendas', unidade: 'reais', ajuda: 'Soma das vendas confirmadas no mês.' },
  vendas_qtd: { nome: 'Vendas confirmadas', unidade: 'vendas', ajuda: 'Quantidade de vendas confirmadas no mês.' },
  os_concluidas: { nome: 'Ordens de serviço concluídas', unidade: 'OS', ajuda: 'OS marcadas como concluídas no mês.' },
};
