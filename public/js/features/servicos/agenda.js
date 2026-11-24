/**
 * Agenda operacional (M09, RF-116 a RF-118; D9-17, D9-18, D9-26): visão por dia ou semana (até 62 dias) com horários
 * confirmados de solicitações e OS, horários propostos aguardando resposta, OS sem horário e solicitações abertas sem
 * horário, com filtro informativo por responsável. Sem agenda por funcionário, bloqueio nem cálculo de vagas (RF-119 futuro).
 * A grade semanal de atendimento (M08, D8-18) continua aqui, no horário de São Paulo.
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { montarGrade, textoHorario } from '../../domain/servicos.js';
import { salvarHorarios, DIAS, TURNO } from '../../data/servicos.js';
import { agendaOperacional, ESTADO_OS } from '../../data/ordens.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, gradeTexto, dataDeHoje, somarDias, formatarData } from './comum.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let periodo = { de: dataDeHoje(), visao: 'semana', responsavel: '' };
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

function formGrade(grade) {
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Salvar horários');
  const form = el('form', { class: 'pilha', id: 'form-grade', novalidate: true }, ...grade.map((d) => el('fieldset', { class: 'cartao pilha', 'data-dia': d.dia_semana },
    el('legend', {}, DIAS[d.dia_semana]),
    ...[0, 1].flatMap((i) => [
      campoTexto({ nome: `d${d.dia_semana}-${i}-abre`, rotulo: `${i === 0 ? 'Primeiro' : 'Segundo'} intervalo: abre`, tipo: 'time', valor: d.intervalos[i]?.abre ?? '', id: `d${d.dia_semana}-${i}-abre` }),
      campoTexto({ nome: `d${d.dia_semana}-${i}-fecha`, rotulo: `${i === 0 ? 'Primeiro' : 'Segundo'} intervalo: fecha`, tipo: 'time', valor: d.intervalos[i]?.fecha ?? '', id: `d${d.dia_semana}-${i}-fecha` }),
    ]),
    el('p', { class: 'campo__ajuda' }, 'Deixe em branco para dia fechado.'))),
  el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    const entradas = {};
    for (let dia = 0; dia < 7; dia += 1) {
      entradas[dia] = [0, 1].map((i) => ({ abre: d[`d${dia}-${i}-abre`], fecha: d[`d${dia}-${i}-fecha`] }));
      for (let i = 0; i < 2; i += 1) {
        const { abre, fecha } = entradas[dia][i];
        if (Boolean(abre) !== Boolean(fecha)) return erroNoCampo(form, `d${dia}-${i}-${abre ? 'fecha' : 'abre'}`, 'Preencha abertura e fechamento.');
        if (abre && abre >= fecha) return erroNoCampo(form, `d${dia}-${i}-fecha`, 'O fechamento vem depois da abertura.');
      }
    }
    return ocupado(botao, () => executar('grade', form, (k) => salvarHorarios(ctx.id, montarGrade(entradas), k), () => anunciar('sucesso', 'Horários de atendimento salvos.')));
  });
  return form;
}

const diaSp = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

function formPeriodo(equipe) {
  const form = el('form', { class: 'pilha', id: 'form-periodo', role: 'search', 'aria-label': 'Escolher o período da agenda' },
    campoTexto({ nome: 'de', rotulo: 'A partir de', tipo: 'date', valor: periodo.de, id: 'agenda-de' }),
    campoSelecao({ nome: 'visao', rotulo: 'Visão', opcoes: [['dia', 'Um dia'], ['semana', 'Uma semana']], valor: periodo.visao, vazio: null, id: 'agenda-visao' }),
    campoSelecao({ nome: 'responsavel', rotulo: 'Responsável (informativo)', opcoes: equipe.map((m) => [m.auth_user_id, m.nome]), valor: periodo.responsavel, vazio: 'Todos', id: 'agenda-responsavel' }),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Mostrar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = valores(form);
    periodo = { de: d.de || dataDeHoje(), visao: d.visao, responsavel: d.responsavel || '' };
    carregar();
  });
  return form;
}

function cartaoCompromisso(x) {
  const href = x.os_id ? `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(x.os_id)}`
    : `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(x.solicitacao_id)}`;
  return el('li', { class: 'cartao pilha', 'data-compromisso': x.os_id ? 'os' : 'solicitacao' },
    el('p', {}, el('strong', {}, textoHorario(x.inicio, x.fim)), x.menos_de_24h ? ' · menos de 24 horas' : ''),
    el('p', {}, el('a', { href }, x.os_id ? `OS nº ${x.os_numero} · ${x.servico} · ${x.cliente_nome}` : `Solicitação nº ${x.solicitacao_numero} · ${x.servico} · ${x.cliente_nome}`),
      x.os_estado ? ` · ${ESTADO_OS[x.os_estado] ?? x.os_estado}` : '', x.responsavel ? ` · ${x.responsavel}` : ''),
    x.reagendamento_pendente ? el('p', { class: 'campo__ajuda' }, 'Há outro horário proposto aguardando resposta; este continua valendo até lá.') : null,
    x.avisos?.length ? el('p', { class: 'campo__ajuda' }, `Confirmado com aviso: ${x.avisos.map((v) => v.mensagem).join(' ')}`) : null);
}

// IB07: a campainha só aparece para um horário confirmado de verdade que começa em até 15 minutos.
const JANELA_LEMBRETE_MS = 15 * 60 * 1000;
let relogioLembrete = 0;
function acompanharLembrete(confirmados, lugar) {
  clearTimeout(relogioLembrete);
  const agora = Date.now();
  const futuros = confirmados.map((x) => ({ x, ms: Date.parse(x.inicio) - agora })).filter((c) => Number.isFinite(c.ms) && c.ms > 0).sort((a, b) => a.ms - b.ms);
  const proximo = futuros[0];
  if (!proximo) { lugar.replaceChildren(); return; }
  if (proximo.ms <= JANELA_LEMBRETE_MS) {
    const minutos = Math.max(1, Math.round(proximo.ms / 60000));
    const x = proximo.x;
    const caixa = el('div', { class: 'cartao com-momento lembrete-agenda', role: 'status' },
      el('p', {}, el('strong', {}, `Começa em ${minutos} minuto${minutos === 1 ? '' : 's'}: `), textoHorario(x.inicio, x.fim), ' · ',
        x.os_id ? `OS nº ${x.os_numero} · ${x.servico} · ${x.cliente_nome}` : `Solicitação nº ${x.solicitacao_numero} · ${x.servico} · ${x.cliente_nome}`));
    lugar.replaceChildren(caixa);
    montarMomento(caixa, 'IB07', { tamanho: 'p' }).disparar();
    relogioLembrete = setTimeout(() => acompanharLembrete(confirmados.filter((c) => c !== x), lugar), proximo.ms);
    return;
  }
  lugar.replaceChildren();
  const espera = proximo.ms - JANELA_LEMBRETE_MS;
  if (espera < 6 * 60 * 60 * 1000) relogioLembrete = setTimeout(() => acompanharLembrete(confirmados, lugar), espera);
}

async function carregar() {
  mostrarCarregando(area, 'Carregando a agenda');
  try {
    ctx = ctx ?? await carregarContexto(area);
    if (!ctx) return;
    nav.replaceChildren(navegacaoEmpresa(ctx, 'agenda'));
    if (!ctx.pode('agenda.visualizar')) {
      area.replaceChildren(aviso('erro', 'Seu perfil não inclui ver a agenda desta empresa.'));
      return;
    }
    const ate = periodo.visao === 'dia' ? periodo.de : somarDias(periodo.de, 6);
    const a = await agendaOperacional(ctx.id, periodo.de, ate, periodo.responsavel || null);
    concluirCarregamento(area);
    const dias = [];
    for (let d = periodo.de; d <= ate; d = somarDias(d, 1)) dias.push(d);
    const porDia = dias.map((d) => {
      const itens = a.confirmados.filter((x) => diaSp(x.inicio) === d);
      return el('section', { class: 'pilha', 'aria-labelledby': `dia-${d}`, 'data-dia': d },
        el('h3', { id: `dia-${d}` }, `${DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${formatarData(d)}`),
        itens.length ? el('ul', { class: 'pilha' }, ...itens.map(cartaoCompromisso)) : el('p', { class: 'campo__ajuda' }, 'Nenhum horário confirmado.'));
    });
    const linkOs = (x) => el('a', { href: `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(x.os_id)}` }, `OS nº ${x.os_numero} · ${x.servico} · ${x.cliente_nome}`);
    const linkSol = (x) => el('a', { href: `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(x.solicitacao_id)}` },
      `Nº ${x.numero} · ${x.servico} · ${x.cliente_nome}`);
    const lembrete = el('div', { id: 'lembrete-agenda' });
    acompanharLembrete(a.confirmados, lembrete);
    area.replaceChildren(
      lembrete,
      formPeriodo(a.equipe),
      el('p', { class: 'campo__ajuda' }, a.aviso),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-confirmados', id: 'confirmados' },
        el('h2', { id: 'titulo-confirmados' }, `Horários confirmados de ${formatarData(periodo.de)} a ${formatarData(ate)}`), ...porDia),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-propostos' }, el('h2', { id: 'titulo-propostos' }, 'Horários propostos aguardando resposta'),
        a.propostos.length ? el('ul', { class: 'pilha', id: 'propostos' }, ...a.propostos.map((x) => el('li', { class: 'cartao pilha' },
          el('p', {}, el('strong', {}, textoHorario(x.inicio, x.fim)), ` · ${x.proposto_por === 'empresa' ? 'proposto pela empresa, aguarda o cliente' : 'pedido pelo cliente, aguarda a empresa'}`),
          el('p', {}, linkOs(x)), x.motivo ? el('p', { class: 'campo__ajuda' }, `Motivo: ${x.motivo}`) : null)))
          : el('p', { id: 'propostos' }, 'Nenhuma proposta pendente no período.')),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-os-sem-horario' }, el('h2', { id: 'titulo-os-sem-horario' }, 'Ordens de serviço sem horário'),
        a.os_sem_horario.length ? el('ul', { class: 'pilha', id: 'os-sem-horario' }, ...a.os_sem_horario.map((x) => el('li', { class: 'cartao pilha' }, el('p', {}, linkOs(x),
          ` · ${ESTADO_OS[x.estado] ?? x.estado}`), x.proposta_pendente ? el('p', { class: 'campo__ajuda' }, 'Horário proposto aguardando resposta.') : null)))
          : el('p', { id: 'os-sem-horario' }, 'Todas as ordens em andamento têm horário.')),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-sem-horario' }, el('h2', { id: 'titulo-sem-horario' }, 'Solicitações abertas sem horário'),
        a.solicitacoes_sem_horario.length ? el('ul', { class: 'pilha', id: 'sem-horario' }, ...a.solicitacoes_sem_horario.map((x) => el('li', { class: 'cartao' }, el('p', {}, linkSol(x)),
          x.preferencia ? el('p', { class: 'campo__ajuda' }, `Preferência (não é reserva): ${[x.preferencia.datas?.map((d) => d.split('-').reverse().join('/')).join(', '),
            TURNO[x.preferencia.turno], x.preferencia.observacao].filter(Boolean).join(' · ')}`) : null)))
          : el('p', { id: 'sem-horario' }, periodo.responsavel ? 'Filtro por responsável: solicitações sem OS não aparecem.' : 'Todas as solicitações abertas já têm horário.')),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-grade' }, el('h2', { id: 'titulo-grade' }, 'Horários de atendimento'),
        el('p', { class: 'campo__ajuda' }, 'Grade privada do ERP, no horário de São Paulo. O texto de horário da vitrine continua separado e só muda pela revisão da CK.'),
        ctx.pode('agenda.alterar') ? formGrade(a.grade) : gradeTexto(a.grade)));
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
