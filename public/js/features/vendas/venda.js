/**
 * Detalhe da venda (M06): itens com preço histórico, entrega pendente de sob encomenda (D6-08), parcelas e
 * recebimentos (D6-03, D6-14, D6-17), estorno só no financeiro, cancelamento total com destino por item e
 * devolução de valores (D6-09), rascunho (editar, confirmar ou descartar) e histórico de eventos.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import {
  venda as lerVenda, registrarEntrega, cancelarVenda, registrarRecebimento, estornarRecebimento, registrarDevolucaoValor,
  descartarVenda, FORMAS, FORMA, DESTINOS, DESTINO, EVENTOS,
} from '../../data/vendas.js';
import { contas as lerContas } from '../../data/financeiro.js';
import {
  carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, dinheiro, chipEstadoVenda, chipEntrega, chipPagamento, chipOrigem,
  dialogoFormulario, formatarData, dataDeHoje, nomeItem,
} from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';
import { botaoPdf, nomeDeQuemGera } from '../../pdf/baixar.js';
import { registrarExportacaoPdf } from '../../data/exportacao.js';
import { comprovanteVenda } from '../../pdf/documentos.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
const vendaId = parametro('venda');
let ctx = null;
let v = null;
let contas = [];   // M07 (D7-16): conta onde o valor entra ou de onde sai

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const podeReceber = () => ctx.pode('vendas.registrar_recebimento') || ctx.pode('financeiro.aprovar');
const campoConta = (id, rotulo) => (contas.length > 1 ? campoSelecao({ nome: 'conta', rotulo, id: `${id}-conta`, vazio: null,
  opcoes: contas.filter((c) => c.ativa).map((c) => [c.id, c.padrao ? `${c.nome} (padrão)` : c.nome]), valor: contas.find((c) => c.padrao)?.id ?? '' }) : null);

function secaoResumo() {
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-resumo' },
    el('h2', { id: 'titulo-resumo' }, v.numero ? `Venda nº ${v.numero}` : 'Rascunho de venda'),
    el('p', { class: 'opcoes' }, chipEstadoVenda(v.estado), chipOrigem(v.origem), v.estado === 'confirmada' ? chipEntrega(v.entrega) : null,
      v.pagamento && v.estado !== 'rascunho' ? chipPagamento(v.pagamento) : null),
    el('dl', { class: 'dados' },
      el('dt', {}, 'Cliente'), el('dd', {}, v.cliente ?? 'Consumidor não identificado'),
      el('dt', {}, 'Registrada por'), el('dd', {}, v.autor_nome),
      v.confirmada_em ? [el('dt', {}, 'Confirmada'), el('dd', {}, `${formatarDataHora(v.confirmada_em)} por ${v.confirmada_por_nome}`)] : null,
      v.cancelada_em ? [el('dt', {}, 'Cancelada'), el('dd', {}, `${formatarDataHora(v.cancelada_em)}: ${v.motivo_cancelamento}`)] : null,
      v.observacao ? [el('dt', {}, 'Observação'), el('dd', {}, v.observacao)] : null,
      el('dt', {}, 'Produtos'), el('dd', {}, dinheiro(v.subtotal_centavos)),
      v.desconto_itens_centavos + v.desconto_geral_centavos ? [el('dt', {}, 'Descontos'), el('dd', {}, `− ${dinheiro(v.desconto_itens_centavos + v.desconto_geral_centavos)}`)] : null,
      el('dt', {}, 'Total'), el('dd', { class: 'numero-grande', id: 'total-venda' }, dinheiro(v.total_centavos))));
}

function secaoItens() {
  const comCusto = v.itens.some((i) => Number.isSafeInteger(i.custo_centavos));
  const pendentes = v.itens.filter((i) => i.entrega === 'pendente');
  let acao = null;
  if (v.estado === 'confirmada' && v.entrega === 'pendente' && ctx.pode('vendas.aprovar')) {
    const entregar = el('button', { type: 'button', class: 'botao', id: 'registrar-entrega' }, 'Registrar entrega');
    entregar.addEventListener('click', () => ocupado(entregar, async () => {
      const ok = await abrirDialogo({ titulo: 'Registrar a entrega?', rotuloConfirmar: 'Registrar entrega', rotuloCancelar: 'Voltar',
        mensagens: ['As unidades dos itens pendentes saem do estoque agora. Só é possível com as unidades realmente produzidas ou recebidas.',
          ...pendentes.map((i) => `${nomeItem(i)}: ${i.quantidade} (${i.reservado ?? 0} já separadas)`)] });
      if (!ok) return;
      await executar('entrega', null, (k) => registrarEntrega(v.id, v.versao, k), () => anunciar('sucesso', 'Entrega registrada. O estoque foi baixado.'));
    }));
    acao = el('div', { class: 'pilha' },
      el('p', {}, 'Itens sob encomenda aguardando produção ou entrega. A entrega só é registrada com as unidades no estoque.'), entregar);
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-itens' },
    el('h2', { id: 'titulo-itens' }, 'Itens'),
    el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-itens' },
      el('caption', { class: 'visualmente-oculto' }, 'Itens da venda com o preço do momento da venda'),
      el('thead', {}, el('tr', {}, ...['Produto', 'Qtd.', 'Preço', 'Desconto', 'Valor', 'Entrega', comCusto ? 'Custo' : null].filter(Boolean).map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...v.itens.map((i) => el('tr', {},
        el('th', { scope: 'row' }, nomeItem(i), i.sob_encomenda ? el('span', { class: 'chip chip--info chip--pequeno' }, 'sob encomenda') : null),
        el('td', { class: 'numero', 'data-rotulo': 'Qtd.' }, String(i.quantidade)),
        el('td', { class: 'numero', 'data-rotulo': 'Preço' }, dinheiro(i.preco_centavos)),
        el('td', { class: 'numero', 'data-rotulo': 'Desconto' }, i.desconto_centavos ? dinheiro(i.desconto_centavos) : '—'),
        el('td', { class: 'numero', 'data-rotulo': 'Valor' }, dinheiro(i.valor_centavos)),
        el('td', { 'data-rotulo': 'Entrega' }, i.destino_cancelamento ? DESTINO[i.destino_cancelamento] : (i.entrega === 'pendente'
          ? `Pendente: ${i.reservado ?? 0} separadas, ${i.quantidade - (i.reservado ?? 0)} a produzir` : (i.entrega ? 'Entregue' : '—'))),
        comCusto ? el('td', { class: 'numero', 'data-rotulo': 'Custo' }, dinheiro(i.custo_centavos)) : null))))),
    acao);
}

function botaoReceber(pa) {
  const botao = el('button', { type: 'button', class: 'botao botao--secundario', 'data-receber': pa.sequencia }, 'Registrar recebimento');
  botao.addEventListener('click', () => ocupado(botao, async () => {
    const id = `receber-${pa.sequencia}`;
    const valoresR = await dialogoFormulario({
      id, titulo: `Recebimento da parcela ${pa.sequencia}`, rotuloConfirmar: 'Registrar recebimento',
      descricao: [`Saldo em aberto: ${dinheiro(pa.saldo_centavos)}. Registre só o que foi pago de fato.`],
      campos: [
        campoTexto({ nome: 'valor', rotulo: 'Valor recebido (R$)', obrigatorio: true, id: `${id}-valor`, valor: (pa.saldo_centavos / 100).toFixed(2).replace('.', ',') }),
        campoSelecao({ nome: 'forma', rotulo: 'Forma', opcoes: FORMAS, obrigatorio: true, id: `${id}-forma` }),
        campoConta(id, 'Entrou na conta'),
        campoTexto({ nome: 'data', rotulo: 'Data do recebimento', tipo: 'date', valor: dataDeHoje(), id: `${id}-data` })].filter(Boolean),
      validar: (form) => {
        const d = valores(form);
        const r = lerValorEmReais(d.valor ?? '');
        if (!r.ok) return erroNoCampo(form, 'valor', r.erro) && null;
        if (r.centavos > pa.saldo_centavos) return erroNoCampo(form, 'valor', `O valor passa do saldo (${dinheiro(pa.saldo_centavos)}).`) && null;
        if (!d.forma) return erroNoCampo(form, 'forma', 'Escolha a forma de pagamento.') && null;
        if (d.data && d.data > dataDeHoje()) return erroNoCampo(form, 'data', 'A data não pode estar no futuro.') && null;
        return { centavos: r.centavos, forma: d.forma, data: d.data, conta: d.conta };
      },
    });
    if (!valoresR) return;
    await executar(`receber-${pa.id}`, null, (k) => registrarRecebimento(pa.id, valoresR.centavos, valoresR.forma, valoresR.data, k, valoresR.conta),
      (r) => anunciar('sucesso', `Recebimento de ${dinheiro(valoresR.centavos)} registrado.`, el('p', {}, `Falta receber desta venda: ${dinheiro(r.saldo_titulo_centavos)}.`)));
  }));
  return botao;
}

function secaoFinanceiro() {
  if (v.estado === 'rascunho' || !v.pagamento) return null;
  const p = v.pagamento;
  const parcelas = v.parcelas.map((pa) => el('li', { class: 'cartao linha-item', 'data-parcela': pa.sequencia },
    el('span', {}, el('strong', {}, `Parcela ${pa.sequencia}`), ` · ${dinheiro(pa.valor_centavos)} · vence ${formatarData(pa.vencimento)}`,
      Number.isInteger(pa.prazo_dias) ? ` (${pa.prazo_dias} DDL)` : '', pa.forma_prevista ? ` · ${FORMA[pa.forma_prevista] ?? pa.forma_prevista}` : '',
      pa.saldo_centavos && pa.estado !== 'cancelada' ? ` · falta ${dinheiro(pa.saldo_centavos)}` : '',
      ` · ${({ aberta: 'em aberto', parcial: 'recebida em parte', liquidada: 'recebida', cancelada: 'cancelada' })[pa.estado]}`),
    v.estado === 'confirmada' && pa.saldo_centavos > 0 && pa.estado !== 'cancelada' && podeReceber() ? botaoReceber(pa) : null));
  const recebimentos = v.recebimentos.map((r) => {
    let acao = null;
    if (r.tipo === 'recebimento' && !r.estornado && v.estado === 'confirmada' && ctx.pode('financeiro.cancelar')) {
      acao = el('button', { type: 'button', class: 'botao botao--texto', 'data-estornar': r.id }, 'Estornar');
      acao.addEventListener('click', () => ocupado(acao, async () => {
        const id = `estorno-${r.id.slice(0, 8)}`;
        const res = await dialogoFormulario({ id, titulo: 'Estornar recebimento?', rotuloConfirmar: 'Estornar',
          descricao: [`${dinheiro(r.valor_centavos)} em ${FORMA[r.forma]}. O estorno cria um registro inverso; o original continua no histórico.`],
          campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo do estorno', obrigatorio: true, linhas: 3, max: 300, id: `${id}-motivo`, ajuda: 'De 10 a 300 caracteres.' })],
          validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });
        if (!res) return;
        await executar(`estornar-${r.id}`, null, (k) => estornarRecebimento(r.id, res.motivo, k), () => anunciar('sucesso', 'Recebimento estornado. O valor voltou a ficar em aberto.'));
      }));
    }
    const rotulo = { recebimento: 'Recebimento', estorno: 'Estorno', devolucao: 'Devolução ao cliente' }[r.tipo];
    return el('li', { class: 'linha-item' }, el('span', {}, `${formatarData(r.data)} · ${rotulo}${r.parcela ? ` (parcela ${r.parcela})` : ''} · ${dinheiro(r.valor_centavos)} · ${FORMA[r.forma]} · ${r.autor_nome}`,
      r.estornado ? ' · estornado' : '', r.motivo ? ` · ${r.motivo}` : ''), acao);
  });
  let devolucao = null;
  if (v.estado === 'cancelada' && p.a_devolver_centavos > 0) {
    const botao = podeReceber() ? el('button', { type: 'button', class: 'botao', id: 'registrar-devolucao' }, 'Registrar devolução do valor') : null;
    botao?.addEventListener('click', () => ocupado(botao, async () => {
      const id = 'devolucao';
      const res = await dialogoFormulario({ id, titulo: 'Devolução do valor ao cliente', rotuloConfirmar: 'Registrar devolução',
        descricao: [`Falta devolver ${dinheiro(p.a_devolver_centavos)}. Registre o que foi devolvido de fato.`],
        campos: [campoTexto({ nome: 'valor', rotulo: 'Valor devolvido (R$)', obrigatorio: true, id: `${id}-valor`, valor: (p.a_devolver_centavos / 100).toFixed(2).replace('.', ',') }),
          campoSelecao({ nome: 'forma', rotulo: 'Forma', opcoes: FORMAS, obrigatorio: true, id: `${id}-forma` }),
          campoConta(id, 'Saiu da conta'),
          campoTexto({ nome: 'motivo', rotulo: 'Observação', max: 300, id: `${id}-motivo` })].filter(Boolean),
        validar: (form) => {
          const d = valores(form);
          const r = lerValorEmReais(d.valor ?? '');
          if (!r.ok) return erroNoCampo(form, 'valor', r.erro) && null;
          if (r.centavos > p.a_devolver_centavos) return erroNoCampo(form, 'valor', `O valor passa do que falta devolver (${dinheiro(p.a_devolver_centavos)}).`) && null;
          if (!d.forma) return erroNoCampo(form, 'forma', 'Escolha a forma.') && null;
          return { centavos: r.centavos, forma: d.forma, motivo: d.motivo, conta: d.conta };
        } });
      if (!res) return;
      await executar('devolucao', null, (k) => registrarDevolucaoValor(p.titulo_id, res.centavos, res.forma, res.motivo, k, res.conta), () => anunciar('sucesso', 'Devolução registrada.'));
    }));
    devolucao = el('div', { role: 'status' }, aviso('alerta', `Valor a devolver ao cliente: ${dinheiro(p.a_devolver_centavos)}.`, botao));
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-financeiro' },
    el('h2', { id: 'titulo-financeiro' }, 'Pagamento'),
    el('p', {}, `Recebido ${dinheiro(p.recebido_centavos)} de ${dinheiro(p.total_centavos)}.`, v.estado === 'confirmada' ? ` Falta receber ${dinheiro(p.saldo_centavos)}.` : ''),
    devolucao,
    parcelas.length ? el('ul', { class: 'lista-simples', id: 'lista-parcelas' }, ...parcelas) : null,
    el('h3', {}, 'Registros'),
    recebimentos.length ? el('ul', { class: 'lista-simples', id: 'lista-recebimentos' }, ...recebimentos) : el('p', { id: 'lista-recebimentos' }, 'Nenhum valor registrado ainda.'));
}

function secaoAcoes() {
  const acoes = [];
  if (v.estado === 'rascunho') {
    if (ctx.pode('vendas.criar') && (v.eh_autor || ctx.pode('vendas.aprovar'))) {
      acoes.push(el('a', { class: 'botao', href: `/business/venda-nova.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(v.id)}`, id: 'editar-rascunho' },
        ctx.pode('vendas.aprovar') ? 'Revisar e confirmar' : 'Editar rascunho'));
      const descartar = el('button', { type: 'button', class: 'botao botao--texto' }, 'Descartar rascunho');
      descartar.addEventListener('click', () => ocupado(descartar, async () => {
        const ok = await abrirDialogo({ titulo: 'Descartar este rascunho?', mensagens: ['O rascunho não mexeu no estoque nem no financeiro. O descarte fica registrado no histórico.'],
          rotuloConfirmar: 'Descartar', rotuloCancelar: 'Manter rascunho' });
        if (!ok) return;
        await executar('descartar', null, (k) => descartarVenda(v.id, v.versao, k), () => { location.href = `/business/vendas.html?id=${encodeURIComponent(ctx.id)}`; });
      }));
      acoes.push(descartar);
    }
  }
  if (v.estado === 'confirmada' && ctx.pode('vendas.cancelar')) {
    const cancelar = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-venda' }, 'Cancelar venda');
    cancelar.addEventListener('click', () => ocupado(cancelar, async () => {
      const entregues = v.itens.filter((i) => i.entrega === 'entregue');
      const id = 'cancelamento';
      const res = await dialogoFormulario({ id, titulo: `Cancelar a venda nº ${v.numero}?`, rotuloConfirmar: 'Cancelar venda', rotuloCancelar: 'Manter venda',
        descricao: ['O cancelamento é total e fica registrado com o motivo. Itens pendentes liberam a reserva. Valores já recebidos ficam a devolver até você registrar a devolução.'],
        campos: [
          ...entregues.map((i) => campoSelecao({ nome: `destino-${i.variacao_id}`, rotulo: `${nomeItem(i)} (${i.quantidade}): o que aconteceu?`, opcoes: DESTINOS, obrigatorio: true, id: `${id}-${i.variacao_id}` })),
          campoTexto({ nome: 'motivo', rotulo: 'Motivo do cancelamento', obrigatorio: true, linhas: 3, max: 300, id: `${id}-motivo`, ajuda: 'De 10 a 300 caracteres.' })],
        validar: (form) => {
          const d = valores(form);
          const destinos = {};
          for (const i of entregues) {
            if (!d[`destino-${i.variacao_id}`]) return erroNoCampo(form, `destino-${i.variacao_id}`, 'Escolha o que aconteceu com o item.') && null;
            destinos[i.variacao_id] = d[`destino-${i.variacao_id}`];
          }
          if ((d.motivo ?? '').length < 10) return erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null;
          return { motivo: d.motivo, destinos };
        } });
      if (!res) return;
      await executar('cancelar', null, (k) => cancelarVenda(v.id, res.motivo, res.destinos, v.versao, k), (r) => anunciar('sucesso', 'Venda cancelada.',
        r.a_devolver_centavos ? el('p', {}, `Há ${dinheiro(r.a_devolver_centavos)} a devolver ao cliente.`) : null));
    }));
    acoes.push(cancelar);
  }
  return acoes.length ? el('section', { class: 'pilha', 'aria-label': 'Ações da venda' }, el('div', { class: 'grupo-botoes' }, ...acoes)) : null;
}

function secaoEventos() {
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-eventos' },
    el('h2', { id: 'titulo-eventos' }, 'Histórico'),
    el('ul', { class: 'lista-simples', id: 'lista-eventos' }, ...v.eventos.map((e) => el('li', {}, `${formatarDataHora(e.criado_em)} · ${EVENTOS[e.tipo] ?? e.tipo} · ${e.ator_nome}`,
      e.detalhes?.motivo ? ` · ${e.detalhes.motivo}` : ''))));
}

/**
 * IB03: logo depois de confirmar, a venda aparece com o comprovante CK e o selo "confirmada". Só quando o banco
 * devolve a venda como confirmada; o comprovante 3D não diz que um documento foi impresso ou gerado (o PDF é outro botão).
 */
function confirmacaoRecente() {
  if (parametro('confirmada') !== '1' || v.estado !== 'confirmada') return null;
  try { const url = new URL(location.href); url.searchParams.delete('confirmada'); history.replaceState(null, '', url); } catch { /* segue sem limpar a URL */ }
  const bloco = el('div', { class: 'com-momento', role: 'status' },
    aviso('sucesso', `Venda nº ${v.numero} registrada.`, el('p', {}, `Total ${dinheiro(v.total_centavos)}. O comprovante em PDF pode ser baixado abaixo.`)));
  montarMomento(bloco, 'IB03', { tamanho: 'g' }).disparar();
  return bloco;
}

async function carregar() {
  mostrarCarregando(area, 'Carregando a venda');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'vendas'));
    if (!ctx.pode('vendas.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui ver vendas desta empresa.')));
      return;
    }
    v = await lerVenda(vendaId);
    // Só quem registra valores escolhe a conta; sem o M07 ou sem acesso, fica a conta padrão.
    contas = podeReceber() ? await lerContas(ctx.id).catch(() => []) : [];
    document.getElementById('titulo-pagina').textContent = v.numero ? `Venda nº ${v.numero}` : 'Rascunho de venda';
    concluirCarregamento(area);
    // M13 (D13-08): comprovante de pedido ou venda (não para rascunho), para quem vê as vendas; sem custo dos itens.
    const pdf = v.estado !== 'rascunho' ? el('p', {}, botaoPdf({ rotulo: v.origem === 'pedido' ? 'Baixar comprovante do pedido (PDF)' : 'Baixar comprovante da venda (PDF)',
      id: 'baixar-pdf-venda', anunciar,
      montar: async () => comprovanteVenda(v, { empresa: ctx.empresa?.nome_publico ?? 'Empresa', usuario: await nomeDeQuemGera(), agora: new Date() }),
      registrar: (chave) => registrarExportacaoPdf(ctx.id, 'venda', v.id, null, null, chave) })) : null;
    area.append(...[confirmacaoRecente(), secaoResumo(), pdf, secaoAcoes(), secaoItens(), secaoFinanceiro(), secaoEventos(),
      el('p', {}, el('a', { href: `/business/vendas.html?id=${encodeURIComponent(ctx.id)}` }, 'Voltar para as vendas'))].filter(Boolean));
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
