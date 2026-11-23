/**
 * Estoque da empresa (M05, UI-029 e UI-031): alertas por variação (D5-02), saldos físico,
 * reservado e disponível, lançamento (direto para quem aprova, proposta para os demais; D5-04),
 * aprovações pendentes e histórico com estorno.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, limparErros, erroNoCampo, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { lerValorEmReais, formatarCentavos } from '../../domain/moeda.js';
import { lerQuantidade } from '../../domain/variacoes.js';
import {
  produtosDaEmpresa, alertasEstoque, historicoMovimentacoes, propostas as lerPropostas, movimentar,
  aprovarProposta, decidirSemAplicar, estornar, TIPOS_MOVIMENTACAO,
} from '../../data/estoque.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, quantidadeLegivel } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let dados = null; // { produtos, alertas, pendentes, historico }

const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });
const nomeVariacao = (p, v) => (v.padrao ? p.nome : `${p.nome} (${v.rotulo})`);

function secaoAlertas() {
  const lista = dados.alertas;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-alertas' },
    el('h2', { id: 'titulo-alertas' }, `Alertas de estoque mínimo (${lista.length})`),
    lista.length
      ? el('ul', { class: 'lista-simples', id: 'lista-alertas' }, ...lista.map((a) => el('li', { class: 'cartao' },
        el('p', {}, el('span', { class: 'chip chip--alerta' }, el('span', { 'aria-hidden': 'true' }, '!'), 'Estoque baixo'), ' ',
          el('strong', {}, a.rotulo === 'Padrão' ? a.produto_nome : `${a.produto_nome} (${a.rotulo})`),
          `: ${quantidadeLegivel(a.disponivel)} disponíveis para um mínimo de ${quantidadeLegivel(a.estoque_minimo)}.`,
          a.sob_encomenda ? ' Produto também feito sob encomenda.' : ''))))
      : el('p', { id: 'lista-alertas' }, 'Nenhuma variação abaixo do mínimo.'));
}

function secaoSaldos() {
  const linhas = [];
  for (const p of dados.produtos.filter((x) => x.ativo)) {
    for (const v of p.variacoes.filter((x) => x.ativo)) {
      linhas.push(el('tr', { 'data-variacao': v.id },
        el('th', { scope: 'row' }, el('a', { href: `/business/produto.html?id=${encodeURIComponent(ctx.id)}&produto=${encodeURIComponent(p.id)}` }, nomeVariacao(p, v)),
          p.venda_pausada ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'venda pausada') : null,
          p.sob_encomenda ? el('span', { class: 'chip chip--info chip--pequeno' }, 'sob encomenda') : null),
        el('td', { class: 'numero', 'data-rotulo': 'Físico' }, quantidadeLegivel(v.fisico)),
        el('td', { class: 'numero', 'data-rotulo': 'Reservado' }, quantidadeLegivel(v.reservado)),
        el('td', { class: 'numero', 'data-rotulo': 'Disponível' }, el('span', { class: 'numero-grande' }, quantidadeLegivel(v.disponivel)),
          v.abaixo_minimo ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'abaixo do mínimo') : null),
        el('td', { class: 'numero', 'data-rotulo': 'Mínimo' }, v.estoque_minimo ?? '—')));
    }
  }
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-saldos' },
    el('h2', { id: 'titulo-saldos' }, 'Saldos por variação'),
    linhas.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-saldos' },
      el('caption', { class: 'visualmente-oculto' }, 'Estoque físico, reservado e disponível por variação'),
      el('thead', {}, el('tr', {}, ...['Produto', 'Físico', 'Reservado', 'Disponível', 'Mínimo'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...linhas))) : el('p', {}, 'Nenhum produto ativo. Cadastre produtos na tela de produtos.'));
}

function secaoLancamento() {
  const direto = ctx.pode('estoque.aprovar');
  if (!direto && !ctx.pode('estoque.propor')) return null;
  const opcoes = [];
  for (const p of dados.produtos.filter((x) => x.ativo)) {
    for (const v of p.variacoes.filter((x) => x.ativo)) opcoes.push([v.id, `${nomeVariacao(p, v)}: ${quantidadeLegivel(v.disponivel)} disponíveis`]);
  }
  if (!opcoes.length) return null;
  const comCusto = ctx.pode('produtos.ver_custo');
  const botao = el('button', { type: 'submit', class: 'botao' }, direto ? 'Lançar no estoque' : 'Enviar para aprovação');
  const form = el('form', { id: 'form-movimentacao', class: 'pilha', novalidate: true },
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'tipo', rotulo: 'Tipo', obrigatorio: true, id: 'mov-tipo', opcoes: [['entrada', 'Entrada'], ['saida', 'Saída'], ['ajuste', 'Ajuste de contagem']] }),
      campoSelecao({ nome: 'variacao_id', rotulo: 'Produto', obrigatorio: true, id: 'mov-variacao', opcoes }),
      campoTexto({ nome: 'quantidade', rotulo: 'Quantidade', obrigatorio: true, id: 'mov-quantidade', ajuda: 'No ajuste, use negativo para retirar (ex.: -2).' }),
      comCusto ? campoTexto({ nome: 'custo', rotulo: 'Custo unitário (R$), só em entradas', id: 'mov-custo' }) : null),
    campoTexto({ nome: 'motivo', rotulo: 'Motivo', max: 300, id: 'mov-motivo', ajuda: 'Obrigatório em saídas e ajustes (no ajuste, pelo menos 10 caracteres).' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.tipo) return erroNoCampo(form, 'tipo', 'Escolha o tipo.');
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
      const s = r.saldos?.[0];
      anunciar('sucesso', r.estado === 'pendente' ? 'Movimentação enviada para aprovação.' : 'Estoque atualizado.',
        s ? el('p', {}, `Agora: ${quantidadeLegivel(s.disponivel)} disponíveis (${quantidadeLegivel(s.fisico)} no físico).`) : null);
    }));
  });
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-lancar' },
    el('h2', { id: 'titulo-lancar' }, direto ? 'Lançar movimentação' : 'Propor movimentação'),
    el('p', {}, direto ? 'Você tem permissão de aprovar: o lançamento vale na hora e fica registrado como aprovação sua.'
      : 'A movimentação só muda o estoque depois de aprovada por quem tem permissão.'),
    form);
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
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-pendentes' },
    el('h2', { id: 'titulo-pendentes' }, `Aguardando aprovação (${lista.length})`),
    lista.length ? el('ul', { class: 'lista-simples', id: 'lista-pendentes' }, ...lista.map(itemProposta)) : el('p', { id: 'lista-pendentes' }, 'Nada aguardando aprovação.'));
}

function secaoHistorico() {
  const podeEstornar = ctx.pode('estoque.aprovar');
  const linhas = dados.historico.map((m) => {
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
      el('th', { scope: 'row' }, m.rotulo === 'Padrão' ? m.produto_nome : `${m.produto_nome} (${m.rotulo})`),
      el('td', { 'data-rotulo': 'Tipo' }, TIPOS_MOVIMENTACAO[m.tipo] ?? m.tipo, m.estornada ? ' (estornada)' : ''),
      el('td', { class: 'numero', 'data-rotulo': 'Quantidade' }, `${m.quantidade > 0 ? '+' : '−'}${quantidadeLegivel(Math.abs(m.quantidade))}`),
      el('td', { class: 'numero', 'data-rotulo': 'Físico depois' }, quantidadeLegivel(m.fisico_apos)),
      el('td', { 'data-rotulo': 'Por' }, m.ator_nome),
      el('td', { 'data-rotulo': 'Motivo' }, m.motivo ?? '—', Number.isSafeInteger(m.custo_centavos) ? ` · custo ${formatarCentavos(m.custo_centavos)}` : ''),
      el('td', { 'data-rotulo': 'Ação' }, acao ?? ''));
  });
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-historico-estoque' },
    el('h2', { id: 'titulo-historico-estoque' }, 'Histórico de movimentações'),
    el('p', { class: 'campo__ajuda' }, 'Registro permanente: nada é apagado. Correções viram estornos ou ajustes.'),
    linhas.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-historico' },
      el('caption', { class: 'visualmente-oculto' }, 'Movimentações de estoque mais recentes'),
      el('thead', {}, el('tr', {}, ...['Quando', 'Produto', 'Tipo', 'Quantidade', 'Físico depois', 'Por', 'Motivo', 'Ação'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...linhas))) : el('p', {}, 'Nenhuma movimentação ainda.'));
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
    area.append(...[secaoAlertas(), secaoLancamento(), secaoPendentes(), secaoSaldos(), secaoHistorico()].filter(Boolean));
  } catch (erro) {
    if (erro.codigo === 'AUTH_REQUIRED') {
      area.replaceChildren(aviso('info', erro.message, el('p', {}, el('a', { href: '/business/entrar.html' }, 'Entrar novamente'))));
      return;
    }
    tratarErro(area, erro, carregar);
  }
}

carregar();
