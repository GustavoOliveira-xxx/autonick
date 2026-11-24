// Agenda: três abas com um objetivo cada. "Semana" mostra os compromissos em calendário; "Horários de
// atendimento" é uma grade com um dia por linha, chave de aberto/fechado, turnos editáveis e uma régua de 24 h;
// "Folgas e exceções" guarda datas especiais.
import { ic, esc, secao, casca, abrirModal, operar, aviso } from '../pecas.js';

const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const grade = DIAS.map((_, i) => ({ aberto: i < 6, turnos: i < 5 ? [['08:00', '12:00'], ['13:00', '18:00']] : i === 5 ? [['08:00', '12:00']] : [] }));
const excecoes = [{ data: '2026-12-25', tipo: 'Feriado', texto: 'Natal', turnos: [] }, { data: '2026-12-31', tipo: 'Horário especial', texto: 'Véspera de Ano-Novo', turnos: [['08:00', '12:00']] }];
let sujo = false;

/** Aceita "8", "830", "8:30", "08h30" e devolve "08:30" (ou o texto original se não der). */
function normalizarHora(v) {
  const d = v.replace(/\D/g, ''); if (!d) return v;
  const [hh, mm] = d.length <= 2 ? [d, '00'] : [d.slice(0, d.length - 2), d.slice(-2)];
  const H = Number(hh), M = Number(mm); return H <= 24 && M < 60 ? `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}` : v;
}
const min = (t) => { const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN; };
const fmt = (t) => t.replace(':00', 'h').replace(':', 'h');
function regua(turnos) {
  turnos = turnos.filter(([a, f]) => !Number.isNaN(min(a)) && !Number.isNaN(min(f)) && min(f) > min(a));
  if (!turnos.length) return '<div class="rf-linha-dia" aria-hidden="true"><em>Fechado</em></div>';
  return `<div class="rf-linha-dia" aria-hidden="true">${turnos.map(([a, f]) => `<i style="left:${(min(a) / 1440) * 100}%;width:${Math.max(0.5, ((min(f) - min(a)) / 1440) * 100)}%"></i>`).join('')}</div>`;
}
function problemas(turnos) {
  for (const [a, f] of turnos) { if (Number.isNaN(min(a)) || Number.isNaN(min(f))) return 'Use o formato 08:00.'; if (min(f) <= min(a)) return 'O fim precisa ser depois do início.'; }
  if (turnos.length === 2 && min(turnos[1][0]) < min(turnos[0][1])) return 'O segundo turno começa antes do primeiro terminar.';
  return '';
}
function turnosHtml(d, i, erro) {
  const campos = d.turnos.map(([a, f], k) => `<span class="rf-turno"><input type="text" inputmode="numeric" maxlength="5" value="${a}" aria-label="${DIAS[i]}, turno ${k + 1}, abre" data-t="${k}" data-p="0">–<input type="text" inputmode="numeric" maxlength="5" value="${f}" aria-label="${DIAS[i]}, turno ${k + 1}, fecha" data-t="${k}" data-p="1">${d.turnos.length > 1 ? `<button type="button" data-tirar="${k}" aria-label="Remover turno ${k + 1} de ${DIAS[i]}">${ic('x')}</button>` : ''}</span>`).join('');
  const add = d.turnos.length < 2 ? `<button type="button" class="rf-add-turno" data-add>${ic('mais', 'width="14" height="14" style="display:inline;vertical-align:-2px"')} ${d.turnos.length ? 'Intervalo' : 'Turno'}</button>` : '';
  return `${campos}${add}${erro ? `<span class="rf-erro-campo" role="alert">${erro}</span>` : ''}`;
}
function linhaDia(d, i) {
  const erro = d.aberto ? problemas(d.turnos) : '';
  const horas = d.aberto ? d.turnos.reduce((s, [a, f]) => s + Math.max(0, min(f) - min(a)), 0) / 60 : 0;
  return `<div class="rf-dia ${d.aberto ? '' : 'rf-dia--fechado'}" data-dia="${i}">
    <div class="rf-dia__nome"><b>${DIAS[i]}</b><small>${d.aberto ? `${String(horas).replace('.', ',')} h abertas` : 'Fechado'}</small></div>
    <label class="rf-chave"><input type="checkbox" ${d.aberto ? 'checked' : ''} data-aberto aria-label="${DIAS[i]} aberto"><i></i></label>
    <div class="rf-turnos">${d.aberto ? turnosHtml(d, i, erro) : '<span class="rf-fraco">Não atende neste dia</span>'}</div>
    ${regua(d.aberto ? d.turnos : [])}
    <div class="rf-pop"><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Copiar horário de ${DIAS[i]}">${ic('copiar')}</button>
      <div class="rf-pop__lista" role="menu" hidden><button type="button" role="menuitem" data-copiar="uteis">${ic('copiar')}Copiar para seg. a sex.</button><button type="button" role="menuitem" data-copiar="todos">${ic('copiar')}Copiar para todos os dias</button></div></div>
  </div>`;
}
const PRESETS = [['comercial', 'Comercial', 'Seg. a sex. 8h–12h e 13h–18h · sáb. 8h–12h'], ['corrido', 'Horário corrido', 'Seg. a sáb. 9h–18h'], ['todos', 'Todos os dias', '9h–21h, inclusive domingo']];
function aplicarPreset(id) {
  grade.forEach((d, i) => {
    if (id === 'comercial') { d.aberto = i < 6; d.turnos = i < 5 ? [['08:00', '12:00'], ['13:00', '18:00']] : i === 5 ? [['08:00', '12:00']] : []; }
    if (id === 'corrido') { d.aberto = i < 6; d.turnos = i < 6 ? [['09:00', '18:00']] : []; }
    if (id === 'todos') { d.aberto = true; d.turnos = [['09:00', '21:00']]; }
  });
}
function abaHorarios() {
  return `<div class="rf-secao-t"><div><h3>Horários de atendimento</h3><p>Uma linha por dia. Use a chave para abrir ou fechar e até dois turnos por dia (com intervalo no meio).</p></div>
      <div class="rf-opcoes-chips" role="group" aria-label="Começar de um modelo">${PRESETS.map(([id, n, d]) => `<button type="button" aria-pressed="false" data-preset="${id}" title="${d}">${n}</button>`).join('')}</div></div>
    <div class="rf-tabela-caixa"><div class="rf-dia rf-dia--cab" style="padding-block:8px;background:var(--rf-sup2)"><span class="lb-rotulo">Dia</span><span class="lb-rotulo">Aberto</span><span class="lb-rotulo">Turnos</span><div class="rf-escala" aria-hidden="true"><span>0h</span><span>4h</span><span>8h</span><span>12h</span><span>16h</span><span>20h</span><span>24h</span></div><span></span></div>
      <div class="rf-semana" data-grade>${grade.map(linhaDia).join('')}</div></div>
    <div class="rf-cartao rf-cartao--p" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;${sujo ? 'position:sticky;bottom:8px;z-index:4;border-color:var(--rf-ouro-borda)' : ''}">
      <span data-sujo class="rf-fraco" style="flex:1;min-width:200px">${sujo ? '<b style="color:var(--rf-alerta)">● Alterações ainda não salvas</b>' : 'Tudo salvo. Os horários valem no fuso de São Paulo.'}</span>
      <button type="button" class="rf-bt rf-bt--f" data-desfazer ${sujo ? '' : 'disabled'}>Desfazer</button><button type="button" class="rf-bt rf-bt--p" data-salvar ${sujo ? '' : 'disabled'}>${ic('check')}Salvar horários</button></div>
    <p class="rf-fraco" style="margin:0">Estes horários são da agenda interna. O texto de horário da vitrine continua separado e passa pela revisão da CK.</p>`;
}
function abaExcecoes() {
  const dt = (iso) => { const d = new Date(`${iso}T12:00:00`); return [d.getDate(), d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')]; };
  return `<div class="rf-secao-t"><div><h3>Folgas e exceções</h3><p>Datas que fogem da semana normal: feriados, folgas, férias coletivas ou horário especial.</p></div><button type="button" class="rf-bt rf-bt--s" data-nova-excecao>${ic('mais')}Adicionar data</button></div>
    <div class="rf-excecoes rf-entra">${excecoes.length ? excecoes.map((x, i) => { const [dd, mm] = dt(x.data); return `<div class="rf-excecao"><span class="rf-data"><b>${dd}</b><small>${mm}</small></span>
      <div><b>${esc(x.texto)}</b><br><span class="rf-chip ${x.tipo === 'Horário especial' ? 'rf-chip--info' : 'rf-chip--neutro'}">${x.tipo}</span> <span class="rf-fraco">${x.turnos.length ? x.turnos.map(([a, f]) => `${fmt(a)}–${fmt(f)}`).join(' e ') : 'Fechado o dia todo'}</span></div>
      <button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-tirar-excecao="${i}" aria-label="Remover ${esc(x.texto)}">${ic('lixo')}</button></div>`; }).join('') : `<div class="rf-vazio">${ic('folga', 'width="28" height="28"')}Nenhuma data especial. A semana normal vale para todos os dias.</div>`}</div>`;
}
function abaSemana() {
  const comp = { 0: [['09:00', 'Pintura de parede', 'Cliente Carla', '']], 2: [['14:00', 'Orçamento no local', 'Cliente César', 'proposto']], 3: [['08:30', 'Troca de tela', 'Cliente Dora', ''], ['15:00', 'Revisão', 'Cliente Edu', '']] };
  const base = new Date('2026-11-23T12:00:00');
  return `<div class="rf-filtros"><div class="rf-abas" role="group" aria-label="Semana"><button type="button" aria-label="Semana anterior">‹</button><button type="button" aria-pressed="true">23 a 29 de nov.</button><button type="button" aria-label="Próxima semana">›</button></div>
      <button type="button" class="rf-bt rf-bt--f">Hoje</button><div class="rf-campo" style="margin-left:auto"><select aria-label="Responsável"><option>Todos os responsáveis</option><option>Bruno Caixa</option><option>Eva Estoque</option></select></div></div>
    <div class="rf-rolagem-x"><div class="rf-cal" style="min-width:860px">${DIAS.map((n, i) => { const d = new Date(base); d.setDate(base.getDate() + i); const fechado = !grade[i].aberto; return `<div class="rf-cal__col ${i === 1 ? 'rf-cal__col--hoje' : ''} ${fechado ? 'rf-cal__col--fechado' : ''}">
      <div class="rf-cal__cab"><small>${n.slice(0, 3)}${i === 1 ? ' · hoje' : ''}</small><b>${d.getDate()}</b><span class="rf-fraco">${fechado ? 'Fechado' : grade[i].turnos.map(([a, f]) => `${fmt(a)}–${fmt(f)}`).join(' · ')}</span></div>
      <div class="rf-cal__corpo">${(comp[i] ?? []).map(([h, s, c, t]) => `<a href="#" data-sem-nav class="rf-compromisso ${t ? 'rf-compromisso--proposto' : ''}"><b>${h}</b>${esc(s)}<span class="rf-fraco">${esc(c)}${t ? ' · aguarda resposta' : ''}</span></a>`).join('')}</div></div>`; }).join('')}</div></div>
    <div class="rf-cartao rf-cartao--p" style="display:grid;gap:8px"><div class="rf-secao-t"><h3 style="font-size:1.05rem">Sem horário (2)</h3><span class="rf-fraco">Arraste para um dia ou abra para propor horário</span></div>
      <div class="rf-opcoes-chips"><button type="button" aria-pressed="false">Solicitação nº 8 · Pintura · Cliente César</button><button type="button" aria-pressed="false">OS nº 41 · Troca de bateria · Cliente Fábio</button></div></div>`;
}

function pagina(palco, aba = 'horarios') {
  const app = casca({ atual: 'agenda', trilha: ['Business', 'Operação', 'Agenda'], titulo: 'Agenda', subtitulo: 'Seus compromissos e os horários em que a empresa atende.',
    acoes: aba === 'semana' ? `<button type="button" class="rf-bt rf-bt--p">${ic('mais')}Marcar horário</button>` : '' });
  const corpo = app.querySelector('[data-corpo]');
  const desenhar = () => {
    corpo.innerHTML = `<div class="rf-rolagem-x"><div class="rf-abas" role="tablist" aria-label="Agenda">
      <button type="button" role="tab" aria-selected="${aba === 'semana'}" data-aba="semana">${ic('agenda')}Semana</button>
      <button type="button" role="tab" aria-selected="${aba === 'horarios'}" data-aba="horarios">${ic('relogio')}Horários de atendimento</button>
      <button type="button" role="tab" aria-selected="${aba === 'excecoes'}" data-aba="excecoes">${ic('folga')}Folgas e exceções <span class="rf-n">${excecoes.length}</span></button></div></div>
      <div role="tabpanel" style="display:grid;gap:14px">${aba === 'semana' ? abaSemana() : aba === 'horarios' ? abaHorarios() : abaExcecoes()}</div>`;
  };
  desenhar(); palco.replaceChildren(app);
  let copia = JSON.stringify(grade);
  const marcar = () => { sujo = JSON.stringify(grade) !== copia; desenhar(); };
  app.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-aba]'); if (t) { aba = t.dataset.aba; pagina(palco, aba); return; }
    const pop = e.target.closest('[data-menu]'); if (pop) { const l = pop.nextElementSibling; l.hidden = !l.hidden; pop.setAttribute('aria-expanded', String(!l.hidden)); return; }
    const linha = e.target.closest('[data-dia]'); const d = linha ? grade[Number(linha.dataset.dia)] : null;
    if (e.target.closest('[data-add]') && d) { d.turnos.push(d.turnos.length ? ['13:00', '18:00'] : ['08:00', '12:00']); marcar(); }
    const tirar = e.target.closest('[data-tirar]'); if (tirar && d) { d.turnos.splice(Number(tirar.dataset.tirar), 1); marcar(); }
    const cp = e.target.closest('[data-copiar]'); if (cp && d) { grade.forEach((x, i) => { if (x !== d && (cp.dataset.copiar === 'todos' || i < 5)) { x.aberto = d.aberto; x.turnos = d.turnos.map((p) => [...p]); } }); marcar(); aviso('ok', `Horário de ${DIAS[Number(linha.dataset.dia)]} copiado`, 'Confira e salve.'); }
    const pr = e.target.closest('[data-preset]'); if (pr) { aplicarPreset(pr.dataset.preset); marcar(); }
    if (e.target.closest('[data-desfazer]')) { const orig = JSON.parse(copia); grade.forEach((x, i) => Object.assign(x, orig[i])); marcar(); }
    const sv = e.target.closest('[data-salvar]');
    if (sv) {
      if (grade.some((x) => x.aberto && problemas(x.turnos))) { aviso('erro', 'Confira os horários marcados em vermelho'); return; }
      if (await operar(sv, 'Salvando…')) { copia = JSON.stringify(grade); sujo = false; desenhar(); aviso('ok', 'Horários salvos', 'Valem a partir de agora para novos agendamentos.'); }
    }
    if (e.target.closest('[data-nova-excecao]')) novaExcecao(() => pagina(palco, 'excecoes'));
    const te = e.target.closest('[data-tirar-excecao]'); if (te) { excecoes.splice(Number(te.dataset.tirarExcecao), 1); desenhar(); }
  });
  app.addEventListener('change', (e) => {
    const linha = e.target.closest('[data-dia]'); if (!linha) return; const d = grade[Number(linha.dataset.dia)];
    if (e.target.matches('[data-aberto]')) { d.aberto = e.target.checked; if (d.aberto && !d.turnos.length) d.turnos = [['08:00', '18:00']]; const foco = Number(linha.dataset.dia); marcar(); corpo.querySelector(`[data-dia="${foco}"] [data-aberto]`)?.focus(); }
    if (e.target.matches('[data-t]')) { d.turnos[Number(e.target.dataset.t)][Number(e.target.dataset.p)] = normalizarHora(e.target.value); const foco = e.target.getAttribute('aria-label'); marcar(); corpo.querySelector(`[aria-label="${foco}"]`)?.focus(); }
  });
}

function novaExcecao(aoSalvar) {
  const d = abrirModal(`<form class="rf-modal__painel" novalidate><div class="rf-modal__cab"><div><h3>Adicionar data especial</h3><p>Vale só para o dia escolhido. A semana normal continua igual.</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo"><div class="rf-grade-campos"><div class="rf-campo"><label for="ex-data">Data</label><input id="ex-data" type="date" value="2026-12-24"></div><div class="rf-campo"><label for="ex-nome">Nome</label><input id="ex-nome" value="Véspera de Natal"></div></div>
      <div class="rf-escolha" role="radiogroup" aria-label="O que acontece neste dia"><label><input type="radio" name="tipo" value="Folga" checked><b>Fechado</b><span>Folga, feriado ou férias.</span></label><label><input type="radio" name="tipo" value="Horário especial"><b>Horário especial</b><span>Abre, mas em outro horário.</span></label></div>
      <div class="rf-turnos" data-especial hidden><span class="rf-turno"><input type="text" inputmode="numeric" maxlength="5" value="08:00" aria-label="Abre">–<input type="text" inputmode="numeric" maxlength="5" value="12:00" aria-label="Fecha"></span></div></div>
    <div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--f" data-fechar>Cancelar</button><button type="submit" class="rf-bt rf-bt--p">${ic('check')}Adicionar</button></div></form>`, { classe: 'rf-modal rf-modal--estreito' });
  d.addEventListener('change', (e) => { if (e.target.name === 'tipo') d.querySelector('[data-especial]').hidden = e.target.value !== 'Horário especial'; });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!(await operar(e.submitter, 'Adicionando…'))) return;
    const tipo = new FormData(e.target).get('tipo'); const tt = [...d.querySelectorAll('[data-especial] input')].map((x) => x.value);
    excecoes.push({ data: d.querySelector('#ex-data').value, tipo: tipo === 'Folga' ? 'Folga' : tipo, texto: d.querySelector('#ex-nome').value || 'Data especial', turnos: tipo === 'Folga' ? [] : [tt] });
    excecoes.sort((a, b) => a.data.localeCompare(b.data)); d.close(); aoSalvar(); aviso('ok', 'Data adicionada');
  });
}

export function montar() {
  const s = secao({ titulo: 'Agenda', destaque: 'reprojetada', texto: 'Os 28 campos de hora soltos viram uma grade com um dia por linha, chave de aberto/fechado, turnos editáveis, modelos prontos e uma régua de 24 h para bater o olho.',
    antes: 'img/antes/agenda.webp',
    objetivos: [['Definir o horário', 'Escolha um modelo ("Comercial") e ajuste o que for diferente. Copie um dia para os outros.'], ['Folga ou feriado', 'Aba própria: data, fechado ou horário especial.'], ['Ver a semana', 'Calendário de 7 colunas com os dias fechados riscados e o que está sem horário.']],
    selos: [['Grade e semana: banco atual (até 2 turnos)', 'ok'], ['Folgas e exceções: precisa de tabela nova', 'banco']],
    notas: ['A grade de horários sai do fim da página e vira uma aba própria.', 'Erros aparecem na hora (fim antes do início, turnos sobrepostos), sem esperar o envio.', 'Barra de salvar fixa, avisando quando há alterações não salvas, com "Desfazer".', 'Hora no formato 24 h, como no Brasil, e régua visual que mostra os intervalos.', 'Na semana, propostas aguardando resposta aparecem tracejadas e diferentes das confirmadas.'] });
  pagina(s.querySelector('[data-palco]')); return s;
}
