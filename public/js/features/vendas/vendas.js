/**
 * Vendas da empresa (M06, RF-081 a RF-083; D6-16): lista com filtros, situação de entrega e de pagamento,
 * rascunhos em aberto e a visão única de operações (vendas e pedidos com a origem).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, valores } from '../../ui/formulario.js';
import { vendas as lerVendas, operacoes as lerOperacoes, ESTADO_VENDA, ORIGEM, ENTREGA } from '../../data/vendas.js';
import { carregarContexto, navegacaoEmpresa, dinheiro, chipEstadoVenda, chipEntrega, chipPagamento, chipOrigem, chipPedido } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
let ctx = null;
let filtros = {};

const linkVenda = (id) => `/business/venda.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(id)}`;

function secaoFiltros() {
  const form = el('form', { id: 'form-filtros', class: 'pilha', role: 'search' },
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'estado', rotulo: 'Situação', opcoes: Object.entries(ESTADO_VENDA), valor: filtros.estado, vazio: 'Todas', id: 'filtro-estado' }),
      campoSelecao({ nome: 'origem', rotulo: 'Origem', opcoes: [['balcao', ORIGEM.balcao], ['pedido', ORIGEM.pedido]], valor: filtros.origem, vazio: 'Todas', id: 'filtro-origem' }),
      campoSelecao({ nome: 'entrega', rotulo: 'Entrega', opcoes: Object.entries(ENTREGA), valor: filtros.entrega, vazio: 'Todas', id: 'filtro-entrega' }),
      campoTexto({ nome: 'numero', rotulo: 'Número da venda', valor: filtros.numero, id: 'filtro-numero', tipo: 'text' }),
      campoTexto({ nome: 'de', rotulo: 'De', tipo: 'date', valor: filtros.de, id: 'filtro-de' }),
      campoTexto({ nome: 'ate', rotulo: 'Até', tipo: 'date', valor: filtros.ate, id: 'filtro-ate' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Filtrar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    filtros = Object.fromEntries(Object.entries(valores(form)).filter(([, v]) => v));
    carregar();
  });
  return form;
}

function linha(v) {
  return el('tr', { 'data-venda': v.id },
    el('th', { scope: 'row' }, el('a', { href: linkVenda(v.id) }, v.numero ? `nº ${v.numero}` : 'Rascunho')),
    el('td', { 'data-rotulo': 'Quando' }, formatarDataHora(v.confirmada_em ?? v.criado_em)),
    el('td', { 'data-rotulo': 'Cliente' }, v.cliente ?? 'Consumidor não identificado'),
    el('td', { class: 'numero', 'data-rotulo': 'Total' }, dinheiro(v.total_centavos)),
    el('td', { 'data-rotulo': 'Situação' }, el('span', { class: 'opcoes' }, chipEstadoVenda(v.estado), chipOrigem(v.origem),
      v.estado === 'confirmada' ? chipEntrega(v.entrega) : null, v.estado !== 'rascunho' ? chipPagamento(v.pagamento) : null)),
    el('td', { 'data-rotulo': 'Por' }, v.autor_nome));
}

function secaoLista(lista) {
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-vendas' },
    el('h2', { id: 'titulo-vendas' }, `Vendas (${lista.length})`),
    ctx.pode('vendas.visualizar') ? secaoFiltros() : null,
    lista.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-vendas' },
      el('caption', { class: 'visualmente-oculto' }, 'Vendas da empresa, das mais recentes para as mais antigas'),
      el('thead', {}, el('tr', {}, ...['Venda', 'Quando', 'Cliente', 'Total', 'Situação', 'Por'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...lista.map(linha)))) : el('p', { id: 'tabela-vendas' }, 'Nenhuma venda encontrada.'));
}

function secaoOperacoes(ops) {
  if (!ops) return null;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-operacoes' },
    el('h2', { id: 'titulo-operacoes' }, 'Todas as operações'),
    el('p', { class: 'campo__ajuda' }, 'Vendas de balcão, vendas de pedidos e pedidos ainda em andamento, com a origem de cada um.'),
    ops.length ? el('ul', { class: 'lista-simples', id: 'lista-operacoes' }, ...ops.slice(0, 30).map((o) => el('li', {},
      o.tipo === 'venda' ? el('a', { href: linkVenda(o.id) }, `Venda nº ${o.numero}`) : el('a', { href: `/business/pedidos-empresa.html?id=${encodeURIComponent(ctx.id)}#pedido-${o.id}` }, 'Pedido'),
      ` · ${o.cliente ?? 'Consumidor não identificado'} · ${dinheiro(o.total_centavos)} · ${formatarDataHora(o.quando)} `,
      o.tipo === 'venda' ? chipEstadoVenda(o.estado) : chipPedido(o.estado), ' ', chipOrigem(o.origem))))
      : el('p', {}, 'Nenhuma operação ainda.'));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as vendas');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'vendas'));
    if (!ctx.pode('vendas.visualizar') && !ctx.pode('vendas.criar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui as vendas desta empresa.')));
      return;
    }
    const [lista, ops] = await Promise.all([
      ctx.pode('vendas.visualizar') ? lerVendas(ctx.id, filtros, 100, 0) : Promise.resolve([]),
      ctx.pode('vendas.visualizar') || ctx.pode('pedidos.visualizar') ? lerOperacoes(ctx.id, 50) : Promise.resolve(null)]);
    document.getElementById('titulo-pagina').textContent = `Vendas de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    area.append(...[
      ctx.pode('vendas.criar') ? el('p', {}, el('a', { class: 'botao', href: `/business/venda-nova.html?id=${encodeURIComponent(ctx.id)}`, id: 'nova-venda' }, 'Nova venda')) : null,
      ctx.pode('vendas.visualizar') ? secaoLista(lista)
        : el('p', {}, 'Você pode registrar vendas, mas seu perfil não inclui ver a lista de vendas da empresa.'),
      Object.keys(filtros).length ? null : secaoOperacoes(ops),
    ].filter(Boolean));
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
