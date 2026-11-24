/**
 * Produtos da empresa (M05, UI-027): lista com filtros, visão consolidada do estoque por
 * produto (D5-02) e cadastro com ou sem variações (D5-12). Finalidade sempre escolhida (D5-01).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, grupoOpcoes, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { lerValorEmReais } from '../../domain/moeda.js';
import { lerQuantidade, faixaDePreco, variacoesRepetidas } from '../../domain/variacoes.js';
import { produtosDaEmpresa, criarProduto, FINALIDADES } from '../../data/estoque.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel } from './comum.js';
import { etiquetaPreco, menorPreco } from '../../ui/pecas-forja.js';
import { vazioComMomento } from '../../ui/forja3d/momentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let produtos = [];
let filtro = { texto: '', tipo: 'ativos' };

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

const chip = (classe, icone, texto) => el('span', { class: `chip ${classe}` }, el('span', { 'aria-hidden': 'true' }, icone), texto);

function selos(p) {
  return el('p', { class: 'opcoes' },
    chip('chip--neutro', '•', FINALIDADES[p.finalidade]),
    p.sob_encomenda ? chip('chip--info', '…', 'Sob encomenda') : null,
    p.venda_pausada ? chip('chip--alerta', '‖', 'Venda pausada') : null,
    p.ativo ? null : chip('chip--erro', '✕', 'Desativado'),
    p.resumo?.variacoes_em_alerta ? chip('chip--alerta', '!', `Estoque baixo em ${p.resumo.variacoes_em_alerta} ${p.resumo.variacoes_em_alerta === 1 ? 'variação' : 'variações'}`) : null);
}

function cartao(p) {
  const ativas = p.variacoes.filter((v) => v.ativo);
  const nomeadas = ativas.filter((v) => !v.padrao);
  return el('li', { class: 'cartao com-momento', 'data-produto': p.id },
    etiquetaPreco(menorPreco(p.variacoes)),
    el('div', { class: 'pilha' },
      el('h3', { class: 'cartao__titulo' }, el('a', { href: `/business/produto.html?id=${encodeURIComponent(ctx.id)}&produto=${encodeURIComponent(p.id)}` }, p.nome)),
      selos(p),
      el('p', { class: 'cartao__meta' },
        [faixaDePreco(ativas), nomeadas.length ? `${nomeadas.length} ${nomeadas.length === 1 ? 'variação' : 'variações'}` : 'Sem variações']
          .filter(Boolean).join(' · ')),
      p.resumo ? el('p', {}, `Disponível: ${quantidadeLegivel(p.resumo.disponivel)} · Físico: ${quantidadeLegivel(p.resumo.fisico)} · Reservado: ${quantidadeLegivel(p.resumo.reservado)}`) : null));
}

function lista() {
  const texto = filtro.texto.trim().toLowerCase();
  const visiveis = produtos.filter((p) => {
    if (texto && !p.nome.toLowerCase().includes(texto) && !p.variacoes.some((v) => (v.sku ?? '').toLowerCase().includes(texto))) return false;
    switch (filtro.tipo) {
      case 'ativos': return p.ativo;
      case 'comercializavel': return p.ativo && p.finalidade === 'comercializavel';
      case 'uso_interno': return p.ativo && p.finalidade === 'uso_interno';
      case 'baixo': return p.ativo && p.resumo?.variacoes_em_alerta > 0;
      case 'pausados': return p.venda_pausada;
      case 'desativados': return !p.ativo;
      default: return true;
    }
  });
  const ul = el('ul', { class: 'lista-simples', id: 'lista-produtos' }, ...visiveis.map(cartao));
  if (visiveis.length) return ul;
  return produtos.length ? el('p', { id: 'lista-produtos' }, 'Nenhum produto com esses filtros.') : vazioComMomento('IB02', { id: 'lista-produtos' }, 'Nenhum produto cadastrado ainda.');
}

function filtros() {
  const busca = el('input', { id: 'busca-produtos', type: 'search', value: filtro.texto, autocomplete: 'off' });
  const tipo = el('select', { id: 'filtro-produtos' }, ...[
    ['ativos', 'Ativos'], ['comercializavel', 'Comercializáveis'], ['uso_interno', 'Uso interno'],
    ...(ctx.pode('estoque.visualizar') ? [['baixo', 'Estoque baixo']] : []),
    ['pausados', 'Venda pausada'], ['desativados', 'Desativados'], ['todos', 'Todos'],
  ].map(([v, r]) => el('option', { value: v, selected: v === filtro.tipo }, r)));
  const atualizar = () => {
    filtro = { texto: busca.value, tipo: tipo.value };
    document.getElementById('lista-produtos').replaceWith(lista());
  };
  busca.addEventListener('input', atualizar);
  tipo.addEventListener('change', atualizar);
  return el('div', { class: 'grade-filtros' },
    el('div', { class: 'campo' }, el('label', { for: 'busca-produtos' }, 'Buscar por nome ou código'), busca),
    el('div', { class: 'campo' }, el('label', { for: 'filtro-produtos' }, 'Mostrar'), tipo));
}

// --- Cadastro --------------------------------------------------------------------
function camposPrecoEstoque(pref, comCusto, comEstoque) {
  return [
    campoTexto({ nome: `${pref}-preco`, rotulo: 'Preço de venda (R$)', obrigatorio: true, id: `${pref}-preco`, ajuda: 'Exemplo: 49,90' }),
    campoTexto({ nome: `${pref}-sku`, rotulo: 'Código (SKU)', max: 60, id: `${pref}-sku` }),
    campoTexto({ nome: `${pref}-minimo`, rotulo: 'Estoque mínimo', id: `${pref}-minimo`, ajuda: 'Opcional. Abaixo disso, aparece o alerta.' }),
    comEstoque ? campoTexto({ nome: `${pref}-inicial`, rotulo: 'Estoque inicial', id: `${pref}-inicial`, ajuda: 'Opcional.' }) : null,
    comCusto ? campoTexto({ nome: `${pref}-custo`, rotulo: 'Custo unitário (R$)', id: `${pref}-custo`, ajuda: 'Opcional. Só quem vê custo enxerga.' }) : null,
  ];
}

function linhaVariacao(n, nomes, comCusto, comEstoque) {
  const pref = `var-${n}`;
  return el('fieldset', { class: 'campo modulo-permissoes linha-variacao', 'data-linha': n },
    el('legend', {}, `Variação ${n + 1}`),
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: `${pref}-a1`, rotulo: nomes[0] || 'Atributo 1', max: 40, id: `${pref}-a1` }),
      nomes[1] ? campoTexto({ nome: `${pref}-a2`, rotulo: nomes[1], max: 40, id: `${pref}-a2` }) : null,
      ...camposPrecoEstoque(pref, comCusto, comEstoque)));
}

function lerLinha(form, pref, { obrigatorioPreco = true } = {}) {
  const d = valores(form);
  const saida = {};
  const preco = lerValorEmReais(d[`${pref}-preco`] ?? '');
  if (!preco.ok || preco.centavos <= 0) {
    if (obrigatorioPreco) return { erro: [`${pref}-preco`, preco.ok ? 'O preço precisa ser maior que zero.' : preco.erro] };
  } else saida.preco_centavos = preco.centavos;
  if (d[`${pref}-sku`]) saida.sku = d[`${pref}-sku`];
  for (const [campo, chave, comSinal] of [[`${pref}-minimo`, 'estoque_minimo', false], [`${pref}-inicial`, 'quantidade_inicial', false]]) {
    if (!d[campo]) continue;
    if (chave === 'estoque_minimo' && d[campo] === '0') { saida.estoque_minimo = 0; continue; }
    const q = lerQuantidade(d[campo], { comSinal });
    if (!q.ok) return { erro: [campo, q.erro] };
    saida[chave] = q.valor;
  }
  if (d[`${pref}-custo`]) {
    const c = lerValorEmReais(d[`${pref}-custo`]);
    if (!c.ok) return { erro: [`${pref}-custo`, c.erro] };
    saida.custo_centavos = c.centavos;
  }
  return { valor: saida };
}

function formularioNovo() {
  const comCusto = ctx.pode('produtos.ver_custo');
  const comEstoque = ctx.pode('estoque.propor') || ctx.pode('estoque.aprovar');
  let linhas = 1;
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Cadastrar produto');
  const grade = el('div', { class: 'pilha', id: 'grade-variacoes' });
  const simples = el('div', { class: 'pilha', id: 'bloco-simples' });
  const atributos = el('div', { class: 'grade-filtros', id: 'nomes-atributos' },
    campoTexto({ nome: 'atributo1', rotulo: 'Nome do atributo 1', max: 40, id: 'novo-atributo1', ajuda: 'Exemplo: Cor' }),
    campoTexto({ nome: 'atributo2', rotulo: 'Nome do atributo 2 (opcional)', max: 40, id: 'novo-atributo2', ajuda: 'Exemplo: Tamanho' }));
  const maisLinha = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Adicionar variação');
  const blocoVariacoes = el('div', { class: 'pilha', id: 'bloco-variacoes', hidden: true }, atributos, grade, el('div', { class: 'grupo-botoes' }, maisLinha));
  const form = el('form', { id: 'form-novo-produto', class: 'pilha', novalidate: true },
    campoTexto({ nome: 'nome', rotulo: 'Nome do produto', obrigatorio: true, max: 120, id: 'novo-nome' }),
    grupoOpcoes({ nome: 'finalidade', legenda: 'Para que serve este produto? (obrigatório)', opcoes: Object.entries(FINALIDADES),
      ajuda: 'Comercializável pode ir à vitrine depois da aprovação da CK. Uso interno (insumo) nunca aparece para clientes.' }),
    grupoOpcoes({ nome: 'tem_variacoes', legenda: 'O produto tem variações (cor, tamanho, modelo)?', opcoes: [['nao', 'Não, é um produto simples'], ['sim', 'Sim, tem variações']], marcados: ['nao'] }),
    el('div', { class: 'opcao' }, el('input', { id: 'novo-sob-encomenda', type: 'checkbox', name: 'sob_encomenda', value: 'sim' }),
      el('label', { for: 'novo-sob-encomenda' }, 'Também é feito ou comprado sob encomenda (pedido aceito mesmo sem estoque)')),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição', linhas: 3, max: 2000, id: 'novo-descricao' }),
    simples, blocoVariacoes,
    el('div', { class: 'grupo-botoes' }, botao));
  simples.append(el('fieldset', { class: 'campo modulo-permissoes' }, el('legend', {}, 'Preço e estoque'),
    el('div', { class: 'grade-filtros' }, ...camposPrecoEstoque('simples', comCusto, comEstoque))));
  const nomes = () => [valores(form).atributo1, valores(form).atributo2].filter(Boolean);
  const redesenhar = () => grade.replaceChildren(...Array.from({ length: linhas }, (_, i) => linhaVariacao(i, nomes(), comCusto, comEstoque)));
  maisLinha.addEventListener('click', () => { if (linhas < 50) { linhas += 1; grade.append(linhaVariacao(linhas - 1, nomes(), comCusto, comEstoque)); } });
  // Renomear os atributos redesenha a grade, preservando o que já foi digitado.
  atributos.addEventListener('change', () => {
    const antes = valores(form);
    redesenhar();
    for (const [nome, valor] of Object.entries(antes)) {
      const campo = grade.querySelector(`[name="${nome}"]`);
      if (campo && typeof valor === 'string') campo.value = valor;
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'tem_variacoes') return;
    const sim = e.target.value === 'sim';
    blocoVariacoes.hidden = !sim;
    simples.hidden = sim;
    if (sim && !grade.children.length) redesenhar();
  });
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.nome || d.nome.length < 2) return erroNoCampo(form, 'nome', 'Informe o nome do produto.');
    if (!d.finalidade) return erroNoCampo(form, 'finalidade', 'Escolha se o produto é comercializável ou de uso interno.');
    const dados = { nome: d.nome, finalidade: d.finalidade, sob_encomenda: d.sob_encomenda === 'sim' };
    if (d.descricao) dados.descricao = d.descricao;
    let variacoes = null;
    if (d.tem_variacoes === 'sim') {
      const n1 = d.atributo1;
      const n2 = d.atributo2;
      if (!n1) return erroNoCampo(form, 'atributo1', 'Dê um nome ao atributo (por exemplo, Cor).');
      variacoes = [];
      for (let i = 0; i < linhas; i += 1) {
        const pref = `var-${i}`;
        const atr = {};
        if (d[`${pref}-a1`]) atr[n1] = d[`${pref}-a1`];
        if (n2 && d[`${pref}-a2`]) atr[n2] = d[`${pref}-a2`];
        if (!Object.keys(atr).length) return erroNoCampo(form, `${pref}-a1`, `Informe ${n1.toLowerCase()} desta variação.`);
        const lida = lerLinha(form, pref);
        if (lida.erro) return erroNoCampo(form, ...lida.erro);
        variacoes.push({ atributos: atr, ...lida.valor });
      }
      const repetidas = variacoesRepetidas(variacoes.map((v) => v.atributos));
      if (repetidas.length) return erroNoCampo(form, `var-${repetidas[0]}-a1`, 'Esta variação repete outra.');
    } else {
      const lida = lerLinha(form, 'simples');
      if (lida.erro) return erroNoCampo(form, ...lida.erro);
      Object.assign(dados, lida.valor);
    }
    ocupado(botao, () => executar('criar', form, (k) => criarProduto(ctx.id, dados, variacoes, k), (r) => {
      const pendente = r.estoque_inicial?.estado === 'pendente';
      anunciar('sucesso', `Produto "${r.nome}" cadastrado.`,
        r.estoque_inicial ? el('p', {}, pendente ? 'O estoque inicial foi enviado para aprovação.' : 'O estoque inicial já está lançado.') : null,
        el('p', {}, el('a', { href: `/business/produto.html?id=${encodeURIComponent(ctx.id)}&produto=${encodeURIComponent(r.id)}` }, 'Abrir o produto')));
    }));
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-novo-produto' },
    el('h2', { id: 'titulo-novo-produto' }, 'Cadastrar produto'), form);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando os produtos');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'produtos'));
    if (!ctx.pode('produtos.visualizar') && !ctx.pode('estoque.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui os produtos desta empresa.')));
      return;
    }
    produtos = await produtosDaEmpresa(ctx.id);
    document.getElementById('titulo-pagina').textContent = `Produtos de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    area.append(...[
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-lista-produtos' },
        el('h2', { id: 'titulo-lista-produtos' }, `Produtos (${produtos.filter((p) => p.ativo).length} ativos)`),
        filtros(), lista()),
      ctx.pode('produtos.criar') ? formularioNovo() : null,
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
