/**
 * Ordens de serviço da empresa (M09, RF-102 a RF-106; D9-01 a D9-05): fila por situação, filtro informativo por
 * responsável e busca por número, cliente ou serviço. A OS nasce no aceite do orçamento; não há criação manual.
 */
import { proximaAcaoOs } from '../../domain/servicos.js';
import { marcarNovas } from '../comunicacao/marcador.js';
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, valores } from '../../ui/formulario.js';
import { textoHorario } from '../../domain/servicos.js';
import { ordensDaEmpresa, ESTADO_OS } from '../../data/ordens.js';
import { carregarContexto, navegacaoEmpresa, dinheiro, formatarData } from './comum.js';
import { chipOs } from './ordens-comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
let ctx = null;
let filtros = { estado: 'ativas' };

const FILTROS = [['ativas', 'Em andamento'], ['aguardando_inicio', 'Aguardando início'], ['em_execucao', 'Em execução'], ['pausada', 'Pausadas'],
  ['concluida', 'Concluídas'], ['encerrada', 'Encerradas'], ['cancelada', 'Canceladas'], ['', 'Todas']];

function linha(o) {
  const href = `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(o.id)}`;
  const pendencias = [o.revisao_pendente ? 'revisão pedida pelo cliente' : null, o.reagendamento_pendente ? 'horário aguardando resposta' : null,
    o.usos_pendentes ? `${o.usos_pendentes} uso(s) de material a confirmar` : null].filter(Boolean);
  return el('li', { class: 'cartao pilha', 'data-os': o.numero, 'data-conversa': `os:${o.id}` },
    el('h3', {}, el('a', { href }, `OS nº ${o.numero} · ${o.servico}`), ' ', chipOs(o.estado)),
    el('p', {}, `${o.cliente_nome}${o.origem === 'interna' ? ' (balcão ou telefone)' : ''} · solicitação nº ${o.solicitacao_numero} · ${dinheiro(o.contratado_centavos)}`),
    el('p', {}, o.horario ? `Horário: ${textoHorario(o.horario.inicio, o.horario.fim)}` : 'Sem horário confirmado',
      o.responsavel ? ` · responsável: ${o.responsavel}` : ' · sem responsável definido', o.previsao_conclusao ? ` · previsão ${formatarData(o.previsao_conclusao)}` : ''),
    pendencias.length ? el('p', { class: 'campo__ajuda', 'data-pendencias': '' }, `Pendências: ${pendencias.join('; ')}.`) : null,
    (() => {
      const acao = proximaAcaoOs(o, ctx.pode);
      return acao ? el('p', { class: 'proxima-acao' }, el('span', { class: 'proxima-acao__rotulo' }, 'Próxima ação: '),
        el('a', { class: `botao ${acao.agir ? '' : 'botao--secundario'}`, href: `${href}#${acao.aba}`, 'data-proxima-acao': acao.aba }, acao.texto)) : null;
    })());
}

function formFiltros(equipe) {
  const form = el('form', { class: 'pilha', id: 'form-filtros', role: 'search', 'aria-label': 'Filtrar ordens de serviço' },
    campoSelecao({ nome: 'estado', rotulo: 'Situação', opcoes: FILTROS, valor: filtros.estado ?? '', vazio: null, id: 'filtro-estado' }),
    campoSelecao({ nome: 'responsavel', rotulo: 'Responsável', opcoes: equipe.map((m) => [m.auth_user_id, m.nome]), valor: filtros.responsavel ?? '', vazio: 'Qualquer', id: 'filtro-responsavel' }),
    campoTexto({ nome: 'busca', rotulo: 'Buscar (número, cliente ou serviço)', valor: filtros.busca ?? '', id: 'filtro-busca', max: 80 }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Filtrar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = valores(form);
    filtros = Object.fromEntries(Object.entries({ estado: d.estado, responsavel: d.responsavel, busca: d.busca?.trim() }).filter(([, v]) => v));
    carregar();
  });
  return form;
}

async function carregar() {
  mostrarCarregando(area, 'Carregando as ordens de serviço');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'ordens'));
    if (!ctx.pode('servicos.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver ordens de serviço desta empresa.'));
      return;
    }
    const r = await ordensDaEmpresa(ctx.id, filtros, 50, 0);
    concluirCarregamento(area);
    const contagem = Object.entries(r.contagem).map(([e, n]) => `${ESTADO_OS[e] ?? e}: ${n}`).join(' · ');
    area.replaceChildren(...[formFiltros(r.equipe),
      el('p', { id: 'contagem', role: 'status' }, contagem || 'Nenhuma ordem de serviço ainda.'),
      r.itens.length ? el('ul', { class: 'pilha', id: 'ordens' }, ...r.itens.map(linha))
        : el('p', { id: 'ordens' }, 'Nenhuma ordem de serviço com estes filtros. A OS nasce quando o cliente aceita um orçamento.'),
      r.total > r.itens.length ? el('p', { class: 'campo__ajuda' }, `Mostrando ${r.itens.length} de ${r.total}. Use os filtros para encontrar as demais.`) : null].filter(Boolean));
    marcarNovas(area, ctx.id);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
