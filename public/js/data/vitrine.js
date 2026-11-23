/**
 * Vitrine pública e área de demonstração (M10) sobre a Neon Data API.
 *
 * Rota pública (D10-01): só `filtros_vitrine`, `buscar_vitrine` e `vitrine_publica`, executáveis pelo papel `anonymous`.
 * As chamadas da rota pública nunca levam parâmetro de conjunto: dados fictícios nunca entram nela (DF-06). O perfil
 * é pedido com token quando há sessão, porque só então o banco inclui os contatos públicos configurados (D10-20).
 * A área de demonstração usa funções próprias, que o banco libera só para conta fictícia autorizada (D10-14, D10-25).
 */
import { neon } from './sessao.js';

export const filtrosVitrine = () => neon.rpcPublica('filtros_vitrine', {});
export const buscarVitrine = (filtros, pagina = 1) => neon.rpcPublica('buscar_vitrine', { p_filtros: filtros, p_pagina: pagina });
export async function vitrinePublica(empresaId) {
  const corpo = { p_empresa_id: empresaId };
  return (await neon.temSessao()) ? neon.rpc('vitrine_publica', corpo) : neon.rpcPublica('vitrine_publica', corpo);
}

export const filtrosDemonstracao = () => neon.rpc('filtros_demonstracao', {});
export const buscarDemonstracao = (filtros, pagina = 1) => neon.rpc('buscar_demonstracao', { p_filtros: filtros, p_pagina: pagina });
export const vitrineDemonstracao = (empresaId) => neon.rpc('vitrine_demonstracao', { p_empresa_id: empresaId });
export const minhaAutorizacaoDemonstracao = () => neon.rpc('minha_autorizacao_demonstracao', {});

// Gestor: liga e desliga a exibição na vitrine (D10-03 = C, D10-04 = B). Desligada por padrão.
export const definirVitrineProduto = (produtoId, exibir, versao, chave) =>
  neon.rpc('definir_vitrine_produto', { p_produto_id: produtoId, p_exibir: exibir, p_expected_version: versao, p_operation_key: chave });
export const definirVitrineServico = (servicoId, exibir, versao, chave) =>
  neon.rpc('definir_vitrine_servico', { p_servico_id: servicoId, p_exibir: exibir, p_expected_version: versao, p_operation_key: chave });

// CK: limites da plataforma (P-M08-02; D10-23 = A).
export const ckLimites = () => neon.rpc('ck_limites', {});
export const ckDefinirLimite = (chaveLimite, valor, motivo, chave) =>
  neon.rpc('ck_definir_limite', { p_chave: chaveLimite, p_valor: valor, p_motivo: motivo, p_operation_key: chave });
export const ckHistoricoLimites = () => neon.rpc('ck_historico_limites', {});

export const POLITICA_VITRINE = { fixo: 'Preço fixo', a_partir_de: 'A partir de', sob_consulta: 'Sob consulta', por_regras: 'Estimativa ao responder o formulário', pacote: 'Pacote' };
export const MODALIDADE = { comercio: 'Comércio', servicos: 'Serviços', ambos: 'Comércio e serviços' };
export const FAIXA = { mesmo_bairro: 'Neste bairro', mesma_cidade: 'Nesta cidade', outros: 'Outros resultados' };
export const NOME_LIMITE = {
  solicitacoes_abertas_por_empresa: 'Solicitações abertas por cliente em cada empresa',
  solicitacoes_novas_por_dia: 'Solicitações novas por cliente por dia',
  reagendamentos_pendentes_por_os: 'Pedidos de reagendamento pendentes por OS',
  reagendamentos_por_os: 'Pedidos de reagendamento por OS',
  mensagens_por_conversa_dia: 'Mensagens por participante em cada conversa por dia',
  denuncias_por_dia: 'Denúncias por conta por dia',
};
