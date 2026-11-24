// Categoria B (animações do sino) e categoria C (ritmo do laço).
// B00 é a cena em produção, importada do próprio app (sem cópia): public/js/ui/sino-hq/animacao-quem-tocou.js.
// As demais são propostas novas, escritas com as mesmas curvas e o mesmo rig.

import { QUEM_TOCOU, LACO } from '../../public/js/ui/sino-hq/animacao-quem-tocou.js';
import { clamp, mix, CURVAS, trilha, estados, oscila, arco, sino01, semente, poseNeutra, misturarPoses, reagirGolpe, AMBIENTE } from './curvas.js';
import { OBJETOS } from './objetos.js';

export const ENQ_PADRAO = Object.freeze({ meiaAltura: 1.62, meiaLargura: 2.05, deslocX: 0.35 });
const ENQ_LARGO = Object.freeze({ meiaAltura: 1.75, meiaLargura: 3.05, deslocX: 0.85 });
const ENQ_ESQ = Object.freeze({ meiaAltura: 1.75, meiaLargura: 3.05, deslocX: -0.7 });

/** Converte a pose do módulo original para o formato estendido do laboratório. */
function deOriginal(po) {
  const p = poseNeutra();
  Object.assign(p.sino, po.sino); Object.assign(p.badalo, po.badalo); Object.assign(p.testa, po.testa);
  p.olhoE = po.olhoE; p.olhoD = po.olhoD; p.boca = po.boca; p.martelo = po.martelo; Object.assign(p.fx, po.fx); Object.assign(p.camera, po.camera);
  p.hq = po.hq.map((g) => (g.tipo === 'toc' ? { tipo: 'texto', texto: 'TOC!', vida: g.vida, em: 'aro' } : { ...g, em: g.tipo === 'velocidade' ? 'martelo' : 'aro' }));
  p.impacto = Math.max(po.fx.estrela / 1.25, po.fx.onda1 > 0 ? 1 - (po.fx.onda1 - 0.7) / 1.65 : 0);
  return p;
}

/** Cena composta por um objeto da categoria D: entrada, ocioso, interação (com reação do sino) e saída. */
function cenaComObjeto(id, { ocioso = 0.5, enquadramento = ENQ_LARGO } = {}) {
  const d = OBJETOS[id]; const D = d.dur;
  const t1 = D.entrada, t2 = t1 + ocioso, t3 = t2 + D.interacao, t4 = t3 + D.saida;
  return {
    dur: t4 + 0.25, fimMovimento: t4, enquadramento, objetos: [id], toque: t2,
    fases: [['entrada', 0, t1], ['antecipação', t1, t2 + 0.3], ['ação e impacto', t2 + 0.3, t2 + D.interacao * 0.6], ['recuperação', t2 + D.interacao * 0.6, t3], ['saída', t3, t4]],
    quadro(t) {
      const p = poseNeutra(); let e = null;
      if (t < t1) { e = d.entrada(t); const k = clamp(t / t1); p.sino.ry += clamp(d.pouso[0] * 7, -14, 14) * CURVAS.suave(k) * 0.6; }
      else if (t < t2) { e = d.ocioso(t - t1); p.sino.ry += clamp(d.pouso[0] * 7, -14, 14) * 0.6 * (1 - clamp((t - t1) / ocioso)); }
      else if (t < t3) e = d.interacao(t - t2, p);
      else if (t < t4) e = d.saida(t - t3);
      if (e) p.objetos.push({ id, ...e });
      return p;
    },
  };
}

/* ======================================================================
   B01 · Martelinho aprimorado
   Mais antecipação, um congelamento curto no contato (hit-stop) e sobreposição de movimento na recuperação.
   ====================================================================== */
const B01 = (() => {
  const C = 1.62, PARADA = 0.08;
  const desloc = trilha([[0.4, [2.3, 1.9, 0.35]], [1.1, [0.32, 0.14, 0.04], 'sai'], [1.5, [0.58, 0.28, 0.06], 'suave'], [C, [0, 0, 0], 'entra'], [2.05, [0.12, 0.05, 0.02], 'sai'], [2.25, [0.14, 0.06, 0.02]], [3.0, [2.3, 0.7, 0.35], 'entra']]);
  const giro = trilha([[0.4, -70], [1.1, -40, 'sai'], [1.5, -84, 'suave'], [C, 0, 'entra'], [2.05, -32, 'sai'], [2.25, -28], [3.0, -10, 'suave']]);
  return {
    dur: 4.4, fimMovimento: 4.1, enquadramento: ENQ_PADRAO, toque: 1.1,
    fases: [['espera', 0, 0.4], ['entrada do martelo', 0.4, 1.1], ['antecipação', 1.1, 1.5], ['golpe', 1.5, C], ['impacto (congelado)', C, C + PARADA], ['recuperação', C + PARADA, 3.0], ['acomodação', 3.0, 4.1]],
    quadro(tReal) {
      const t = tReal < C ? tReal : tReal < C + PARADA ? C : tReal - PARADA; // hit-stop
      const p = poseNeutra();
      if (t > 0.4 && t < 3.0) p.martelo = { desloc: desloc(t), giro: giro(t) };
      p.olhoD = trilha([[0, 1], [0.3, 0.7, 'suave'], [1.1, 0.7], [1.45, 0.45, 'suave'], [C, 0.45]])(t);
      p.olhoE = trilha([[0, 1], [1.1, 1], [1.45, 0.6, 'suave'], [C, 0.6]])(t);
      p.sino.ry = trilha([[0, 0], [0.6, 6, 'suave'], [1.1, 10], [1.5, -6, 'suave'], [C, 0, 'entra'], [2.9, 0], [3.4, 0]])(t);
      p.sino.rz = trilha([[1.1, 0], [1.5, 3.5, 'suave'], [C, 0, 'entra']])(t);
      p.testa.rz = trilha([[1.1, 0], [1.5, -6, 'suave'], [C, 0, 'entra']])(t) + oscila(t, C + 0.05, C + 1.6, 7, 1.6, 0.5);
      if (t > 1.5 && t < C) p.hq.push({ tipo: 'velocidade', vida: (t - 1.5) / (C - 1.5), em: 'martelo' });
      reagirGolpe(p, t, C, { forca: 1.15, lado: 1 });
      if (tReal >= C && tReal < C + PARADA) { p.hq.push({ tipo: 'impacto', vida: 0.3, em: 'aro' }); p.fx.estrela = 1.35; }
      p.sino.rx = trilha([[3.0, 0], [3.4, -3, 'suave']])(t);
      if (t > 3.15 && t < 3.45) { const k = sino01(t, 3.15, 0.3); p.olhoE = mix(p.olhoE, 0.07, k); p.olhoD = mix(p.olhoD, 0.07, k); }
      if (t > 3.4) p.boca = 'canto';
      p.testa.rz += trilha([[3.4, 0], [3.8, 4.5, 'suave']])(t);
      p.camera.dist = trilha([[3.0, 1], [3.6, 0.92, 'suave']])(t);
      p.camera.alvoY = trilha([[2.9, -0.12], [3.5, 0, 'suave']])(t);
      return p;
    },
  };
})();

/* ======================================================================
   B02 · Sino de balcão
   Uma campainha de recepção CK é pressionada; o sino sente a vibração, dá um pulo e toca junto.
   Clique no palco para pressionar.
   ====================================================================== */
const B02 = {
  dur: 3.4, fimMovimento: 3.1, enquadramento: ENQ_LARGO, objetos: ['campainha'], toque: 0.4,
  fases: [['expectativa', 0, 0.55], ['pressão', 0.55, 0.62], ['vibração', 0.62, 0.95], ['pulo e toque', 0.95, 1.5], ['acomodação', 1.5, 3.1]],
  quadro(t) {
    const p = poseNeutra(); const P = [1.78, 0, 0.8];
    const aperta = t < 0.55 ? 0 : t < 0.62 ? (t - 0.55) / 0.07 : t < 0.8 ? 1 : 1 - clamp((t - 0.8) / 0.12);
    p.objetos.push({ id: 'campainha', pos: P, rot: [0, -25, 0], esc: 1, aperta, vibra: oscila(t, 0.62, 1.7, 5, 9, 0.3, 0.3) });
    if (t > 0.3 && t < 0.55) p.hq.push({ tipo: 'velocidade', vida: (t - 0.3) / 0.25, em: [P[0], 1.2, P[2]], dir: 'baixo' });
    if (t >= 0.62 && t < 1.1) p.hq.push({ tipo: 'texto', texto: 'PLIM!', vida: (t - 0.62) / 0.48, em: [P[0] + 0.1, 1.05, P[2]], pequeno: true });
    if (t >= 0.62 && t < 0.7) p.hq.push({ tipo: 'impacto', vida: (t - 0.62) / 0.08, em: [P[0], 0.7, P[2]] });
    // expectativa: olha para a campainha
    const k = trilha([[0, 0], [0.4, 1, 'suave'], [0.95, 1], [1.4, 0, 'suave']])(t); p.sino.ry += 12 * k; p.sino.rx += 5 * k; p.olhoD = mix(1, 0.7, k);
    // pulo
    p.sino.ty = trilha([[0.9, 0], [1.08, 0.16, 'sai'], [1.28, 0, 'entra']])(t);
    if (t > 0.9 && t < 0.98) p.sino.sy = 1 - 0.06 * sino01(t, 0.9, 0.08);
    if (t > 1.28 && t < 1.4) p.sino.sy = 1 - 0.07 * sino01(t, 1.28, 0.12);
    reagirGolpe(p, t, 1.1, { forca: 1, lado: -1, texto: 'DING!', alvo: 'topo' });
    p.impacto = Math.max(p.impacto, t >= 0.62 && t < 0.9 ? 0.5 * (1 - (t - 0.62) / 0.28) : 0);
    if (t > 2.2) p.boca = 'canto';
    if (t > 2.45 && t < 2.75) p.olhoE = mix(p.olhoE, 0.07, sino01(t, 2.45, 0.3));
    p.sino.rx += trilha([[2.0, 0], [2.4, -3, 'suave']])(t);
    return p;
  },
};

/* ======================================================================
   B03 · Acionador mecânico (alavanca, engrenagem e braço)
   ====================================================================== */
const B03 = {
  dur: 4.3, fimMovimento: 4.0, enquadramento: ENQ_LARGO, objetos: ['alavanca'], toque: 0.6,
  fases: [['montagem', 0, 0.6], ['puxa a alavanca', 0.8, 1.2], ['engrenagem arma', 1.0, 1.55], ['golpe', 1.55, 1.68], ['recuperação', 1.68, 3.3], ['saída', 3.3, 4.0]],
  quadro(t) {
    const p = poseNeutra();
    const esc = t < 0.6 ? CURVAS.volta(clamp(t / 0.6)) : t > 3.4 ? 1 - CURVAS.entra(clamp((t - 3.4) / 0.5)) : 1;
    const alavanca = trilha([[0.8, 0], [1.2, -72, 'entra'], [2.0, -72], [2.35, 8, 'sai'], [2.6, 0, 'suave']])(t);
    const giro = trilha([[1.0, 0], [1.55, 200, 'suave'], [2.0, 230, 'sai']])(t);
    const braco = trilha([[0, 22], [1.1, 22], [1.5, 48, 'suave'], [1.68, 0, 'entra'], [1.9, 12, 'sai'], [2.6, 22, 'suave']])(t);
    p.objetos.push({ id: 'alavanca', pos: [2.45, 0, 0.45], rot: [0, -12, 0], esc, alavanca, giro, braco });
    if (t > 1.15 && t < 1.55) p.hq.push({ tipo: 'texto', texto: 'CLAC', vida: (t - 1.15) / 0.4, em: [2.5, 1.05, 0.45], pequeno: true });
    if (t > 1.55 && t < 1.68) p.hq.push({ tipo: 'velocidade', vida: (t - 1.55) / 0.13, em: [1.25, 0.6, 0.5], dir: 'baixo' });
    reagirGolpe(p, t, 1.68, { forca: 1, lado: 1, texto: 'TOC!' });
    const k = trilha([[0, 0], [0.5, 1, 'suave'], [1.5, 1], [1.8, 0]])(t); p.sino.ry += 13 * k; p.olhoD = mix(p.olhoD, 0.6, k); p.testa.rz += -5 * k;
    if (t > 2.6) p.boca = 'canto';
    if (t > 2.4 && t < 3.2) { const s = sino01(t, 2.4, 0.8); p.sino.ry += 8 * s; p.olhoE = mix(p.olhoE, 0.75, s); }
    return p;
  },
};

/* B04 · Mão cartunesca (manopla dourada do mascote) */
const B04 = cenaComObjeto('manopla', { ocioso: 0.3 });
/* B11 · Objeto empresarial (calculadora fecha a venda e o sino toca como caixa registradora) */
const B11 = cenaComObjeto('calculadora', { ocioso: 0.35 });

/* ======================================================================
   B05 · Impacto HQ (quadro congelado, linhas radiais, flash e tremor de câmera)
   ====================================================================== */
const B05 = (() => {
  const C = 1.3, PARADA = 0.14;
  const desloc = trilha([[0.2, [2.6, 1.6, 0.35]], [0.75, [0.4, 0.2, 0.04], 'sai'], [1.15, [0.7, 0.36, 0.06], 'suave'], [C, [0, 0, 0], 'entra'], [1.7, [0.9, 0.8, 0.2], 'sai'], [2.4, [3.0, 2.8, 0.4], 'linear']]);
  const giro = trilha([[0.2, -70], [0.75, -45, 'sai'], [1.15, -95, 'suave'], [C, 0, 'entra'], [2.4, -560, 'linear']]);
  return {
    dur: 4.6, fimMovimento: 4.2, enquadramento: ENQ_PADRAO, toque: 0.75,
    fases: [['entrada rápida', 0.2, 0.75], ['antecipação', 0.75, 1.15], ['golpe', 1.15, C], ['quadro congelado', C, C + PARADA], ['ricochete', C + PARADA, 2.4], ['tontura e recuperação', 2.4, 4.2]],
    quadro(tReal) {
      const t = tReal < C ? tReal : tReal < C + PARADA ? C : tReal - PARADA;
      const p = poseNeutra(); const red = AMBIENTE.reduzido;
      if (t > 0.2 && t < 2.4) p.martelo = { desloc: desloc(t), giro: giro(t) };
      if (t > 1.15 && t < C) p.hq.push({ tipo: 'velocidade', vida: (t - 1.15) / (C - 1.15), em: 'martelo' });
      p.olhoE = p.olhoD = trilha([[0.6, 1], [1.1, 0.5, 'suave'], [C, 0.5]])(t);
      reagirGolpe(p, t, C, { forca: 1.35, lado: 1, texto: null });
      if (tReal >= C && tReal < C + PARADA) {
        p.fx.estrela = 1.5; p.impacto = 1;
        if (!red) { p.hq.push({ tipo: 'radial', vida: (tReal - C) / PARADA }); if (tReal - C < 0.05) p.hq.push({ tipo: 'flash', vida: (tReal - C) / 0.05 }); }
      }
      if (t >= C && t < C + 0.75) p.hq.push({ tipo: 'texto', texto: 'TÓIM!', vida: (t - C) / 0.75, em: 'aro', grande: true });
      if (!red && t >= C && t < C + 0.6) { const k = 1 - (t - C) / 0.6; p.camera.az += 2.4 * k * Math.sin(t * 70); p.camera.el += 1.6 * k * Math.cos(t * 55); }
      // tontura: o rosto balança e os olhos piscam alternados
      if (t > 2.0 && t < 3.4) { const s = sino01(t, 2.0, 1.4); p.sino.ry += 10 * s * Math.sin(t * 9); p.olhoE = mix(p.olhoE, 0.55 + 0.4 * Math.sin(t * 9), s); p.olhoD = mix(p.olhoD, 0.55 - 0.4 * Math.sin(t * 9), s); p.hq.push({ tipo: 'estrelas', vida: ((t - 2.0) / 1.4), em: 'topo' }); }
      if (t > 3.5) { p.boca = 'canto'; p.sino.rx = -3 * clamp((t - 3.5) / 0.4); }
      return p;
    },
  };
})();

/* ======================================================================
   B06 · Reação expressiva (personalidade: desconfia, procura, dá de ombros, se orgulha)
   ====================================================================== */
const B06 = {
  dur: 5.0, fimMovimento: 4.8, enquadramento: ENQ_PADRAO, toque: 0.3,
  fases: [['repouso', 0, 0.5], ['cutucão', 0.5, 0.62], ['susto', 0.62, 1.0], ['procura', 1.0, 2.3], ['dá de ombros', 2.3, 3.0], ['piscadinha', 3.0, 3.8], ['orgulho', 3.8, 4.8]],
  quadro(t) {
    const p = poseNeutra();
    if (t > 0.35 && t < 0.62) p.hq.push({ tipo: 'velocidade', vida: (t - 0.35) / 0.27, em: [-1.3, 0.45, 0.5], dir: 'direita' });
    reagirGolpe(p, t, 0.62, { forca: 0.7, lado: -1, texto: 'TOC!', alvo: 'aro' });
    p.sino.ty = trilha([[0.62, 0], [0.8, 0.1, 'sai'], [0.98, 0, 'entra']])(t);
    p.sino.ry += trilha([[1.0, 0], [1.35, -18, 'suave'], [1.65, -18], [2.0, 18, 'suave'], [2.2, 18], [2.5, 0, 'suave']])(t);
    const desconfia = trilha([[1.0, 0], [1.3, 1, 'suave'], [2.2, 1], [2.5, 0, 'suave']])(t);
    p.olhoE = mix(p.olhoE, 0.5, desconfia); p.olhoD = mix(p.olhoD, 0.45, desconfia); p.testa.rz += -6 * desconfia; p.testa.ty += -0.012 * desconfia;
    if (t > 1.15 && t < 2.3) p.hq.push({ tipo: 'interroga', vida: (t - 1.15) / 1.15, em: 'topo' });
    const ombro = sino01(t, 2.35, 0.55); p.testa.ty += 0.04 * ombro; p.sino.sy *= 1 + 0.03 * ombro; p.badalo.rz += 6 * ombro;
    p.sino.rx += trilha([[3.0, 0], [3.3, -3, 'suave'], [3.8, -3], [4.2, -6, 'suave']])(t);
    if (t > 3.2) p.boca = 'canto';
    if (t > 3.45 && t < 3.8) p.olhoD = mix(p.olhoD, 0.07, sino01(t, 3.45, 0.35));
    const orgulho = trilha([[3.8, 0], [4.15, 1, 'sai'], [4.8, 1]])(t); p.sino.sy *= 1 + 0.035 * orgulho; p.testa.rz += 4 * orgulho;
    if (t > 3.9 && t < 4.7) p.hq.push({ tipo: 'brilho', vida: (t - 3.9) / 0.8, em: 'cabeca' });
    return p;
  },
};

/* ======================================================================
   B07 · Acionamento duplo (toque leve acorda pela metade; o segundo desperta de vez)
   ====================================================================== */
const B07 = (() => {
  const T1 = 1.4, T2 = 2.45;
  const desloc = trilha([[0.3, [2.3, 1.9, 0.35]], [1.05, [0.25, 0.1, 0.03], 'sai'], [1.3, [0.12, 0.05, 0.02]], [T1, [0, 0, 0], 'entra'], [1.6, [0.15, 0.06, 0.02], 'sai'], [2.25, [0.55, 0.3, 0.06], 'suave'], [T2, [0, 0, 0], 'entra'], [2.7, [0.14, 0.05, 0.02], 'sai'], [3.4, [2.3, 0.7, 0.35], 'entra']]);
  const giro = trilha([[0.3, -70], [1.05, -35, 'sai'], [1.3, -18], [T1, 0, 'entra'], [1.6, -20, 'sai'], [2.25, -88, 'suave'], [T2, 0, 'entra'], [2.7, -30, 'sai'], [3.4, -10]]);
  return {
    dur: 4.9, fimMovimento: 4.6, enquadramento: ENQ_PADRAO, toque: 1.05,
    fases: [['sono', 0, 1.3], ['toque leve', 1.3, T1 + 0.1], ['meio acordado', T1 + 0.1, 2.25], ['toque forte', 2.25, T2], ['desperta', T2, 3.4], ['resmunga', 3.4, 4.6]],
    quadro(t) {
      const p = poseNeutra();
      if (t > 0.3 && t < 3.4) p.martelo = { desloc: desloc(t), giro: giro(t) };
      const sono = t < T1 ? 1 : t < T2 ? 0.5 : 0;
      p.olhoE = sono === 1 ? 0.4 : sono === 0.5 ? 0.42 : 1; p.olhoD = sono === 1 ? 0.4 : sono === 0.5 ? 1.05 : 1;
      p.testa.ty = sono === 1 ? -0.02 : sono === 0.5 ? -0.01 : 0;
      p.sino.rz = sono === 1 ? 1.2 * Math.sin(t * 2.2) : 0;
      if (t < 1.2) p.hq.push({ tipo: 'zzz', vida: (t % 1.2) / 1.2, em: 'topo' });
      reagirGolpe(p, t, T1, { forca: 0.3, lado: 1, texto: 'tic', ondas: false, olhos: false, boca: false });
      reagirGolpe(p, t, T2, { forca: 1.15, lado: 1, texto: 'TOC!' });
      p.sino.ty = trilha([[T2, 0], [T2 + 0.16, 0.12, 'sai'], [T2 + 0.34, 0, 'entra']])(t);
      const resm = trilha([[3.4, 0], [3.7, 1, 'suave'], [4.3, 1], [4.6, 0.4, 'suave']])(t);
      p.sino.ry += 14 * resm; p.olhoE = mix(p.olhoE, 0.62, resm); p.olhoD = mix(p.olhoD, 0.55, resm); p.testa.rz += -6 * resm;
      return p;
    },
  };
})();

/* ======================================================================
   B08 · Entrada cinematográfica (cai em cena, amassa, toca sozinho e se apresenta)
   ====================================================================== */
const B08 = {
  dur: 3.6, fimMovimento: 3.3, enquadramento: ENQ_PADRAO, toque: 0,
  fases: [['queda', 0, 0.45], ['aterrissagem', 0.45, 0.9], ['desperta', 0.9, 1.4], ['toque próprio', 1.4, 2.5], ['apresentação', 2.5, 3.3]],
  quadro(t) {
    const p = poseNeutra(); const red = AMBIENTE.reduzido;
    p.sino.ty = red ? 0 : trilha([[0, 3.4], [0.45, 0, 'entra'], [0.62, 0.1, 'sai'], [0.78, 0, 'entra']])(t);
    if (!red) {
      if (t < 0.45) p.hq.push({ tipo: 'velocidade', vida: t / 0.45, em: 'topo', dir: 'cima' });
      p.sino.sy = t < 0.45 ? 1.08 : t < 0.6 ? 1 - 0.18 * sino01(t, 0.45, 0.15) : 1 + oscila(t, 0.6, 1.2, 0.05, 2.5, 0.2);
      if (t >= 0.45 && t < 1.0) p.hq.push({ tipo: 'poeira', vida: (t - 0.45) / 0.55, em: 'base' });
      if (t >= 0.45 && t < 0.8) { const k = 1 - (t - 0.45) / 0.35; p.camera.el += 1.5 * k * Math.sin(t * 60); }
      p.impacto = t >= 0.45 && t < 0.9 ? 1 - (t - 0.45) / 0.45 : 0;
    }
    const abre = trilha([[0, 0.07], [0.95, 0.07], [1.15, 1.15, 'sai'], [1.35, 1]])(t); p.olhoE = p.olhoD = abre;
    p.testa.ty = trilha([[0.95, -0.02], [1.15, 0.03, 'sai'], [1.35, 0]])(t);
    p.badalo.rz = oscila(t, 1.45, 2.6, 32, 1.4, 0.55, 0.4); p.sino.rz = oscila(t, 1.45, 2.6, -4, 1.4, 0.55, 0.4);
    if (t >= 1.5 && t < 2.2) p.hq.push({ tipo: 'texto', texto: 'DONG!', vida: (t - 1.5) / 0.7, em: 'topo' });
    p.impacto = Math.max(p.impacto, sino01(t, 1.5, 0.6) * 0.6);
    p.sino.rx = trilha([[2.5, 0], [2.8, -3, 'suave']])(t); if (t > 2.85) p.boca = 'canto'; p.testa.rz = trilha([[2.85, 0], [3.2, 4.5, 'suave']])(t);
    return p;
  },
};

/* ======================================================================
   B09 · Reação ao cursor (desktop) e ao toque (celular). Sem laço: responde ao vivo.
   ====================================================================== */
const B09 = {
  dur: 6, fimMovimento: 6, enquadramento: ENQ_PADRAO, livre: true, toque: 0,
  fases: [['acompanha o cursor (ao vivo)', 0, 6]],
  quadro(t, ctx) {
    const m = ctx.memoria; const pt = ctx.ponteiro;
    if (!m.b09) m.b09 = { ry: 0, rx: 0, perto: 0, toque: -10, parado: 0, ultimo: [0, 0] };
    const s = m.b09; const dt = ctx.dt ?? 0.016;
    let alvoY, alvoX, perto;
    if (pt.ativo) { alvoY = clamp(pt.x, -1.2, 1.2) * 18; alvoX = clamp(-pt.y, -1, 1) * 7; perto = clamp(1 - Math.hypot(pt.x, pt.y) / 1.2); }
    else { alvoY = 9 * Math.sin(t * 0.45) + 4 * Math.sin(t * 1.3); alvoX = 2 * Math.sin(t * 0.7); perto = 0; } // piloto automático
    const k = 1 - Math.exp(-dt * (AMBIENTE.reduzido ? 2 : 6));
    s.ry += (alvoY - s.ry) * k; s.rx += (alvoX - s.rx) * k; s.perto += (perto - s.perto) * k;
    if (pt.clique && pt.clique !== s.ultimoClique) { s.ultimoClique = pt.clique; s.toque = t; }
    const p = poseNeutra();
    p.sino.ry = s.ry; p.sino.rx = s.rx; p.testa.ty = 0.02 * s.perto;
    p.olhoE = p.olhoD = 1 + 0.18 * s.perto;
    const pisca = (t % 3.7) < 0.14; if (pisca) { p.olhoE = p.olhoD = 0.07; }
    if (s.perto > 0.75) p.boca = 'canto';
    reagirGolpe(p, t, s.toque, { forca: 0.6, lado: pt.x > 0 ? 1 : -1, texto: 'TOC!' });
    return p;
  },
};

/* ======================================================================
   B10 · Interação magnética (atrai, inverte o polo, repele e o sino toca no tranco)
   ====================================================================== */
const B10 = {
  dur: 4.6, fimMovimento: 4.3, enquadramento: ENQ_LARGO, objetos: ['ima'], toque: 0.7,
  fases: [['entrada do ímã', 0, 0.7], ['atração', 0.7, 1.8], ['inverte o polo', 1.8, 2.1], ['repulsão e toque', 2.1, 2.8], ['saída', 2.8, 3.4], ['acomodação', 3.4, 4.3]],
  quadro(t) {
    const p = poseNeutra();
    const x = trilha([[0, 3.8], [0.7, 2.05, 'sai'], [1.7, 1.85, 'suave'], [2.15, 2.0], [2.8, 2.05], [3.4, 3.9, 'entra']])(t);
    const vira = trilha([[1.8, 0], [2.1, 180, 'volta']])(t);
    p.objetos.push({ id: 'ima', pos: [x + 0.2, 0.5, 0.45], rot: [0, -10, 0], esc: 1, vira });
    const atrai = trilha([[0.7, 0], [1.7, 1, 'suave'], [2.1, 1]])(t) * (t < 2.12 ? 1 : 0);
    p.sino.rz += 7 * atrai; p.badalo.rz += 20 * atrai; p.sino.ry += 12 * atrai; p.olhoD = mix(1, 1.15, atrai); p.olhoE = mix(1, 0.8, atrai);
    if (t > 1.0 && t < 1.8) p.hq.push({ tipo: 'interroga', vida: (t - 1.0) / 0.8, em: 'topo' });
    if (t > 1.85 && t < 2.15) p.hq.push({ tipo: 'texto', texto: 'ZAP', vida: (t - 1.85) / 0.3, em: [x, 1.15, 0.45], pequeno: true });
    if (t >= 2.12) p.sino.rz += trilha([[2.12, 7], [2.3, -4, 'sai'], [2.6, 0, 'suave']])(t);
    reagirGolpe(p, t, 2.15, { forca: 0.9, lado: 1, texto: 'DOIN!', alvo: 'topo' });
    if (t > 3.0) p.boca = 'canto';
    if (t > 3.1 && t < 3.9) { const s = sino01(t, 3.1, 0.8); p.sino.ry += 14 * s; p.olhoD = mix(p.olhoD, 0.6, s); }
    return p;
  },
};

/* ======================================================================
   B12 · Chamado da Forja (proposta autoral: círculo rúnico e orbe de energia do logo)
   ====================================================================== */
const B12 = {
  dur: 4.6, fimMovimento: 4.3, enquadramento: ENQ_PADRAO, objetos: ['circulo', 'orbe'], toque: 0.2,
  fases: [['círculo acende', 0, 0.8], ['orbe sobe', 0.3, 1.0], ['carga', 1.0, 1.6], ['absorção', 1.6, 1.72], ['explosão de energia', 1.72, 2.4], ['brasa', 2.4, 4.3]],
  quadro(t) {
    const p = poseNeutra();
    const forca = trilha([[0, 0], [0.8, 0.8, 'suave'], [1.6, 1], [1.72, 1.5, 'sai'], [2.3, 0.9, 'suave'], [3.8, 0, 'suave']])(t);
    if (forca > 0.01) p.objetos.push({ id: 'circulo', pos: [0, 1.15, -0.95], rot: [0, 0, 0], esc: 0.85 + 0.15 * forca, forca, giro: t * 14 + (t > 1.72 ? 40 * CURVAS.sai(clamp((t - 1.72) / 0.6)) : 0) });
    const carga = trilha([[0.3, 0.3], [1.0, 0.5], [1.6, 1.2, 'entra']])(t);
    const pos = t < 1.0 ? arco(t, 0.3, 1.0, [0, -0.6, 1.3], [0.4, 0.5, 1.4], [0, 1.0, 1.3], 'sai') : t < 1.6 ? [0, 1.0 + 0.02 * Math.sin(t * 40), 1.3] : arco(t, 1.6, 1.72, [0, 1.0, 1.3], [0, 1.05, 1.0], [0, 1.05, 0.7], 'entra');
    if (t > 0.3 && t < 1.72) p.objetos.push({ id: 'orbe', pos, rot: [0, 0, 0], esc: t < 0.5 ? CURVAS.volta(clamp((t - 0.3) / 0.2)) : 1, carga, giro: t * 220 });
    const comprime = trilha([[1.0, 0], [1.6, 1, 'entra'], [1.72, -1.4, 'sai'], [2.0, 0.3, 'suave'], [2.3, 0, 'suave']])(t);
    p.sino.sy = 1 - 0.05 * comprime; p.olhoE = p.olhoD = t < 1.72 ? mix(1, 0.45, clamp((t - 1.0) / 0.6)) : 1;
    p.visor = trilha([[1.0, 0], [1.6, 0.6], [1.72, 1, 'sai'], [2.6, 1], [3.8, 0, 'suave']])(t);
    reagirGolpe(p, t, 1.72, { forca: 0.8, lado: 1, texto: 'FWOOM!', alvo: 'topo' });
    if (t >= 1.72 && t < 2.5) p.hq.push({ tipo: 'anel', vida: (t - 1.72) / 0.78, em: 'cabeca' });
    if (t >= 1.8 && t < 3.2) p.hq.push({ tipo: 'faiscas', vida: ((t - 1.8) * 1.6) % 1, em: 'cabeca' });
    p.impacto = Math.max(p.impacto, forca > 1 ? (forca - 1) * 2 : 0);
    if (t > 2.6) p.boca = 'canto'; p.sino.rx = trilha([[2.4, 0], [2.8, -4, 'suave']])(t);
    return p;
  },
};

/* B13 · Aceno de boas-vindas (para o primeiro acesso ou depois do login) */
const B13 = {
  dur: 3.8, fimMovimento: 3.5, enquadramento: ENQ_PADRAO, toque: 0,
  fases: [['impulso', 0, 0.3], ['pulinho', 0.3, 0.75], ['aceno', 0.9, 2.3], ['piscadinha', 2.4, 2.75], ['repouso', 2.75, 3.5]],
  quadro(t) {
    const p = poseNeutra();
    p.sino.sy = t < 0.3 ? 1 - 0.04 * sino01(t, 0, 0.6) : t > 0.75 && t < 0.88 ? 1 - 0.05 * sino01(t, 0.75, 0.13) : 1;
    p.sino.ty = trilha([[0.3, 0], [0.52, 0.14, 'sai'], [0.75, 0, 'entra']])(t);
    const env = sino01(t, 0.9, 1.4); p.sino.rz = 9 * env * Math.sin(2 * Math.PI * 1.5 * (t - 0.9)); p.badalo.rz = -14 * env * Math.sin(2 * Math.PI * 1.5 * (t - 0.9) - 0.6);
    p.olhoE = p.olhoD = mix(1, 0.62, env); if (t > 0.9) p.boca = 'canto';
    if (t >= 1.0 && t < 2.2) p.hq.push({ tipo: 'texto', texto: 'OLÁ!', vida: (t - 1.0) / 1.2, em: 'cabeca' });
    if (t > 2.4 && t < 2.75) p.olhoE = mix(p.olhoE, 0.07, sino01(t, 2.4, 0.35));
    p.testa.rz = trilha([[2.4, 0], [2.75, 5, 'suave']])(t); p.sino.rx = trilha([[2.3, 0], [2.7, -3, 'suave']])(t);
    return p;
  },
};

/* B14 · Toque de assinatura: o clipe que veio dentro do GLB (HQ_Toque_de_Assinatura) e não é usado no app */
const B14 = {
  dur: 4.17, fimMovimento: 4.17, enquadramento: ENQ_PADRAO, clipe: true, toque: 0,
  fases: [['clipe original do modelo (4,17 s)', 0, 4.17]],
  quadro(t, ctx) {
    const p = poseNeutra(); p.clipe = { t: Math.min(t, 4.16) };
    const tc = ctx.clipeImpacto ?? 2;
    if (t >= tc && t < tc + 0.6) p.hq.push({ tipo: 'texto', texto: 'TOC!', vida: (t - tc) / 0.6, em: 'aro' });
    if (t >= tc && t < tc + 0.085) p.hq.push({ tipo: 'impacto', vida: (t - tc) / 0.085, em: 'aro' });
    p.impacto = t >= tc && t < tc + 0.5 ? 1 - (t - tc) / 0.5 : 0;
    return p;
  },
};

/* B00 · a cena em produção, sem alterações */
const B00 = {
  dur: QUEM_TOCOU.dur, fimMovimento: 7.06, enquadramento: QUEM_TOCOU.enquadramento, toque: 1.4, original: true,
  fases: [['espera', 0, 0.55], ['desconfia', 0.55, 1.4], ['martelo entra e hesita', 1.4, 3.95], ['antecipação', 3.95, 4.22], ['golpe', 4.22, 4.36], ['impacto', 4.36, 4.5], ['oscilação', 4.5, 6.76], ['martelo sai', 4.95, 5.95], ['piscadinha e sorriso', 6.1, 6.65], ['imóvel', 7.06, 8.0]],
  quadro(t) { return deOriginal(QUEM_TOCOU.pose(t, AMBIENTE.reduzido)); },
};

export const ANIMACOES = { B00, B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, B11, B12, B13, B14 };

/* ======================================================================
   CATEGORIA C · RITMO DO LAÇO
   Tempo parado percebido = (fim da cena − fim do movimento) + pausa final.
   Para a cena atual: (8,0 − 7,06) + 3,5 = 4,44 s parados em cada ciclo de 12,5 s.
   ====================================================================== */
export const LACO_ORIGINAL = LACO; // { cena: 8, pausaFinal: 3.5, retorno: 1 }

export const RITMOS = {
  C01: { fator: 1 },
  C02: { fator: 0.85 },
  C03: { fator: 0.75 },
  C04: { fator: 0.65 },
  C05: { faixa: [0.58, 0.86] },
  C06: { fator: 0.75, repouso: true },
  C07: { fator: 0.75, repouso: true, repertorio: true },
};

/** Tempo parado original de uma animação (mesma pausa do app, 3,5 s). */
export const paradoOriginal = (anim) => Math.max(0, anim.dur - anim.fimMovimento) + LACO.pausaFinal;

/** Olhadinha curta que entra no lugar da cena a cada três ciclos (C07): olha, pisca, sorri e volta. */
const OLHADINHA = {
  dur: 2.4,
  quadro(t) {
    const p = poseNeutra();
    p.sino.ry = trilha([[0, 0], [0.4, 9, 'suave'], [0.9, 9], [1.3, -7, 'suave'], [1.6, -7], [2.1, 0, 'suave']])(t);
    p.olhoD = trilha([[0.2, 1], [0.5, 0.75], [1.6, 0.75], [2.0, 1]])(t);
    if (t > 1.7 && t < 1.95) { const k = sino01(t, 1.7, 0.25); p.olhoE = mix(1, 0.07, k); p.olhoD = mix(p.olhoD, 0.07, k); }
    if (t > 0.9 && t < 2.0) p.boca = 'canto';
    return p;
  },
};

/** Monta o laço para uma animação e um ritmo. Devolve quadro(t, ctx) → { pose, info }. */
export function criarLaco(anim, ritmoCfg, { personalizado = null } = {}) {
  const S0 = paradoOriginal(anim); const cauda = Math.max(0, anim.dur - anim.fimMovimento);
  const retorno = anim.livre ? 0 : LACO.retorno;
  const aleatorio = semente(7);
  const ciclos = []; let acumulado = 0;
  function pausaDoCiclo() {
    let S;
    if (personalizado != null) S = personalizado;
    else if (ritmoCfg.faixa) S = S0 * mix(ritmoCfg.faixa[0], ritmoCfg.faixa[1], aleatorio());
    else S = S0 * (ritmoCfg.fator ?? 1);
    return Math.max(0.35, S - cauda);
  }
  function garantir(t) {
    while (acumulado <= t) {
      const i = ciclos.length; const variante = ritmoCfg.repertorio && i % 3 === 2;
      const cena = variante ? OLHADINHA.dur : anim.dur; const pausa = variante ? 0.6 : pausaDoCiclo(); const ret = variante ? 0 : retorno;
      ciclos.push({ ini: acumulado, cena, pausa, ret, variante, total: cena + pausa + ret }); acumulado += cena + pausa + ret;
    }
  }
  const finais = new Map();
  function poseFinal(ctx) { const k = AMBIENTE.reduzido ? 'r' : 'n'; if (!finais.has(k)) finais.set(k, anim.quadro(anim.dur, ctx)); return finais.get(k); }
  const inicial = (ctx) => anim.quadro(0, ctx);

  return {
    anim, ritmo: ritmoCfg,
    ciclo(t) { garantir(t); let lo = 0, hi = ciclos.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ciclos[m].ini <= t) lo = m; else hi = m - 1; } return { ...ciclos[lo], indice: lo }; },
    quadro(t, ctx) {
      if (anim.livre) return { pose: anim.quadro(t, ctx), info: { fase: 'cena', u: t % anim.dur, cena: anim.dur, pausa: 0, ret: 0, indice: 0 } };
      const c = this.ciclo(t); const u = t - c.ini;
      let pose, fase;
      if (u < c.cena) { pose = c.variante ? OLHADINHA.quadro(u) : anim.quadro(u, ctx); fase = c.variante ? 'variação' : 'cena'; }
      else if (u < c.cena + c.pausa) {
        fase = 'pausa'; const f = c.variante ? OLHADINHA.quadro(OLHADINHA.dur) : poseFinal(ctx);
        pose = misturarPoses(f, f, 0, f.boca); pose.objetos = f.objetos ?? [];
        if (ritmoCfg.repouso && !AMBIENTE.reduzido) repousoVivo(pose, u - c.cena, c.indice, c.pausa);
      } else {
        fase = 'retorno'; const k = CURVAS.suave(clamp((u - c.cena - c.pausa) / c.ret));
        const fim = poseFinal(ctx), ini = inicial(ctx);
        pose = misturarPoses(fim, ini, k); pose.objetos = (k < 0.5 ? fim.objetos : ini.objetos) ?? [];
      }
      return { pose, info: { fase, u, cena: c.cena, pausa: c.pausa, ret: c.ret, indice: c.indice, variante: c.variante } };
    },
  };
}

/** Repouso vivo: respiração lenta, uma piscada e um olhar de canto durante a pausa (C06 e C07). */
function repousoVivo(p, u, ciclo, pausa) {
  const ent = clamp(u / 0.6);
  p.sino.sy *= 1 + 0.007 * ent * Math.sin((2 * Math.PI * u) / 2.6);
  p.sino.rz += 0.5 * ent * Math.sin((2 * Math.PI * u) / 3.4);
  const r = semente(ciclo + 3); const tp = 0.5 + r() * Math.max(0.2, pausa - 1.0);
  if (u > tp && u < tp + 0.22) { const k = sino01(u, tp, 0.22); p.olhoE = mix(p.olhoE, 0.07, k); p.olhoD = mix(p.olhoD, 0.07, k); }
  const lado = r() > 0.5 ? 1 : -1; p.sino.ry += 4 * lado * sino01(u, 0.3, Math.max(0.6, pausa - 0.4));
}

/** Pose estática representativa para miniaturas (quadro de maior expressão). */
export function tempoRepresentativo(anim) {
  const f = anim.fases.find(([n]) => /impacto|golpe|toque|explos|pulo|ação|aceno|susto|repulsão/.test(n));
  return f ? Math.min(anim.dur, f[1] + 0.12) : anim.dur * 0.5;
}
