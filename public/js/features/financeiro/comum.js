/**
 * Utilidades das telas do financeiro (M07). A tela só orienta e esconde o que a pessoa não pode fazer;
 * quem decide é o banco (permissão atual, período aberto, saldo, versão e chave de operação).
 */
import { el } from '../../ui/dom.js';
import { aviso } from '../../ui/estados.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { ESTADO_EXIBICAO } from '../../domain/financeiro.js';
import { semAcesso } from '../empresa/comum.js';
import { carregarContexto, navegacaoEmpresa, novaChave } from '../estoque/comum.js';

export { carregarContexto, navegacaoEmpresa, criarAnunciador, novaChave } from '../estoque/comum.js';
export { dinheiro, dataDeHoje, formatarData, somarDias, dialogoFormulario } from '../vendas/comum.js';
export { FORMAS, FORMA } from '../../data/vendas.js';

export const ehProprietario = (ctx) => ctx?.acesso?.papel === 'proprietario';

/** Contexto da empresa com a exigência de ver o financeiro (financeiro.visualizar). */
export async function carregarFinanceiro(area, nav, atual) {
  const ctx = await carregarContexto(area);
  if (!ctx) return null;
  nav.replaceChildren(navegacaoEmpresa(ctx, 'financeiro'), navegacaoFinanceiro(ctx, atual));
  if (!ctx.pode('financeiro.visualizar')) {
    area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui o financeiro desta empresa.',
      el('p', {}, 'Peça ao proprietário a permissão "Ver financeiro", se precisar.'))));
    nav.replaceChildren(navegacaoEmpresa(ctx, 'financeiro'));
    return null;
  }
  return ctx;
}

/** Navegação interna do financeiro. */
export function navegacaoFinanceiro(ctx, atual) {
  const id = encodeURIComponent(ctx.id);
  const itens = [
    ['painel', `/business/financeiro.html?id=${id}`, 'Painel'],
    ['titulos', `/business/financeiro-contas.html?id=${id}`, 'A pagar e a receber'],
    ['movimentacoes', `/business/financeiro-movimentacoes.html?id=${id}`, 'Movimentações'],
    ['fechamento', `/business/financeiro-fechamento.html?id=${id}`, 'Fechamento do mês'],
    ['relatorios', `/business/financeiro-relatorios.html?id=${id}`, 'Relatórios'],
    ['configuracoes', `/business/financeiro-configuracoes.html?id=${id}`, 'Contas, categorias e recorrências'],
  ];
  return el('nav', { class: 'navegacao-local', 'aria-label': 'Seções do financeiro' },
    el('ul', { class: 'opcoes' }, ...itens.map(([chave, href, rotulo]) => el('li', {},
      el('a', { href, class: 'botao botao--texto', 'aria-current': chave === atual ? 'page' : null }, rotulo)))));
}

/** Lembrete fixo (RF-140, FIN-I29): o sistema registra; não movimenta dinheiro. */
export const avisoRegistro = () => el('p', { class: 'campo__ajuda', id: 'aviso-registro' },
  'Os valores são registrados à mão aqui. Nenhum dinheiro é movimentado pela AutoniCK, e nenhum banco é consultado.');

export const chipEstado = (estado) => el('span', {
  class: `chip ${{ vencido: 'chip--erro', parcial: 'chip--alerta', pendente: 'chip--info', liquidado: 'chip--sucesso', previsto: 'chip--neutro', cancelado: 'chip--neutro' }[estado] ?? 'chip--neutro'}`,
}, el('span', { 'aria-hidden': 'true' }, { vencido: '!', liquidado: '✓', cancelado: '✕' }[estado] ?? '•'), ESTADO_EXIBICAO[estado] ?? estado);

export const opcoesContas = (lista) => lista.filter((c) => c.ativa).map((c) => [c.id, c.padrao ? `${c.nome} (padrão)` : c.nome]);
export const contaPadrao = (lista) => lista.find((c) => c.padrao && c.ativa)?.id ?? '';
export const opcoesCategorias = (lista, tipo) => lista.filter((c) => c.ativa && c.tipo === tipo).map((c) => [c.id, c.nome]);

/** Lê um valor em reais do formulário e marca o erro ao lado do campo. Devolve centavos ou null. */
export function centavosDoCampo(form, nome, erroNoCampo, { obrigatorio = true, minimo = 1 } = {}) {
  const texto = form.elements[nome]?.value ?? '';
  if (!obrigatorio && !texto.trim()) return 0;
  const r = lerValorEmReais(texto);
  if (!r.ok) { erroNoCampo(form, nome, r.erro); return null; }
  if (r.centavos < minimo) { erroNoCampo(form, nome, 'Informe um valor maior que zero.'); return null; }
  return r.centavos;
}

/** Valor em centavos para preencher um campo de reais ("1234,56"). */
export const reaisParaCampo = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');

// Erros que o banco devolve com o campo a corrigir: mostrados ao lado do campo quando o formulário está na tela.
const ERROS_DE_CAMPO = new Set(['VALIDATION_ERROR', 'INSUFFICIENT_FUNDS', 'PERIOD_LOCKED', 'PAYMENT_EXCEEDS_BALANCE']);

/**
 * Executa um comando no banco com chave de operação por ação. A chave só é reaproveitada quando a resposta se
 * perdeu na rede (API-OP-037). Erro de regra com campo aparece ao lado do campo; sem formulário, no aviso da página.
 */
export function criarExecutorFinanceiro({ area, anunciar, recarregar, erroNoCampo }) {
  const chaves = new Map();
  return async function executar(acao, form, chamada, sucesso) {
    if (!chaves.has(acao)) chaves.set(acao, novaChave());
    try {
      const r = await chamada(chaves.get(acao));
      chaves.delete(acao);
      await recarregar();
      sucesso?.(r);
      return r;
    } catch (erro) {
      if (erro.codigo === 'NETWORK_UNKNOWN') {
        anunciar('erro', erro.message, el('p', {}, 'Tente novamente: se a ação já tiver sido registrada, ela não será duplicada.'));
        return null;
      }
      chaves.delete(acao);
      if (erro.codigo === 'TENANT_FORBIDDEN') {
        semAcesso(area);
        return null;
      }
      if (ERROS_DE_CAMPO.has(erro.codigo) && form && erroNoCampo(form, erro.campo, erro.message)) return null;
      if (['FORBIDDEN_ACTION', 'VERSION_CONFLICT', 'STATE_CONFLICT', 'NOT_FOUND'].includes(erro.codigo)) {
        await recarregar();
        anunciar(erro.codigo === 'FORBIDDEN_ACTION' ? 'erro' : 'alerta', erro.message, el('p', {}, 'Atualizamos a tela com a situação atual.'));
        return null;
      }
      anunciar('erro', erro.message, erro.codigo === 'PERIOD_LOCKED'
        ? el('p', {}, 'Um mês fechado não recebe registros novos. Lance a correção com a data de hoje ou peça ao proprietário para reabrir o último mês fechado.')
        : null);
      return null;
    }
  };
}

/** Tratamento do erro de carregamento comum às telas do financeiro. */
export function erroDeCarga(area, erro, tratarErro, tentarDeNovo) {
  if (erro.codigo === 'AUTH_REQUIRED') {
    area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
    return;
  }
  tratarErro(area, erro, tentarDeNovo);
}

/** Lista de definição a partir de pares [rótulo, valor]. */
export const dados = (pares, atributos = {}) => el('dl', { class: 'dados', ...atributos },
  ...pares.filter(Boolean).flatMap(([r, v]) => [el('dt', {}, r), el('dd', {}, v)]));
