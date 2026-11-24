// Momentos 3D das áreas do AutoniCK (direção CK Forja Noturna).
// Cada cena é disparada por um EVENTO real (memoria.inicio / memoria.fase), com repouso antes e depois.
// Nada celebra sozinho: sem evento, o objeto fica parado ou nem aparece.

import { OBJETOS } from './objetos.js';
import { clamp, CURVAS, trilha, oscila, sino01, poseNeutra, reagirGolpe } from './curvas.js';
import './objetos-forja.js';

const sai = CURVAS.sai, suave = CURVAS.suave, volta = CURVAS.volta;

/* ======================================================================
   CATEGORIA I · cenas por evento
   ====================================================================== */
const dentro = (p) => { p.hq = p.hq.filter((g) => Array.isArray(g.em)); return p; };
const desde = (t, m) => (m.inicio == null ? -1 : t - m.inicio);
const def = (id) => OBJETOS[id];

export const CENAS_I = {
  IB01: { // moeda CK: só aparece quando a meta existente é atingida; gira 2 voltas e para de frente
    contagem: 1.7, dur: 2.4,
    quadro(t, m) {
      const p = poseNeutra(); const u = desde(t, m); if (u < 0) return p;
      const sobe = volta(clamp(u / 0.5));
      const giro = 720 * CURVAS.sai(clamp((u - 0.15) / 1.55)) + (u > 1.7 ? 10 * Math.sin((u - 1.7) * 1.1) : 0);
      const inclina = oscila(u, 1.6, 2.6, 7, 1.4, 0.35) + 6;
      p.objetos.push({ id: 'moedaCK', pos: [0, 0.5 + 0.35 * (1 - sobe) + 0.018 * Math.sin(u * 2.2), 0], rot: [0, 0, 0], esc: 0.45 + 0.55 * sobe, giro, inclina, sombra: sobe, altura: 0.35 * (1 - sobe) });
      if (u > 1.65 && u < 2.4) p.hq.push({ tipo: 'brilho', vida: (u - 1.65) / 0.75, em: [0.18, 0.72, 0.2] });
      return p;
    },
  },
  IB02: { // caixa no estado vazio: chega, abre com brilho e fica respirando
    dur: 2.2,
    quadro(t, m) {
      const d = def('caixa'); const p = poseNeutra(); const u = Math.max(0, desde(t, m));
      const pouso = [0, 0, 0]; let e;
      if (u < 0.9) e = { ...d.entrada.call({ ...d, pouso }, u) };
      else e = { pos: pouso, rot: [0, -22, 0], esc: 1, abre: trilha([[1.0, 0], [1.5, 1, 'volta']])(u) - 0.06 * (u > 1.8 ? (1 - Math.cos((u - 1.8) * 2.2)) : 0) };
      p.objetos.push({ id: 'caixa', ...e });
      if (u > 1.35 && u < 2.2) p.hq.push({ tipo: 'brilho', vida: (u - 1.35) / 0.85, em: [0, 0.85, 0] });
      return p;
    },
  },
  IB03: { // comprovante: sobe de dentro do quadro, assenta e o selo CONFIRMADA bate depois da confirmação
    dur: 1.6,
    quadro(t, m) {
      const p = poseNeutra(); const u = desde(t, m); if (u < 0) return p;
      const k = volta(clamp(u / 0.7));
      const selo = clamp((u - 0.8) / 0.22);
      p.objetos.push({ id: 'comprovante', pos: [0, 0.48 - 0.22 * (1 - k) + 0.012 * Math.sin(u * 1.8), 0], rot: [0, -12 + 6 * k, -9 + 5 * k], esc: 0.9 + 0.1 * k, dobra: 22 * (1 - k), selo, sombra: k });
      if (u > 0.8 && u < 0.9) p.hq.push({ tipo: 'impacto', vida: (u - 0.8) / 0.1, em: [0.12, 0.2, 0.15] });
      return p;
    },
  },
  IB04: { // calculadora: teclas acompanham as etapas reais; o visor só mostra o total quando a operação confirma
    dur: 0,
    quadro(t, m) {
      const p = poseNeutra(); const f = m.fase ?? 'parado';
      let tecla = -1, valor = '0';
      if (f === 'processando') { const n = Math.floor(t / 0.24); tecla = [1, 2, 5, 6, 9, 10][n % 6]; valor = '·'.repeat(1 + (n % 3)); }
      if (f === 'concluido') { const u = t - (m.inicio ?? t); tecla = u < 0.14 ? 15 : -1; valor = m.valor ?? '0'; }
      if (f === 'falhou') valor = 'ERRO';
      p.objetos.push({ id: 'calculadora', pos: [0, 0.5, 0], rot: [-12, -20, 0], esc: 1, tecla, valor });
      if (f === 'concluido' && t - m.inicio < 0.7) p.hq.push({ tipo: 'brilho', vida: (t - m.inicio) / 0.7, em: [0.2, 0.95, 0.1] });
      return p;
    },
  },
  IB05: { // etiqueta suspensa: pêndulo amortecido a partir de um gancho fixo; balanço curto e contínuo
    dur: 4,
    quadro(t, m) {
      const p = poseNeutra(); const u = Math.max(0, desde(t, m));
      const amp = 10 * Math.exp(-u / 2.4); const T = 1.9;
      const balanco = amp * Math.cos((2 * Math.PI * u) / T) + 2.2 * Math.sin((2 * Math.PI * t) / 3.8);
      p.objetos.push({ id: 'etiquetaCK', pos: [0, 1.6, 0], rot: [0, 0, 0], esc: 1, balanco, giro: 14 * Math.sin(t * 0.55), preco: m.preco ?? 'R$ 29,90' });
      return p;
    },
  },
  IB06: { // prancheta + sino: cada etapa confirmada marca um item; a conclusão real faz o sino tocar
    sino: true, dur: 2.6,
    quadro(t, m) {
      const p = poseNeutra(); const passos = m.passos ?? [];
      const checks = passos.reduce((a, tp) => a + clamp((t - tp) / 0.22), 0);
      for (const tp of passos) p.sino.rx += 4 * sino01(t, tp, 0.3);
      if (m.concluida != null) reagirGolpe(p, t, m.concluida, { forca: 0.85, lado: -1, texto: 'PRONTO!', alvo: 'topo' });
      if (m.concluida != null && t > m.concluida + 0.9) p.boca = 'canto';
      p.sino.ry += 8;
      p.objetos.push({ id: 'prancheta', pos: [1.9, 0.75, 0.45], rot: [-8, -24, 4], esc: 1, checks });
      return p;
    },
  },
  IB07: { // campainha: um DING breve quando o lembrete dispara
    dur: 1.4,
    quadro(t, m) {
      const p = poseNeutra(); const u = desde(t, m);
      const aperta = u < 0 ? 0 : u < 0.07 ? u / 0.07 : u < 0.25 ? 1 : 1 - clamp((u - 0.25) / 0.12);
      p.objetos.push({ id: 'campainha', pos: [0, 0, 0], rot: [8, -20, 0], esc: 1, aperta, vibra: u < 0 ? 0 : oscila(u, 0.07, 1.2, 4, 9, 0.28, 0.3) });
      if (u >= 0.07 && u < 0.7) p.hq.push({ tipo: 'texto', texto: 'DING!', vida: (u - 0.07) / 0.63, em: [0, 0.95, 0], pequeno: true });
      return p;
    },
  },
  IC01: { // escudo CK ao lado de empresa aprovada: entra uma vez, brilha uma vez e fica
    dur: 1.6,
    quadro(t, m) {
      const p = poseNeutra(); const u = Math.max(0, desde(t, m));
      const k = volta(clamp(u / 0.6));
      p.objetos.push({ id: 'escudo', pos: [0, 0.9, 0], rot: [0, -14 + 6 * Math.sin(t * 0.5), 0], esc: k, brilho: sino01(u, 0.7, 0.6), giroEstrela: 360 * suave(clamp((u - 0.4) / 0.8)) });
      return p;
    },
  },
  IC02: { // busca sem resultado: balão "pensando", pontos em onda lenta
    dur: 2,
    quadro(t, m) {
      const p = poseNeutra(); const u = Math.max(0, desde(t, m)); const k = volta(clamp(u / 0.5));
      p.objetos.push({ id: 'balao', pos: [0, 2.05, 0], rot: [0, -12, 0], esc: k, modo: 'digitando', t: t * 0.55 });
      return p;
    },
  },
  IC03: { // cesta: cada item adicionado de verdade cai dentro (memoria.itens = instantes)
    dur: 1.2,
    quadro(t, m) {
      const p = poseNeutra(); const tempos = (m.itens ?? []).slice(-3); const destinos = [[-0.1, 0.3, 0.02], [0.12, 0.3, 0.06], [0.02, 0.36, -0.1]];
      const itens = tempos.map((t0, i) => { const k = clamp((t - t0) / 0.45); return [destinos[i][0], destinos[i][1] + 1.2 * (1 - CURVAS.quica(k)), destinos[i][2], (1 - k) * 160 * (i % 2 ? 1 : -1)]; });
      let amassa = 1; for (const t0 of tempos) amassa -= 0.1 * sino01(t, t0 + 0.17, 0.14);
      p.objetos.push({ id: 'cesta', pos: [0, 0, 0], rot: [10, -15, 0], esc: 1, itens, amassa });
      return p;
    },
  },
  IC04: { // orçamento: "aguardando" é um balão parado; só quando a resposta chega (evento) vira alerta
    dur: 1.4,
    quadro(t, m) {
      const p = poseNeutra(); const chegou = m.fase === 'chegou'; const u = chegou ? t - m.inicio : -1;
      p.objetos.push({ id: 'balao', pos: [0, 2.05, 0], rot: [0, -12, 0], esc: chegou ? 1 + 0.12 * sino01(u, 0, 0.3) : 1, modo: chegou ? 'alerta' : 'digitando', parado: !chegou, pop: u / 0.3, t });
      if (chegou && u < 0.7) p.hq.push({ tipo: 'texto', texto: 'PLIM!', vida: u / 0.7, em: [0.1, 2.5, 0], pequeno: true });
      return p;
    },
  },
  IC05: { sino: true, dur: 2.2, quadro: (t, m) => cenaComSino('chave', t, m) }, // chave toca o sino a cada etapa confirmada
  IC06: { dur: 2.4, quadro: (t, m) => cenaEvento('carimbo', t, m) },
  IA01: { dur: 2.4, quadro: (t, m) => cenaEvento('carimbo', t, m) },
  IA02: { dur: 2.4, quadro: (t, m) => cenaEvento('escudo', t, m) },
  IA03: { // engrenagem: gira enquanto o recálculo real acontece e desacelera até parar quando termina
    dur: 0,
    quadro(t, m, ctx) {
      const p = poseNeutra(); const s = m.ia03 ?? (m.ia03 = { giro: 0, vel: 0 }); const dt = ctx?.dt ?? 0.016;
      const alvo = m.fase === 'calculando' ? 260 : 0; s.vel += (alvo - s.vel) * (1 - Math.exp(-dt * 3)); s.giro += s.vel * dt;
      p.objetos.push({ id: 'engrenagem', pos: [0, 0.75, 0], rot: [0, 16, 0], esc: 1, giro: s.giro, encaixe: 1 });
      return p;
    },
  },
  IA04: { // denúncia nova: balão com "!" aparece; sem ocorrência, nada
    dur: 1.4,
    quadro(t, m) {
      const p = poseNeutra(); const u = desde(t, m); if (u < 0) return p;
      p.objetos.push({ id: 'balao', pos: [0, 2.05, 0], rot: [0, -12, 0], esc: volta(clamp(u / 0.45)), modo: 'alerta', pop: (u - 0.15) / 0.3, t });
      return p;
    },
  },
  IA05: { // manopla aponta para o trecho contestado com um gesto curto de empurrar
    dur: 3,
    quadro(t) {
      const p = poseNeutra(); const g = 0.06 * Math.max(0, Math.sin((t % 3) / 3 * Math.PI * 2)) ** 3;
      p.objetos.push({ id: 'manopla', pos: [0.1 - g, 0.45, 0], rot: [0, -20, 90], esc: 1, fecha: 0.92, dedo: 1 });
      return p;
    },
  },
  IA06: { // engrenagens se encaixam e giram juntas quando o salvamento da configuração é confirmado
    dur: 1.6,
    quadro(t, m) {
      const p = poseNeutra(); const u = desde(t, m);
      const encaixe = u < 0 ? 0 : volta(clamp(u / 0.55)); const giro = u < 0 ? 0 : 90 * suave(clamp((u - 0.5) / 0.9));
      p.objetos.push({ id: 'engrenagem', pos: [-0.2, 0.75, 0], rot: [0, 16, 0], esc: 1, giro, encaixe });
      if (u > 0.5 && u < 1.0) p.hq.push({ tipo: 'brilho', vida: (u - 0.5) / 0.5, em: [0.1, 0.55, 0.2] });
      return p;
    },
  },
};

/** Cena genérica: o objeto repousa no próprio ponto e, a cada evento, executa a interação do Design Lab (sem o sino). */
function cenaEvento(id, t, m) {
  const d = def(id); const p = poseNeutra(); const u = desde(t, m);
  const e = u >= 0 && u < d.dur.interacao ? d.interacao(u, p) : d.ocioso(0);
  p.objetos = [{ id, ...e, pos: [0, d.pouso[1], 0] }];
  p.sino = poseNeutra().sino; return dentro(p);
}
function cenaComSino(id, t, m) {
  const d = def(id); const p = poseNeutra(); const u = desde(t, m);
  const e = u >= 0 && u < d.dur.interacao ? d.interacao(u, p) : d.ocioso(0);
  p.objetos = [{ id, ...e }]; return p;
}

/** Poses de amostra de uma cena (para o enquadramento cobrir a trajetória inteira). */
export function amostrasDe(cena, { eventos = 6 } = {}) {
  const poses = []; const dur = Math.max(1.5, cena.dur);
  const mems = [{ inicio: 0, fase: 'concluido', valor: 'R$ 184,00', passos: [0, 0.2, 0.4], concluida: 0.6, itens: [0, 0.2, 0.4] }, { inicio: 0, fase: 'chegou' }, { inicio: 0, fase: 'processando' }];
  for (const m of mems) for (let i = 0; i <= eventos * 4; i++) { const t = (i / (eventos * 4)) * (dur + 1.5); poses.push(cena.quadro(t, { ...m }, { dt: 0.05 })); }
  return poses;
}
