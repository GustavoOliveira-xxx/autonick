/**
 * Editor de produto (M05, UI-028): dados e finalidade, pausa comercial (D5-08), ativação,
 * variações com preço, código, mínimo (D5-02) e custo protegido (D5-07), e históricos.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el, parametro } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, grupoOpcoes, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { lerValorEmReais, formatarCentavos } from '../../domain/moeda.js';
import { lerQuantidade } from '../../domain/variacoes.js';
import {
  produtosDaEmpresa, alterarProduto, pausarVenda, definirProdutoAtivo, adicionarVariacao, alterarVariacao,
  definirVariacaoAtiva, alterarPreco, alterarCusto, custosDaVariacao, historicoPrecos, FINALIDADES,
} from '../../data/estoque.js';
import { definirVitrineProduto } from '../../data/vitrine.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
const produtoId = parametro('produto');
let ctx = null;
let produto = null;

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const reais = (c) => (Number.isSafeInteger(c) ? formatarCentavos(c) : 'Não informado');

function secaoDados() {
  if (!ctx.pode('produtos.alterar')) {
    return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-dados' },
      el('h2', { id: 'titulo-dados' }, 'Dados do produto'),
      el('dl', { class: 'dados' },
        el('dt', {}, 'Finalidade'), el('dd', {}, FINALIDADES[produto.finalidade]),
        el('dt', {}, 'Sob encomenda'), el('dd', {}, produto.sob_encomenda ? 'Sim' : 'Não'),
        ...(produto.descricao ? [el('dt', {}, 'Descrição'), el('dd', {}, produto.descricao)] : [])));
  }
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Salvar dados');
  const form = el('form', { id: 'form-dados-produto', class: 'pilha', novalidate: true },
    campoTexto({ nome: 'nome', rotulo: 'Nome do produto', obrigatorio: true, max: 120, valor: produto.nome, id: 'produto-nome' }),
    grupoOpcoes({ nome: 'finalidade', legenda: 'Finalidade', opcoes: Object.entries(FINALIDADES), marcados: [produto.finalidade],
      ajuda: 'Uso interno (insumo) nunca aparece para clientes.' }),
    el('div', { class: 'opcao' }, el('input', { id: 'produto-sob-encomenda', type: 'checkbox', name: 'sob_encomenda', value: 'sim', checked: produto.sob_encomenda }),
      el('label', { for: 'produto-sob-encomenda' }, 'Também é feito ou comprado sob encomenda')),
    campoTexto({ nome: 'descricao', rotulo: 'Descrição', linhas: 3, max: 2000, valor: produto.descricao ?? '', id: 'produto-descricao' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const dados = { nome: d.nome, finalidade: d.finalidade, sob_encomenda: d.sob_encomenda === 'sim', descricao: d.descricao ?? '' };
    ocupado(botao, () => executar('dados', form, (k) => alterarProduto(produto.id, dados, produto.versao, k), () => anunciar('sucesso', 'Dados do produto salvos.')));
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-dados' }, el('h2', { id: 'titulo-dados' }, 'Dados do produto'), form);
}

function secaoVenda() {
  if (!ctx.pode('produtos.alterar')) return null;
  const pausado = produto.venda_pausada;
  const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, pausado ? 'Retomar a venda' : 'Pausar a venda');
  const form = el('form', { id: 'form-pausa', class: 'pilha', novalidate: true },
    pausado
      ? aviso('alerta', 'A venda deste produto está pausada.', produto.motivo_pausa ? el('p', {}, `Motivo: ${produto.motivo_pausa}`) : null)
      : el('p', {}, 'Pausar impede novas vendas e pedidos deste produto, mesmo com estoque. O estoque não muda.'),
    pausado ? null : campoTexto({ nome: 'motivo', rotulo: 'Motivo da pausa', max: 300, id: 'pausa-motivo', ajuda: 'Opcional. Exemplo: coleção encerrada.' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { motivo } = valores(form);
    ocupado(botao, () => executar('pausa', form, (k) => pausarVenda(produto.id, !pausado, motivo, produto.versao, k),
      () => anunciar('sucesso', pausado ? 'Venda retomada.' : 'Venda pausada. O estoque continua o mesmo.')));
  });
  const ativar = el('button', { type: 'button', class: 'botao botao--texto' }, produto.ativo ? 'Desativar produto' : 'Reativar produto');
  ativar.addEventListener('click', () => ocupado(ativar, async () => {
    if (produto.ativo) {
      const ok = await abrirDialogo({ titulo: `Desativar "${produto.nome}"?`,
        mensagens: ['O produto some das listas e não recebe novas entradas. Saldo e histórico são preservados.'],
        rotuloConfirmar: 'Desativar produto', rotuloCancelar: 'Cancelar' });
      if (!ok) return;
    }
    await executar('ativo', null, (k) => definirProdutoAtivo(produto.id, !produto.ativo, produto.versao, k),
      () => anunciar('sucesso', produto.ativo ? 'Produto reativado.' : 'Produto desativado.'));
  }));
  // M10 (D10-03 = C): comercializável não basta para aparecer na vitrine; a empresa liga o controle.
  const situacaoVitrine = el('p', { 'data-situacao-vitrine': produto.exibir_na_vitrine ? 'na_vitrine' : 'fora' },
    produto.aparece_na_vitrine ? el('span', { class: 'chip chip--sucesso' }, 'Aparece na vitrine')
      : el('span', { class: 'chip chip--neutro' }, produto.exibir_na_vitrine ? 'Marcado para a vitrine, mas não aparece agora' : 'Fora da vitrine'),
    produto.exibir_na_vitrine && !produto.aparece_na_vitrine
      ? el('span', { class: 'campo__ajuda' }, ' Só aparece se for comercializável, ativo, sem venda pausada e com variação ativa.') : null);
  let vitrine = null;
  if (ctx.pode('vitrine.alterar') && (produto.finalidade === 'comercializavel' || produto.exibir_na_vitrine)) {
    vitrine = el('button', { type: 'button', class: 'botao botao--secundario', id: 'alternar-vitrine' },
      produto.exibir_na_vitrine ? 'Tirar da vitrine' : 'Mostrar na vitrine');
    vitrine.addEventListener('click', () => ocupado(vitrine, () => executar('vitrine', null,
      (k) => definirVitrineProduto(produto.id, !produto.exibir_na_vitrine, produto.versao, k),
      () => anunciar('sucesso', produto.exibir_na_vitrine ? 'Produto retirado da vitrine.' : 'Produto marcado para a vitrine.'))));
  }
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-venda' },
    el('h2', { id: 'titulo-venda' }, 'Venda e situação'), form, situacaoVitrine, el('div', { class: 'grupo-botoes' }, ativar, vitrine));
}

function formPreco(v) {
  const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Salvar preço');
  const form = el('form', { class: 'pilha', novalidate: true, 'data-form': 'preco' },
    campoTexto({ nome: 'preco', rotulo: 'Novo preço (R$)', obrigatorio: true, id: `preco-${v.id}`, valor: formatarCentavos(v.preco_centavos).replace(/^R\$\s?/, '') }),
    campoTexto({ nome: 'motivo', rotulo: 'Motivo (opcional)', max: 300, id: `preco-motivo-${v.id}` }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const p = lerValorEmReais(d.preco ?? '');
    if (!p.ok || p.centavos <= 0) return erroNoCampo(form, 'preco', p.ok ? 'O preço precisa ser maior que zero.' : p.erro);
    ocupado(botao, () => executar(`preco-${v.id}`, form, (k) => alterarPreco(v.id, p.centavos, d.motivo, v.versao, k),
      (r) => anunciar('sucesso', `Preço alterado para ${formatarCentavos(r.preco_centavos)}.`, el('p', {}, 'Vendas já registradas não mudam.'))));
  });
  return form;
}

function formVariacao(v) {
  const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Salvar variação');
  const form = el('form', { class: 'pilha', novalidate: true, 'data-form': 'variacao' },
    campoTexto({ nome: 'sku', rotulo: 'Código (SKU)', max: 60, valor: v.sku ?? '', id: `sku-${v.id}` }),
    campoTexto({ nome: 'estoque_minimo', rotulo: 'Estoque mínimo', valor: v.estoque_minimo ?? '', id: `minimo-${v.id}`, ajuda: 'Vazio = sem alerta.' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const dados = { sku: d.sku ?? '' };
    if (!d.estoque_minimo) dados.estoque_minimo = null;
    else if (d.estoque_minimo === '0') dados.estoque_minimo = 0;
    else {
      const q = lerQuantidade(d.estoque_minimo);
      if (!q.ok) return erroNoCampo(form, 'estoque_minimo', q.erro);
      dados.estoque_minimo = q.valor;
    }
    ocupado(botao, () => executar(`variacao-${v.id}`, form, (k) => alterarVariacao(v.id, dados, v.versao, k), () => anunciar('sucesso', 'Variação salva.')));
  });
  return form;
}

function formCusto(v) {
  const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Corrigir custo');
  const form = el('form', { class: 'pilha', novalidate: true, 'data-form': 'custo' },
    campoTexto({ nome: 'custo', rotulo: 'Custo corrigido (R$)', obrigatorio: true, id: `custo-${v.id}` }),
    campoTexto({ nome: 'motivo', rotulo: 'Motivo da correção', obrigatorio: true, max: 300, id: `custo-motivo-${v.id}` }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const c = lerValorEmReais(d.custo ?? '');
    if (!c.ok) return erroNoCampo(form, 'custo', c.erro);
    if (!d.motivo || d.motivo.length < 3) return erroNoCampo(form, 'motivo', 'Explique a correção.');
    ocupado(botao, () => executar(`custo-${v.id}`, form, (k) => alterarCusto(v.id, c.centavos, d.motivo, v.versao, k), () => anunciar('sucesso', 'Custo corrigido e registrado no histórico.')));
  });
  return form;
}

function historico(v) {
  const det = el('details', {}, el('summary', {}, 'Histórico de preço' + (ctx.pode('produtos.ver_custo') ? ' e custo' : '')));
  let carregado = false;
  det.addEventListener('toggle', async () => {
    if (!det.open || carregado) return;
    carregado = true;
    try {
      if (ctx.pode('produtos.ver_custo')) {
        const h = await custosDaVariacao(v.id);
        det.append(el('p', {}, `Último custo informado: ${reais(h.ultimo_custo_centavos)} (não é custo médio).`),
          el('ul', { class: 'lista-simples' }, ...h.historico.map((x) => el('li', {}, `${formatarDataHora(x.vigente_desde)}: custo ${reais(x.custo_centavos)} (${x.origem}) por ${x.autor_nome}${x.motivo ? `. ${x.motivo}` : ''}`))),
          el('ul', { class: 'lista-simples' }, ...h.precos.map((x) => el('li', {}, `${formatarDataHora(x.criado_em)}: preço ${reais(x.preco_centavos)} por ${x.autor_nome}${x.motivo ? `. ${x.motivo}` : ''}`))));
      } else {
        const precos = await historicoPrecos(v.id);
        det.append(el('ul', { class: 'lista-simples' }, ...precos.map((x) => el('li', {}, `${formatarDataHora(x.criado_em)}: ${x.preco_anterior ? `de R$ ${String(x.preco_anterior).replace('.', ',')} para ` : ''}R$ ${String(x.preco_novo).replace('.', ',')}${x.motivo ? `. ${x.motivo}` : ''}`))));
      }
    } catch (erro) {
      det.append(aviso('erro', erro.message));
    }
  });
  return det;
}

function linhaVariacao(v) {
  const verEstoque = ctx.pode('estoque.visualizar');
  const acoes = [];
  if (ctx.pode('produtos.alterar_preco') && v.ativo) acoes.push(formPreco(v));
  if (ctx.pode('produtos.alterar')) {
    if (v.ativo) acoes.push(formVariacao(v));
    if (ctx.pode('produtos.ver_custo') && v.ativo) acoes.push(formCusto(v));
    if (!v.padrao) {
      const b = el('button', { type: 'button', class: 'botao botao--texto' }, v.ativo ? 'Desativar variação' : 'Reativar variação');
      b.addEventListener('click', () => ocupado(b, () => executar(`ativa-${v.id}`, null, (k) => definirVariacaoAtiva(v.id, !v.ativo, v.versao, k),
        () => anunciar('sucesso', v.ativo ? 'Variação desativada.' : 'Variação reativada.'))));
      acoes.push(el('div', { class: 'grupo-botoes' }, b));
    }
  }
  return el('tr', { 'data-variacao': v.id },
    el('th', { scope: 'row' }, v.padrao ? 'Produto simples' : v.rotulo, v.ativo ? null : ' (desativada)'),
    el('td', { 'data-rotulo': 'Código' }, v.sku ?? '—'),
    el('td', { class: 'numero', 'data-rotulo': 'Preço' }, reais(v.preco_centavos)),
    ctx.pode('produtos.ver_custo') ? el('td', { class: 'numero', 'data-rotulo': 'Último custo' }, reais(v.custo_centavos)) : null,
    verEstoque ? el('td', { class: 'numero', 'data-rotulo': 'Disponível' }, quantidadeLegivel(v.disponivel), v.abaixo_minimo ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'abaixo do mínimo') : null) : null,
    verEstoque ? el('td', { class: 'numero', 'data-rotulo': 'Físico / reservado' }, `${quantidadeLegivel(v.fisico)} / ${quantidadeLegivel(v.reservado)}`) : null,
    el('td', { class: 'numero', 'data-rotulo': 'Mínimo' }, v.estoque_minimo ?? '—'),
    el('td', { 'data-rotulo': 'Ações' }, acoes.length ? el('details', {}, el('summary', {}, 'Alterar'), ...acoes) : null, historico(v)));
}

function secaoVariacoes() {
  const verEstoque = ctx.pode('estoque.visualizar');
  const cab = ['Variação', 'Código', 'Preço', ...(ctx.pode('produtos.ver_custo') ? ['Último custo'] : []), ...(verEstoque ? ['Disponível', 'Físico / reservado'] : []), 'Mínimo', 'Ações'];
  const visiveis = produto.variacoes.filter((v) => v.ativo || !v.padrao);
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-variacoes' },
    el('h2', { id: 'titulo-variacoes' }, 'Variações, preços e estoque'),
    produto.resumo ? el('p', {}, `Total do produto: ${quantidadeLegivel(produto.resumo.disponivel)} disponíveis, ${quantidadeLegivel(produto.resumo.fisico)} no físico, ${quantidadeLegivel(produto.resumo.reservado)} reservados.`) : null,
    el('div', { class: 'tabela-container' }, el('table', { class: 'tabela' },
      el('caption', { class: 'visualmente-oculto' }, 'Variações do produto'),
      el('thead', {}, el('tr', {}, ...cab.map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...visiveis.map(linhaVariacao)))));
}

function formNovaVariacao() {
  if (!ctx.pode('produtos.criar') || !produto.ativo) return null;
  const comCusto = ctx.pode('produtos.ver_custo');
  const comEstoque = ctx.pode('estoque.propor') || ctx.pode('estoque.aprovar');
  const simples = produto.variacoes.some((v) => v.padrao && v.ativo);
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Adicionar variação');
  const form = el('form', { id: 'form-nova-variacao', class: 'pilha', novalidate: true },
    simples ? aviso('info', 'Este produto ainda é simples.', el('p', {}, 'A primeira variação substitui o produto simples, que precisa estar sem estoque.')) : null,
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'n1', rotulo: 'Atributo', obrigatorio: true, max: 40, id: 'nv-n1', ajuda: 'Exemplo: Cor' }),
      campoTexto({ nome: 'v1', rotulo: 'Valor', obrigatorio: true, max: 40, id: 'nv-v1', ajuda: 'Exemplo: Azul' }),
      campoTexto({ nome: 'n2', rotulo: 'Outro atributo (opcional)', max: 40, id: 'nv-n2' }),
      campoTexto({ nome: 'v2', rotulo: 'Valor', max: 40, id: 'nv-v2' }),
      campoTexto({ nome: 'preco', rotulo: 'Preço de venda (R$)', obrigatorio: true, id: 'nv-preco' }),
      campoTexto({ nome: 'sku', rotulo: 'Código (SKU)', max: 60, id: 'nv-sku' }),
      campoTexto({ nome: 'minimo', rotulo: 'Estoque mínimo', id: 'nv-minimo' }),
      comEstoque ? campoTexto({ nome: 'inicial', rotulo: 'Estoque inicial', id: 'nv-inicial' }) : null,
      comCusto ? campoTexto({ nome: 'custo', rotulo: 'Custo unitário (R$)', id: 'nv-custo' }) : null),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.n1 || !d.v1) return erroNoCampo(form, d.n1 ? 'v1' : 'n1', 'Informe o atributo e o valor.');
    const atributos = { [d.n1]: d.v1 };
    if (d.n2 && d.v2) atributos[d.n2] = d.v2;
    const p = lerValorEmReais(d.preco ?? '');
    if (!p.ok || p.centavos <= 0) return erroNoCampo(form, 'preco', p.ok ? 'O preço precisa ser maior que zero.' : p.erro);
    const dados = { atributos, preco_centavos: p.centavos };
    if (d.sku) dados.sku = d.sku;
    for (const [campo, chave] of [['minimo', 'estoque_minimo'], ['inicial', 'quantidade_inicial']]) {
      if (!d[campo]) continue;
      if (campo === 'minimo' && d[campo] === '0') { dados.estoque_minimo = 0; continue; }
      const q = lerQuantidade(d[campo]);
      if (!q.ok) return erroNoCampo(form, campo, q.erro);
      dados[chave] = q.valor;
    }
    if (d.custo) {
      const c = lerValorEmReais(d.custo);
      if (!c.ok) return erroNoCampo(form, 'custo', c.erro);
      dados.custo_centavos = c.centavos;
    }
    ocupado(botao, () => executar('nova-variacao', form, (k) => adicionarVariacao(produto.id, dados, k), (r) =>
      anunciar('sucesso', 'Variação adicionada.', r.estoque_inicial?.estado === 'pendente' ? el('p', {}, 'O estoque inicial foi enviado para aprovação.') : null)));
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-nova-variacao' },
    el('h2', { id: 'titulo-nova-variacao' }, 'Adicionar variação'), form);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando o produto');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'produtos'));
    if (!ctx.pode('produtos.visualizar') && !ctx.pode('estoque.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui os produtos desta empresa.')));
      return;
    }
    produto = (await produtosDaEmpresa(ctx.id)).find((p) => p.id === produtoId) ?? null;
    if (!produto) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Produto não encontrado nesta empresa.',
        el('p', {}, el('a', { href: `/business/produtos-empresa.html?id=${encodeURIComponent(ctx.id)}` }, 'Ver os produtos')))));
      return;
    }
    document.getElementById('titulo-pagina').textContent = produto.nome;
    document.title = `${produto.nome} | AutoniCK Business`;
    concluirCarregamento(area);
    area.append(...[
      el('p', {}, el('a', { href: `/business/produtos-empresa.html?id=${encodeURIComponent(ctx.id)}` }, 'Voltar para os produtos')),
      secaoVariacoes(), formNovaVariacao(), secaoDados(), secaoVenda(),
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
