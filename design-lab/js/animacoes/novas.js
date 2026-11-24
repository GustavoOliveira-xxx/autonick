// Novas cenas do sino com a mãozinha (N01–N06) e o refinamento do peteleco (B04 → N02).
// Todas usam o mesmo rig do sino e a mão procedural de motor/mao.js. A variante de acabamento da mão
// (luva clássica, manopla CK ou vinho) é escolhida no lab e lida a cada quadro.
import { clamp, mix, CURVAS, trilha, oscila, sino01, poseNeutra, reagirGolpe } from '../motor/curvas.js';
import { POSES, misturarMao, trilhaPoses } from '../motor/mao.js';

export const MAO = { variante: 'manopla' };
const id = () => `mao_${MAO.variante}`;
const ENQ = Object.freeze({ meiaAltura: 1.75, meiaLargura: 3.05, deslocX: 0.85 });
const olhar = (p, x, k = 1) => { p.sino.ry += clamp(x * 9, -18, 18) * k; };

/* N01 · Toc-toc: a mão bate duas vezes com os nós dos dedos, o sino atende e ela acena. */
const N01 = {
  nome: 'Toc-toc', dur: 4.6, fimMovimento: 4.3, enquadramento: ENQ, toque: 0.9,
  fases: [['chega', 0, 0.55], ['toc leve', 0.75, 0.95], ['toc forte', 1.25, 1.45], ['o sino atende', 1.45, 2.4], ['aceno', 2.4, 3.7], ['sai', 3.7, 4.3]],
  quadro(t) {
    const p = poseNeutra();
    const x = trilha([[0, 3.6], [0.55, 2.25, 'volta'], [0.75, 2.38, 'sai'], [0.9, 1.92, 'entra'], [1.05, 2.3, 'sai'], [1.3, 1.9, 'entra'], [1.5, 2.25, 'sai'], [2.4, 2.25], [3.7, 2.25], [4.3, 3.8, 'entra']])(t);
    const pose = trilhaPoses([[0, 'relaxada'], [0.45, 'punho', 'sai'], [2.3, 'punho'], [2.55, 'aberta', 'volta'], [3.7, 'aberta'], [4.0, 'relaxada']])(t);
    const aceno = t > 2.5 && t < 3.7 ? Math.sin((t - 2.5) * 2 * Math.PI * 1.4) * 20 * Math.min(1, (3.7 - t) * 2) : 0;
    const rotZ = t < 2.4 ? 90 : mix(90, 0, CURVAS.volta(clamp((t - 2.4) / 0.3)));
    const y = t < 2.4 ? 0.25 : mix(0.25, 0.55, CURVAS.sai(clamp((t - 2.4) / 0.3)));
    p.objetos.push({ id: id(), pos: [x, y, 0.55], rot: [0, -18, rotZ + aceno], esc: 1, pose, estica: 1 + 0.16 * (sino01(t, 0.85, 0.12) + sino01(t, 1.25, 0.12)) });
    reagirGolpe(p, t, 0.9, { forca: 0.35, lado: 1, texto: 'toc', ondas: false, boca: false });
    reagirGolpe(p, t, 1.32, { forca: 0.7, lado: 1, texto: 'TOC!' });
    const k = trilha([[1.5, 0], [1.9, 1, 'suave'], [3.4, 1], [3.9, 0, 'suave']])(t); olhar(p, 1.8, k); if (t > 1.9 && t < 3.8) p.boca = 'canto';
    if (t > 2.9 && t < 3.15) p.olhoE = mix(p.olhoE, 0.07, sino01(t, 2.9, 0.25));
    if (t > 2.5 && t < 3.0) p.hq.push({ tipo: 'texto', texto: 'OI!', vida: (t - 2.5) / 0.5, em: [2.3, 1.45, 0.55], pequeno: true });
    return p;
  },
};

/* N02 · Peteleco refinado: o médio arma atrás do polegar e solta no aro; o sino roda e a mão faz joinha. */
const N02 = {
  nome: 'Peteleco (B04 refinada)', dur: 3.9, fimMovimento: 3.6, enquadramento: ENQ, toque: 1.05,
  fases: [['entra', 0, 0.5], ['mira', 0.5, 0.9], ['arma', 0.9, 1.0], ['peteleco', 1.0, 1.12], ['giro do sino', 1.12, 2.4], ['joinha', 2.2, 3.1], ['sai', 3.1, 3.6]],
  quadro(t) {
    const p = poseNeutra();
    const pos = trilha([[0, [3.5, -0.2, 0.6]], [0.5, [2.2, 0.35, 0.6], 'volta'], [0.9, [2.42, 0.45, 0.62], 'sai'], [1.04, [1.86, 0.3, 0.6], 'entra'], [1.35, [2.1, 0.4, 0.6], 'sai'], [2.2, [2.15, 0.45, 0.6], 'suave'], [3.1, [2.15, 0.45, 0.6]], [3.6, [3.7, 0.6, 0.6], 'entra']])(t);
    const pose = trilhaPoses([[0, 'relaxada'], [0.55, 'peteleco', 'volta'], [1.0, 'peteleco'], [1.06, 'estalou', 'sai'], [1.8, 'relaxada', 'suave'], [2.2, 'joinha', 'volta'], [3.6, 'joinha']])(t);
    const rot = t < 2.0 ? 70 + (t > 0.85 && t < 1.0 ? Math.sin(t * 80) * 2 : 0) : mix(70, -90, CURVAS.volta(clamp((t - 2.0) / 0.35)));
    p.objetos.push({ id: id(), pos, rot: [0, -20, rot], esc: 1, pose, estica: 1 + 0.2 * sino01(t, 0.98, 0.14) });
    if (t > 0.92 && t < 1.04) p.hq.push({ tipo: 'velocidade', vida: (t - 0.92) / 0.12, em: [1.95, 0.4, 0.6], dir: 'esquerda' });
    reagirGolpe(p, t, 1.05, { forca: 0.95, lado: 1, texto: 'PLIM!' });
    p.sino.ry += oscila(t, 1.05, 2.6, 40, 0.8, 0.5, 0.5);
    if (t > 2.6) p.boca = 'canto';
    if (t > 2.25 && t < 2.9) p.hq.push({ tipo: 'brilho', vida: (t - 2.25) / 0.65, em: [1.95, 1.15, 0.6] });
    return p;
  },
};

/* N03 · Joinha de aprovação: a mão surge de baixo com o polegar para cima, o sino dá um pulinho feliz. */
const N03 = {
  nome: 'Joinha de aprovação', dur: 3.3, fimMovimento: 3.0, enquadramento: ENQ, toque: 0.7,
  fases: [['surge', 0, 0.55], ['joinha', 0.55, 0.9], ['pulinho do sino', 0.8, 1.6], ['brilho', 0.9, 1.6], ['assenta', 1.6, 2.6], ['desce', 2.6, 3.0]],
  quadro(t) {
    const p = poseNeutra();
    const y = trilha([[0, -1.6], [0.5, 0.3, 'volta'], [2.5, 0.3], [3.0, -1.7, 'entra']])(t);
    const pose = trilhaPoses([[0, 'punho'], [0.45, 'punho'], [0.7, 'joinha', 'volta'], [3.0, 'joinha']])(t);
    p.objetos.push({ id: id(), pos: [1.95, y, 0.6], rot: [0, -30, -90 + 10 * Math.sin(t * 2.5) * clamp((t - 0.7) * 2)], esc: 1, pose, estica: 1 + 0.15 * sino01(t, 0.3, 0.3) });
    p.sino.ty = trilha([[0.8, 0], [1.0, 0.2, 'sai'], [1.22, 0, 'entra'], [1.34, 0.06, 'sai'], [1.46, 0, 'entra']])(t);
    if (t > 1.2 && t < 1.32) p.sino.sy = 1 - 0.07 * sino01(t, 1.2, 0.12);
    const k = trilha([[0.4, 0], [0.7, 1, 'suave'], [2.3, 1], [2.7, 0.2, 'suave']])(t); olhar(p, 1.6, k * 0.8);
    if (t > 0.9) p.boca = 'canto';
    if (t > 0.75 && t < 1.5) p.hq.push({ tipo: 'brilho', vida: (t - 0.75) / 0.75, em: [1.8, 1.05, 0.6] }, { tipo: 'estrelas', vida: (t - 0.75) / 0.75, em: 'topo' });
    if (t > 1.6 && t < 1.85) { p.olhoE = mix(p.olhoE, 0.07, sino01(t, 1.6, 0.25)); }
    return p;
  },
};

/* N04 · Aperta a campainha: o indicador aperta o botão de balcão e o sino responde com DING. */
const N04 = {
  nome: 'Aperta a campainha', dur: 3.8, fimMovimento: 3.5, enquadramento: ENQ, toque: 1.0,
  fases: [['chega', 0, 0.6], ['mira', 0.6, 0.9], ['aperta', 0.9, 1.0], ['campainha vibra', 1.0, 1.6], ['sino pula e toca', 1.3, 2.0], ['sai', 2.6, 3.5]],
  quadro(t) {
    const p = poseNeutra(); const C = [1.85, 0, 0.8];
    const aperta = t < 0.92 ? 0 : t < 1.0 ? (t - 0.92) / 0.08 : t < 1.18 ? 1 : 1 - clamp((t - 1.18) / 0.12);
    p.objetos.push({ id: 'campainha', pos: C, rot: [0, -25, 0], esc: 1, aperta, vibra: oscila(t, 1.0, 2.1, 5, 9, 0.3, 0.3) });
    const y = trilha([[0, 2.6], [0.6, 1.25, 'volta'], [0.9, 1.35, 'sai'], [1.0, 0.98, 'entra'], [1.25, 1.2, 'sai'], [2.6, 1.25], [3.5, 3.0, 'entra']])(t);
    const pose = trilhaPoses([[0, 'relaxada'], [0.5, 'aponta', 'volta'], [2.0, 'aponta'], [2.3, 'ok', 'volta'], [3.5, 'ok']])(t);
    p.objetos.push({ id: id(), pos: [C[0] + 0.08, y, C[2]], rot: [-15, -25, t < 2.0 ? 180 : mix(180, 20, CURVAS.volta(clamp((t - 2.0) / 0.4)))], esc: 0.85, pose, estica: t > 0.98 && t < 1.15 ? 0.85 : 1 });
    if (t > 0.75 && t < 0.97) p.hq.push({ tipo: 'velocidade', vida: (t - 0.75) / 0.22, em: [C[0], 1.5, C[2]], dir: 'baixo' });
    if (t >= 1.0 && t < 1.45) p.hq.push({ tipo: 'texto', texto: 'PLIM!', vida: (t - 1.0) / 0.45, em: [C[0] + 0.3, 0.9, C[2]], pequeno: true });
    const k = trilha([[0.2, 0], [0.6, 1, 'suave'], [1.3, 1], [1.8, 0, 'suave']])(t); p.sino.ry += 12 * k; p.sino.rx += 5 * k;
    p.sino.ty = trilha([[1.25, 0], [1.42, 0.16, 'sai'], [1.62, 0, 'entra']])(t);
    reagirGolpe(p, t, 1.45, { forca: 1, lado: -1, texto: 'DING!', alvo: 'topo' });
    if (t > 2.2) p.boca = 'canto';
    return p;
  },
};

/* N05 · Estalo desperta: o sino cochila; a mão estala os dedos e ele acorda assustado, depois sorri. */
const N05 = {
  nome: 'Estalo que desperta', dur: 4.4, fimMovimento: 4.1, enquadramento: ENQ, toque: 1.55,
  fases: [['cochilo', 0, 1.0], ['prepara o estalo', 0.6, 1.5], ['ESTALO', 1.5, 1.6], ['susto', 1.6, 2.2], ['sorriso', 2.6, 3.4], ['OK e sai', 3.0, 4.1]],
  quadro(t) {
    const p = poseNeutra();
    const pos = trilha([[0, [3.6, 0.9, 0.5]], [0.7, [2.25, 0.9, 0.5], 'volta'], [3.4, [2.25, 0.9, 0.5]], [4.1, [3.8, 1.1, 0.5], 'entra']])(t);
    const pose = trilhaPoses([[0, 'relaxada'], [0.9, 'relaxada'], [1.3, 'estalo', 'suave'], [1.5, 'estalo'], [1.56, 'estalou', 'sai'], [2.4, 'estalou'], [2.8, 'ok', 'volta'], [4.1, 'ok']])(t);
    const tre = t > 1.35 && t < 1.52 ? Math.sin(t * 90) * 1.6 : 0;
    p.objetos.push({ id: id(), pos, rot: [0, -25, 15 + tre], esc: 0.9, pose, estica: 1 + 0.12 * sino01(t, 1.55, 0.16) });
    const dorme = t < 1.56;
    if (dorme) { p.olhoE = 0.4; p.olhoD = 0.4; p.testa.ty = -0.02; p.sino.rz = 1.2 * Math.sin(t * 2.2); if (t < 1.4) p.hq.push({ tipo: 'zzz', vida: (t % 1.2) / 1.2, em: 'topo' }); }
    if (t >= 1.55 && t < 2.1) { p.hq.push({ tipo: 'texto', texto: 'ESTALO!', vida: (t - 1.55) / 0.55, em: [2.1, 1.7, 0.5], pequeno: true }); }
    if (t >= 1.6) {
      const u = t - 1.6; const susto = u < 0.08 ? u / 0.08 : 1 - clamp((u - 0.5) / 0.5);
      p.olhoE = mix(1, 1.32, susto); p.olhoD = mix(1, 1.32, susto); p.boca = u < 0.9 ? 'o' : 'canto'; p.testa.ty += 0.05 * susto;
      p.sino.ty = trilha([[0, 0], [0.12, 0.22, 'sai'], [0.34, 0, 'entra']])(u);
      if (u < 0.6) p.hq.push({ tipo: 'exclama', vida: u / 0.6, em: 'topo' });
      const k = trilha([[0.3, 0], [0.7, 1, 'suave'], [2.2, 1], [2.5, 0, 'suave']])(u); olhar(p, 1.7, k);
    }
    return p;
  },
};

/* N06 · Aceno de boas-vindas a dois: o sino pula e a mão acena ao lado, como se fosse dele. */
const N06 = {
  nome: 'Boas-vindas com aceno', dur: 3.6, fimMovimento: 3.3, enquadramento: ENQ, toque: 0.4,
  fases: [['pulinho', 0, 0.5], ['mão surge', 0.2, 0.7], ['aceno', 0.7, 2.6], ['piscadinha', 2.1, 2.4], ['assenta', 2.6, 3.3]],
  quadro(t) {
    const p = poseNeutra();
    p.sino.ty = trilha([[0, 0], [0.18, 0.14, 'sai'], [0.38, 0, 'entra']])(t);
    if (t > 0.36 && t < 0.48) p.sino.sy = 1 - 0.06 * sino01(t, 0.36, 0.12);
    const s = trilha([[0.2, 0.0001], [0.62, 1, 'volta'], [2.7, 1], [3.2, 0.0001, 'entra']])(t);
    const onda = t > 0.7 && t < 2.6 ? Math.sin((t - 0.7) * 2 * Math.PI * 1.3) : 0; const atraso = t > 0.78 ? Math.sin((t - 0.78) * 2 * Math.PI * 1.3) : 0;
    p.objetos.push({ id: id(), pos: [1.65, 1.0, 0.45], rot: [0, -10, -8 + onda * 24], esc: s * 0.85, pose: misturarMao(POSES.aberta, POSES.relaxada, 0.2 + 0.2 * atraso * (t < 2.6 ? 1 : 0)), dobra: [0, 0, -atraso * 9] });
    p.sino.rz += 3 * onda; p.boca = t > 0.3 ? 'canto' : 'neutra';
    if (t > 2.1 && t < 2.4) p.olhoE = mix(p.olhoE, 0.07, sino01(t, 2.1, 0.3));
    if (t > 0.8 && t < 1.6) p.hq.push({ tipo: 'texto', texto: 'OLÁ!', vida: (t - 0.8) / 0.8, em: [0.2, 1.55, 0.3], pequeno: true });
    return p;
  },
};

export const NOVAS = { N01, N02, N03, N04, N05, N06 };
