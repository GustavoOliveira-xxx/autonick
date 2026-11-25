/**
 * Solicitações e orçamentos da empresa (M08, RF-096, RF-097; D8-03, D8-17): fila por situação e solicitação interna
 * registrada pela equipe para um cliente do balcão ou do telefone.
 */
import { marcarNovas } from '../comunicacao/marcador.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { lerRespostas, textoEstimativa, textoHorario } from '../../domain/servicos.js';
import { clientes as lerClientes } from '../../data/vendas.js';
import { solicitacoesDaEmpresa, servicosDaEmpresa, criarSolicitacaoInterna, ESTADO_SOLICITACAO } from '../../data/servicos.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, chipSolicitacao, dinheiro, camposDoFormulario } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let filtro = 'abertas';
let visao = location.hash === '#funil' ? 'funil' : 'lista';
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

const FILTROS = [['abertas', 'Abertas'], ['nova', 'Novas'], ['revisao_pedida', 'Revisão pedida'], ['aceita', 'Aceitas'], ['', 'Todas']];

function linha(s) {
  const href = `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(s.id)}`;
  return el('li', { class: 'cartao pilha', 'data-solicitacao': s.numero, 'data-conversa': `solicitacao:${s.id}` },
    el('h3', {}, el('a', { href }, `Nº ${s.numero} · ${s.servico}`), ' ', chipSolicitacao(s.estado_exibicao)),
    el('p', {}, `${s.cliente_nome}${s.origem === 'interna' ? ' (balcão ou telefone)' : ''} · ${formatarDataHora(s.criado_em)}`),
    el('p', {}, s.total_vigente_centavos ? `Orçamento vigente: ${dinheiro(s.total_vigente_centavos)}` : `Estimativa: ${textoEstimativa(s.estimativa)}`,
      s.aguardando_aprovacao ? ' · versão aguardando aprovação' : '', s.tem_rascunho ? ' · rascunho em preparo' : ''),
    s.horario ? el('p', {}, `Horário: ${textoHorario(s.horario.inicio, s.horario.fim)}`) : null);
}

async function secaoInterna() {
  if (!ctx.pode('orcamentos.criar')) return null;
  const [servicos, lista] = await Promise.all([servicosDaEmpresa(ctx.id).catch(() => []), lerClientes(ctx.id, null, 100, 0).catch(() => ({ itens: [] }))]);
  const ativos = servicos.filter((s) => s.ativo);
  const clientes = (lista.itens ?? lista).filter((c) => c.ativo !== false);
  if (!ativos.length) return null;
  const perguntas = el('div', { class: 'pilha', id: 'perguntas-internas' });
  const seletor = campoSelecao({ nome: 'servico', rotulo: 'Serviço', opcoes: ativos.map((s) => [s.id, s.nome]), obrigatorio: true, id: 'interna-servico' });
  const desenharPerguntas = () => {
    const s = ativos.find((x) => x.id === seletor.querySelector('select').value);
    perguntas.replaceChildren(...(s ? camposDoFormulario(s.perguntas, 'interna') : []));
  };
  seletor.querySelector('select').addEventListener('change', desenharPerguntas);
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Registrar solicitação');
  const form = el('form', { class: 'pilha', id: 'form-interna', novalidate: true },
    campoSelecao({ nome: 'cliente', rotulo: 'Cliente da empresa', opcoes: clientes.map((c) => [c.id, c.nome]), obrigatorio: true, id: 'interna-cliente',
      ajuda: clientes.length ? null : 'Cadastre o cliente na tela de clientes antes.' }),
    seletor, perguntas,
    campoTexto({ nome: 'relato', rotulo: 'O que o cliente precisa', obrigatorio: true, linhas: 3, max: 2000, id: 'interna-relato', ajuda: 'De 10 a 2.000 caracteres.' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.cliente) return erroNoCampo(form, 'cliente', 'Escolha o cliente.');
    if (!d.servico) return erroNoCampo(form, 'servico', 'Escolha o serviço.');
    const s = ativos.find((x) => x.id === d.servico);
    const { respostas, erros } = lerRespostas(s.perguntas, d);
    if (erros.length) return erroNoCampo(form, erros[0].nome, erros[0].mensagem);
    return ocupado(botao, () => executar('interna', form, (k) => criarSolicitacaoInterna(ctx.id, d.cliente, d.servico, { respostas, relato: d.relato }, k),
      (r) => anunciar('sucesso', `Solicitação nº ${r.numero} registrada.`, el('p', {}, el('a', {
        href: `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(r.id)}` }, 'Abrir e preparar o orçamento')))));
  });
  return el('details', { class: 'cartao', id: 'nova-interna' }, el('summary', {}, 'Registrar solicitação do balcão ou do telefone'), form);
}

// E05: funil em colunas sobre os estados reais. Mudar de etapa continua sendo pela tela do orçamento (regras do banco).
const ETAPAS = [['nova', 'Novas'], ['em_analise', 'Em análise'], ['orcamento_enviado', 'Orçamento enviado'], ['revisao_pedida', 'Revisão pedida'], ['aceita', 'Aceitas']];
function cartaoFunil(s) {
  const href = `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(s.id)}`;
  return el('li', { class: 'funil__cartao', 'data-solicitacao': s.numero, 'data-conversa': `solicitacao:${s.id}` },
    el('a', { href }, el('strong', {}, `Nº ${s.numero}`), ` · ${s.servico}`),
    el('span', {}, s.cliente_nome),
    el('span', { class: 'funil__valor' }, s.total_vigente_centavos ? dinheiro(s.total_vigente_centavos) : textoEstimativa(s.estimativa)),
    el('span', { class: 'opcoes' }, s.estado_exibicao === 'vencido' ? chipSolicitacao('vencido') : null,
      s.aguardando_aprovacao ? el('span', { class: 'chip chip--alerta chip--pequeno' }, 'aguarda aprovação') : null,
      s.tem_rascunho ? el('span', { class: 'chip chip--neutro chip--pequeno' }, 'rascunho') : null,
      s.horario ? el('span', { class: 'chip chip--info chip--pequeno' }, textoHorario(s.horario.inicio)) : null));
}
async function funil(contagem) {
  const [abertas, aceitas] = await Promise.all([solicitacoesDaEmpresa(ctx.id, { estado: 'abertas' }, 100, 0), solicitacoesDaEmpresa(ctx.id, { estado: 'aceita' }, 20, 0)]);
  const itens = [...abertas.itens, ...aceitas.itens];
  const total = (e) => (e === 'aceita' ? aceitas.total : contagem?.[e] ?? 0);
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-funil', id: 'funil' },
    el('h2', { id: 'titulo-funil', class: 'visualmente-oculto' }, 'Funil de orçamentos'),
    el('p', { class: 'campo__ajuda' }, 'Cada coluna é uma etapa real. Para avançar, abra o orçamento: as regras de envio, aprovação e aceite continuam valendo. "Aceitas" mostra as 20 mais recentes.'),
    el('div', { class: 'funil' }, ...ETAPAS.map(([e, nome]) => {
      const daEtapa = itens.filter((s) => s.estado === e);
      return el('section', { class: `funil__coluna funil__coluna--${e}`, 'aria-labelledby': `funil-${e}`, 'data-etapa': e },
        el('h3', { id: `funil-${e}`, class: 'funil__titulo' }, nome, el('span', { class: 'abas__contador' }, String(total(e)))),
        daEtapa.length ? el('ul', { class: 'funil__lista', role: 'list' }, ...daEtapa.map(cartaoFunil)) : el('p', { class: 'campo__ajuda' }, 'Nada nesta etapa.'));
    })));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as solicitações');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'solicitacoes'));
    if (!ctx.pode('orcamentos.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver orçamentos desta empresa.'));
      return;
    }
    const r = await solicitacoesDaEmpresa(ctx.id, filtro ? { estado: filtro } : {}, 50, 0);
    const interna = await secaoInterna();
    concluirCarregamento(area);
    const filtros = el('ul', { class: 'opcoes', id: 'filtros', 'aria-label': 'Filtrar por situação' }, ...FILTROS.map(([v, rotulo]) => {
      const n = v === 'abertas' ? ['nova', 'em_analise', 'orcamento_enviado', 'revisao_pedida'].reduce((t, e) => t + (r.contagem?.[e] ?? 0), 0)
        : v ? r.contagem?.[v] ?? 0 : Object.values(r.contagem ?? {}).reduce((a, b) => a + b, 0);
      const b = el('button', { type: 'button', class: 'botao botao--texto', 'aria-pressed': String(v === filtro), 'data-filtro': v || 'todas' }, `${rotulo} (${n})`);
      b.addEventListener('click', () => { filtro = v; carregar(); });
      return el('li', {}, b);
    }));
    const alternar = el('div', { class: 'navegacao-periodo__visoes', role: 'group', 'aria-label': 'Forma de ver os orçamentos' }, ...[['lista', 'Lista'], ['funil', 'Funil']].map(([v, nome]) => {
      const b = el('button', { type: 'button', class: 'botao botao--texto', 'aria-pressed': String(visao === v), 'data-visao': v }, nome);
      b.addEventListener('click', () => { if (visao !== v) { visao = v; history.replaceState(history.state, '', `${location.pathname}${location.search}${v === 'funil' ? '#funil' : ''}`); carregar(); } });
      return b;
    }));
    const conteudo = visao === 'funil' ? [await funil(r.contagem)] : [filtros,
      r.itens.length ? el('ul', { class: 'pilha', id: 'lista-solicitacoes' }, ...r.itens.map(linha))
        : el('p', { id: 'lista-solicitacoes' }, `Nenhuma solicitação${filtro ? ` em "${(ESTADO_SOLICITACAO[filtro] ?? 'abertas').toLowerCase()}"` : ''}.`)];
    area.replaceChildren(interna ?? el('span'), alternar, ...conteudo);
    marcarNovas(area, ctx.id);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
