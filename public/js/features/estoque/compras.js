/**
 * Compras (pacote 27/11, item 4.2): consulta primeiro. Lista com fornecedor, data, referência, itens, total (quem vê custo)
 * e situação; busca e filtros por situação e período; detalhes sob demanda.
 * "Nova compra" em modal: fornecedor por busca (com "Novo fornecedor" sem perder o rascunho), produtos por busca,
 * quantidades, custos (só quem tem "ver custo"), data, documento e observação.
 * Regras preservadas: rascunho -> registrar gera a proposta de entrada (quem aprova estoque recebe na hora, D5-04);
 * a entrada no estoque acontece uma vez, na aprovação; conta a pagar é gerada no Financeiro, uma por compra.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirModal } from '../../ui/modal.js';
import { barraConsulta, vazio } from '../../ui/consulta.js';
import { autocompletar } from '../../ui/autocompletar.js';
import { lerValorEmReais, formatarCentavos } from '../../domain/moeda.js';
import { lerQuantidade } from '../../domain/variacoes.js';
import { compras as lerCompras, criarCompra, registrarCompra, cancelarCompra, produtosDaEmpresa, fornecedoresDaEmpresa, ESTADOS_COMPRA } from '../../data/estoque.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel, novaChave } from './comum.js';
import { abrirCadastroFornecedor } from './fornecedor-modal.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let todas = [];
let produtos = null;
const filtros = { busca: '', estado: '', de: '', ate: '' };
const corpoLista = el('div', { id: 'resultado-compras', 'aria-live': 'polite' });
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const q = encodeURIComponent;
const dataCurta = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const nomeItem = (i) => (i.rotulo === 'Padrão' ? i.produto_nome : `${i.produto_nome} (${i.rotulo})`);
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chipEstado = (e) => el('span', { class: `chip ${e === 'recebida' ? 'chip--sucesso' : e === 'cancelada' ? 'chip--erro' : e === 'registrada' ? 'chip--alerta' : 'chip--info'}` }, ESTADOS_COMPRA[e] ?? e);

function filtradas() {
  const t = semAcento(filtros.busca);
  return todas.filter((c) => (!filtros.estado || c.estado === filtros.estado)
    && (!filtros.de || c.data_compra >= filtros.de) && (!filtros.ate || c.data_compra <= filtros.ate)
    && (!t || semAcento([c.fornecedor_nome, c.numero_documento, c.observacao, ...(c.itens ?? []).map(nomeItem)].join(' ')).includes(t)));
}

function acoesDaCompra(c, depois) {
  const acoes = [];
  if (c.estado === 'rascunho' && ctx.pode('estoque.propor')) {
    const registrar = el('button', { type: 'button', class: 'botao', 'data-registrar': c.id }, ctx.pode('estoque.aprovar') ? 'Registrar e receber no estoque' : 'Registrar compra');
    registrar.addEventListener('click', () => ocupado(registrar, () => executar(`registrar-${c.id}`, null, (k) => registrarCompra(c.id, c.versao, k),
      (r) => { depois?.(); anunciar('sucesso', r.estado === 'recebida' ? 'Compra recebida: o estoque já foi atualizado.' : 'Compra registrada. A entrada aguarda aprovação.'); })));
    acoes.push(registrar);
  }
  if ((c.estado === 'rascunho' && (c.sou_autor || ctx.pode('estoque.aprovar'))) || (c.estado === 'registrada' && ctx.pode('estoque.aprovar'))) {
    const botao = el('button', { type: 'submit', class: 'botao botao--perigo' }, 'Cancelar compra');
    const form = el('form', { class: 'pilha', novalidate: true },
      campoTexto({ nome: 'motivo', rotulo: 'Motivo do cancelamento', obrigatorio: true, max: 300, id: `cancelar-compra-${c.id}` }),
      el('div', { class: 'grupo-botoes' }, botao));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const { motivo } = valores(form);
      if (!motivo || motivo.length < 3) return erroNoCampo(form, 'motivo', 'Explique o cancelamento.');
      ocupado(botao, () => executar(`cancelar-${c.id}`, form, (k) => cancelarCompra(c.id, motivo, c.versao, k), () => { depois?.(); anunciar('sucesso', 'Compra cancelada.'); }));
    });
    acoes.push(el('details', { class: 'detalhes-opcionais' }, el('summary', {}, 'Cancelar esta compra'), form));
  }
  if (['registrada', 'recebida'].includes(c.estado) && Number.isSafeInteger(c.custo_total_centavos) && c.custo_total_centavos > 0 && !c.tem_conta_pagar && ctx.pode('financeiro.criar')) {
    acoes.push(el('a', { class: 'botao botao--secundario', href: `/business/financeiro-contas.html?id=${q(ctx.id)}#titulo-compras` }, 'Gerar conta a pagar no Financeiro'));
  }
  return acoes;
}

function abrirDetalhes(c, origem = null) {
  const modal = abrirModal({ titulo: `Compra de ${dataCurta(c.data_compra)}`, descricao: [c.fornecedor_nome ?? 'Sem fornecedor', c.numero_documento].filter(Boolean).join(' · '),
    tamanho: 'grande', aoFechar: () => origem?.focus(),
    corpo: el('div', { class: 'pilha' },
      el('p', { class: 'opcoes' }, chipEstado(c.estado), c.tem_conta_pagar ? el('span', { class: 'chip chip--info' }, 'conta a pagar gerada') : null),
      el('div', { class: 'tabela-container' }, el('table', { class: 'tabela' },
        el('caption', { class: 'visualmente-oculto' }, 'Itens da compra'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Produto'), el('th', { scope: 'col', class: 'numero' }, 'Quantidade'), el('th', { scope: 'col', class: 'numero' }, 'Custo unitário'))),
        el('tbody', {}, ...(c.itens ?? []).map((i) => el('tr', {}, el('th', { scope: 'row' }, nomeItem(i)),
          el('td', { class: 'numero', 'data-rotulo': 'Quantidade' }, quantidadeLegivel(i.quantidade)),
          el('td', { class: 'numero', 'data-rotulo': 'Custo unitário' }, Number.isSafeInteger(i.custo_centavos) ? formatarCentavos(i.custo_centavos) : '—')))))),
      Number.isSafeInteger(c.custo_total_centavos) ? el('p', { class: 'numero-grande' }, `Custo total: ${formatarCentavos(c.custo_total_centavos)}`)
        : el('p', { class: 'campo__ajuda' }, ctx.pode('produtos.ver_custo') ? 'Sem custo informado em todos os itens.' : 'Seu perfil não vê custos.'),
      c.observacao ? el('p', {}, el('strong', {}, 'Observação: '), c.observacao) : null,
      c.motivo_cancelamento ? el('p', {}, el('strong', {}, 'Cancelada: '), c.motivo_cancelamento) : null,
      el('p', { class: 'campo__ajuda' }, `Criada por ${c.autor_nome} em ${formatarDataHora(c.criado_em)}`),
      c.estado === 'registrada' ? el('p', { class: 'campo__ajuda' }, 'A entrada no estoque acontece quando alguém com permissão aprova a proposta em Estoque.') : null,
      ...(() => { const a = acoesDaCompra(c, () => modal.fechar()); return a.length ? [el('div', { class: 'pilha' }, ...a)] : []; })()) });
  return modal;
}

function linha(c) {
  const detalhes = el('button', { type: 'button', class: 'botao botao--secundario', 'data-compra-detalhes': c.id }, 'Detalhes', el('span', { class: 'visualmente-oculto' }, ` da compra de ${dataCurta(c.data_compra)}`));
  detalhes.addEventListener('click', () => abrirDetalhes(c, detalhes));
  const qtd = c.quantidade_total ?? (c.itens ?? []).reduce((t, i) => t + i.quantidade, 0);
  const n = (c.itens ?? []).length;
  const principal = acoesDaCompra(c).find((a) => a.matches?.('[data-registrar]'));
  return el('tr', { 'data-compra': c.id, class: c.estado === 'cancelada' ? 'inativo' : null },
    el('th', { scope: 'row' }, el('strong', {}, dataCurta(c.data_compra)), c.numero_documento ? el('span', { class: 'sub' }, c.numero_documento) : null),
    el('td', { 'data-rotulo': 'Fornecedor' }, c.fornecedor_nome ?? 'Sem fornecedor'),
    el('td', { 'data-rotulo': 'Itens' }, `${n} ${n === 1 ? 'item' : 'itens'} · ${quantidadeLegivel(qtd)}`,
      el('span', { class: 'sub' }, (c.itens ?? []).slice(0, 2).map(nomeItem).join(', ') + (n > 2 ? '…' : ''))),
    el('td', { 'data-rotulo': 'Total', class: 'numero' }, Number.isSafeInteger(c.custo_total_centavos) ? formatarCentavos(c.custo_total_centavos) : '—'),
    el('td', { 'data-rotulo': 'Situação' }, chipEstado(c.estado)),
    el('td', { 'data-rotulo': 'Ações' }, el('div', { class: 'acoes-linha' }, detalhes, principal ?? null)));
}

function desenhar() {
  const lista = filtradas();
  document.getElementById('titulo-compras')?.replaceChildren(`Compras (${lista.length})`);
  corpoLista.replaceChildren(lista.length
    ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'lista-compras' },
      el('caption', { class: 'visualmente-oculto' }, 'Compras da empresa, das mais recentes para as mais antigas'),
      el('thead', {}, el('tr', {}, ...['Data', 'Fornecedor', 'Itens', 'Total', 'Situação', 'Ações'].map((c) => el('th', { scope: 'col', class: c === 'Total' ? 'numero' : null }, c)))),
      el('tbody', {}, ...lista.map(linha))))
    : vazio(todas.length ? 'Nenhuma compra com esses filtros.' : 'Nenhuma compra registrada ainda.',
      !todas.length && ctx.pode('estoque.propor') ? botaoNova('nao-ha-compras') : null, 'lista-compras'));
}

function botaoNova(id = 'nova-compra') {
  const b = el('button', { type: 'button', class: 'botao', id }, 'Nova compra');
  b.addEventListener('click', () => abrirNovaCompra({ origem: b }));
  return b;
}

/** Modal da nova compra. O rascunho fica no modal enquanto a pessoa cadastra um fornecedor em outro modal por cima. */
async function abrirNovaCompra({ origem = null, fornecedorId = null } = {}) {
  produtos ??= await produtosDaEmpresa(ctx.id);
  const variacoes = [];
  for (const p of (Array.isArray(produtos) ? produtos : []).filter((x) => x.ativo)) {
    for (const v of (p.variacoes ?? []).filter((x) => x.ativo)) variacoes.push({ id: v.id, nome: v.padrao ? p.nome : `${p.nome} (${v.rotulo})`, sku: v.sku ?? '' });
  }
  const comCusto = ctx.pode('produtos.ver_custo');
  const podeFornecedor = ctx.pode('fornecedores.visualizar');
  let fornecedores = podeFornecedor ? await fornecedoresDaEmpresa(ctx.id, null, 'ativos') : [];
  if (!Array.isArray(fornecedores)) fornecedores = [];
  let fornecedor = fornecedores.find((f) => f.id === fornecedorId) ?? null;
  const itens = []; // { id, nome, quantidade, custo }
  let sujo = false;

  const form = el('form', { class: 'pilha', id: 'form-nova-compra', novalidate: true });
  const resumoFornecedor = el('div', { id: 'compra-fornecedor-escolhido', 'aria-live': 'polite' });
  const desenharFornecedor = () => {
    if (!fornecedor) { resumoFornecedor.replaceChildren(); campoForn?.elemento.removeAttribute('hidden'); return; }
    const trocar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Trocar fornecedor');
    trocar.addEventListener('click', () => { fornecedor = null; desenharFornecedor(); campoForn.entrada.focus(); });
    resumoFornecedor.replaceChildren(el('div', { class: 'resumo-pessoa' }, el('strong', {}, fornecedor.nome),
      el('span', {}, [fornecedor.nome_fantasia, fornecedor.cidade, fornecedor.telefone].filter(Boolean).join(' · ') || 'Fornecedor selecionado'), el('div', { class: 'grupo-botoes' }, trocar)));
    campoForn?.elemento.setAttribute('hidden', '');
  };
  const campoForn = podeFornecedor ? autocompletar({ id: 'compra-fornecedor', rotulo: 'Fornecedor (opcional)', dica: 'Digite o nome, CNPJ ou cidade',
    buscar: async (t) => {
      const s = semAcento(t);
      const achados = fornecedores.filter((f) => !s || semAcento([f.nome, f.nome_fantasia, f.documento, f.cidade].join(' ')).includes(s));
      return { itens: achados.slice(0, 8), mais: false };
    },
    rotuloItem: (f) => f.nome, detalheItem: (f) => [f.nome_fantasia, f.cidade].filter(Boolean).join(' · '),
    aoEscolher: (f) => { fornecedor = f; sujo = true; desenharFornecedor(); },
    vazioTexto: 'Nenhum fornecedor encontrado.',
    acaoExtra: ctx.pode('fornecedores.alterar') ? () => {
      const b = el('button', { type: 'button', class: 'botao botao--secundario', id: 'compra-novo-fornecedor' }, '+ Novo fornecedor');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => abrirCadastroFornecedor({ ctx, origem: campoForn.entrada, aoSalvar: async (r) => {
        fornecedores = await fornecedoresDaEmpresa(ctx.id, null, 'ativos');
        fornecedor = fornecedores.find((f) => f.id === r.id) ?? { id: r.id, nome: r.nome };
        desenharFornecedor();
      } }));
      return b;
    } : null }) : null;

  const corpoItens = el('div', { id: 'itens-compra', class: 'pilha' });
  const total = el('p', { class: 'numero-grande', id: 'compra-total', 'aria-live': 'polite' });
  const erroItens = el('span', { class: 'campo__erro', id: 'compra-itens-erro', 'data-grupo': 'itens' });
  const atualizarTotal = () => {
    if (!comCusto) { total.textContent = itens.length ? `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}` : ''; return; }
    let soma = 0;
    let completo = itens.length > 0;
    for (const i of itens) {
      const qv = lerQuantidade(document.getElementById(`compra-qtd-${i.id}`)?.value ?? '');
      const cv = (document.getElementById(`compra-custo-${i.id}`)?.value ?? '').trim();
      const c = cv ? lerValorEmReais(cv) : { ok: false };
      if (qv.ok && c.ok) soma += qv.valor * c.centavos; else completo = false;
    }
    total.textContent = itens.length ? (completo ? `Total da compra: ${formatarCentavos(soma)}` : `Total parcial: ${formatarCentavos(soma)} (preencha o custo de todos os itens para fechar o total)`) : '';
  };
  const desenharItens = () => {
    corpoItens.replaceChildren(...(itens.length ? itens.map((i) => {
      const remover = el('button', { type: 'button', class: 'botao botao--texto' }, 'Remover', el('span', { class: 'visualmente-oculto' }, ` ${i.nome}`));
      remover.addEventListener('click', () => { itens.splice(itens.indexOf(i), 1); desenharItens(); });
      const qtd = campoTexto({ nome: `qtd-${i.id}`, rotulo: 'Quantidade', valor: i.quantidade ?? '1', id: `compra-qtd-${i.id}` });
      qtd.querySelector('input').setAttribute('inputmode', 'numeric');
      const custo = comCusto ? campoTexto({ nome: `custo-${i.id}`, rotulo: 'Custo unitário (R$)', valor: i.custo ?? '', id: `compra-custo-${i.id}` }) : null;
      custo?.querySelector('input').setAttribute('inputmode', 'decimal');
      for (const c of [qtd, custo].filter(Boolean)) c.querySelector('input').addEventListener('input', (e) => { i[e.target.name.startsWith('qtd') ? 'quantidade' : 'custo'] = e.target.value; atualizarTotal(); });
      return el('div', { class: 'cartao linha-compra', 'data-item-compra': i.id }, el('p', {}, el('strong', {}, i.nome)), el('div', { class: 'grade-filtros' }, qtd, custo), el('div', { class: 'grupo-botoes' }, remover));
    }) : [el('p', { class: 'campo__ajuda' }, 'Busque os produtos acima para incluir na compra.')]));
    atualizarTotal();
  };
  const campoProduto = autocompletar({ id: 'compra-produto', rotulo: 'Adicionar produto', dica: 'Digite o nome ou o código do produto',
    buscar: async (t) => {
      const s = semAcento(t);
      const achados = variacoes.filter((v) => !s || semAcento(`${v.nome} ${v.sku}`).includes(s));
      return { itens: achados.slice(0, 10), mais: false };
    },
    rotuloItem: (v) => v.nome, detalheItem: (v) => (v.sku ? `Código ${v.sku}` : ''), vazioTexto: variacoes.length ? 'Nenhum produto encontrado.' : 'Cadastre produtos antes de registrar compras.',
    aoEscolher: (v) => {
      sujo = true;
      if (!itens.some((i) => i.id === v.id)) itens.push({ id: v.id, nome: v.nome, quantidade: '1' });
      desenharItens();
      campoProduto.limpar();
      document.getElementById(`compra-qtd-${v.id}`)?.focus();
    } });

  form.append(...[campoForn?.elemento, resumoFornecedor,
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'data_compra', rotulo: 'Data da compra', tipo: 'date', valor: hojeSp(), id: 'compra-data' }),
      campoTexto({ nome: 'numero_documento', rotulo: 'Nota ou documento (opcional)', max: 60, id: 'compra-documento' })),
    el('fieldset', { class: 'campo pilha' }, el('legend', {}, 'Itens'), campoProduto.elemento, erroItens, corpoItens, total),
    campoTexto({ nome: 'observacao', rotulo: 'Observação (opcional)', linhas: 2, max: 500, id: 'compra-observacao' }),
    el('p', { class: 'campo__ajuda' }, ctx.pode('estoque.aprovar')
      ? 'Ao registrar, a entrada no estoque acontece na hora (você tem permissão de aprovar). A conta a pagar é gerada depois, no Financeiro.'
      : 'Ao registrar, a entrada vai para aprovação de quem cuida do estoque. A conta a pagar é gerada depois, no Financeiro.')].filter(Boolean));
  form.querySelector('[name="data_compra"]').setAttribute('max', hojeSp());
  form.addEventListener('input', () => { sujo = true; });
  desenharFornecedor();
  desenharItens();

  const erroGeral = el('p', { class: 'campo__erro', role: 'alert' });
  const rascunho = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Salvar rascunho');
  const registrar = el('button', { type: 'submit', class: 'botao', form: form.id }, ctx.pode('estoque.aprovar') ? 'Salvar e receber no estoque' : 'Salvar e registrar');
  const modal = abrirModal({ titulo: 'Nova compra', tamanho: 'grande', corpo: el('div', { class: 'pilha' }, form, erroGeral), rodape: [rascunho, registrar],
    protegerAlteracoes: () => sujo, aoFechar: () => origem?.focus() });
  let chave = null;
  const montar = () => {
    limparErros(form);
    erroGeral.textContent = '';
    erroItens.textContent = '';
    if (!itens.length) { erroItens.textContent = 'Inclua pelo menos um produto.'; campoProduto.entrada.focus(); return null; }
    const lista = [];
    for (const i of itens) {
      const qv = lerQuantidade(document.getElementById(`compra-qtd-${i.id}`).value);
      if (!qv.ok) return erroNoCampo(form, `qtd-${i.id}`, qv.erro) && null;
      const item = { variacao_id: i.id, quantidade: qv.valor };
      const cv = comCusto ? document.getElementById(`compra-custo-${i.id}`).value.trim() : '';
      if (cv) {
        const c = lerValorEmReais(cv);
        if (!c.ok) return erroNoCampo(form, `custo-${i.id}`, c.erro) && null;
        item.custo_centavos = c.centavos;
      }
      lista.push(item);
    }
    const d = valores(form);
    if (d.data_compra && d.data_compra > hojeSp()) return erroNoCampo(form, 'data_compra', 'A data da compra não pode estar no futuro.') && null;
    return { cabecalho: { fornecedor_id: fornecedor?.id ?? null, numero_documento: d.numero_documento || null, data_compra: d.data_compra || null, observacao: d.observacao || null }, itens: lista };
  };
  const salvar = (registrarDepois, botao) => {
    const m = montar();
    if (!m) return;
    chave ??= novaChave();
    ocupado(botao, async () => {
      try {
        const r = await criarCompra(ctx.id, m.cabecalho, m.itens, chave);
        chave = null;
        sujo = false;
        let final = null;
        if (registrarDepois) {
          try { final = await registrarCompra(r.id, r.versao, novaChave()); } catch (erro) {
            modal.fechar();
            await carregar();
            anunciar('alerta', `A compra foi salva como rascunho, mas não foi registrada: ${erro.message}`);
            return;
          }
        }
        modal.fechar();
        await carregar();
        anunciar('sucesso', !final ? 'Compra salva como rascunho. Registre quando conferir.'
          : final.estado === 'recebida' ? 'Compra registrada e recebida: o estoque já foi atualizado.' : 'Compra registrada. A entrada aguarda aprovação.');
      } catch (erro) {
        if (erro.codigo !== 'NETWORK_UNKNOWN') chave = null;
        if (erro.codigo === 'VALIDATION_ERROR' && erroNoCampo(form, erro.campo === 'itens' ? null : erro.campo, erro.message)) return;
        erroGeral.textContent = erro.codigo === 'NETWORK_UNKNOWN' ? `${erro.message} Tente de novo: a compra não será duplicada.` : erro.message;
      }
    });
  };
  rascunho.addEventListener('click', () => salvar(false, rascunho));
  form.addEventListener('submit', (e) => { e.preventDefault(); salvar(true, registrar); });
  setTimeout(() => (fornecedor ? campoProduto.entrada : campoForn?.entrada ?? campoProduto.entrada).focus(), 30);
  return modal;
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as compras');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'compras'));
    if (!ctx.pode('estoque.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui as compras desta empresa.')));
      return;
    }
    document.getElementById('titulo-pagina').textContent = `Compras de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    todas = await lerCompras(ctx.id);
    if (!Array.isArray(todas)) todas = [];
    produtos = null;
    concluirCarregamento(area);
    const estado = campoSelecao({ nome: 'estado', rotulo: 'Situação', opcoes: Object.entries(ESTADOS_COMPRA), valor: filtros.estado, vazio: 'Todas', id: 'filtro-estado-compra' });
    estado.querySelector('select').addEventListener('change', (e) => { filtros.estado = e.target.value; desenhar(); });
    const de = campoTexto({ nome: 'de', rotulo: 'De', tipo: 'date', valor: filtros.de, id: 'filtro-de-compra' });
    const ate = campoTexto({ nome: 'ate', rotulo: 'Até', tipo: 'date', valor: filtros.ate, id: 'filtro-ate-compra' });
    de.querySelector('input').addEventListener('change', (e) => { filtros.de = e.target.value; desenhar(); });
    ate.querySelector('input').addEventListener('change', (e) => { filtros.ate = e.target.value; desenhar(); });
    const barra = barraConsulta({ id: 'busca-compra', rotulo: 'Buscar compras', valor: filtros.busca, dica: 'Fornecedor, documento, produto ou observação',
      aoBuscar: (v) => { filtros.busca = v; desenhar(); barra.anunciar(`${filtradas().length} compras encontradas.`); },
      acoes: [ctx.pode('estoque.propor') ? botaoNova() : null,
        ctx.pode('fornecedores.visualizar') ? el('a', { class: 'botao botao--secundario', href: `/business/fornecedores.html?id=${q(ctx.id)}` }, 'Fornecedores') : null],
      filtros: [estado, de, ate], filtrosAbertos: Boolean(filtros.estado || filtros.de || filtros.ate) });
    area.append(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-compras' }, el('h2', { id: 'titulo-compras' }, 'Compras'), barra.elemento, corpoLista));
    desenhar();
    const pedida = parametro('compra');
    if (pedida) { const c = todas.find((x) => x.id === pedida); if (c) abrirDetalhes(c); }
    if (parametro('nova') === '1' && ctx.pode('estoque.propor')) {
      const forn = parametro('fornecedor');
      history.replaceState(history.state, '', `/business/compras.html?id=${q(ctx.id)}`);
      abrirNovaCompra({ fornecedorId: forn });
    }
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
