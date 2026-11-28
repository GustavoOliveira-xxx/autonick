// Lab de animações do AutoniCK: palco com comparação lado a lado, estúdio da mãozinha e galeria completa.
import { carregarFontes } from '../fontes.js';
import { obterMotor } from '../motor/motor.js';
import { AMBIENTE, poseNeutra } from '../motor/curvas.js';
import { ANIMACOES, tempoRepresentativo } from '../motor/animacoes.js';
import '../forja/cenas.js';
import { GESTOS, POSES, VARIANTES_MAO } from '../motor/mao.js';
import { NOVAS, MAO } from './novas.js';
import { B } from '../catalogo.js';
import { vitrine3D } from '../paginas/comum.js';

const ORIGEM = { app: ['No app hoje', 'ok'], nova: ['Nova', 'ouro'], refinada: ['Refinada', 'info'], existente: ['Lab anterior', 'neutro'] };
const nomeB = (id) => B.find((p) => p.id === id)?.nome ?? id;
const LISTA = [
  ['B12F', 'Chamado da Forja (no app)', 'app', ANIMACOES.B12F],
  ...Object.entries(NOVAS).map(([id, a]) => [id, a.nome, id === 'N02' ? 'refinada' : 'nova', a]),
  ...Object.keys(ANIMACOES).filter((id) => /^B\d\d$/.test(id)).map((id) => [id, id === 'B00' ? 'Quem tocou? (versão anterior do app)' : nomeB(id), 'existente', ANIMACOES[id]]),
];
const porId = (id) => LISTA.find(([x]) => x === id);
const est = { estilo: { modo: 'hq', luz: 'frontal', contorno: true }, hq: true, velocidade: 1 };
const raiz = document.documentElement; const conteudo = document.getElementById('conteudo');
const vistas = new Set();

async function enquadrar(anim) { return anim.enquadramento; }
/* Intensidade: interpola cada número da pose entre o repouso (quadro 0) e o quadro atual (1 = como aprovado). */
function misturar(base, alvo, k) {
  if (typeof alvo === 'number' && typeof base === 'number') return base + (alvo - base) * k;
  if (Array.isArray(alvo) && Array.isArray(base)) return alvo.map((v, i) => (i < base.length ? misturar(base[i], v, k) : v));
  if (alvo && typeof alvo === 'object' && base && typeof base === 'object') {
    const r = {}; for (const c of Object.keys(alvo)) r[c] = c in base ? misturar(base[c], alvo[c], k) : alvo[c];
    return r;
  }
  return alvo;
}
const fonteDe = (anim, { laco = true, pausa = 0.9, intensidade = 1 } = {}) => (t, ctx) => {
  const quadro = (u) => (intensidade === 1 ? anim.quadro(u, ctx) : misturar(anim.quadro(0, ctx), anim.quadro(u, ctx), intensidade));
  if (AMBIENTE.reduzido) return { pose: quadro(anim.fimMovimento ?? anim.dur), info: { u: anim.fimMovimento ?? anim.dur } };
  const ciclo = anim.dur + pausa; const u = laco ? t % ciclo : Math.min(t, anim.dur);
  return { pose: quadro(Math.min(u, anim.dur)), info: { u: Math.min(u, anim.dur) } };
};
function aplicarEstilo() { for (const v of vistas) v.vista?.atualizar({ estilo: { ...est.estilo }, hq: est.hq, velocidade: est.velocidade }); }

/* ---------------- palco (A/B) ---------------- */
function palco(lado, idInicial) {
  const el = document.createElement('section'); el.className = 'an-palco';
  el.innerHTML = `<div class="an-palco__topo"><span class="an-lado">${lado}</span><select aria-label="Animação do palco ${lado}" data-sel>${LISTA.map(([id, n, o]) => `<option value="${id}" ${id === idInicial ? 'selected' : ''}>${id} · ${n}${o === 'nova' ? ' ★' : ''}</option>`).join('')}</select><span data-origem></span></div>
    <div class="an-vista" data-vista></div>
    <div class="an-controles"><button type="button" class="rf-bt rf-bt--s rf-bt--icone" data-play aria-label="Pausar">❚❚</button><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-reiniciar aria-label="Do começo">↺</button>
      <input type="range" min="0" max="1000" value="0" aria-label="Linha do tempo" data-tempo><output data-t>0,0 s</output>
      <label class="rf-chave"><input type="checkbox" checked data-laco><i></i>Laço</label></div>
    <div class="an-controles an-controles--extra">
      <label>Intervalo <input type="range" min="0" max="3" step="0.1" value="0.9" data-pausa aria-label="Pausa entre repetições"><output data-pausa-v>0,9 s</output></label>
      <label>Intensidade <input type="range" min="0.5" max="1.5" step="0.05" value="1" data-intensidade aria-label="Intensidade do movimento"><output data-intensidade-v>100%</output></label>
      <label>Enquadramento <input type="range" min="0.7" max="1.5" step="0.05" value="1" data-zoom aria-label="Aproximação da câmera"><output data-zoom-v>100%</output></label>
      <button type="button" class="rf-bt rf-bt--f" data-png>Baixar quadro (PNG)</button>
      <button type="button" class="rf-bt rf-bt--f" data-json>Exportar ajustes</button></div>
    <div class="an-fases" data-fases></div><p class="rf-fraco" data-desc></p>`;
  let atual = null, vis = null, arrastando = false, pedirPng = false, idAtual = idInicial;
  const ajustes = () => ({ pausa: Number(el.querySelector('[data-pausa]').value), intensidade: Number(el.querySelector('[data-intensidade]').value),
    zoom: Number(el.querySelector('[data-zoom]').value), laco: el.querySelector('[data-laco]').checked });
  const baixar = (blob, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const montar = async (id) => {
    vis?.destruir(); vistas.delete(vis);
    const [, nome, origem, anim] = porId(id); atual = anim;
    const [ro, co] = ORIGEM[origem]; el.querySelector('[data-origem]').innerHTML = `<span class="rf-chip rf-chip--${co}">${ro}</span>`;
    el.querySelector('[data-fases]').innerHTML = (anim.fases ?? []).map(([n, a, b]) => `<span data-a="${a}" data-b="${b}">${n}</span>`).join('');
    el.querySelector('[data-desc]').textContent = `${nome} · ${anim.dur.toFixed(1).replace('.', ',')} s de cena${B.find((p) => p.id === id)?.descricao ? ` · ${B.find((p) => p.id === id).descricao}` : ''}`;
    idAtual = id;
    const a = ajustes();
    const base = await enquadrar(anim);
    const enq = { ...base, meiaAltura: base.meiaAltura / a.zoom, meiaLargura: base.meiaLargura / a.zoom };
    vis = vitrine3D(el.querySelector('[data-vista]'), { fonte: fonteDe(anim, { laco: a.laco, pausa: a.pausa, intensidade: a.intensidade }), enquadramento: enq, tocando: true, miniatura: false, estilo: { ...est.estilo }, hq: est.hq,
      aoQuadro: ({ info }) => {
        if (pedirPng) {
          // Exportação: compõe as camadas (cena 3D e HQ) no mesmo quadro em que foram desenhadas.
          pedirPng = false;
          const camadas = [...el.querySelectorAll('[data-vista] canvas')];
          const w = Math.max(...camadas.map((c) => c.width)); const h = Math.max(...camadas.map((c) => c.height));
          const tela = document.createElement('canvas'); tela.width = w; tela.height = h;
          const g = tela.getContext('2d'); for (const c of camadas) g.drawImage(c, 0, 0, w, h);
          tela.toBlob((b) => b && baixar(b, `autonick-${idAtual}-${(info?.u ?? 0).toFixed(2)}s.png`), 'image/png');
        }
        const u = info?.u ?? 0; if (!arrastando) el.querySelector('[data-tempo]').value = String(Math.round((u / anim.dur) * 1000));
        el.querySelector('[data-t]').textContent = `${u.toFixed(1).replace('.', ',')} s`;
        for (const f of el.querySelectorAll('[data-fases] span')) f.classList.toggle('ativa', u >= Number(f.dataset.a) && u < Number(f.dataset.b));
      } });
    vistas.add(vis); await vis.pronto; vis.vista?.atualizar({ velocidade: est.velocidade });
  };
  el.querySelector('[data-sel]').addEventListener('change', (e) => montar(e.target.value));
  el.querySelector('[data-play]').addEventListener('click', (e) => { const v = vis?.vista; if (!v) return; if (v.tocando) { v.pausar(); e.currentTarget.textContent = '▶'; e.currentTarget.setAttribute('aria-label', 'Tocar'); } else { v.tocar(); e.currentTarget.textContent = '❚❚'; e.currentTarget.setAttribute('aria-label', 'Pausar'); } });
  el.querySelector('[data-reiniciar]').addEventListener('click', () => { vis?.irPara(0); vis?.tocar(); });
  const tempo = el.querySelector('[data-tempo]');
  tempo.addEventListener('input', () => { arrastando = true; vis?.pausar(); vis?.irPara((Number(tempo.value) / 1000) * atual.dur); el.querySelector('[data-play]').textContent = '▶'; });
  tempo.addEventListener('change', () => { arrastando = false; });
  el.querySelector('[data-laco]').addEventListener('change', () => montar(el.querySelector('[data-sel]').value));
  for (const [sel, saida, fmt] of [['[data-pausa]', '[data-pausa-v]', (v) => `${v.toFixed(1).replace('.', ',')} s`], ['[data-intensidade]', '[data-intensidade-v]', (v) => `${Math.round(v * 100)}%`], ['[data-zoom]', '[data-zoom-v]', (v) => `${Math.round(v * 100)}%`]]) {
    const r = el.querySelector(sel);
    r.addEventListener('input', () => { el.querySelector(saida).textContent = fmt(Number(r.value)); });
    r.addEventListener('change', () => montar(el.querySelector('[data-sel]').value));
  }
  el.querySelector('[data-png]').addEventListener('click', () => { pedirPng = true; vis?.vista?.atualizar({}); });
  el.querySelector('[data-json]').addEventListener('click', () => baixar(new Blob([JSON.stringify({ animacao: idAtual, ...ajustes(), velocidade: est.velocidade, estilo: est.estilo, efeitosHq: est.hq, exportado_em: new Date().toISOString() }, null, 2)], { type: 'application/json' }), `autonick-${idAtual}-ajustes.json`));
  montar(idInicial);
  return el;
}

/* ---------------- estúdio da mão ---------------- */
function estudio() {
  const el = document.createElement('div'); el.className = 'an-estudio';
  el.innerHTML = `<div class="an-vista an-vista--mao" data-vista></div>
    <div class="an-painel">
      <div><span class="lb-rotulo lb-rotulo--proposta">Gestos</span><div class="rf-opcoes-chips" data-gestos>${Object.entries(GESTOS).filter(([k]) => k !== 'aberta').map(([k, g], i) => `<button type="button" aria-pressed="${i === 0}" data-gesto="${k}">${g.nome}</button>`).join('')}</div></div>
      <div><span class="lb-rotulo">Poses paradas</span><div class="rf-opcoes-chips" data-poses>${Object.keys(POSES).map((k) => `<button type="button" aria-pressed="false" data-pose="${k}">${k}</button>`).join('')}</div></div>
      <div><span class="lb-rotulo">Acabamento</span><div class="rf-abas" role="radiogroup" aria-label="Acabamento da mão" data-var>${Object.entries(VARIANTES_MAO).map(([k, n]) => `<button type="button" role="radio" aria-checked="${k === MAO.variante}" data-v="${k}">${n}</button>`).join('')}</div></div>
      <div style="display:grid;gap:8px"><label class="rf-chave"><input type="checkbox" data-gira><i></i>Girar no próprio eixo</label>
        <label class="rf-fraco" style="display:flex;gap:8px;align-items:center">Ângulo <input type="range" min="-180" max="180" value="0" data-angulo style="flex:1;accent-color:var(--rf-ouro)"></label></div>
      <div class="an-comparar"><span class="lb-rotulo">Antes: a manopla do lab anterior</span><div class="an-vista an-vista--p" data-antiga></div></div>
      <ul class="lb-notas"><li>Três dedos gordinhos e polegar: leitura clara mesmo pequena, no padrão clássico de desenho animado.</li><li>Cada dedo tem três juntas com pesos diferentes; o polegar abre, dobra e cruza à frente da palma.</li><li>Movimento com antecipação, sobressalto e assentamento; os dedos atrasam um pouco em relação ao pulso.</li><li>Estica e encolhe preservando o volume nos impactos (squash and stretch).</li><li>Costuras assentadas na superfície do dorso, punho em sino com aba enrolada e botão CK.</li></ul>
    </div>`;
  let gesto = 'aceno', poseFixa = null, giro = 0, gira = false, ultimo = performance.now();
  const fonte = (t) => {
    const p = poseNeutra(); const agora = performance.now(); if (gira) giro = (giro + (agora - ultimo) * 0.04) % 360; ultimo = agora;
    const g = GESTOS[gesto]; const st = poseFixa ? GESTOS.aberta.quadro(0) : g.quadro(AMBIENTE.reduzido ? g.dur * 0.6 : t % (g.dur + 0.5) > g.dur ? g.dur : t % (g.dur + 0.5));
    if (poseFixa) { st.pose = poseFixa; if (poseFixa === 'joinha') st.rot = [0, -50, -90]; if (['aponta', 'peteleco'].includes(poseFixa)) st.rot = [0, -20, 90]; }
    p.objetos.push({ id: `mao_${MAO.variante}`, ...st, rot: [st.rot[0], st.rot[1] + giro, st.rot[2]] }); p.hq = st.hq ?? []; p.camera.el = 6;
    return { pose: p, info: {} };
  };
  const enq = Object.freeze({ meiaAltura: 1.22, meiaLargura: 1.22, deslocX: 0, deslocY: 0.1 });
  obterMotor().then((m) => {
    const ajuste = { ...enq, deslocY: enq.deslocY - m.rig.centroY + 0.05 };
    const v = vitrine3D(el.querySelector('[data-vista]'), { fonte, enquadramento: ajuste, tocando: true, miniatura: false, sino: false, estilo: { ...est.estilo }, hq: est.hq }); vistas.add(v);
    const antiga = vitrine3D(el.querySelector('[data-antiga]'), { fonte: (t) => { const p = poseNeutra(); p.objetos.push({ id: 'manopla', pos: [0, m.rig.centroY - 0.05, 0], rot: [0, -20 + 25 * Math.sin(t * 0.6), 0], esc: 1, fecha: 0.15, dedo: 1 }); return { pose: p, info: {} }; },
      enquadramento: { meiaAltura: 0.75, meiaLargura: 0.75, deslocX: 0, deslocY: -0.05 }, tocando: true, sino: false, estilo: { ...est.estilo }, hq: false }); vistas.add(antiga);
  }).catch(() => { el.querySelector('[data-vista]').textContent = 'WebGL indisponível neste navegador.'; });
  el.addEventListener('click', (e) => {
    const g = e.target.closest('[data-gesto]'); if (g) { gesto = g.dataset.gesto; poseFixa = null; marcar(el, '[data-gestos] button', g); marcar(el, '[data-poses] button', null); }
    const p = e.target.closest('[data-pose]'); if (p) { poseFixa = p.dataset.pose; marcar(el, '[data-poses] button', p); marcar(el, '[data-gestos] button', null); }
    const vv = e.target.closest('[data-v]'); if (vv) { MAO.variante = vv.dataset.v; for (const b of el.querySelectorAll('[data-v]')) b.setAttribute('aria-checked', String(b === vv)); document.getElementById('variante').value = MAO.variante; }
  });
  el.querySelector('[data-gira]').addEventListener('change', (e) => { gira = e.target.checked; ultimo = performance.now(); });
  el.querySelector('[data-angulo]').addEventListener('input', (e) => { gira = false; el.querySelector('[data-gira]').checked = false; giro = Number(e.target.value); });
  return el;
}
const marcar = (el, sel, ativo) => { for (const b of el.querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b === ativo)); };

/* ---------------- galeria ---------------- */
function galeria() {
  const el = document.createElement('div'); el.className = 'an-galeria';
  for (const [id, nome, origem, anim] of LISTA) {
    const [ro, co] = ORIGEM[origem];
    const c = document.createElement('article'); c.className = 'an-card'; c.tabIndex = 0;
    c.innerHTML = `<div class="an-vista an-vista--mini" data-v></div><div class="an-card__txt"><b>${id} · ${nome}</b><span class="rf-chip rf-chip--${co}">${ro}</span></div><button type="button" class="rf-bt rf-bt--s" data-abrir>Abrir no palco</button>`;
    el.append(c);
    enquadrar(anim).then((enq) => {
      const t0 = origem === 'nova' || origem === 'refinada' ? anim.toque + 0.1 : tempoRepresentativo(anim);
      const v = vitrine3D(c.querySelector('[data-v]'), { fonte: fonteDe(anim), enquadramento: enq, t: t0, estilo: { ...est.estilo }, hq: est.hq }); vistas.add(v);
      const tocar = () => { v.irPara(0); v.tocar(); }; const parar = () => { v.pausar(); v.irPara(t0); };
      c.addEventListener('mouseenter', tocar); c.addEventListener('mouseleave', parar); c.addEventListener('focusin', tocar); c.addEventListener('focusout', parar);
    });
    c.querySelector('[data-abrir]').addEventListener('click', () => { sessionStorage.setItem('an:abrir', id); location.hash = 'palco'; });
  }
  return el;
}

/* ---------------- rotas e controles ---------------- */
const ROTAS = { palco: 'Palco e comparação', mao: 'Estúdio da mãozinha', todas: `Todas as animações (${LISTA.length})` };
document.getElementById('nav').innerHTML = Object.entries(ROTAS).map(([id, n]) => `<a href="#${id}">${n}</a>`).join('') + '<a href="refino.html">← Lab de refino de UX</a>';
function rota() {
  for (const v of vistas) v?.destruir(); vistas.clear();
  const id = location.hash.slice(1) || 'palco';
  for (const a of document.querySelectorAll('#nav a')) { if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  const cab = { palco: ['Palco e <em>comparação</em>', 'Escolha duas animações e compare lado a lado. Arraste a linha do tempo para ver quadro a quadro; as fases acendem conforme a cena passa. ★ marca as novas com a mãozinha.'],
    mao: ['Estúdio da <em>mãozinha</em>', 'A mão é procedural (Three.js puro, nenhum modelo externo) e foi desenhada para ter personalidade: dedos gordinhos, juntas que dobram de verdade, costuras no dorso e punho com aba. Teste gestos, poses, acabamentos e gire para ver de todos os lados.'],
    todas: ['Todas as <em>animações</em>', 'Paradas no quadro mais expressivo; passe o mouse (ou foque com o teclado) para tocar. Inclui a animação que está no app, as novas com a mãozinha e todas as propostas do lab anterior.'] }[id] ?? [];
  const sec = document.createElement('section'); sec.className = 'lb-sec'; sec.innerHTML = `<header class="lb-cab"><h1>${cab[0]}</h1><p>${cab[1]}</p></header>`;
  const corpo = document.createElement('div'); corpo.style.marginTop = '18px';
  if (id === 'palco') { const a = sessionStorage.getItem('an:abrir') ?? 'N02'; sessionStorage.removeItem('an:abrir'); corpo.className = 'an-ab'; corpo.append(palco('A', a), palco('B', a === 'B04' ? 'N02' : 'B04')); }
  if (id === 'mao') corpo.append(estudio());
  if (id === 'todas') corpo.append(galeria());
  sec.append(corpo); conteudo.replaceChildren(sec);
}
window.addEventListener('hashchange', rota);
const variante = document.getElementById('variante'); variante.innerHTML = Object.entries(VARIANTES_MAO).map(([k, n]) => `<option value="${k}">${n}</option>`).join(''); variante.value = MAO.variante;
variante.addEventListener('change', () => { MAO.variante = variante.value; for (const b of document.querySelectorAll('[data-v]')) b.setAttribute('aria-checked', String(b.dataset.v === MAO.variante)); });
document.getElementById('contorno').addEventListener('change', (e) => { est.estilo.contorno = e.target.checked; aplicarEstilo(); });
document.getElementById('efeitos').addEventListener('change', (e) => { est.hq = e.target.checked; aplicarEstilo(); });
document.getElementById('luz').addEventListener('change', (e) => { est.estilo.luz = e.target.value; aplicarEstilo(); });
document.getElementById('vel').addEventListener('change', (e) => { est.velocidade = Number(e.target.value); aplicarEstilo(); });
document.getElementById('tema').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b)); if (b.dataset.v === 'claro') raiz.dataset.tema = 'claro'; else delete raiz.dataset.tema; });
document.getElementById('red').addEventListener('click', async (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); AMBIENTE.reduzido = on; (await obterMotor()).config.reduzido = on; rota(); });
const barra = document.querySelector('.lb-barra'); new ResizeObserver(() => raiz.style.setProperty('--lb-alt', `${barra.offsetHeight}px`)).observe(barra);
carregarFontes().finally(rota);
