/**
 * Fornecedores e compras (M05, UI-030 e UI-032). Fornecedores seguem as permissões próprias
 * (D5-06). A compra registrada vira proposta de entrada; quem aprova estoque recebe na hora (D5-04).
 * Custo só aparece e só é informado por quem tem "Produtos: ver custo".
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { lerValorEmReais, formatarCentavos } from '../../domain/moeda.js';
import { lerQuantidade } from '../../domain/variacoes.js';
import {
  fornecedores as lerFornecedores, criarFornecedor, alterarFornecedor, compras as lerCompras, criarCompra,
  registrarCompra, cancelarCompra, produtosDaEmpresa, ESTADOS_COMPRA,
} from '../../data/estoque.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let dados = null; // { fornecedores, compras, produtos }

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

function dadosFornecedor(form) {
  const d = valores(form);
  return { nome: d.nome ?? '', documento: d.documento ?? '', telefone: d.telefone ?? '', email: d.email ?? '', observacoes: d.observacoes ?? '' };
}

function camposFornecedor(pref, f = {}) {
  return [
    campoTexto({ nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 120, valor: f.nome ?? '', id: `${pref}-nome` }),
    campoTexto({ nome: 'documento', rotulo: 'CPF ou CNPJ', max: 18, valor: f.documento ?? '', id: `${pref}-documento`, ajuda: 'Opcional.' }),
    campoTexto({ nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', max: 20, valor: f.telefone ?? '', id: `${pref}-telefone`, ajuda: 'Opcional, com DDD.' }),
    campoTexto({ nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 254, valor: f.email ?? '', id: `${pref}-email`, ajuda: 'Opcional.' }),
    campoTexto({ nome: 'observacoes', rotulo: 'Observações', linhas: 2, max: 500, valor: f.observacoes ?? '', id: `${pref}-observacoes` }),
  ];
}

function itemFornecedor(f) {
  const partes = [el('p', {}, el('strong', {}, f.nome), f.ativo ? '' : ' (desativado)'),
    el('p', { class: 'cartao__meta' }, [f.documento, f.telefone, f.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado')];
  if (ctx.pode('fornecedores.alterar')) {
    const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Salvar fornecedor');
    const form = el('form', { class: 'pilha', novalidate: true }, ...camposFornecedor(`f-${f.id}`, f), el('div', { class: 'grupo-botoes' }, botao));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      ocupado(botao, () => executar(`fornecedor-${f.id}`, form, (k) => alterarFornecedor(f.id, dadosFornecedor(form), f.versao, k), () => anunciar('sucesso', 'Fornecedor salvo.')));
    });
    const ativar = el('button', { type: 'button', class: 'botao botao--texto' }, f.ativo ? 'Desativar fornecedor' : 'Reativar fornecedor');
    ativar.addEventListener('click', () => ocupado(ativar, () => executar(`ativo-${f.id}`, null, (k) => alterarFornecedor(f.id, { ativo: !f.ativo }, f.versao, k),
      () => anunciar('sucesso', f.ativo ? 'Fornecedor desativado.' : 'Fornecedor reativado.'))));
    partes.push(el('details', {}, el('summary', {}, 'Alterar'), form, el('div', { class: 'grupo-botoes' }, ativar)));
  }
  return el('li', { class: 'cartao pilha', 'data-fornecedor': f.id }, ...partes);
}

function secaoFornecedores() {
  if (!ctx.pode('fornecedores.visualizar')) return null;
  const lista = dados.fornecedores;
  let novo = null;
  if (ctx.pode('fornecedores.alterar')) {
    const botao = el('button', { type: 'submit', class: 'botao' }, 'Cadastrar fornecedor');
    const form = el('form', { id: 'form-novo-fornecedor', class: 'pilha', novalidate: true },
      el('div', { class: 'grade-filtros' }, ...camposFornecedor('novo-fornecedor')), el('div', { class: 'grupo-botoes' }, botao));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const d = dadosFornecedor(form);
      if (d.nome.length < 2) return erroNoCampo(form, 'nome', 'Informe o nome do fornecedor.');
      ocupado(botao, () => executar('novo-fornecedor', form, (k) => criarFornecedor(ctx.id, d, k), (r) => anunciar('sucesso', `Fornecedor "${r.nome}" cadastrado.`)));
    });
    novo = el('details', { class: 'cartao pilha' }, el('summary', {}, 'Cadastrar fornecedor'), form);
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-fornecedores' },
    el('h2', { id: 'titulo-fornecedores' }, `Fornecedores (${lista.filter((f) => f.ativo).length} ativos)`),
    el('p', { class: 'campo__ajuda' }, 'Dados de contato de terceiros: visíveis só para quem tem a permissão de fornecedores.'),
    lista.length ? el('ul', { class: 'lista-simples', id: 'lista-fornecedores' }, ...lista.map(itemFornecedor)) : el('p', { id: 'lista-fornecedores' }, 'Nenhum fornecedor cadastrado.'),
    novo);
}

function formNovaCompra() {
  if (!ctx.pode('estoque.propor')) return null;
  const variacoes = [];
  for (const p of dados.produtos.filter((x) => x.ativo)) {
    for (const v of p.variacoes.filter((x) => x.ativo)) variacoes.push([v.id, v.padrao ? p.nome : `${p.nome} (${v.rotulo})`]);
  }
  if (!variacoes.length) return el('section', { class: 'cartao pilha' }, el('h2', {}, 'Registrar compra'), el('p', {}, 'Cadastre produtos antes de registrar compras.'));
  const comCusto = ctx.pode('produtos.ver_custo');
  let linhas = 1;
  const grade = el('div', { class: 'pilha', id: 'itens-compra' });
  const linha = (n) => el('fieldset', { class: 'campo modulo-permissoes' }, el('legend', {}, `Item ${n + 1}`),
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: `item-${n}-variacao`, rotulo: 'Produto', obrigatorio: true, opcoes: variacoes, id: `compra-item-${n}-variacao` }),
      campoTexto({ nome: `item-${n}-quantidade`, rotulo: 'Quantidade', obrigatorio: true, id: `compra-item-${n}-quantidade` }),
      comCusto ? campoTexto({ nome: `item-${n}-custo`, rotulo: 'Custo unitário (R$)', id: `compra-item-${n}-custo` }) : null));
  grade.append(linha(0));
  const mais = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Adicionar item');
  mais.addEventListener('click', () => { if (linhas < 200) { grade.append(linha(linhas)); linhas += 1; } });
  const fornecedoresAtivos = (dados.fornecedores ?? []).filter((f) => f.ativo).map((f) => [f.id, f.nome]);
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Salvar compra');
  const form = el('form', { id: 'form-nova-compra', class: 'pilha', novalidate: true },
    el('div', { class: 'grade-filtros' },
      fornecedoresAtivos.length ? campoSelecao({ nome: 'fornecedor_id', rotulo: 'Fornecedor', opcoes: fornecedoresAtivos, id: 'compra-fornecedor', vazio: 'Sem fornecedor' }) : null,
      campoTexto({ nome: 'numero_documento', rotulo: 'Nota ou documento', max: 60, id: 'compra-documento', ajuda: 'Opcional.' }),
      campoTexto({ nome: 'data_compra', rotulo: 'Data da compra', tipo: 'date', id: 'compra-data', ajuda: 'Vazio = hoje.' })),
    grade, el('div', { class: 'grupo-botoes' }, mais), el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const itens = [];
    for (let i = 0; i < linhas; i += 1) {
      if (!d[`item-${i}-variacao`]) return erroNoCampo(form, `item-${i}-variacao`, 'Escolha o produto.');
      const q = lerQuantidade(d[`item-${i}-quantidade`]);
      if (!q.ok) return erroNoCampo(form, `item-${i}-quantidade`, q.erro);
      const item = { variacao_id: d[`item-${i}-variacao`], quantidade: q.valor };
      if (d[`item-${i}-custo`]) {
        const c = lerValorEmReais(d[`item-${i}-custo`]);
        if (!c.ok) return erroNoCampo(form, `item-${i}-custo`, c.erro);
        item.custo_centavos = c.centavos;
      }
      itens.push(item);
    }
    const cabecalho = { fornecedor_id: d.fornecedor_id || null, numero_documento: d.numero_documento || null, data_compra: d.data_compra || null };
    ocupado(botao, () => executar('nova-compra', form, (k) => criarCompra(ctx.id, cabecalho, itens, k),
      () => anunciar('sucesso', 'Compra salva como rascunho.', el('p', {}, 'Confira e clique em "Registrar compra" para gerar a entrada no estoque.'))));
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-nova-compra' },
    el('h2', { id: 'titulo-nova-compra' }, 'Registrar compra de fornecedor'), form);
}

function itemCompra(c) {
  const acoes = [];
  if (c.estado === 'rascunho' && ctx.pode('estoque.propor')) {
    const registrar = el('button', { type: 'button', class: 'botao' }, ctx.pode('estoque.aprovar') ? 'Registrar e receber no estoque' : 'Registrar compra');
    registrar.addEventListener('click', () => ocupado(registrar, () => executar(`registrar-${c.id}`, null, (k) => registrarCompra(c.id, c.versao, k),
      (r) => anunciar('sucesso', r.estado === 'recebida' ? 'Compra recebida: o estoque já foi atualizado.' : 'Compra registrada. A entrada aguarda aprovação.'))));
    acoes.push(registrar);
  }
  if ((c.estado === 'rascunho' && (c.sou_autor || ctx.pode('estoque.aprovar'))) || (c.estado === 'registrada' && ctx.pode('estoque.aprovar'))) {
    const botao = el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Cancelar compra');
    const form = el('form', { class: 'pilha', novalidate: true },
      campoTexto({ nome: 'motivo', rotulo: 'Motivo do cancelamento', obrigatorio: true, max: 300, id: `cancelar-compra-${c.id}` }),
      el('div', { class: 'grupo-botoes' }, botao));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      limparErros(form);
      const { motivo } = valores(form);
      if (!motivo || motivo.length < 3) return erroNoCampo(form, 'motivo', 'Explique o cancelamento.');
      ocupado(botao, () => executar(`cancelar-${c.id}`, form, (k) => cancelarCompra(c.id, motivo, c.versao, k), () => anunciar('sucesso', 'Compra cancelada.')));
    });
    acoes.push(el('details', {}, el('summary', {}, 'Cancelar'), form));
  }
  return el('li', { class: 'cartao pilha', 'data-compra': c.id },
    el('p', {}, el('strong', {}, `Compra de ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${c.data_compra}T00:00:00Z`))}`),
      c.fornecedor_nome ? ` · ${c.fornecedor_nome}` : '', c.numero_documento ? ` · ${c.numero_documento}` : ''),
    el('p', { class: 'opcoes' }, el('span', { class: `chip ${c.estado === 'recebida' ? 'chip--sucesso' : c.estado === 'cancelada' ? 'chip--erro' : 'chip--info'}` }, ESTADOS_COMPRA[c.estado])),
    el('ul', {}, ...(c.itens ?? []).map((i) => el('li', {}, `${i.rotulo === 'Padrão' ? i.produto_nome : `${i.produto_nome} (${i.rotulo})`}: ${quantidadeLegivel(i.quantidade)}`,
      Number.isSafeInteger(i.custo_centavos) ? ` a ${formatarCentavos(i.custo_centavos)}` : ''))),
    Number.isSafeInteger(c.custo_total_centavos) ? el('p', {}, `Custo total: ${formatarCentavos(c.custo_total_centavos)}`) : null,
    c.motivo_cancelamento ? el('p', {}, `Cancelada: ${c.motivo_cancelamento}`) : null,
    el('p', { class: 'cartao__meta' }, `Criada por ${c.autor_nome} em ${formatarDataHora(c.criado_em)}`),
    acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
}

function secaoCompras() {
  if (!ctx.pode('estoque.visualizar')) return null;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-compras' },
    el('h2', { id: 'titulo-compras' }, 'Compras'),
    dados.compras.length ? el('ul', { class: 'lista-simples', id: 'lista-compras' }, ...dados.compras.map(itemCompra)) : el('p', { id: 'lista-compras' }, 'Nenhuma compra registrada.'));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando fornecedores e compras');
  try {
    ctx = await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'fornecedores'));
    if (!ctx.pode('fornecedores.visualizar') && !ctx.pode('estoque.visualizar')) {
      area.replaceChildren(el('div', { role: 'alert' }, aviso('alerta', 'Seu perfil de acesso não inclui fornecedores nem compras desta empresa.')));
      return;
    }
    const nada = async () => [];
    const [fornecedores, compras, produtos] = await Promise.all([
      ctx.pode('fornecedores.visualizar') ? lerFornecedores(ctx.id) : nada(),
      ctx.pode('estoque.visualizar') ? lerCompras(ctx.id) : nada(),
      ctx.pode('estoque.propor') ? produtosDaEmpresa(ctx.id) : nada()]);
    dados = { fornecedores, compras, produtos };
    document.getElementById('titulo-pagina').textContent = `Fornecedores e compras de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    concluirCarregamento(area);
    area.append(...[formNovaCompra(), secaoCompras(), secaoFornecedores()].filter(Boolean));
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
