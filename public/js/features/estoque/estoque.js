/**
 * Estoque da empresa (M05; pacote 27/11, item 3): consulta primeiro. Abre numa tabela simples (produto/variação, código,
 * disponível e mínimo), com busca, filtro de estoque baixo e físico/reservado sob demanda. Vendas, compras recebidas,
 * reservas, devoluções e OS já movimentam o estoque sozinhas; por isso o lançamento manual saiu do fluxo padrão e virou
 * a ação secundária "Ajustar estoque" (só com permissão, motivo e aprovação conforme a regra D5-04), para inventário
 * inicial, contagem, perda e exceções. Histórico com a origem de cada movimento (venda, compra, OS, ajuste) por produto.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirModal } from '../../ui/modal.js';
import { barraConsulta, vazio } from '../../ui/consulta.js';
import { lerValorEmReais, formatarCentavos } from '../../domain/moeda.js';
import { lerQuantidade } from '../../domain/variacoes.js';
import { origemDoMovimento } from '../../domain/estoque.js';
import {
  produtosDaEmpresa, alertasEstoque, historicoMovimentacoes, propostas as lerPropostas, movimentar,
  aprovarProposta, decidirSemAplicar, estornar, TIPOS_MOVIMENTACAO,
} from '../../data/estoque.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';
import { vazioComMomento } from '../../ui/forja3d/momentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let dados = null; // { produtos, alertas, pendentes, historico }

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const nomeVariacao = (p, v) => (v.padrao ? p.nome : `${p.nome} (${v.rotulo})`);

let filtro = { busca: '', baixo: false, detalhes: false };
const corpoSaldos = el('div', { id: 'resultado-estoque', 'aria-live': 'polite' });
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function linhasDeSaldo() {
  const t = semAcento(filtro.busca);
  const linhas = [];
  for (const p of dados.produtos.filter((x) => x.ativo)) {
    for (const v of p.variacoes.filter((x) => x.ativo)) {
      if (filtro.baixo && !v.abaixo_minimo) continue;
      if (t && !semAcento(`${p.nome} ${v.rotulo} ${v.sku ?? ''}`).includes(t)) continue;
      linhas.push({ p, v });
    }
  }
  return linhas;
}

function desenharSaldos() {
  const linhas = linhasDeSaldo();
  const cab = ['Produto', 'Código', 'Disponível', ...(filtro.detalhes ? ['Físico', 'Reservado'] : []), 'Mínimo', 'Ações'];
  corpoSaldos.replaceChildren(linhas.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-saldos' },
    el('caption', { class: 'visualmente-oculto' }, 'Quantidade disponível por produto e variação'),
    el('thead', {}, el('tr', {}, ...cab.map((c) => el('th', { scope: 'col', class: ['Disponível', 'Físico', 'Reservado', 'Mínimo'].includes(c) ? 'numero' : null }, c)))),
    el('tbody', {}, ...linhas.map(({ p, v }) => {
      const hist = el('button', { type: 'button', class: 'botao botao--secundario', 'data-historico': v.id }, 'Histórico', el('span', { class: 'visualmente-oculto' }, ` de ${nomeVariacao(p, v)}`));
      hist.addEventListener('click', () => abrirHistorico(p, v, hist));
      return el('tr', { 'data-variacao': v.id },
        el('th', { scope: 'row' }, el('a', { class: 'link-tabela', href: `/business/produto.html?id=${encodeURIComponent(ctx.id)}&produto=${encodeURIComponent(p.id)}` }, nomeVariacao(p, v)),
          p.venda_pausada ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'venda pausada') : null,
          p.sob_encomenda ? el('span', { class: 'chip chip--info chip--pequeno' }, 'sob encomenda') : null),
        el('td', { 'data-rotulo': 'Código' }, v.sku ?? '—'),
        el('td', { class: 'numero', 'data-rotulo': 'Disponível' }, el('span', { class: 'numero-grande' }, quantidadeLegivel(v.disponivel)),
          v.abaixo_minimo ? el('span', { class: 'chip chip--alerta chip--pequeno' }, el('span', { 'aria-hidden': 'true' }, '! '), 'abaixo do mínimo') : null),
        ...(filtro.detalhes ? [el('td', { class: 'numero', 'data-rotulo': 'Físico' }, quantidadeLegivel(v.fisico)),
          el('td', { class: 'numero', 'data-rotulo': 'Reservado' }, quantidadeLegivel(v.reservado))] : []),
        el('td', { class: 'numero', 'data-rotulo': 'Mínimo' }, v.estoque_minimo ?? '—'),
        el('td', { 'data-rotulo': 'Ações' }, el('div', { class: 'acoes-linha' }, hist)));
    }))))
    : dados.produtos.some((x) => x.ativo) ? vazio(filtro.baixo ? 'Nenhum produto abaixo do mínimo. Tudo certo!' : `Nenhum produto encontrado para "${filtro.busca}".`, null, 'tabela-saldos')
      : vazioComMomento('IB02', null, 'Nenhum produto ativo. Cadastre produtos na tela de produtos.'));
}

function secaoSaldos() {
  const baixo = el('label', { class: 'opcao', for: 'filtro-baixo' }, el('input', { type: 'checkbox', id: 'filtro-baixo', checked: filtro.baixo }), 'Só estoque baixo');
  const detalhes = el('label', { class: 'opcao', for: 'filtro-detalhes' }, el('input', { type: 'checkbox', id: 'filtro-detalhes', checked: filtro.detalhes }), 'Mostrar físico e reservado');
  baixo.querySelector('input').addEventListener('change', (e) => { filtro.baixo = e.target.checked; desenharSaldos(); });
  detalhes.querySelector('input').addEventListener('change', (e) => { filtro.detalhes = e.target.checked; desenharSaldos(); });
  const ajustar = podeAjustar() ? el('button', { type: 'button', class: 'botao botao--secundario', id: 'ajustar-estoque' }, 'Ajustar estoque') : null;
  ajustar?.addEventListener('click', () => abrirAjuste(ajustar));
  const barra = barraConsulta({ id: 'busca-estoque', rotulo: 'Buscar no estoque', valor: filtro.busca, dica: 'Produto, variação ou código',
    aoBuscar: (v) => { filtro.busca = v; desenharSaldos(); barra.anunciar(`${linhasDeSaldo().length} itens.`); },
    acoes: [ajustar, el('a', { class: 'botao botao--secundario', href: `/business/compras.html?id=${encodeURIComponent(ctx.id)}` }, 'Compras')],
    filtros: [baixo, detalhes], filtrosAbertos: filtro.baixo || filtro.detalhes });
  const alertas = dados.alertas.length ? (() => {
    const ver = el('button', { type: 'button', class: 'botao botao--secundario', id: 'ver-alertas' }, 'Ver só esses');
    ver.addEventListener('click', () => { filtro.baixo = true; baixo.querySelector('input').checked = true; barra.elemento.querySelector('details')?.setAttribute('open', ''); desenharSaldos(); });
    return el('div', { class: 'aviso-estoque', id: 'lista-alertas', role: 'status' }, el('span', { class: 'chip chip--alerta' }, el('span', { 'aria-hidden': 'true' }, '!'), ` ${dados.alertas.length} abaixo do mínimo`),
      el('span', {}, dados.alertas.slice(0, 3).map((a) => (a.rotulo === 'Padrão' ? a.produto_nome : `${a.produto_nome} (${a.rotulo})`)).join(', ') + (dados.alertas.length > 3 ? '…' : '')), ver);
  })() : null;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-saldos' },
    el('h2', { id: 'titulo-saldos' }, 'O que tenho em estoque'), barra.elemento, alertas,
    el('p', { class: 'campo__ajuda' }, 'Vendas confirmadas, compras recebidas, reservas, devoluções e ordens de serviço já atualizam o estoque sozinhas.'),
    corpoSaldos);
}

const podeAjustar = () => ctx.pode('estoque.aprovar') || ctx.pode('estoque.propor');

async function abrirHistorico(p, v, origem) {
  const corpo = el('div', { class: 'pilha', 'aria-live': 'polite' }, el('p', {}, 'Carregando…'));
  abrirModal({ titulo: `Histórico de ${nomeVariacao(p, v)}`, descricao: `${quantidadeLegivel(v.disponivel)} disponíveis agora (${quantidadeLegivel(v.fisico)} no físico, ${quantidadeLegivel(v.reservado)} reservados).`,
    corpo, tamanho: 'grande', aoFechar: () => origem?.focus() });
  try {
    const h = await historicoMovimentacoes(ctx.id, v.id, 100);
    corpo.replaceChildren(h.length ? tabelaHistorico(h, false) : el('p', {}, 'Nenhuma movimentação registrada para este item.'));
  } catch (erro) { corpo.replaceChildren(aviso('erro', erro.message)); }
}

/** Ajuste excepcional (inventário, contagem, perda): direto para quem aprova, proposta para os demais (D5-04). */
function abrirAjuste(origem) {
  const direto = ctx.pode('estoque.aprovar');
  const opcoes = [];
  for (const p of dados.produtos.filter((x) => x.ativo)) {
    for (const v of p.variacoes.filter((x) => x.ativo)) opcoes.push([v.id, `${nomeVariacao(p, v)}: ${quantidadeLegivel(v.disponivel)} disponíveis`]);
  }
  const comCusto = ctx.pode('produtos.ver_custo');
  const form = el('form', { id: 'form-movimentacao', class: 'pilha', novalidate: true },
    el('p', { class: 'aviso aviso--alerta aviso--compacto' }, el('strong', {}, 'Não use para vendas nem compras: '),
      'a venda confirmada já baixa o estoque e a compra recebida já dá entrada. Aqui ficam só as exceções, como inventário inicial, contagem, perda, avaria ou consumo interno.'),
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'tipo', rotulo: 'O que aconteceu', obrigatorio: true, id: 'mov-tipo', opcoes: [['ajuste', 'Contagem diferente do sistema (ajuste)'], ['saida', 'Perda, avaria ou consumo (saída)'], ['entrada', 'Entrada sem compra (ex.: estoque inicial, doação)']] }),
      campoSelecao({ nome: 'variacao_id', rotulo: 'Produto', obrigatorio: true, id: 'mov-variacao', opcoes }),
      campoTexto({ nome: 'quantidade', rotulo: 'Quantidade', obrigatorio: true, id: 'mov-quantidade', ajuda: 'No ajuste, use negativo para retirar (ex.: -2).' }),
      comCusto ? campoTexto({ nome: 'custo', rotulo: 'Custo unitário (R$), só em entradas', id: 'mov-custo' }) : null),
    campoTexto({ nome: 'motivo', rotulo: 'Motivo', max: 300, id: 'mov-motivo', ajuda: 'Obrigatório em saídas e ajustes (no ajuste, pelo menos 10 caracteres). Fica no histórico.' }));
  const botao = el('button', { type: 'submit', class: 'botao', form: 'form-movimentacao' }, direto ? 'Lançar no estoque' : 'Enviar para aprovação');
  const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');
  let sujo = false;
  form.addEventListener('input', () => { sujo = true; });
  const modal = abrirModal({ titulo: 'Ajustar estoque', descricao: direto ? 'Você tem permissão de aprovar: o lançamento vale na hora e fica registrado como aprovação sua.'
    : 'O ajuste só muda o estoque depois de aprovado por quem tem permissão.', corpo: form, rodape: [cancelar, botao], tamanho: 'grande',
  protegerAlteracoes: () => sujo, aoFechar: () => origem?.focus() });
  cancelar.addEventListener('click', () => modal.dialogo.querySelector('.modal__fechar').click());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.tipo) return erroNoCampo(form, 'tipo', 'Escolha o que aconteceu.');
    if (!d.variacao_id) return erroNoCampo(form, 'variacao_id', 'Escolha o produto.');
    const q = lerQuantidade(d.quantidade, { comSinal: d.tipo === 'ajuste' });
    if (!q.ok) return erroNoCampo(form, 'quantidade', q.erro);
    const item = { variacao_id: d.variacao_id, quantidade: q.valor };
    if (d.custo) {
      if (d.tipo !== 'entrada') return erroNoCampo(form, 'custo', 'Custo só é informado em entradas.');
      const c = lerValorEmReais(d.custo);
      if (!c.ok) return erroNoCampo(form, 'custo', c.erro);
      item.custo_centavos = c.centavos;
    }
    if (d.tipo !== 'entrada' && !d.motivo) return erroNoCampo(form, 'motivo', 'Informe o motivo.');
    ocupado(botao, () => executar('movimentar', form, (k) => movimentar(direto, ctx.id, d.tipo, [item], d.motivo, k), (r) => {
      sujo = false;
      modal.fechar();
      const s = r.saldos?.[0];
      anunciar('sucesso', r.estado === 'pendente' ? 'Ajuste enviado para aprovação.' : 'Estoque atualizado.',
        s ? el('p', {}, `Agora: ${quantidadeLegivel(s.disponivel)} disponíveis (${quantidadeLegivel(s.fisico)} no físico).`) : null);
    }));
  });
  setTimeout(() => form.querySelector('#mov-tipo')?.focus(), 30);
}

function itemProposta(pr) {
  const acoes = [];
  if (ctx.pode('estoque.aprovar')) {
    const aprovar = el('button', { type: 'button', class: 'botao' }, 'Aprovar e aplicar');
    aprovar.addEventListener('click', () => ocupado(aprovar, () => executar(`aprovar-${pr.id}`, null, (k) => aprovarProposta(pr.id, pr.versao, k),
      () => anunciar('sucesso', 'Movimentação aprovada e aplicada ao estoque.'))));
    acoes.push(aprovar);
    const motivo = campoTexto({ nome: 'motivo', rotulo: 'Motivo da rejeição', max: 300, id: `rejeitar-motivo-${pr.id}` });
    const rejeitar = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Rejeitar');
    const form = el('form', { class: 'pilha', novalidate: true }, motivo, el('div', { class: 'grupo-botoes' }, rejeitar));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const { motivo: m } = valores(form);
      if (!m || m.length < 3) return erroNoCampo(form, 'motivo', 'Explique a rejeição.');
      ocupado(rejeitar, () => executar(`rejeitar-${pr.id}`, form, (k) => decidirSemAplicar(pr.id, 'rejeitar', m, pr.versao, k), () => anunciar('sucesso', 'Movimentação rejeitada.')));
    });
    acoes.push(el('details', {}, el('summary', {}, 'Rejeitar'), form));
  } else if (pr.sou_autor) {
    const cancelar = el('button', { type: 'button', class: 'botao botao--texto' }, 'Cancelar minha proposta');
    cancelar.addEventListener('click', () => ocupado(cancelar, () => executar(`cancelar-${pr.id}`, null, (k) => decidirSemAplicar(pr.id, 'cancelar', null, pr.versao, k),
      () => anunciar('sucesso', 'Proposta cancelada.'))));
    acoes.push(cancelar);
  }
  return el('li', { class: 'cartao pilha', 'data-proposta': pr.id },
    el('p', {}, el('strong', {}, TIPOS_MOVIMENTACAO[pr.tipo]), ` por ${pr.autor_nome} em ${formatarDataHora(pr.criado_em)}`),
    el('ul', {}, ...pr.itens.map((i) => el('li', {}, `${i.rotulo === 'Padrão' ? i.produto_nome : `${i.produto_nome} (${i.rotulo})`}: ${pr.tipo === 'saida' ? '−' : (i.quantidade > 0 ? '+' : '')}${quantidadeLegivel(i.quantidade)}`,
      Number.isSafeInteger(i.custo_centavos) ? ` a ${formatarCentavos(i.custo_centavos)}` : ''))),
    pr.motivo ? el('p', {}, `Motivo: ${pr.motivo}`) : null,
    acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
}

function secaoPendentes() {
  const lista = dados.pendentes;
  if (!lista.length) return null;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-pendentes' },
    el('h2', { id: 'titulo-pendentes' }, `Aguardando aprovação (${lista.length})`),
    lista.length ? el('ul', { class: 'lista-simples', id: 'lista-pendentes' }, ...lista.map(itemProposta)) : el('p', { id: 'lista-pendentes' }, 'Nada aguardando aprovação.'));
}

function tabelaHistorico(historico, comProduto = true) {
  const podeEstornar = ctx.pode('estoque.aprovar');
  const linhas = historico.map((m) => {
    let acao = null;
    if (podeEstornar && m.origem_tipo === 'proposta' && m.tipo !== 'estorno' && !m.estornada) {
      acao = el('button', { type: 'button', class: 'botao botao--texto', 'data-estornar': m.id }, 'Estornar');
      acao.addEventListener('click', () => ocupado(acao, async () => {
        const motivo = await pedirMotivoEstorno(m);
        if (!motivo) return;
        await executar(`estornar-${m.id}`, null, (k) => estornar(m.id, motivo, k), () => anunciar('sucesso', 'Movimentação estornada. A original continua no histórico.'));
      }));
    }
    return el('tr', {},
      el('td', { 'data-rotulo': 'Quando' }, formatarDataHora(m.criado_em)),
      comProduto ? el('th', { scope: 'row' }, m.rotulo === 'Padrão' ? m.produto_nome : `${m.produto_nome} (${m.rotulo})`) : null,
      el('td', { 'data-rotulo': 'Origem' }, origemDoMovimento(m), m.estornada ? ' (estornada)' : ''),
      el('td', { class: 'numero', 'data-rotulo': 'Quantidade' }, `${m.quantidade > 0 ? '+' : '−'}${quantidadeLegivel(Math.abs(m.quantidade))}`),
      el('td', { class: 'numero', 'data-rotulo': 'Físico depois' }, quantidadeLegivel(m.fisico_apos)),
      el('td', { 'data-rotulo': 'Por' }, m.ator_nome),
      el('td', { 'data-rotulo': 'Motivo' }, m.motivo ?? '—', Number.isSafeInteger(m.custo_centavos) ? ` · custo ${formatarCentavos(m.custo_centavos)}` : ''),
      el('td', { 'data-rotulo': 'Ação' }, acao ?? ''));
  });
  return el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: comProduto ? 'tabela-historico' : 'tabela-historico-item' },
    el('caption', { class: 'visualmente-oculto' }, 'Movimentações de estoque mais recentes'),
    el('thead', {}, el('tr', {}, ...['Quando', comProduto ? 'Produto' : null, 'Origem', 'Quantidade', 'Físico depois', 'Por', 'Motivo', 'Ação'].filter(Boolean).map((c) => el('th', { scope: 'col' }, c)))),
    el('tbody', {}, ...linhas)));
}

function secaoHistorico() {
  return el('details', { class: 'pilha secao-recolhida', id: 'secao-historico' },
    el('summary', {}, el('h2', { id: 'titulo-historico-estoque' }, 'Histórico de movimentações')),
    el('p', { class: 'campo__ajuda' }, 'Registro permanente: nada é apagado. Correções viram estornos ou ajustes.'),
    dados.historico.length ? tabelaHistorico(dados.historico) : el('p', {}, 'Nenhuma movimentação ainda.'));
}

/** Diálogo acessível com motivo obrigatório (o diálogo comum não tem campo). */
function pedirMotivoEstorno(m) {
  return new Promise((resolver) => {
    const gatilho = document.activeElement;
    const entrada = el('textarea', { id: 'estorno-motivo', rows: 3, maxlength: 300, 'aria-describedby': 'estorno-ajuda estorno-erro' });
    const erro = el('span', { id: 'estorno-erro', class: 'campo__erro' });
    const confirmar = el('button', { type: 'button', class: 'botao' }, 'Estornar');
    const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');
    const dialogo = el('dialog', { class: 'dialogo', 'aria-labelledby': 'estorno-titulo' },
      el('div', { class: 'dialogo__corpo' },
        el('h2', { id: 'estorno-titulo' }, 'Estornar movimentação?'),
        el('p', {}, `${TIPOS_MOVIMENTACAO[m.tipo]} de ${quantidadeLegivel(Math.abs(m.quantidade))} em ${m.produto_nome}. O estorno cria a movimentação inversa; a original continua no histórico.`),
        el('div', { class: 'campo' }, el('label', { for: 'estorno-motivo' }, 'Motivo do estorno', el('span', { class: 'obrigatorio' }, ' (obrigatório)')),
          el('span', { id: 'estorno-ajuda', class: 'campo__ajuda' }, 'De 10 a 300 caracteres.'), entrada, erro),
        el('div', { class: 'grupo-botoes' }, confirmar, cancelar)));
    let resultado = null;
    confirmar.addEventListener('click', () => {
      const t = entrada.value.trim();
      if (t.length < 10) {
        erro.textContent = 'Explique o estorno com pelo menos 10 caracteres.';
        entrada.setAttribute('aria-invalid', 'true');
        entrada.focus();
        return;
      }
      resultado = t;
      dialogo.close();
    });
    cancelar.addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (gatilho instanceof HTMLElement) gatilho.focus();
      resolver(resultado);
    });
    document.body.append(dialogo);
    dialogo.showModal();
    entrada.focus();
  });
}

async function carregar() {
  mostrarCarregando(area, 'Carregando o estoque');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'estoque'));
    if (!ctx.pode('estoque.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui o estoque desta empresa.')));
      return;
    }
    const [produtos, alertas, pendentes, historico] = await Promise.all([
      produtosDaEmpresa(ctx.id), alertasEstoque(ctx.id), lerPropostas(ctx.id, 'pendente'), historicoMovimentacoes(ctx.id, null, 100)]);
    dados = { produtos, alertas, pendentes, historico };
    document.getElementById('titulo-pagina').textContent = `Estoque de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    area.append(...[secaoSaldos(), secaoPendentes(), secaoHistorico()].filter(Boolean));
    desenharSaldos();
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
