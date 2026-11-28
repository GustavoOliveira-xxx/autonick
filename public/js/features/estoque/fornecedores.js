/**
 * Fornecedores (pacote 27/11, item 4.1): consulta primeiro. Lista enxuta com busca (nome, fantasia, CPF/CNPJ, cidade,
 * contato), situação e resumo de compras; "Adicionar fornecedor" e "Editar" em modal (PF/PJ, CPF/CNPJ opcional, contato,
 * endereço com Buscar CEP); detalhes com endereço e últimas compras. Desativar preserva as compras antigas.
 * As compras ficam em Compras (compras.html). Endereço antigo "fornecedores.html#compras" leva para lá.
 */
import { dicaContextual } from '../../ui/onboarding.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoSelecao, erroNoCampo, ocupado } from '../../ui/formulario.js';
import { abrirModal } from '../../ui/modal.js';
import { barraConsulta, vazio } from '../../ui/consulta.js';
import { enderecoEmLinha } from '../../ui/cadastro-pessoa.js';
import { abrirCadastroFornecedor } from './fornecedor-modal.js';
import { documentoParaLista, mascararDocumento } from '../../domain/documentos.js';
import { formatarCentavos } from '../../domain/moeda.js';
import { fornecedoresDaEmpresa, alterarFornecedor, compras as lerCompras, ESTADOS_COMPRA } from '../../data/estoque.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor } from './comum.js';

if (/^#compras/.test(location.hash) || new URLSearchParams(location.search).get('aba') === 'compras') {
  location.replace(`/business/compras.html${location.search.replace(/([?&])aba=compras&?/, '$1').replace(/[?&]$/, '')}`);
}

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let lista = [];
let busca = '';
let situacao = 'ativos';
const corpoLista = el('div', { id: 'resultado-fornecedores', 'aria-live': 'polite' });

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const dataCurta = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : '');
const telefone = (t) => (t && t.length >= 10 ? `(${t.slice(0, 2)}) ${t.slice(2, -4)}-${t.slice(-4)}` : t ?? '');

async function abrirDetalhes(f, origem) {
  const corpo = el('div', { class: 'pilha', 'aria-live': 'polite' });
  const modal = abrirModal({ titulo: f.nome, descricao: f.nome_fantasia ?? null, corpo, tamanho: 'grande', aoFechar: () => origem?.focus() });
  const linhas = [
    ['Tipo', f.tipo_pessoa === 'pf' ? 'Pessoa física' : 'Pessoa jurídica'],
    f.documento ? [f.tipo_pessoa === 'pf' ? 'CPF' : 'CNPJ', mascararDocumento(f.documento, f.tipo_pessoa)] : null,
    f.contato_nome ? ['Contato', f.contato_nome] : null,
    f.telefone ? ['Telefone', telefone(f.telefone)] : null,
    f.email ? ['E-mail', f.email] : null,
    enderecoEmLinha(f) ? ['Endereço', enderecoEmLinha(f)] : null,
    f.observacoes ? ['Observações', f.observacoes] : null,
    ['Situação', f.ativo ? 'Ativo' : 'Desativado (compras antigas continuam no histórico)'],
  ].filter(Boolean);
  corpo.append(el('dl', { class: 'resumo-ficha' }, ...linhas.map(([k, v]) => el('div', {}, el('dt', {}, el('small', {}, k)), el('dd', {}, el('strong', {}, v))))));
  if (ctx.pode('estoque.visualizar')) {
    const bloco = el('section', { class: 'pilha' }, el('h3', {}, 'Compras deste fornecedor'), el('p', {}, 'Carregando…'));
    corpo.append(bloco);
    try {
      const compras = (await lerCompras(ctx.id)).filter((c) => c.fornecedor_id === f.id).slice(0, 20);
      bloco.replaceChildren(el('h3', {}, 'Compras deste fornecedor'), compras.length
        ? el('ul', { class: 'lista-simples' }, ...compras.map((c) => el('li', { class: 'linha-ficha' },
          el('a', { href: `/business/compras.html?id=${encodeURIComponent(ctx.id)}&compra=${encodeURIComponent(c.id)}` }, `Compra de ${dataCurta(c.data_compra)}${c.numero_documento ? ` · ${c.numero_documento}` : ''}`),
          el('span', { class: 'campo__ajuda' }, [ESTADOS_COMPRA[c.estado], Number.isSafeInteger(c.custo_total_centavos) ? formatarCentavos(c.custo_total_centavos) : null].filter(Boolean).join(' · ')))))
        : el('p', {}, 'Nenhuma compra registrada com este fornecedor.'));
    } catch (erro) { bloco.replaceChildren(aviso('erro', erro.message)); }
  }
  if (ctx.pode('estoque.propor') && f.ativo) {
    corpo.append(el('div', { class: 'grupo-botoes' }, el('a', { class: 'botao', href: `/business/compras.html?id=${encodeURIComponent(ctx.id)}&nova=1&fornecedor=${encodeURIComponent(f.id)}` }, 'Nova compra deste fornecedor')));
  }
  return modal;
}

function linha(f) {
  const detalhes = el('button', { type: 'button', class: 'botao botao--secundario', 'data-detalhes': f.id }, 'Detalhes', el('span', { class: 'visualmente-oculto' }, ` de ${f.nome}`));
  detalhes.addEventListener('click', () => abrirDetalhes(f, detalhes));
  const acoes = [detalhes];
  if (ctx.pode('fornecedores.alterar')) {
    const editar = el('button', { type: 'button', class: 'botao botao--secundario', 'data-editar': f.id }, 'Editar', el('span', { class: 'visualmente-oculto' }, ` ${f.nome}`));
    editar.addEventListener('click', () => abrirCadastroFornecedor({ ctx, atual: f, origem: editar, aoSalvar: async () => { await carregar(); anunciar('sucesso', 'Fornecedor salvo.'); } }));
    const ativar = el('button', { type: 'button', class: 'botao botao--texto', 'data-ativo': f.id }, f.ativo ? 'Desativar' : 'Reativar', el('span', { class: 'visualmente-oculto' }, ` ${f.nome}`));
    ativar.addEventListener('click', () => ocupado(ativar, () => executar(`ativo-${f.id}`, null, (k) => alterarFornecedor(f.id, { ativo: !f.ativo }, f.versao, k),
      () => anunciar('sucesso', f.ativo ? 'Fornecedor desativado. As compras antigas continuam no histórico.' : 'Fornecedor reativado.'))));
    acoes.push(editar, ativar);
  }
  return el('tr', { 'data-fornecedor': f.id, class: f.ativo ? null : 'inativo' },
    el('th', { scope: 'row' }, el('strong', {}, f.nome), f.nome_fantasia ? el('span', { class: 'sub' }, f.nome_fantasia) : null,
      f.documento ? el('span', { class: 'sub' }, documentoParaLista(f.documento)) : null,
      f.ativo ? null : el('span', { class: 'chip chip--neutro chip--pequeno' }, 'desativado')),
    el('td', { 'data-rotulo': 'Contato' }, [f.contato_nome, telefone(f.telefone), f.email].filter(Boolean).join(' · ') || '—'),
    el('td', { 'data-rotulo': 'Cidade' }, [f.cidade, f.uf].filter(Boolean).join('/') || '—'),
    el('td', { 'data-rotulo': 'Compras', class: 'numero' }, f.compras === undefined ? '—' : `${f.compras}${f.ultima_compra ? ` · ${dataCurta(f.ultima_compra)}` : ''}`),
    el('td', { 'data-rotulo': 'Ações' }, el('div', { class: 'acoes-linha' }, ...acoes)));
}

function botaoNovo(id = 'novo-fornecedor') {
  const b = el('button', { type: 'button', class: 'botao', id }, 'Adicionar fornecedor');
  b.addEventListener('click', () => abrirCadastroFornecedor({ ctx, origem: b, aoSalvar: async (r) => { await carregar(); anunciar('sucesso', `Fornecedor "${r.nome}" cadastrado.`); } }));
  return b;
}

function desenhar() {
  document.getElementById('titulo-fornecedores')?.replaceChildren(`Fornecedores (${lista.length})`);
  corpoLista.replaceChildren(lista.length
    ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'lista-fornecedores' },
      el('caption', { class: 'visualmente-oculto' }, 'Fornecedores da empresa'),
      el('thead', {}, el('tr', {}, ...['Fornecedor', 'Contato', 'Cidade', 'Compras', 'Ações'].map((c) => el('th', { scope: 'col', class: c === 'Compras' ? 'numero' : null }, c)))),
      el('tbody', {}, ...lista.map(linha))))
    : vazio(busca ? `Nenhum fornecedor encontrado para "${busca}".` : situacao === 'inativos' ? 'Nenhum fornecedor desativado.' : 'Nenhum fornecedor cadastrado ainda.',
      !busca && situacao === 'ativos' && ctx.pode('fornecedores.alterar') ? botaoNovo('nao-ha-fornecedores') : null, 'lista-fornecedores'));
}

async function buscar() {
  lista = await fornecedoresDaEmpresa(ctx.id, busca, situacao);
  if (!Array.isArray(lista)) lista = [];
  desenhar();
}

async function carregar() {
  mostrarCarregando(area, 'Carregando os fornecedores');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'fornecedores'));
    if (!ctx.pode('fornecedores.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui os fornecedores desta empresa.',
        ctx.pode('estoque.visualizar') ? el('p', {}, el('a', { class: 'botao botao--secundario', href: `/business/compras.html?id=${encodeURIComponent(ctx.id)}` }, 'Ver compras')) : null)));
      return;
    }
    document.getElementById('titulo-pagina').textContent = `Fornecedores de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    lista = await fornecedoresDaEmpresa(ctx.id, busca, situacao);
    if (!Array.isArray(lista)) lista = [];
    concluirCarregamento(area);
    area.append(dicaContextual({ chave: 'business.fornecedores', titulo: 'Fornecedores', texto: 'CNPJ não é obrigatório para autônomos. Desativar um fornecedor não apaga as compras antigas.', empresaId: ctx.id }));
    const filtro = campoSelecao({ nome: 'situacao', rotulo: 'Situação', opcoes: [['ativos', 'Ativos'], ['inativos', 'Desativados'], ['todos', 'Todos']], valor: situacao, vazio: null, id: 'filtro-situacao' });
    filtro.querySelector('select').addEventListener('change', (e) => { situacao = e.target.value; buscar(); });
    const barra = barraConsulta({ id: 'busca-fornecedor', rotulo: 'Buscar fornecedores', valor: busca, dica: 'Nome, fantasia, CNPJ/CPF, cidade ou contato',
      aoBuscar: async (v) => { busca = v; await buscar(); barra.anunciar(`${lista.length} fornecedores encontrados.`); },
      acoes: [ctx.pode('fornecedores.alterar') ? botaoNovo() : null,
        ctx.pode('estoque.visualizar') ? el('a', { class: 'botao botao--secundario', href: `/business/compras.html?id=${encodeURIComponent(ctx.id)}` }, 'Ver compras') : null],
      filtros: [filtro] });
    area.append(el('section', { class: 'pilha', 'aria-labelledby': 'titulo-fornecedores' }, el('h2', { id: 'titulo-fornecedores' }, 'Fornecedores'), barra.elemento, corpoLista));
    desenhar();
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { class: 'botao botao--secundario', href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
