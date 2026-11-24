// Peças compartilhadas da prévia Forja Noturna. Na implementação real, cada uma vira um módulo do app
// (public/js/ui/...): cenas por evento, imagens pré-renderizadas, sininho compacto, herói e loaders.

import { obterMotor, URL_POSTER } from '../motor/motor.js';
import { ANIMACOES, RITMOS, criarLaco, ENQ_PADRAO } from '../motor/animacoes.js';
import { poseNeutra } from '../motor/curvas.js';
import { ligarBotao, SIMULACAO } from '../feedback.js';
import { RUNTIME } from '../estado.js';
import { CENAS_I, amostrasDe } from './cenas.js';

export const ESTILO = { modo: 'hq', luz: 'forja', contorno: true };
const enquadramentos = new Map();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cena 3D de um conceito da categoria I. Fica parada até um evento real; anima o momento e para de desenhar.
 * Cenas contínuas (balanço da etiqueta, gesto da manopla) só desenham enquanto visíveis.
 */
export function montarCena(el, id, { continua = false, rotulo = '', inicial = {} } = {}) {
  const cena = CENAS_I[id]; const mem = { ...inicial }; let v = null, morto = false, timer = 0;
  el.classList.add('fn-cena'); el.insertAdjacentHTML('beforeend', `<span class="fn-cena-alt">${rotulo}</span>`);
  const pronto = obterMotor().then((m) => {
    if (morto) return null;
    if (!enquadramentos.has(id)) enquadramentos.set(id, m.enquadrarTrajetoria(amostrasDe(cena), { comSino: Boolean(cena.sino) }));
    v = m.criarVista(el, { fonte: (t, ctx) => ({ pose: cena.quadro(t, mem, ctx), info: {} }), enquadramento: enquadramentos.get(id), sino: Boolean(cena.sino), estilo: ESTILO, tocando: continua && !RUNTIME.reduzido, miniatura: false });
    el.classList.add('com-3d'); return v;
  }).catch(() => { el.classList.add('sem-3d'); return null; });
  const tocarPor = (s) => { if (!v) return; clearTimeout(timer); v.tocar(); if (!continua) timer = setTimeout(() => v?.pausar(), s * 1000 / Math.max(0.25, RUNTIME.velocidade)); };
  return {
    pronto, mem,
    async disparar(campos = {}) {
      await pronto; if (!v) return;
      Object.assign(mem, campos);
      if (RUNTIME.reduzido) { mem.inicio = v.t - (cena.dur + 0.5); v.redesenhar(); return; } // movimento reduzido: mostra o estado final, sem animar
      mem.inicio = v.t; tocarPor(cena.dur + 0.8);
    },
    async definir(campos = {}, { manter = false } = {}) {
      await pronto; if (!v) return;
      for (const [k, val] of Object.entries(campos)) mem[k] = val === 'agora' ? v.t : val;
      if (manter && !RUNTIME.reduzido) { clearTimeout(timer); v.tocar(); } else tocarPor(1.6);
      v.redesenhar();
    },
    destruir() { morto = true; clearTimeout(timer); v?.liberar(); },
  };
}

/** Imagem estática de uma cena (para listas com muitos itens): renderizada uma vez e guardada. */
const fotos = new Map();
export async function fotoCena(id, mem = {}, { t = 0, largura = 220, altura = 220 } = {}) {
  const chave = `${id}|${JSON.stringify(mem)}|${t}`; if (fotos.has(chave)) return fotos.get(chave);
  const p = obterMotor().then((m) => {
    const cena = CENAS_I[id];
    if (!enquadramentos.has(id)) enquadramentos.set(id, m.enquadrarTrajetoria(amostrasDe(cena), { comSino: Boolean(cena.sino) }));
    return m.fotografar({ fonte: (tt) => ({ pose: cena.quadro(tt, { ...mem }, { dt: 0 }), info: {} }), enquadramento: enquadramentos.get(id), sino: Boolean(cena.sino), largura, altura, t, estilo: ESTILO });
  }).catch(() => null);
  fotos.set(chave, p); return p;
}

/* ---------- G08 compacto: 10 quadros do sino real num sprite, gerado uma vez ---------- */
const SVG_SINO = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v6" stroke="#16111f" stroke-width="4"/><path d="M15 47c-3 0-5-1.4-5-3.3 0-2.3 3.3-3.6 4-7.6l1.6-9.3A16.6 16.6 0 0 1 32 13a16.6 16.6 0 0 1 16.4 13.8l1.6 9.3c.7 4 4 5.3 4 7.6 0 1.9-2 3.3-5 3.3z" fill="#f5b70a" stroke="#16111f" stroke-width="3.2"/><path d="M21 33.5l6 1.2M43 33.5l-6 1.2" stroke="#6ea13e" stroke-width="3"/><circle cx="32" cy="53" r="4.5" fill="#16111f"/></svg>';
let sprite = null;
function gerarSprite() {
  return sprite ?? (sprite = obterMotor().then(async (m) => {
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 60; const c = cv.getContext('2d');
    for (let i = 0; i < 10; i++) {
      const fase = (i / 10) * Math.PI * 2;
      const url = m.fotografar({ fonte: () => { const p = poseNeutra(); p.sino.rz = 13 * Math.sin(fase); p.badalo.rz = -22 * Math.sin(fase - 0.5); return { pose: p, info: {} }; }, enquadramento: { meiaAltura: 1.3, meiaLargura: 1.3, deslocX: 0 }, sino: true, largura: 60, altura: 60, estilo: ESTILO });
      const img = new Image(); img.src = url; await img.decode(); c.drawImage(img, i * 60, 0);
    }
    return cv.toDataURL('image/png');
  }).catch(() => null));
}
export function sinoMini() {
  const el = document.createElement('span'); el.className = 'fn-sino-mini fn-sino-mini--svg'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = SVG_SINO;
  gerarSprite().then((url) => { if (!url) return; el.innerHTML = ''; el.classList.remove('fn-sino-mini--svg'); el.style.backgroundImage = `url(${url})`; });
  return el;
}

/* ---------- operação simulada (no app real: a chamada à API) ---------- */
export function operacao({ etapas = [], informaEtapas = true, aoEtapa, fator = 1 } = {}) {
  return (async () => {
    const total = SIMULACAO.latencia * fator;
    if (SIMULACAO.resultado === 'conexao') throw new Error('Sem conexão. Nada foi enviado.');
    if (etapas.length && informaEtapas) for (let i = 0; i < etapas.length; i++) { aoEtapa?.(i, 'agora'); await espera(total / etapas.length); aoEtapa?.(i, 'feito'); }
    else await espera(total);
    if (SIMULACAO.resultado === 'erro') throw new Error('O servidor recusou a operação. Nada foi alterado.');
    return true;
  })();
}

/** Botão da Forja: F14 (contorno que corre) + H02, com a operação real no lugar da simulação. */
export function botaoForja(btn, { executar, aoFim, rotulos } = {}) {
  return ligarBotao(btn, { estilo: 'F14', executar, aoFim, rotulos: { processando: 'Salvando…', sucesso: 'Salvo', erro: 'Tentar de novo', ...rotulos } });
}

/** Contagem até um valor confirmado (nunca inventa: recebe o número que veio do sistema). */
export function contar(el, valor, { dur = 1.2, formato = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) } = {}) {
  if (RUNTIME.reduzido) { el.textContent = formato(valor); return; }
  const t0 = performance.now(); const passo = (agora) => { const k = Math.min(1, (agora - t0) / (dur * 1000)); const e = 1 - Math.pow(1 - k, 3); el.textContent = formato(valor * e); if (k < 1) requestAnimationFrame(passo); };
  requestAnimationFrame(passo);
}

/* ---------- herói da home: A05 (palco) + E01 (cúpula de raios separada) + B12F + C04 ---------- */
export function montarHeroi(heroi) {
  const palco = heroi.querySelector('.fn-heroi-sino'); let v = null, morto = false;
  const laco = criarLaco(ANIMACOES.B12F, RITMOS.C04);
  let ultimo = null;
  const aoQuadro = (d) => {
    const hr = heroi.getBoundingClientRect(), pr = palco.getBoundingClientRect(); if (!hr.width) return;
    const bx = pr.left - hr.left + d.sino.x * pr.width, by = pr.top - hr.top + d.sino.y * pr.height;
    const bb = pr.top - hr.top + d.sino.base * pr.height + pr.height * 0.035; const br = pr.width * 0.24;
    const novo = `${bx.toFixed(0)}|${by.toFixed(0)}|${bb.toFixed(0)}`;
    if (novo !== ultimo) { ultimo = novo; heroi.style.setProperty('--bx', `${bx}px`); heroi.style.setProperty('--by', `${by}px`); heroi.style.setProperty('--bb', `${bb}px`); heroi.style.setProperty('--br', `${br}px`); }
    heroi.style.setProperty('--imp', (d.impacto || 0).toFixed(3));
  };
  obterMotor().then((m) => {
    if (morto) return;
    v = m.criarVista(palco, { fonte: (t, ctx) => laco.quadro(t, ctx), enquadramento: ANIMACOES.B12F.enquadramento, tocando: !RUNTIME.reduzido, miniatura: false, aoQuadro, aoTocar: (vv) => { if (RUNTIME.reduzido) { vv.irPara(0); vv.tocar(); } } });
    palco.classList.add('com-3d');
  }).catch(() => palco.classList.add('sem-3d'));
  return { get vista() { return v; }, get laco() { return laco; }, destruir() { morto = true; v?.liberar(); } };
}
export { URL_POSTER, ENQ_PADRAO };
