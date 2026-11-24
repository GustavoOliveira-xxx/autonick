/**
 * Cliente: fazer pedido e acompanhar (M06; M11: D11-01 a D11-03, D11-05, D11-06, D11-09).
 * Novo pedido começa SEMPRE pela vitrine (empresa e, se veio do botão "Pedir", o produto vêm do link); não há seletor avulso
 * de empresas. O banco confere de novo no envio se cada produto continua publicado e a empresa elegível. Nenhum estoque
 * aparece e nada é cobrado: pedido não é pagamento (RF-076, D6-14); a empresa confirma a disponibilidade ao responder.
 * "Meus pedidos" mostra só os pedidos desta conta, inclusive de produtos que saíram da vitrine.
 */
import { marcarNovas } from '../comunicacao/marcador.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { itensParaPedido, criarPedido, cancelarPedido, meusPedidos, ENTREGA } from '../../data/vendas.js';
import { novaChave } from '../../data/empresas.js';
import { neon } from '../../data/sessao.js';
import { exigirSessao, formatarDataHora } from '../empresa/comum.js';
import { dinheiro, chipPedido, nomeItem } from '../vendas/comum.js';
import { linkVitrine, uuidOuNulo, pedirEntrada, reentrar, avisoSessaoEncerrada, avisoSuspensao } from './jornada.js';
import { secaoConversa } from '../comunicacao/conversa.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const avisos = document.getElementById('avisos');
const chaves = new Map();
const chave = (a) => { if (!chaves.has(a)) chaves.set(a, novaChave()); return chaves.get(a); };
let empresaId = null;
let produtoEscolhido = null;
let itens = [];
let indisponivel = null;
let conversaAberta = null;   // M12: uma conversa de pedido aberta por vez

function anunciar(tipo, texto, ...extra) {
  avisos.replaceChildren(el('div', { role: tipo === 'erro' ? 'alert' : 'status' }, aviso(tipo, texto, ...extra)));
  avisos.scrollIntoView({ block: 'nearest' });
}

async function sessaoTerminou() {
  if (await reentrar()) anunciar('sucesso', 'Você entrou de novo. Confira as quantidades e envie quando quiser: nada foi enviado ainda.');
  else avisos.replaceChildren(el('div', { role: 'alert' }, avisoSessaoEncerrada()));
}

function secaoNovo() {
  if (indisponivel) {
    return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-novo-pedido', id: 'novo-pedido' },
      el('h2', { id: 'titulo-novo-pedido' }, 'Fazer um pedido'),
      aviso('alerta', indisponivel, el('p', {}, 'Nada foi enviado.'), el('p', {}, el('a', { href: linkVitrine(empresaId) }, 'Voltar para a vitrine da empresa'))));
  }
  if (!empresaId) {
    return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-novo-pedido', id: 'novo-pedido' },
      el('h2', { id: 'titulo-novo-pedido' }, 'Fazer um pedido'),
      el('p', {}, 'Para fazer um novo pedido, escolha a empresa e o produto na busca.'),
      el('p', {}, el('a', { class: 'botao botao--secundario', href: linkVitrine(null) }, 'Ir para a busca')));
  }
  const ordenados = [...itens].sort((a, b) => Number(b.produto_id === produtoEscolhido) - Number(a.produto_id === produtoEscolhido));
  const lista = el('div', { class: 'pilha', id: 'itens-pedido' }, ...(ordenados.length ? ordenados.map((i) => {
    const escolhido = produtoEscolhido && i.produto_id === produtoEscolhido;
    const c = campoTexto({ nome: `qtd-${i.variacao_id}`, rotulo: `${nomeItem(i)} · ${dinheiro(i.preco_centavos)}${i.sob_encomenda ? ' (sob encomenda)' : ''}: quantidade`,
      id: `qtd-${i.variacao_id}`, tipo: 'number', valor: escolhido && ordenados.filter((x) => x.produto_id === produtoEscolhido).length === 1 ? '1' : '' });
    c.querySelector('input').setAttribute('min', '0');
    if (escolhido) c.setAttribute('data-escolhido', '');
    return c;
  }) : [el('p', {}, 'Esta empresa não tem produtos disponíveis para pedido agora.')]));
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Enviar pedido');
  const form = el('form', { class: 'pilha', id: 'form-pedido', novalidate: true }, lista,
    el('span', { class: 'campo__erro', id: 'erro-itens-pedido' }),
    campoTexto({ nome: 'observacao', rotulo: 'Observação para a empresa', max: 500, linhas: 2, id: 'pedido-observacao',
      ajuda: 'Ex.: horário para retirar. Não escreva dados de cartão nem senhas.' }),
    el('p', { class: 'campo__ajuda' }, 'A empresa confirma a disponibilidade ao responder. Nada é cobrado pelo app: o pedido não é um pagamento.'),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    document.getElementById('erro-itens-pedido').textContent = '';
    const d = valores(form);
    const escolhidos = [];
    for (const i of itens) {
      const t = d[`qtd-${i.variacao_id}`];
      if (!t) continue;
      const q = Number(t);
      if (!Number.isInteger(q) || q < 0) return erroNoCampo(form, `qtd-${i.variacao_id}`, 'Use um número inteiro.');
      if (q > 0) escolhidos.push({ variacao_id: i.variacao_id, quantidade: q });
    }
    if (!escolhidos.length) {
      document.getElementById('erro-itens-pedido').textContent = 'Informe a quantidade de pelo menos um produto.';
      return form.querySelector('input[type="number"]')?.focus();
    }
    return ocupado(botao, async () => {
      try {
        const r = await criarPedido(empresaId, escolhidos, d.observacao, chave('pedido'));
        chaves.delete('pedido');
        anunciar('sucesso', `Pedido enviado (${dinheiro(r.total_centavos)}). A empresa vai responder se aceita.`);
        await carregar();
      } catch (erro) {
        if (erro.codigo === 'NETWORK_UNKNOWN') return anunciar('erro', erro.message, el('p', {}, 'Tente de novo: o pedido não será duplicado.'));
        if (erro.codigo === 'AUTH_REQUIRED') return sessaoTerminou();
        chaves.delete('pedido');
        if (erro.codigo === 'NOT_FOUND') {
          // Produto (ou empresa) saiu da vitrine com a tela aberta: nada foi criado; a lista é atualizada.
          anunciar('alerta', erro.message, el('p', {}, 'Nada foi enviado. A lista abaixo foi atualizada.'));
          return carregar(false);
        }
        if (erro.campo && erroNoCampo(form, `qtd-${erro.campo}`, erro.message)) return null;
        return anunciar(erro.codigo === 'STATE_CONFLICT' ? 'alerta' : 'erro', erro.message);
      }
    });
  });
  const topo = el('div', { class: 'com-momento' }, el('div', { class: 'pilha' },
    el('h2', { id: 'titulo-novo-pedido' }, 'Fazer um pedido'),
    el('p', {}, el('a', { href: linkVitrine(empresaId), id: 'voltar-vitrine' }, 'Voltar para a vitrine da empresa'))));
  if (ordenados.length) acompanharCesta(topo, lista);
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-novo-pedido', id: 'novo-pedido' }, topo, form);
}

/** IC03: cada produto que a pessoa passa a incluir no pedido cai na cesta (só a escolha dela; o envio continua dizendo o resultado). */
function acompanharCesta(lugar, lista) {
  const cesta = montarMomento(lugar, 'IC03', { tamanho: 'p' });
  const incluidos = new Set();
  const conferir = () => {
    let novos = 0;
    for (const entrada of lista.querySelectorAll('input[type="number"]')) {
      const q = Number(entrada.value);
      if (Number.isInteger(q) && q > 0) { if (!incluidos.has(entrada.id)) { incluidos.add(entrada.id); novos += 1; } } else incluidos.delete(entrada.id);
    }
    if (novos) cesta.definir({ itens: (t) => [...(cesta.mem.itens ?? []), ...Array.from({ length: novos }, (_, i) => t + i * 0.18)].slice(-3) }, { duracao: 1.4 + novos * 0.18 });
  };
  lista.addEventListener('change', conferir);
  conferir();
}

function cartao(p) {
  let cancelar = null;
  if (p.estado === 'solicitado') {
    cancelar = el('button', { type: 'button', class: 'botao botao--texto', 'data-cancelar': p.id }, 'Cancelar pedido');
    cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
      const ok = await abrirDialogo({ titulo: 'Cancelar este pedido?', mensagens: ['A empresa ainda não respondeu. O cancelamento não tem custo.'],
        rotuloConfirmar: 'Cancelar pedido', rotuloCancelar: 'Manter pedido' });
      if (!ok) return;
      try {
        await cancelarPedido(p.id, null, p.versao, chave(`cancelar-${p.id}`));
        chaves.delete(`cancelar-${p.id}`);
        anunciar('sucesso', 'Pedido cancelado.');
        await carregar();
      } catch (erro) {
        if (erro.codigo === 'AUTH_REQUIRED') { await sessaoTerminou(); return; }
        if (erro.codigo !== 'NETWORK_UNKNOWN') chaves.delete(`cancelar-${p.id}`);
        anunciar('alerta', erro.message);
        if (erro.codigo === 'STATE_CONFLICT') await carregar();
      }
    }));
  }
  // M12 (D12-01): cada pedido tem a sua conversa com a empresa, aberta sob demanda.
  const lugar = el('div', { class: 'pilha' });
  const abrir = el('button', { type: 'button', class: 'botao botao--secundario', 'data-abrir-conversa': p.id }, 'Conversa com a empresa');
  abrir.addEventListener('click', () => {
    if (conversaAberta?.pedido === p.id) { conversaAberta.parar(); lugar.replaceChildren(); conversaAberta = null; abrir.textContent = 'Conversa com a empresa'; return; }
    if (conversaAberta) conversaAberta.fechar();
    const c = secaoConversa({ tipo: 'pedido', id: p.id, titulo: 'Conversa sobre este pedido', anunciar });
    lugar.replaceChildren(c.secao);
    abrir.textContent = 'Fechar a conversa';
    conversaAberta = { pedido: p.id, parar: c.parar, fechar: () => { c.parar(); lugar.replaceChildren(); abrir.textContent = 'Conversa com a empresa'; } };
  });
  return el('li', { class: 'cartao pilha', 'data-meu-pedido': p.id, 'data-conversa': `pedido:${p.id}` },
    el('h3', { class: 'cartao__titulo' }, `${p.empresa} · ${dinheiro(p.total_centavos)}`),
    el('p', { class: 'opcoes' }, chipPedido(p.estado), p.entrega ? el('span', {}, ENTREGA[p.entrega]) : null,
      el('span', { class: 'cartao__meta' }, formatarDataHora(p.criado_em))),
    avisoSuspensao(p.suspensao, p.estado === 'solicitado' ? 'pendente' : 'aceito'),
    el('ul', {}, ...p.itens.map((i) => el('li', {}, `${nomeItem(i)}: ${i.quantidade} × ${dinheiro(i.preco_centavos)}`))),
    p.motivo ? el('p', {}, `Resposta da empresa: ${p.motivo}`) : null,
    el('div', { class: 'grupo-botoes' }, abrir, cancelar), lugar);
}

async function carregar(mostrar = true) {
  if (mostrar) mostrarCarregando(area, 'Carregando seus pedidos');
  try {
    empresaId = uuidOuNulo(parametro('empresa'));
    produtoEscolhido = uuidOuNulo(parametro('produto'));
    if (neon.configurado && !(await neon.temSessao())) { concluirCarregamento(area); pedirEntrada(area); return; }
    if (!(await exigirSessao(area, { perfil: 'cliente', entrada: '/cliente/entrar.html' }))) return;
    indisponivel = null;
    conversaAberta?.parar();
    conversaAberta = null;
    itens = [];
    const meus = await meusPedidos();
    if (empresaId) {
      try {
        itens = await itensParaPedido(empresaId);
        if (produtoEscolhido && !itens.some((i) => i.produto_id === produtoEscolhido)) {
          anunciar('alerta', 'Este produto não está mais disponível para pedido. Os demais produtos desta empresa estão abaixo.');
        }
      } catch (erro) {
        if (erro.codigo !== 'NOT_FOUND') throw erro;
        indisponivel = erro.message;
      }
    }
    concluirCarregamento(area);
    area.replaceChildren(secaoNovo(), el('section', { class: 'pilha', 'aria-labelledby': 'titulo-meus-pedidos' },
      el('h2', { id: 'titulo-meus-pedidos' }, `Meus pedidos (${meus.length})`),
      meus.length ? el('ul', { class: 'lista-simples', id: 'lista-meus-pedidos' }, ...meus.map(cartao)) : el('p', { id: 'lista-meus-pedidos' }, 'Você ainda não fez pedidos.')));
    document.querySelector('[data-escolhido] input')?.focus();
    marcarNovas(area);
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') { pedirEntrada(area); return; }
    tratarErro(area, erro, carregar);
  }
}

carregar();
