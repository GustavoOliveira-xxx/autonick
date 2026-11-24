/**
 * Agenda (M09, RF-116 a RF-118; D9-17, D9-18, D9-26; reorganizada no E04).
 *
 * Abas:
 *  - Calendário: visões Dia e Semana (grade de horas com o horário de atendimento ao fundo), Mês e Lista; horários
 *    confirmados de solicitações e OS, propostas aguardando resposta, OS e solicitações sem horário; filtro informativo
 *    por responsável. As exceções do dia (feriado, fechamento, horário especial) aparecem no cabeçalho de cada dia.
 *  - Horários de atendimento: grade semanal com até 2 turnos por dia, no horário de São Paulo.
 *  - Exceções: feriados, fechamentos e horários especiais por data. Valem nos avisos de conflito ao marcar horário.
 * Sem agenda por funcionário nem cálculo de vagas: conflitos geram aviso e exigem confirmação explícita (regra do banco).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, grupoOpcoes, erroNoCampo, limparErros, ocupado, valores } from '../../ui/formulario.js';
import { abrirDialogo } from '../../ui/dialogo.js';
import { abas } from '../../ui/abas.js';
import { montarGrade, textoHorario } from '../../domain/servicos.js';
import { salvarHorarios, excecoesAgenda, salvarExcecaoAgenda, removerExcecaoAgenda, DIAS, TURNO } from '../../data/servicos.js';
import { agendaOperacional, ESTADO_OS } from '../../data/ordens.js';
import { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, gradeTexto, dataDeHoje, somarDias, formatarData } from './comum.js';
import { montarMomento } from '../../ui/forja3d/momentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let periodo = { de: dataDeHoje(), visao: 'semana', responsavel: '' };
let abaAtiva = ['calendario', 'horarios', 'excecoes'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'calendario';
const executar = criarExecutor({ area, anunciar, recarregar: () => carregar(), erroNoCampo });

const VISOES = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['lista', 'Lista']];
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const diaDaSemana = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const diaSp = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const minutosSp = (iso) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).split(':');
  return Number(h) * 60 + Number(m);
};
const paraMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Período pedido ao banco conforme a visão (o banco aceita até 62 dias). */
function intervalo() {
  const { de, visao } = periodo;
  if (visao === 'dia') return { inicio: de, fim: de };
  if (visao === 'lista') return { inicio: de, fim: somarDias(de, 13) };
  if (visao === 'mes') {
    const primeiro = `${de.slice(0, 7)}-01`;
    const inicio = somarDias(primeiro, -diaDaSemana(primeiro));
    return { inicio, fim: somarDias(inicio, 41), mes: de.slice(0, 7) };
  }
  return { inicio: de, fim: somarDias(de, 6) };
}
function andar(sentido) {
  const { de, visao } = periodo;
  if (visao === 'mes') {
    const [a, m] = de.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + sentido, 1));
    periodo.de = d.toISOString().slice(0, 10);
  } else {
    periodo.de = somarDias(de, sentido * ({ dia: 1, semana: 7, lista: 14 })[visao]);
  }
  carregar();
}

// --- Calendário ---------------------------------------------------------------------------------------

function formPeriodo(equipe) {
  const form = el('form', { class: 'barra-agenda', id: 'form-periodo', role: 'search', 'aria-label': 'Escolher o período da agenda' },
    campoTexto({ nome: 'de', rotulo: 'A partir de', tipo: 'date', valor: periodo.de, id: 'agenda-de' }),
    campoSelecao({ nome: 'visao', rotulo: 'Visão', opcoes: VISOES, valor: periodo.visao, vazio: null, id: 'agenda-visao' }),
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

function navegacaoPeriodo(r) {
  const anterior = el('button', { type: 'button', class: 'botao botao--secundario', 'aria-label': 'Período anterior' }, '‹');
  const proximo = el('button', { type: 'button', class: 'botao botao--secundario', 'aria-label': 'Próximo período' }, '›');
  const hoje = el('button', { type: 'button', class: 'botao botao--texto' }, 'Hoje');
  anterior.addEventListener('click', () => andar(-1));
  proximo.addEventListener('click', () => andar(1));
  hoje.addEventListener('click', () => { periodo.de = dataDeHoje(); carregar(); });
  const titulo = r.mes ? `${MESES[Number(r.mes.slice(5)) - 1]} de ${r.mes.slice(0, 4)}`
    : r.inicio === r.fim ? `${DIAS[diaDaSemana(r.inicio)]}, ${formatarData(r.inicio)}` : `${formatarData(r.inicio)} a ${formatarData(r.fim)}`;
  // Atalhos de visão: aplicam na hora, mantendo a data e o filtro.
  const visoes = el('div', { class: 'navegacao-periodo__visoes', role: 'group', 'aria-label': 'Visão do calendário' }, ...VISOES.map(([v, nome]) => {
    const b = el('button', { type: 'button', class: 'botao botao--texto', 'aria-pressed': String(periodo.visao === v), 'data-visao': v }, nome);
    b.addEventListener('click', () => { if (periodo.visao !== v) { periodo.visao = v; carregar(); } });
    return b;
  }));
  return el('div', { class: 'navegacao-periodo' }, anterior, hoje, proximo, el('strong', { class: 'navegacao-periodo__titulo', 'aria-live': 'polite' }, titulo), visoes);
}

const linkCompromisso = (x) => (x.os_id ? `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(x.os_id)}`
  : `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(x.solicitacao_id)}`);
const tituloCompromisso = (x) => (x.os_id ? `OS nº ${x.os_numero} · ${x.servico} · ${x.cliente_nome}` : `Solicitação nº ${x.solicitacao_numero} · ${x.servico} · ${x.cliente_nome}`);

function cartaoCompromisso(x) {
  return el('li', { class: 'cartao pilha', 'data-compromisso': x.os_id ? 'os' : 'solicitacao' },
    el('p', {}, el('strong', {}, textoHorario(x.inicio, x.fim)), x.menos_de_24h ? ' · menos de 24 horas' : ''),
    el('p', {}, el('a', { href: linkCompromisso(x) }, tituloCompromisso(x)),
      x.os_estado ? ` · ${ESTADO_OS[x.os_estado] ?? x.os_estado}` : '', x.responsavel ? ` · ${x.responsavel}` : ''),
    x.reagendamento_pendente ? el('p', { class: 'campo__ajuda' }, 'Há outro horário proposto aguardando resposta; este continua valendo até lá.') : null,
    x.avisos?.length ? el('p', { class: 'campo__ajuda' }, `Confirmado com aviso: ${x.avisos.map((v) => v.mensagem).join(' ')}`) : null);
}

/** Intervalos de atendimento de um dia: a exceção do dia vale no lugar da grade semanal. */
function atendimentoDoDia(d, grade, excecoes) {
  const x = excecoes.get(d);
  if (x) return { excecao: x, intervalos: x.tipo === 'fechado' ? [] : x.intervalos };
  return { excecao: null, intervalos: grade.find((g) => g.dia_semana === diaDaSemana(d))?.intervalos ?? [] };
}
function rotuloDoDia(d, grade, excecoes) {
  const { excecao, intervalos } = atendimentoDoDia(d, grade, excecoes);
  if (excecao) return el('span', { class: `chip ${excecao.tipo === 'fechado' ? 'chip--alerta' : 'chip--info'} chip--pequeno`, title: excecao.motivo },
    excecao.tipo === 'fechado' ? `Fechado: ${excecao.motivo}` : `Especial: ${excecao.intervalos.map((i) => `${i.abre}–${i.fecha}`).join(', ')}`);
  // Sem nenhuma grade cadastrada, o aviso aparece uma vez no topo (não em cada dia).
  if (!grade.some((g) => g.intervalos.length)) return null;
  return intervalos.length ? null : el('span', { class: 'chip chip--neutro chip--pequeno' }, 'Sem atendimento');
}

/** Visões Dia e Semana: colunas por dia, horas na vertical, compromissos posicionados pela hora de São Paulo. */
function gradeDeHoras(dias, a, excecoes) {
  const minutos = [...a.grade.flatMap((g) => g.intervalos), ...[...excecoes.values()].flatMap((x) => x.intervalos)]
    .flatMap((i) => [paraMin(i.abre), paraMin(i.fecha)]);
  for (const x of a.confirmados) { minutos.push(minutosSp(x.inicio)); minutos.push(Math.min(24 * 60, minutosSp(x.inicio) + (Date.parse(x.fim) - Date.parse(x.inicio)) / 60000)); }
  const h0 = Math.max(0, Math.floor((minutos.length ? Math.min(...minutos) : 8 * 60) / 60));
  const h1 = Math.min(24, Math.max(h0 + 4, Math.ceil((minutos.length ? Math.max(...minutos) : 18 * 60) / 60)));
  const total = (h1 - h0) * 60;
  const pos = (no, ini, fim) => {
    no.style.setProperty('--topo', `${((ini - h0 * 60) / total) * 100}%`);
    no.style.setProperty('--altura', `${Math.max(((fim - ini) / total) * 100, 3)}%`);
    return no;
  };
  const horas = el('div', { class: 'calendario__horas', 'aria-hidden': 'true' }, el('span', {}),
    el('div', {}, ...Array.from({ length: h1 - h0 }, (_, i) => el('span', {}, `${String(h0 + i).padStart(2, '0')}:00`))));
  const colunas = dias.map((d) => {
    const { intervalos } = atendimentoDoDia(d, a.grade, excecoes);
    const itens = a.confirmados.filter((x) => diaSp(x.inicio) === d);
    const faixas = intervalos.map((i) => pos(el('div', { class: 'calendario__aberto', 'aria-hidden': 'true' }), paraMin(i.abre), paraMin(i.fecha)));
    const eventos = itens.map((x) => {
      const ini = minutosSp(x.inicio);
      const fim = Math.min(h1 * 60, ini + (Date.parse(x.fim) - Date.parse(x.inicio)) / 60000);
      const li = cartaoCompromisso(x);
      li.classList.add('calendario__evento');
      if (x.os_id) li.classList.add('calendario__evento--os');
      return pos(li, ini, fim);
    });
    const hoje = d === dataDeHoje();
    return el('section', { class: `calendario__dia${hoje ? ' calendario__dia--hoje' : ''}`, 'aria-labelledby': `dia-${d}`, 'data-dia': d },
      el('h3', { id: `dia-${d}`, class: 'calendario__cab' }, el('span', {}, `${DIAS_CURTOS[diaDaSemana(d)]} `), el('strong', {}, d.slice(8)),
        el('span', { class: 'visualmente-oculto' }, `, ${DIAS[diaDaSemana(d)]}, ${formatarData(d)}`), rotuloDoDia(d, a.grade, excecoes)),
      el('div', { class: 'calendario__corpo' }, ...faixas,
        itens.length ? el('ul', { class: 'calendario__eventos', role: 'list' }, ...eventos) : el('p', { class: 'visualmente-oculto' }, 'Nenhum horário confirmado.')));
  });
  const grade = el('div', { class: `calendario calendario--${dias.length === 1 ? 'dia' : 'semana'}` }, horas, ...colunas);
  grade.style.setProperty('--linhas', String(h1 - h0));
  grade.style.setProperty('--colunas', String(dias.length));
  return el('div', { class: 'calendario__rolagem' }, grade);
}

/** Visão Mês: grade de 6 semanas; cada dia mostra até 3 compromissos e abre na visão Dia. */
function gradeDoMes(r, a, excecoes) {
  const dias = Array.from({ length: 42 }, (_, i) => somarDias(r.inicio, i));
  const cab = DIAS_CURTOS.map((n) => el('span', { class: 'mes__semana', 'aria-hidden': 'true' }, n));
  const celulas = dias.map((d) => {
    const itens = a.confirmados.filter((x) => diaSp(x.inicio) === d);
    const abrir = el('button', { type: 'button', class: 'mes__numero', 'aria-label': `Abrir ${DIAS[diaDaSemana(d)]}, ${formatarData(d)}: ${itens.length} ${itens.length === 1 ? 'horário' : 'horários'}` }, String(Number(d.slice(8))));
    abrir.addEventListener('click', () => { periodo = { ...periodo, de: d, visao: 'dia' }; carregar(); });
    return el('section', { class: `mes__dia${d.slice(0, 7) === r.mes ? '' : ' mes__dia--fora'}${d === dataDeHoje() ? ' mes__dia--hoje' : ''}`, 'data-dia': d, 'aria-label': formatarData(d) },
      abrir, rotuloDoDia(d, a.grade, excecoes),
      itens.length ? el('ul', { class: 'mes__itens', role: 'list' }, ...itens.slice(0, 3).map((x) => el('li', {},
        el('a', { href: linkCompromisso(x) }, `${textoHorario(x.inicio).split(' ').pop()} ${x.os_id ? `OS ${x.os_numero}` : `Sol. ${x.solicitacao_numero}`}`))),
        itens.length > 3 ? el('li', { class: 'campo__ajuda' }, `+${itens.length - 3}`) : null) : null);
  });
  return el('div', { class: 'calendario__rolagem' }, el('div', { class: 'mes' }, ...cab, ...celulas));
}

function listaPorDia(dias, a, excecoes) {
  return dias.map((d) => {
    const itens = a.confirmados.filter((x) => diaSp(x.inicio) === d);
    return el('section', { class: 'pilha', 'aria-labelledby': `dia-${d}`, 'data-dia': d },
      el('h3', { id: `dia-${d}` }, `${DIAS[diaDaSemana(d)]}, ${formatarData(d)} `, rotuloDoDia(d, a.grade, excecoes)),
      itens.length ? el('ul', { class: 'pilha' }, ...itens.map(cartaoCompromisso)) : el('p', { class: 'campo__ajuda' }, 'Nenhum horário confirmado.'));
  });
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
      el('p', {}, el('strong', {}, `Começa em ${minutos} minuto${minutos === 1 ? '' : 's'}: `), textoHorario(x.inicio, x.fim), ' · ', tituloCompromisso(x)));
    lugar.replaceChildren(caixa);
    montarMomento(caixa, 'IB07', { tamanho: 'p' }).disparar();
    relogioLembrete = setTimeout(() => acompanharLembrete(confirmados.filter((c) => c !== x), lugar), proximo.ms);
    return;
  }
  lugar.replaceChildren();
  const espera = proximo.ms - JANELA_LEMBRETE_MS;
  if (espera < 6 * 60 * 60 * 1000) relogioLembrete = setTimeout(() => acompanharLembrete(confirmados, lugar), espera);
}

function painelCalendario(r, a, excecoes) {
  const dias = [];
  for (let d = r.inicio; d <= r.fim; d = somarDias(d, 1)) dias.push(d);
  const visao = periodo.visao;
  const corpo = visao === 'mes' ? gradeDoMes(r, a, excecoes) : visao === 'lista' ? listaPorDia(dias, a, excecoes) : [gradeDeHoras(dias, a, excecoes)];
  const linkOs = (x) => el('a', { href: `/business/ordem.html?id=${encodeURIComponent(ctx.id)}&os=${encodeURIComponent(x.os_id)}` }, `OS nº ${x.os_numero} · ${x.servico} · ${x.cliente_nome}`);
  const linkSol = (x) => el('a', { href: `/business/solicitacao.html?id=${encodeURIComponent(ctx.id)}&solicitacao=${encodeURIComponent(x.solicitacao_id)}` },
    `Nº ${x.numero} · ${x.servico} · ${x.cliente_nome}`);
  const lembrete = el('div', { id: 'lembrete-agenda' });
  acompanharLembrete(a.confirmados, lembrete);
  return el('div', { class: 'pilha-grande' },
    lembrete,
    formPeriodo(a.equipe),
    navegacaoPeriodo(r),
    el('p', { class: 'campo__ajuda' }, a.aviso),
    a.grade.some((g) => g.intervalos.length) ? null : aviso('info', 'Os horários de atendimento ainda não foram cadastrados.',
      el('p', {}, 'Cadastre-os na aba "Horários de atendimento": eles aparecem ao fundo do calendário e geram aviso ao marcar fora deles.')),
    el('section', { class: 'pilha', 'aria-labelledby': 'titulo-confirmados', id: 'confirmados' },
      el('h2', { id: 'titulo-confirmados', class: 'visualmente-oculto' }, `Horários confirmados de ${formatarData(r.inicio)} a ${formatarData(r.fim)}`),
      ...[corpo].flat(),
      a.confirmados.length ? null : el('p', { class: 'campo__ajuda' }, 'Nenhum horário confirmado neste período.')),
    el('div', { class: 'agenda-pendencias' },
      el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-propostos' }, el('h2', { id: 'titulo-propostos' }, `Horários propostos aguardando resposta (${a.propostos.length})`),
        a.propostos.length ? el('ul', { class: 'pilha', id: 'propostos' }, ...a.propostos.map((x) => el('li', { class: 'pilha' },
          el('p', {}, el('strong', {}, textoHorario(x.inicio, x.fim)), ` · ${x.proposto_por === 'empresa' ? 'proposto pela empresa, aguarda o cliente' : 'pedido pelo cliente, aguarda a empresa'}`),
          el('p', {}, linkOs(x)), x.motivo ? el('p', { class: 'campo__ajuda' }, `Motivo: ${x.motivo}`) : null)))
          : el('p', { id: 'propostos' }, 'Nenhuma proposta pendente no período.')),
      el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-os-sem-horario' }, el('h2', { id: 'titulo-os-sem-horario' }, `Ordens de serviço sem horário (${a.os_sem_horario.length})`),
        a.os_sem_horario.length ? el('ul', { class: 'pilha', id: 'os-sem-horario' }, ...a.os_sem_horario.map((x) => el('li', { class: 'pilha' }, el('p', {}, linkOs(x),
          ` · ${ESTADO_OS[x.estado] ?? x.estado}`), x.proposta_pendente ? el('p', { class: 'campo__ajuda' }, 'Horário proposto aguardando resposta.') : null)))
          : el('p', { id: 'os-sem-horario' }, 'Todas as ordens em andamento têm horário.')),
      el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-sem-horario' }, el('h2', { id: 'titulo-sem-horario' }, `Solicitações abertas sem horário (${a.solicitacoes_sem_horario.length})`),
        a.solicitacoes_sem_horario.length ? el('ul', { class: 'pilha', id: 'sem-horario' }, ...a.solicitacoes_sem_horario.map((x) => el('li', {}, el('p', {}, linkSol(x)),
          x.preferencia ? el('p', { class: 'campo__ajuda' }, `Preferência (não é reserva): ${[x.preferencia.datas?.map((d) => d.split('-').reverse().join('/')).join(', '),
            TURNO[x.preferencia.turno], x.preferencia.observacao].filter(Boolean).join(' · ')}`) : null)))
          : el('p', { id: 'sem-horario' }, periodo.responsavel ? 'Filtro por responsável: solicitações sem OS não aparecem.' : 'Todas as solicitações abertas já têm horário.'))));
}

// --- Horários de atendimento -------------------------------------------------------------------------

function formGrade(grade) {
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Salvar horários');
  const linha = (d) => el('fieldset', { class: 'grade-semana__dia', 'data-dia': d.dia_semana },
    el('legend', {}, DIAS[d.dia_semana]),
    ...[0, 1].map((i) => el('div', { class: 'grade-semana__turno' },
      el('span', { class: 'grade-semana__rotulo', 'aria-hidden': 'true' }, i === 0 ? '1º turno' : '2º turno'),
      campoTexto({ nome: `d${d.dia_semana}-${i}-abre`, rotulo: `${i === 0 ? 'Primeiro' : 'Segundo'} intervalo: abre`, tipo: 'time', valor: d.intervalos[i]?.abre ?? '', id: `d${d.dia_semana}-${i}-abre` }),
      campoTexto({ nome: `d${d.dia_semana}-${i}-fecha`, rotulo: `${i === 0 ? 'Primeiro' : 'Segundo'} intervalo: fecha`, tipo: 'time', valor: d.intervalos[i]?.fecha ?? '', id: `d${d.dia_semana}-${i}-fecha` }))));
  const copiar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Copiar a segunda-feira para terça a sexta');
  const form = el('form', { class: 'pilha', id: 'form-grade', novalidate: true },
    el('p', { class: 'campo__ajuda' }, 'Deixe os dois turnos em branco para dia fechado. O segundo turno é opcional (por exemplo, depois do almoço).'),
    el('div', { class: 'grade-semana' }, ...grade.map(linha)),
    el('div', { class: 'grupo-botoes' }, botao, copiar));
  copiar.addEventListener('click', () => {
    for (let dia = 2; dia <= 5; dia += 1) {
      for (const i of [0, 1]) for (const c of ['abre', 'fecha']) form.querySelector(`#d${dia}-${i}-${c}`).value = form.querySelector(`#d1-${i}-${c}`).value;
    }
    anunciar('info', 'Horários de segunda-feira copiados para terça a sexta. Confira e salve.');
  });
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
      const [t1, t2] = entradas[dia];
      if (t1.abre && t2.abre && t2.abre < t1.fecha) return erroNoCampo(form, `d${dia}-1-abre`, 'O segundo turno começa depois do fim do primeiro.');
    }
    return ocupado(botao, () => executar('grade', form, (k) => salvarHorarios(ctx.id, montarGrade(entradas), k), () => anunciar('sucesso', 'Horários de atendimento salvos.')));
  });
  return form;
}

function painelHorarios(grade) {
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-grade' }, el('h2', { id: 'titulo-grade' }, 'Horários de atendimento'),
    el('p', { class: 'campo__ajuda' }, 'Grade privada do ERP, no horário de São Paulo. Ela aparece ao fundo do calendário e gera avisos ao marcar fora dela. O texto de horário da vitrine continua separado e só muda pela revisão da CK.'),
    ctx.pode('agenda.alterar') ? formGrade(grade) : gradeTexto(grade));
}

// --- Exceções ------------------------------------------------------------------------------------------

function formExcecao() {
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Salvar exceção');
  const especial = el('div', { class: 'pilha', hidden: true, id: 'excecao-intervalos' },
    el('div', { class: 'grade-semana__turno' },
      campoTexto({ nome: 'abre1', rotulo: 'Abre', tipo: 'time', id: 'excecao-abre1' }), campoTexto({ nome: 'fecha1', rotulo: 'Fecha', tipo: 'time', id: 'excecao-fecha1' })),
    el('div', { class: 'grade-semana__turno' },
      campoTexto({ nome: 'abre2', rotulo: 'Abre (2º turno, opcional)', tipo: 'time', id: 'excecao-abre2' }), campoTexto({ nome: 'fecha2', rotulo: 'Fecha (2º turno)', tipo: 'time', id: 'excecao-fecha2' })));
  const form = el('form', { class: 'cartao pilha', id: 'form-excecao', novalidate: true },
    el('h3', {}, 'Nova exceção'),
    campoTexto({ nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, id: 'excecao-data', valor: dataDeHoje(), ajuda: 'Se a data já tiver uma exceção, ela é substituída.' }),
    grupoOpcoes({ nome: 'tipo', legenda: 'Como fica o dia', opcoes: [['fechado', 'Fechado (feriado, folga, inventário)'], ['horario_especial', 'Horário especial']], valor: 'fechado' }),
    especial,
    campoTexto({ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, max: 120, id: 'excecao-motivo', ajuda: 'Por exemplo: "Feriado municipal" ou "Meio período".' }),
    el('div', { class: 'grupo-botoes' }, botao));
  form.addEventListener('change', () => { especial.hidden = valores(form).tipo !== 'horario_especial'; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.data) return erroNoCampo(form, 'data', 'Escolha a data.');
    if (d.data < dataDeHoje()) return erroNoCampo(form, 'data', 'Escolha hoje ou uma data futura.');
    if (!d.motivo || d.motivo.trim().length < 2) return erroNoCampo(form, 'motivo', 'Diga o motivo.');
    const intervalos = [];
    if (d.tipo === 'horario_especial') {
      if (!d.abre1 || !d.fecha1) return erroNoCampo(form, d.abre1 ? 'fecha1' : 'abre1', 'Informe abertura e fechamento.');
      if (d.abre1 >= d.fecha1) return erroNoCampo(form, 'fecha1', 'O fechamento vem depois da abertura.');
      intervalos.push({ abre: d.abre1, fecha: d.fecha1 });
      if (d.abre2 || d.fecha2) {
        if (!d.abre2 || !d.fecha2) return erroNoCampo(form, d.abre2 ? 'fecha2' : 'abre2', 'Preencha os dois horários do 2º turno.');
        if (d.abre2 < d.fecha1 || d.abre2 >= d.fecha2) return erroNoCampo(form, 'abre2', 'O 2º turno começa depois do 1º e abre antes de fechar.');
        intervalos.push({ abre: d.abre2, fecha: d.fecha2 });
      }
    }
    return ocupado(botao, () => executar('excecao', form, (k) => salvarExcecaoAgenda(ctx.id, d.data, d.tipo, intervalos, d.motivo.trim(), k),
      (x) => anunciar('sucesso', `Exceção salva para ${formatarData(x.data)}.`, el('p', {}, 'Ela aparece no calendário e nos avisos ao marcar horário nesse dia.'))));
  });
  return form;
}

function painelExcecoes(excecoes) {
  const lista = [...excecoes.values()];
  const pode = ctx.pode('agenda.alterar');
  return el('section', { class: 'pilha-grande', 'aria-labelledby': 'titulo-excecoes' },
    el('div', { class: 'pilha' }, el('h2', { id: 'titulo-excecoes' }, `Feriados e exceções (${lista.length})`),
      el('p', { class: 'campo__ajuda' }, 'Um dia fechado ou com horário especial substitui a grade semanal só naquele dia. Marcar horário nesse dia gera aviso, e a gravação exige confirmação.')),
    lista.length ? el('ul', { class: 'lista-simples', id: 'lista-excecoes' }, ...lista.map((x) => {
      const remover = pode ? el('button', { type: 'button', class: 'botao botao--texto' }, 'Remover') : null;
      remover?.addEventListener('click', () => ocupado(remover, async () => {
        const ok = await abrirDialogo({ titulo: `Remover a exceção de ${formatarData(x.data)}?`, mensagens: ['O dia volta a seguir a grade semanal de atendimento.'],
          rotuloConfirmar: 'Remover exceção', rotuloCancelar: 'Manter' });
        if (!ok) return;
        await executar(`remover-${x.id}`, null, (k) => removerExcecaoAgenda(x.id, k), () => anunciar('sucesso', 'Exceção removida.'));
      }));
      return el('li', { class: 'cartao linha-excecao', 'data-excecao': x.data },
        el('div', {}, el('strong', {}, `${DIAS[diaDaSemana(x.data)]}, ${formatarData(x.data)}`),
          el('p', {}, x.tipo === 'fechado' ? 'Fechado' : `Horário especial: ${x.intervalos.map((i) => `${i.abre} às ${i.fecha}`).join(' e ')}`, ` · ${x.motivo}`),
          el('p', { class: 'campo__ajuda' }, `Registrado por ${x.criado_por ?? 'pessoa removida'}`)),
        remover);
    })) : el('p', { id: 'lista-excecoes' }, 'Nenhuma exceção a partir de hoje.'),
    pode ? formExcecao() : null);
}

// --- Carregamento -------------------------------------------------------------------------------------

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
    const r = intervalo();
    const hoje = dataDeHoje();
    const [a, lista] = await Promise.all([agendaOperacional(ctx.id, r.inicio, r.fim, periodo.responsavel || null),
      excecoesAgenda(ctx.id, r.inicio < hoje ? r.inicio : hoje, somarDias(r.inicio < hoje ? r.inicio : hoje, 400)).catch(() => [])]);
    const excecoes = new Map((Array.isArray(lista) ? lista : []).map((x) => [x.data, x]));
    const futuras = new Map([...excecoes].filter(([d]) => d >= hoje));
    concluirCarregamento(area);
    const grupo = abas({ rotulo: 'Partes da agenda', ativa: abaAtiva, aoTrocar: (k) => { abaAtiva = k; },
      itens: [
        { chave: 'calendario', titulo: 'Calendário', painel: painelCalendario(r, a, excecoes) },
        { chave: 'horarios', titulo: 'Horários de atendimento', painel: painelHorarios(a.grade) },
        { chave: 'excecoes', titulo: 'Feriados e exceções', contador: futuras.size, painel: painelExcecoes(futuras) },
      ] });
    area.replaceChildren(grupo.elemento);
  } catch (erro) {
    tratarErro(area, erro, carregar);
  }
}

carregar();
