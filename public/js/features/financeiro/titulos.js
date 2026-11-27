/**
 * Contas a pagar e a receber (M07, UI-043; RF-122 a RF-124, RF-127, RF-131, RF-132; D7-07, D7-10):
 * lista com situação calculada pelo banco, conta nova com parcelas, baixa parcial na conta escolhida, estorno,
 * cancelamento com motivo e conta a pagar gerada a partir de uma compra registrada.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, grupoOpcoes, valores, erroNoCampo, limparErros, ocupado } from '../../ui/formulario.js';
import {
  titulos as lerTitulos, titulo as lerTitulo, contas as lerContas, categorias as lerCategorias, criarTitulo, cancelarTitulo,
  registrarRecebimento, estornarRecebimento, registrarPagamento, estornarPagamento, comprasParaContaPagar, gerarTituloCompra,
} from '../../data/financeiro.js';
import { SITUACOES, sugerirParcelas } from '../../domain/financeiro.js';
import {
  carregarFinanceiro, criarAnunciador, criarExecutorFinanceiro, dinheiro, dataDeHoje, formatarData, dialogoFormulario, FORMAS, FORMA,
  chipEstado, opcoesContas, contaPadrao, opcoesCategorias, centavosDoCampo, reaisParaCampo, avisoRegistro, erroDeCarga, dados,
} from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let contas = [];
let categorias = [];
let filtros = { situacao: 'abertos' };
let detalheId = parametro('titulo');

const executar = criarExecutorFinanceiro({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const podeBaixar = (t) => ctx.pode('financeiro.aprovar') || (t.tipo === 'receber' && t.origem_tipo === 'venda' && ctx.pode('vendas.registrar_recebimento'));
const ORIGEM = { venda: 'Venda', manual: 'Lançada à mão', compra: 'Compra de fornecedor', recorrencia: 'Despesa recorrente' };

function secaoFiltros() {
  const form = el('form', { id: 'form-filtros', class: 'pilha', role: 'search' },
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'tipo', rotulo: 'Tipo', opcoes: [['receber', 'A receber'], ['pagar', 'A pagar']], valor: filtros.tipo, vazio: 'A pagar e a receber', id: 'filtro-tipo' }),
      campoSelecao({ nome: 'situacao', rotulo: 'Situação', opcoes: SITUACOES, valor: filtros.situacao, vazio: null, id: 'filtro-situacao' }),
      campoTexto({ nome: 'texto', rotulo: 'Buscar por descrição ou nome', valor: filtros.texto, id: 'filtro-texto' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Filtrar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    filtros = Object.fromEntries(Object.entries(valores(form)).filter(([, v]) => v));
    carregar();
  });
  return form;
}

function linha(t) {
  const ver = el('button', { type: 'button', class: 'botao botao--texto', 'data-ver': t.id }, 'Ver parcelas');
  ver.addEventListener('click', () => { detalheId = t.id; carregar(); });
  return el('tr', { 'data-titulo': t.id },
    el('th', { scope: 'row' }, t.descricao, el('span', { class: 'campo__ajuda' }, ` ${t.tipo === 'pagar' ? 'A pagar' : 'A receber'} · ${ORIGEM[t.origem_tipo]}`)),
    el('td', { 'data-rotulo': 'De ou para' }, t.contraparte ?? '—'),
    el('td', { 'data-rotulo': 'Categoria' }, t.categoria ?? '—'),
    el('td', { 'data-rotulo': 'Próximo vencimento' }, t.proximo_vencimento ? formatarData(t.proximo_vencimento) : '—'),
    el('td', { class: 'numero', 'data-rotulo': 'Total' }, dinheiro(t.total_centavos)),
    el('td', { class: 'numero', 'data-rotulo': 'Falta' }, dinheiro(t.saldo_centavos)),
    el('td', { 'data-rotulo': 'Situação' }, chipEstado(t.estado_exibicao)),
    el('td', { 'data-rotulo': 'Ações' }, ver));
}

function secaoLista(r) {
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-lista' },
    el('h2', { id: 'titulo-lista' }, `Contas (${r.total})`),
    secaoFiltros(),
    r.itens.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-titulos' },
      el('caption', { class: 'visualmente-oculto' }, 'Contas a pagar e a receber, das que vencem antes para as que vencem depois'),
      el('thead', {}, el('tr', {}, ...['Conta', 'De ou para', 'Categoria', 'Próximo vencimento', 'Total', 'Falta', 'Situação', 'Ações'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...r.itens.map(linha)))) : el('p', { id: 'tabela-titulos' }, 'Nenhuma conta encontrada com esses filtros.'));
}

/** Diálogo de baixa (recebimento ou pagamento) com valor, conta, forma e data. */
async function baixar(t, pa) {
  const id = `baixa-${pa.sequencia}`;
  const pagar = t.tipo === 'pagar';
  const res = await dialogoFormulario({
    id, titulo: `${pagar ? 'Pagamento' : 'Recebimento'} da parcela ${pa.sequencia}`, rotuloConfirmar: pagar ? 'Registrar pagamento' : 'Registrar recebimento',
    descricao: [`Falta ${dinheiro(pa.saldo_centavos)} nesta parcela. Registre só o que foi ${pagar ? 'pago' : 'recebido'} de fato; pode ser uma parte.`],
    campos: [
      campoTexto({ nome: 'valor', rotulo: `Valor ${pagar ? 'pago' : 'recebido'} (R$)`, obrigatorio: true, id: `${id}-valor`, valor: reaisParaCampo(pa.saldo_centavos) }),
      campoSelecao({ nome: 'conta', rotulo: pagar ? 'Saiu da conta' : 'Entrou na conta', opcoes: opcoesContas(contas), valor: contaPadrao(contas), obrigatorio: true, id: `${id}-conta` }),
      campoSelecao({ nome: 'forma', rotulo: 'Forma', opcoes: FORMAS, obrigatorio: true, id: `${id}-forma` }),
      campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', valor: dataDeHoje(), id: `${id}-data`, ajuda: 'Pode ser uma data passada de um mês ainda aberto; nunca no futuro.' })],
    validar: (form) => {
      const centavos = centavosDoCampo(form, 'valor', erroNoCampo);
      if (centavos === null) return null;
      if (centavos > pa.saldo_centavos) return erroNoCampo(form, 'valor', `O valor passa do que falta (${dinheiro(pa.saldo_centavos)}).`) && null;
      const d = valores(form);
      if (!d.conta) return erroNoCampo(form, 'conta', 'Escolha a conta.') && null;
      if (!d.forma) return erroNoCampo(form, 'forma', 'Escolha a forma.') && null;
      if (d.data && d.data > dataDeHoje()) return erroNoCampo(form, 'data', 'A data não pode estar no futuro.') && null;
      return { centavos, conta: d.conta, forma: d.forma, data: d.data };
    },
  });
  if (!res) return;
  await executar(`baixa-${pa.id}`, null,
    (k) => (pagar ? registrarPagamento(pa.id, res.centavos, res.conta, res.forma, res.data, k) : registrarRecebimento(pa.id, res.centavos, res.forma, res.data, k, res.conta)),
    (r) => anunciar('sucesso', `${pagar ? 'Pagamento' : 'Recebimento'} de ${dinheiro(res.centavos)} registrado.`, el('p', {}, `Falta nesta conta: ${dinheiro(r.saldo_titulo_centavos)}.`)));
}

async function estornar(t, b) {
  const id = `estorno-${b.id.slice(0, 8)}`;
  const res = await dialogoFormulario({ id, titulo: 'Estornar este registro?', rotuloConfirmar: 'Estornar',
    descricao: [`${dinheiro(b.valor_centavos)} em ${FORMA[b.forma]}, conta ${b.conta}. O estorno cria um registro inverso com a data de hoje; o original continua no histórico.`],
    campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo do estorno', obrigatorio: true, linhas: 3, max: 300, id: `${id}-motivo`, ajuda: 'De 10 a 300 caracteres.' })],
    validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });
  if (!res) return;
  await executar(`estornar-${b.id}`, null, (k) => (t.tipo === 'pagar' ? estornarPagamento(b.id, res.motivo, k) : estornarRecebimento(b.id, res.motivo, k)),
    () => anunciar('sucesso', 'Registro estornado. O valor voltou a ficar em aberto.'));
}

async function cancelar(t) {
  const res = await dialogoFormulario({ id: 'cancelar-titulo', titulo: 'Cancelar esta conta?', rotuloConfirmar: 'Cancelar a conta', rotuloCancelar: 'Voltar',
    descricao: ['A conta deixa de ser cobrada, mas continua no histórico com o motivo.'],
    campos: [campoTexto({ nome: 'motivo', rotulo: 'Motivo do cancelamento', obrigatorio: true, linhas: 3, max: 300, id: 'cancelar-titulo-motivo', ajuda: 'De 10 a 300 caracteres.' })],
    validar: (form) => { const m = valores(form).motivo ?? ''; return m.length >= 10 ? { motivo: m } : (erroNoCampo(form, 'motivo', 'Explique com pelo menos 10 caracteres.') && null); } });
  if (!res) return;
  await executar(`cancelar-${t.id}`, null, (k) => cancelarTitulo(t.id, res.motivo, t.versao, k), () => anunciar('sucesso', 'Conta cancelada.'));
}

function secaoDetalhe(t) {
  const fechar = el('button', { type: 'button', class: 'botao botao--texto', id: 'fechar-detalhe' }, 'Fechar detalhe');
  fechar.addEventListener('click', () => { detalheId = null; carregar(); });
  const parcelas = t.parcelas.map((pa) => {
    let acao = null;
    if (t.estado !== 'cancelado' && pa.saldo_centavos > 0 && pa.estado !== 'cancelada' && podeBaixar(t)) {
      acao = el('button', { type: 'button', class: 'botao botao--secundario', 'data-baixar': pa.sequencia }, t.tipo === 'pagar' ? 'Registrar pagamento' : 'Registrar recebimento');
      acao.addEventListener('click', () => ocupado(acao, () => baixar(t, pa)));
    }
    return el('li', { class: 'cartao linha-item', 'data-parcela': pa.sequencia },
      el('span', {}, el('strong', {}, `Parcela ${pa.sequencia}`), ` · ${dinheiro(pa.valor_centavos)} · vence ${formatarData(pa.vencimento)}`,
        pa.saldo_centavos && pa.estado !== 'cancelada' ? ` · falta ${dinheiro(pa.saldo_centavos)} ` : ' ', chipEstado(pa.estado_exibicao)), acao);
  });
  const baixas = t.baixas.map((b) => {
    let acao = null;
    if ((b.tipo === 'recebimento' || b.tipo === 'pagamento') && !b.estornado && t.estado !== 'cancelado' && ctx.pode('financeiro.cancelar')) {
      acao = el('button', { type: 'button', class: 'botao botao--texto', 'data-estornar': b.id }, 'Estornar');
      acao.addEventListener('click', () => ocupado(acao, () => estornar(t, b)));
    }
    const rotulo = { recebimento: 'Recebimento', pagamento: 'Pagamento', estorno: 'Estorno', devolucao: 'Devolução ao cliente' }[b.tipo];
    return el('li', { class: 'linha-item' }, el('span', {}, `${formatarData(b.data)} · ${rotulo} · ${dinheiro(b.valor_centavos)} · ${FORMA[b.forma]} · ${b.conta} · ${b.autor}`,
      b.estornado ? ' · estornado' : '', b.motivo ? ` · ${b.motivo}` : ''), acao);
  });
  let cancelamento = null;
  if (t.origem_tipo !== 'venda' && t.estado !== 'cancelado' && t.baixado_centavos === 0 && ctx.pode('financeiro.cancelar')) {
    cancelamento = el('button', { type: 'button', class: 'botao botao--secundario', id: 'cancelar-titulo-botao' }, 'Cancelar esta conta');
    cancelamento.addEventListener('click', () => ocupado(cancelamento, () => cancelar(t)));
  }
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-detalhe', id: 'detalhe-titulo', tabindex: '-1' },
    el('h2', { id: 'titulo-detalhe' }, t.descricao),
    el('p', { class: 'opcoes' }, chipEstado(t.estado_exibicao), el('span', { class: 'chip chip--neutro' }, t.tipo === 'pagar' ? 'A pagar' : 'A receber'),
      el('span', { class: 'chip chip--neutro' }, ORIGEM[t.origem_tipo])),
    dados([['De ou para', t.contraparte ?? '—'], ['Categoria', t.categoria ?? '—'], ['Mês de referência', formatarData(t.competencia)],
      ['Total', dinheiro(t.total_centavos)], [t.tipo === 'pagar' ? 'Pago' : 'Recebido', dinheiro(t.baixado_centavos)], ['Falta', dinheiro(t.saldo_centavos)],
      t.motivo_cancelamento ? ['Motivo do cancelamento', t.motivo_cancelamento] : null]),
    t.origem_tipo === 'venda' ? el('p', {}, el('a', { class: 'botao botao--secundario', href: `/business/venda.html?id=${encodeURIComponent(ctx.id)}&venda=${encodeURIComponent(t.origem_id)}` }, 'Abrir a venda')) : null,
    el('h3', {}, 'Parcelas'), el('ul', { class: 'lista-simples', id: 'lista-parcelas' }, ...parcelas),
    el('h3', {}, 'Registros'), baixas.length ? el('ul', { class: 'lista-simples', id: 'lista-baixas' }, ...baixas) : el('p', { id: 'lista-baixas' }, 'Nenhum valor registrado ainda.'),
    el('div', { class: 'grupo-botoes' }, cancelamento, fechar));
}

function secaoNova() {
  const tipo = 'pagar';
  const categoria = el('div', { id: 'campo-categoria' });
  const montarCategoria = (t) => categoria.replaceChildren(campoSelecao({ nome: 'categoria_id', rotulo: 'Categoria', obrigatorio: true, id: 'nova-categoria',
    opcoes: opcoesCategorias(categorias, t === 'receber' ? 'receita' : 'despesa') }));
  const previa = el('ul', { class: 'lista-simples', id: 'previa-parcelas', 'aria-live': 'polite' });
  const form = el('form', { id: 'form-nova-conta', class: 'pilha', novalidate: true },
    grupoOpcoes({ nome: 'tipo', legenda: 'É uma conta', opcoes: [['pagar', 'A pagar'], ['receber', 'A receber']], marcados: [tipo] }),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, max: 120, id: 'nova-descricao', ajuda: 'Ex.: Aluguel de novembro, Conserto do freezer.' }),
    categoria,
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'total', rotulo: 'Valor total (R$)', obrigatorio: true, id: 'nova-total' }),
      campoSelecao({ nome: 'parcelas', rotulo: 'Número de parcelas', opcoes: Array.from({ length: 24 }, (_, i) => [String(i + 1), String(i + 1)]), valor: '1', vazio: null, id: 'nova-parcelas' }),
      campoTexto({ nome: 'vencimento', rotulo: 'Primeiro vencimento', tipo: 'date', obrigatorio: true, valor: dataDeHoje(), id: 'nova-vencimento' }),
      campoTexto({ nome: 'competencia', rotulo: 'Mês de referência', tipo: 'date', valor: dataDeHoje(), id: 'nova-competencia', ajuda: 'O mês a que a conta se refere (para o resultado do mês).' })),
    campoTexto({ nome: 'contraparte_texto', rotulo: 'De quem ou para quem (opcional)', max: 120, id: 'nova-contraparte' }),
    el('div', { class: 'pilha' }, el('h3', {}, 'Parcelas que serão criadas'), previa),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao', id: 'salvar-conta' }, 'Lançar conta')));
  const atualizarPrevia = () => {
    const r = centavosDoCampo(form, 'total', () => false);
    const n = Number(form.elements.parcelas.value);
    const venc = form.elements.vencimento.value;
    previa.replaceChildren();
    if (!r || !venc) { previa.append(el('li', {}, 'Informe o valor total e o primeiro vencimento.')); return null; }
    try {
      const lista = sugerirParcelas(r, n, venc);
      previa.append(...lista.map((p, i) => el('li', {}, `Parcela ${i + 1}: ${dinheiro(p.valor_centavos)}, vence ${formatarData(p.vencimento)}`)));
      return lista;
    } catch (e) {
      previa.append(el('li', {}, e.message));
      return null;
    }
  };
  montarCategoria(tipo);
  form.addEventListener('change', (e) => { if (e.target.name === 'tipo') montarCategoria(e.target.value); atualizarPrevia(); });
  form.addEventListener('input', () => atualizarPrevia());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.descricao || d.descricao.length < 2) return erroNoCampo(form, 'descricao', 'Descreva a conta (2 a 120 caracteres).');
    if (!d.categoria_id) return erroNoCampo(form, 'categoria_id', 'Escolha a categoria.');
    const total = centavosDoCampo(form, 'total', erroNoCampo);
    if (total === null) return null;
    if (!d.vencimento) return erroNoCampo(form, 'vencimento', 'Informe o primeiro vencimento.');
    let parcelas;
    try { parcelas = sugerirParcelas(total, Number(d.parcelas), d.vencimento); } catch (erro) { return erroNoCampo(form, 'total', erro.message); }
    const dadosConta = { tipo: d.tipo, descricao: d.descricao, categoria_id: d.categoria_id, competencia: d.competencia || dataDeHoje(), parcelas,
      ...(d.contraparte_texto ? { contraparte_tipo: 'texto', contraparte_texto: d.contraparte_texto } : {}) };
    // O detalhe da conta nova abre na recarga seguinte.
    return executar('nova-conta', form, (k) => criarTitulo(ctx.id, dadosConta, k).then((t) => { detalheId = t.id; return t; }),
      (t) => anunciar('sucesso', `Conta "${t.descricao}" lançada com ${t.parcelas.length} parcela(s).`));
  });
  atualizarPrevia();
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-nova' }, el('h2', { id: 'titulo-nova' }, 'Lançar conta a pagar ou a receber'), form);
}

function secaoCompras(compras) {
  if (!compras?.length) return null;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-compras' },
    el('h2', { id: 'titulo-compras' }, 'Compras sem conta a pagar'),
    el('p', { class: 'campo__ajuda' }, 'Opcional: gere a conta a pagar de uma compra registrada. Compras pagas na hora não precisam disso.'),
    el('ul', { class: 'lista-simples', id: 'lista-compras' }, ...compras.map((c) => {
      const botao = el('button', { type: 'button', class: 'botao botao--secundario', 'data-compra': c.id }, 'Gerar conta a pagar');
      botao.addEventListener('click', () => ocupado(botao, async () => {
        const res = await dialogoFormulario({ id: 'conta-compra', titulo: 'Conta a pagar da compra', rotuloConfirmar: 'Gerar conta a pagar',
          descricao: [`${c.fornecedor ?? 'Fornecedor não informado'} · ${formatarData(c.data_compra)} · ${dinheiro(c.custo_total_centavos)}. A conta fica na categoria Compras de mercadorias e insumos.`],
          campos: [campoSelecao({ nome: 'parcelas', rotulo: 'Número de parcelas', opcoes: Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)]), valor: '1', vazio: null, id: 'conta-compra-parcelas' }),
            campoTexto({ nome: 'vencimento', rotulo: 'Primeiro vencimento', tipo: 'date', valor: dataDeHoje(), obrigatorio: true, id: 'conta-compra-vencimento' })],
          validar: (form) => { const d = valores(form); return d.vencimento ? d : (erroNoCampo(form, 'vencimento', 'Informe o vencimento.') && null); } });
        if (!res) return;
        await executar(`compra-${c.id}`, null, (k) => gerarTituloCompra(c.id, { parcelas: sugerirParcelas(c.custo_total_centavos, Number(res.parcelas), res.vencimento) }, k)
          .then((t) => { detalheId = t.id; return t; }), () => anunciar('sucesso', 'Conta a pagar da compra gerada.'));
      }));
      return el('li', { class: 'linha-item' }, el('span', {}, `${formatarData(c.data_compra)} · ${c.fornecedor ?? 'Fornecedor não informado'}${c.numero_documento ? ` · doc. ${c.numero_documento}` : ''} · ${dinheiro(c.custo_total_centavos)}`), botao);
    })));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as contas');
  try {
    ctx = await carregarFinanceiro(area, nav, 'titulos');
    if (!ctx) return;
    const [lista, cs, cats, compras, det] = await Promise.all([
      lerTitulos(ctx.id, filtros, 100, 0), lerContas(ctx.id), lerCategorias(ctx.id),
      ctx.pode('financeiro.criar') ? comprasParaContaPagar(ctx.id) : Promise.resolve(null),
      detalheId ? lerTitulo(detalheId).catch((e) => (e.codigo === 'NOT_FOUND' ? null : Promise.reject(e))) : Promise.resolve(null)]);
    contas = cs;
    categorias = cats;
    concluirCarregamento(area);
    area.append(...[avisoRegistro(), det ? secaoDetalhe(det) : null, secaoLista(lista),
      ctx.pode('financeiro.criar') ? secaoNova() : el('p', {}, 'Seu perfil pode consultar, mas não lançar contas.'),
      ctx.pode('financeiro.criar') ? secaoCompras(compras) : null].filter(Boolean));
    if (det) document.getElementById('detalhe-titulo')?.focus();
  } catch (erro) {
    erroDeCarga(area, erro, tratarErro, carregar);
  }
}

carregar();
