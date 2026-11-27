/**
 * Pedidos recebidos (M06, RF-068 e RF-069; D6-01, D6-06, D6-07, D6-11): fila "aguardando aceite" com a
 * disponibilidade por item, aceite (reserva tudo ou nada), recusa com motivo, conclusão (vira venda) e
 * cancelamento depois do aceite (libera a reserva uma vez). O motivo de recusa ou cancelamento é visto pelo cliente.
 */
import { marcarNovas } from '../comunicacao/marcador.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { pedidosDaEmpresa, aceitarPedido, recusarPedido, cancelarPedido, concluirPedido, FORMAS, ESTADO_PEDIDO } from '../../data/vendas.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, dinheiro, chipPedido, dialogoFormulario, nomeItem } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';
import { secaoConversa } from '../comunicacao/conversa.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let filtro = 'solicitado';
let conversaAberta = null;   // M12: uma conversa de pedido aberta por vez

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

const pedirMotivo = (id, titulo, rotulo, rotuloConfirmar) => dialogoFormulario({ id, titulo, rotuloConfirmar,
  descricao: ['O cliente verá este motivo no acompanhamento do pedido.'],
  campos: [campoTexto({ nome: 'motivo', rotulo, obrigatorio: true, linhas: 3, max: 300, id: `${id}-motivo`, ajuda: 'De 10 a 300 caracteres.' })],
  validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });

function acoes(p) {
  const lista = [];
  if (p.estado === 'solicitado' && ctx.pode('pedidos.aprovar')) {
    const aceitar = el('button', { type: 'button', class: 'botao', 'data-aceitar': p.id }, 'Aceitar e reservar');
    aceitar.addEventListener('click', () => ocupado(aceitar, async () => {
      const faltando = p.itens.filter((i) => !i.suficiente);
      const ok = await abrirDialogo({ titulo: 'Aceitar o pedido?', rotuloConfirmar: 'Aceitar e reservar', rotuloCancelar: 'Voltar',
        mensagens: ['As unidades ficam reservadas para este cliente até a conclusão ou o cancelamento.',
          ...faltando.map((i) => (i.sob_encomenda ? `${nomeItem(i)}: sob encomenda, o que faltar será produzido.` : `${nomeItem(i)}: estoque insuficiente; o aceite será recusado.`))] });
      if (!ok) return;
      await executar(`aceitar-${p.id}`, null, (k) => aceitarPedido(p.id, p.versao, k), (r) => {
        const encomendar = (r.reservas ?? []).filter((x) => x.a_encomendar > 0);
        anunciar('sucesso', 'Pedido aceito e estoque reservado.', encomendar.length ? el('p', {}, `A produzir: ${encomendar.map((x) => x.a_encomendar).reduce((a, b) => a + b, 0)} unidade(s).`) : null);
      });
    }));
    const recusar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-recusar': p.id }, 'Recusar');
    recusar.addEventListener('click', () => ocupado(recusar, async () => {
      const r = await pedirMotivo(`recusa-${p.id.slice(0, 8)}`, 'Recusar o pedido?', 'Motivo da recusa', 'Recusar pedido');
      if (!r) return;
      await executar(`recusar-${p.id}`, null, (k) => recusarPedido(p.id, r.motivo, p.versao, k), () => anunciar('sucesso', 'Pedido recusado. O cliente verá o motivo.'));
    }));
    lista.push(aceitar, recusar);
  }
  if (p.estado === 'aceito' && ctx.pode('pedidos.aprovar') && ctx.pode('vendas.aprovar')) {
    const concluir = el('button', { type: 'button', class: 'botao', 'data-concluir': p.id }, 'Concluir (gerar venda)');
    concluir.addEventListener('click', () => ocupado(concluir, async () => {
      const id = `concluir-${p.id.slice(0, 8)}`;
      const podeReceber = ctx.pode('vendas.registrar_recebimento') || ctx.pode('financeiro.aprovar');
      const r = await dialogoFormulario({ id, titulo: 'Concluir o pedido?', rotuloConfirmar: 'Gerar a venda',
        descricao: [`A venda é registrada com os preços combinados no pedido (${dinheiro(p.total_centavos)}). Itens com estoque saem agora; sob encomenda sem unidades ficam com entrega pendente.`],
        campos: podeReceber ? [
          campoTexto({ nome: 'recebido', rotulo: 'Valor recebido agora (R$), opcional', id: `${id}-recebido` }),
          campoSelecao({ nome: 'forma', rotulo: 'Forma', opcoes: FORMAS, id: `${id}-forma` })] : [],
        validar: (form) => {
          const d = valores(form);
          const pagamento = { condicao: 'a_vista' };
          if (d.recebido) {
            const v = lerValorEmReais(d.recebido);
            if (!v.ok) return erroNoCampo(form, 'recebido', v.erro) && null;
            if (!d.forma) return erroNoCampo(form, 'forma', 'Escolha a forma.') && null;
            pagamento.recebimento_inicial = { valor_centavos: v.centavos, forma: d.forma };
          }
          return { pagamento };
        } });
      if (!r) return;
      await executar(`concluir-${p.id}`, null, (k) => concluirPedido(p.id, r.pagamento, p.versao, k), (res) => anunciar('sucesso', `Pedido concluído: venda nº ${res.venda.numero}.`,
        el('p', {}, el('a', { class: 'botao botao--secundario', href: `/business/venda.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(res.venda.id)}` }, 'Ver a venda'))));
    }));
    lista.push(concluir);
  }
  if (p.estado === 'aceito' && ctx.pode('pedidos.cancelar')) {
    const cancelar = el('button', { type: 'button', class: 'botao botao--texto', 'data-cancelar': p.id }, 'Cancelar pedido');
    cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
      const r = await pedirMotivo(`cancela-${p.id.slice(0, 8)}`, 'Cancelar o pedido aceito?', 'Motivo do cancelamento', 'Cancelar pedido');
      if (!r) return;
      await executar(`cancelar-${p.id}`, null, (k) => cancelarPedido(p.id, r.motivo, p.versao, k), () => anunciar('sucesso', 'Pedido cancelado e reserva liberada.'));
    }));
    lista.push(cancelar);
  }
  return lista.length ? el('div', { class: 'grupo-botoes' }, ...lista) : null;
}

function botaoConversa(p, lugar) {
  const abrir = el('button', { type: 'button', class: 'botao botao--secundario', 'data-abrir-conversa': p.id }, 'Conversa com o cliente');
  abrir.addEventListener('click', () => {
    if (conversaAberta?.pedido === p.id) { conversaAberta.fechar(); conversaAberta = null; return; }
    conversaAberta?.fechar();
    const c = secaoConversa({ tipo: 'pedido', id: p.id, titulo: 'Conversa sobre este pedido', anunciar });
    lugar.replaceChildren(c.secao);
    abrir.textContent = 'Fechar a conversa';
    conversaAberta = { pedido: p.id, fechar: () => { c.parar(); lugar.replaceChildren(); abrir.textContent = 'Conversa com o cliente'; } };
  });
  return abrir;
}

function cartao(p) {
  const lugar = el('div', { class: 'pilha' });
  return el('li', { class: 'cartao pilha', id: `pedido-${p.id}`, 'data-pedido': p.id, 'data-conversa': `pedido:${p.id}` },
    el('h3', { class: 'cartao__titulo' }, `${p.cliente} · ${dinheiro(p.total_centavos)}`),
    el('p', { class: 'opcoes' }, chipPedido(p.estado), el('span', { class: 'cartao__meta' }, `Pedido em ${formatarDataHora(p.criado_em)}`),
      p.venda_numero ? el('a', { href: `/business/venda.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(p.venda_id)}` }, `Venda nº ${p.venda_numero}`) : null),
    el('ul', {}, ...p.itens.map((i) => el('li', {}, `${nomeItem(i)}: ${i.quantidade} × ${dinheiro(i.preco_centavos)}`,
      i.sob_encomenda ? el('span', { class: 'chip chip--info chip--pequeno' }, 'sob encomenda') : null,
      i.venda_pausada ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'venda pausada') : null,
      p.estado === 'solicitado' ? ` · ${i.suficiente ? 'tem estoque' : (i.sob_encomenda ? 'a produzir' : 'sem estoque suficiente')}${Number.isInteger(i.disponivel) ? ` (${i.disponivel} disponíveis)` : ''}` : '',
      p.estado === 'aceito' && Number.isInteger(i.reservado) ? ` · ${i.reservado} reservadas` : ''))),
    p.observacao_cliente ? el('p', {}, `Observação do cliente: ${p.observacao_cliente}`) : null,
    p.motivo ? el('p', {}, `Motivo: ${p.motivo}`) : null,
    acoes(p), el('div', { class: 'grupo-botoes' }, botaoConversa(p, lugar)), lugar);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando os pedidos');
  conversaAberta?.fechar();
  conversaAberta = null;
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'pedidos'));
    if (!ctx.pode('pedidos.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui os pedidos desta empresa.')));
      return;
    }
    const lista = await pedidosDaEmpresa(ctx.id, filtro || null, 100);
    document.getElementById('titulo-pagina').textContent = `Pedidos de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    const seletor = campoSelecao({ nome: 'estado', rotulo: 'Mostrar', opcoes: Object.entries(ESTADO_PEDIDO), valor: filtro, vazio: 'Todos', id: 'filtro-pedidos' });
    seletor.querySelector('select').addEventListener('change', (e) => { filtro = e.target.value; carregar(); });
    area.append(...[seletor,
      ctx.empresa?.situacao_vitrine && ctx.empresa.situacao_vitrine !== 'publicada'
        ? aviso('info', 'Clientes só conseguem pedir quando a vitrine da empresa está publicada.') : null,
      lista.length ? el('ul', { class: 'lista-simples', id: 'lista-pedidos' }, ...lista.map(cartao))
        : el('p', { id: 'lista-pedidos' }, filtro === 'solicitado' ? 'Nenhum pedido aguardando aceite.' : 'Nenhum pedido encontrado.')].filter(Boolean));
    marcarNovas(area, ctx.id);
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
