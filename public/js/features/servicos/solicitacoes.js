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
    area.replaceChildren(interna ?? el('span'), filtros,
      r.itens.length ? el('ul', { class: 'pilha', id: 'lista-solicitacoes' }, ...r.itens.map(linha))
        : el('p', { id: 'lista-solicitacoes' }, `Nenhuma solicitação${filtro ? ` em "${(ESTADO_SOLICITACAO[filtro] ?? 'abertas').toLowerCase()}"` : ''}.`));
    marcarNovas(area, ctx.id);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
