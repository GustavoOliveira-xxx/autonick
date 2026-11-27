/**
 * Vendas da empresa (M06; pacote 27/11): consulta primeiro. Busca por número ou cliente, "Nova venda" ao lado, filtros
 * compactos; situação de entrega e de pagamento,
 * rascunhos em aberto e a visão única de operações (vendas e pedidos com a origem).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao } from '../../ui/formulario.js';
import { barraConsulta, vazio } from '../../ui/consulta.js';
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
  const mudar = (nome) => (e) => { if (e.target.value) filtros[nome] = e.target.value; else delete filtros[nome]; recarregarLista(); };
  const campos = [
    campoSelecao({ nome: 'estado', rotulo: 'Situação', opcoes: Object.entries(ESTADO_VENDA), valor: filtros.estado, vazio: 'Todas', id: 'filtro-estado' }),
    campoSelecao({ nome: 'origem', rotulo: 'Origem', opcoes: [['balcao', ORIGEM.balcao], ['pedido', ORIGEM.pedido]], valor: filtros.origem, vazio: 'Todas', id: 'filtro-origem' }),
    campoSelecao({ nome: 'entrega', rotulo: 'Entrega', opcoes: Object.entries(ENTREGA), valor: filtros.entrega, vazio: 'Todas', id: 'filtro-entrega' }),
    campoTexto({ nome: 'de', rotulo: 'De', tipo: 'date', valor: filtros.de, id: 'filtro-de' }),
    campoTexto({ nome: 'ate', rotulo: 'Até', tipo: 'date', valor: filtros.ate, id: 'filtro-ate' })];
  for (const c of campos) c.querySelector('select, input').addEventListener('change', mudar(c.querySelector('select, input').name));
  const nova = ctx.pode('vendas.criar') ? el('a', { class: 'botao', href: `/business/venda-nova.html?id=${encodeURIComponent(ctx.id)}`, id: 'nova-venda' }, 'Nova venda') : null;
  const barra = barraConsulta({ id: 'busca-venda', rotulo: 'Buscar vendas', valor: filtros.busca, dica: 'Número da venda ou nome do cliente',
    aoBuscar: (v) => { if (v) filtros.busca = v; else delete filtros.busca; recarregarLista(); }, acoes: [nova], filtros: campos,
    filtrosAbertos: Boolean(filtros.estado || filtros.origem || filtros.entrega || filtros.de || filtros.ate) });
  return barra.elemento;
}

const corpoLista = el('div', { id: 'resultado-vendas', 'aria-live': 'polite' });
async function recarregarLista() {
  corpoLista.setAttribute('aria-busy', 'true');
  try {
    const lista = await lerVendas(ctx.id, filtros, 100, 0);
    desenharLista(Array.isArray(lista) ? lista : []);
  } catch (erro) {
    corpoLista.replaceChildren(aviso('erro', erro.message));
  } finally { corpoLista.removeAttribute('aria-busy'); }
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

function desenharLista(lista) {
  document.getElementById('titulo-vendas')?.replaceChildren(`Vendas (${lista.length}${lista.length >= 100 ? '+' : ''})`);
  corpoLista.replaceChildren(lista.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-vendas' },
    el('caption', { class: 'visualmente-oculto' }, 'Vendas da empresa, das mais recentes para as mais antigas'),
    el('thead', {}, el('tr', {}, ...['Venda', 'Quando', 'Cliente', 'Total', 'Situação', 'Por'].map((c) => el('th', { scope: 'col', class: c === 'Total' ? 'numero' : null }, c)))),
    el('tbody', {}, ...lista.map(linha))))
    : vazio(Object.keys(filtros).length ? 'Nenhuma venda com essa busca ou filtros.' : 'Nenhuma venda registrada ainda.',
      !Object.keys(filtros).length && ctx.pode('vendas.criar') ? el('a', { class: 'botao', href: `/business/venda-nova.html?id=${encodeURIComponent(ctx.id)}` }, 'Registrar a primeira venda') : null, 'tabela-vendas'));
}

function secaoLista(lista) {
  const s = el('section', { class: 'pilha', 'aria-labelledby': 'titulo-vendas' }, el('h2', { id: 'titulo-vendas' }, 'Vendas'), secaoFiltros(), corpoLista);
  desenharLista(lista);
  return s;
}

function secaoOperacoes(ops) {
  if (!ops) return null;
  return el('details', { class: 'pilha secao-recolhida', id: 'secao-operacoes' },
    el('summary', {}, el('h2', { id: 'titulo-operacoes' }, 'Todas as operações (vendas e pedidos)')),
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
      ctx.pode('vendas.visualizar') ? secaoLista(lista)
        : el('div', { class: 'pilha' }, el('p', {}, 'Você pode registrar vendas, mas seu perfil não inclui ver a lista de vendas da empresa.'),
          el('p', {}, el('a', { class: 'botao', href: `/business/venda-nova.html?id=${encodeURIComponent(ctx.id)}`, id: 'nova-venda' }, 'Nova venda'))),
      Object.keys(filtros).length ? null : secaoOperacoes(ops),
    ].filter(Boolean));
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
