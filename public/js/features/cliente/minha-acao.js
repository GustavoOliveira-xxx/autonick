/**
 * Início do Cliente logado (M11, D11-04; UI-002 e RF-157): na mesma busca, um bloco curto "Precisa da sua ação" e
 * "Em andamento", só com pendências da PRÓPRIA conta (as funções minhas_* e meus_* já filtram pelo titular no banco).
 * Sem tabela nova e sem cópia no aparelho. Visitante não vê o bloco.
 */
import { el } from '../../ui/dom.js';
import { neon } from '../../data/sessao.js';
import { minhasSolicitacoes } from '../../data/servicos.js';
import { minhasOrdens } from '../../data/ordens.js';
import { meusPedidos } from '../../data/vendas.js';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export async function mostrarMinhaAcao(secao) {
  if (!secao || !neon.configurado || !(await neon.temSessao())) return;
  let perfis;
  try {
    perfis = await neon.meusPerfis();
  } catch {
    return;
  }
  if (!perfis.some((p) => p.tipo_conta === 'cliente')) return;
  let sol;
  let os;
  let ped;
  try {
    [sol, os, ped] = await Promise.all([minhasSolicitacoes(), minhasOrdens(), meusPedidos()]);
  } catch {
    secao.hidden = false;
    secao.replaceChildren(el('h2', { id: 'titulo-minha-acao' }, 'Precisa da sua ação'),
      el('p', { class: 'campo__ajuda' }, 'Não foi possível carregar seus atendimentos agora. Veja em Minhas solicitações, Meus serviços e Meus pedidos.'));
    return;
  }
  const acoes = [];
  const orcamentos = sol.filter((s) => s.estado_exibicao === 'orcamento_enviado' && !s.suspensao).length;
  if (orcamentos) acoes.push(['/cliente/solicitacoes.html', plural(orcamentos, 'orçamento disponível para você responder', 'orçamentos disponíveis para você responder'), 'orcamentos']);
  const contar = (acao) => os.filter((o) => o.acao_pendente === acao).length;
  if (contar('responder_horario')) acoes.push(['/cliente/ordens.html', plural(contar('responder_horario'), 'horário proposto pela empresa', 'horários propostos pela empresa'), 'horarios']);
  if (contar('responder_custos')) acoes.push(['/cliente/ordens.html', plural(contar('responder_custos'), 'proposta de custos para responder', 'propostas de custos para responder'), 'custos']);
  if (contar('confirmar_recebimento')) acoes.push(['/cliente/ordens.html', plural(contar('confirmar_recebimento'), 'serviço concluído para confirmar', 'serviços concluídos para confirmar'), 'recebimentos']);
  const suspensas = [...sol, ...os, ...ped].filter((x) => x.suspensao).length;
  if (suspensas) acoes.push(['/cliente/solicitacoes.html', plural(suspensas, 'atendimento com empresa de vitrine suspensa', 'atendimentos com empresa de vitrine suspensa'), 'suspensoes']);

  const abertasSol = sol.filter((s) => ['nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida'].includes(s.estado)).length;
  const ativasOs = os.filter((o) => ['aguardando_inicio', 'em_execucao', 'pausada', 'concluida'].includes(o.estado)).length;
  const pedidosAbertos = ped.filter((p) => ['solicitado', 'aceito'].includes(p.estado)).length;
  if (!acoes.length && !abertasSol && !ativasOs && !pedidosAbertos) return;

  secao.hidden = false;
  secao.replaceChildren(
    el('h2', { id: 'titulo-minha-acao' }, 'Precisa da sua ação'),
    acoes.length
      ? el('ul', { class: 'lista-simples', id: 'lista-minha-acao' }, ...acoes.map(([href, texto, tipo]) => el('li', { 'data-acao-cliente': tipo }, el('a', { href }, texto))))
      : el('p', { id: 'lista-minha-acao' }, 'Nada pendente com você agora.'),
    el('h3', {}, 'Em andamento'),
    el('ul', { class: 'lista-simples', id: 'em-andamento' },
      el('li', {}, el('a', { href: '/cliente/solicitacoes.html' }, plural(abertasSol, 'solicitação de orçamento aberta', 'solicitações de orçamento abertas'))),
      el('li', {}, el('a', { href: '/cliente/ordens.html' }, plural(ativasOs, 'serviço em andamento', 'serviços em andamento'))),
      el('li', {}, el('a', { href: '/cliente/pedidos.html' }, plural(pedidosAbertos, 'pedido em andamento', 'pedidos em andamento')))));
}
