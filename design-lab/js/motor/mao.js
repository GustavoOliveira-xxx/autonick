// Mãozinha de desenho animado do AutoniCK (procedural, Three.js puro, sem modelo externo).
//
// Construção pensada para ler bem em tamanho pequeno e ter personalidade:
//  · palma em superelipsoide (macia, com o dorso abaulado e afinando para o pulso);
//  · três dedos gordinhos + polegar (a convenção clássica de desenho animado), cada dedo com três falanges
//    em "salsicha" (perfil torneado com pontas arredondadas e a ponta levemente bulbosa);
//  · três costuras em relevo no dorso, assentadas na superfície da palma por raio;
//  · punho em sino com aba enrolada e um botão CK.
// Rig: curvatura por dedo (3 juntas com pesos diferentes), abertura entre dedos, polegar com curvatura,
// abdução e oposição, dobra do pulso e "estica" (squash & stretch preservando volume).
// Variações de acabamento: luva clássica marfim, manopla dourada CK e luva vinho.

import { clamp, mix, CURVAS, trilha, oscila, sino01, reagirGolpe, G } from './curvas.js';
import { OBJETOS } from './objetos.js';

const VARIANTES = {
  luva: { mao: '#fbf3e2', costura: '#e2cfa8', punho: 'ouro', aba: 'ouro', botao: 'vermelho', metal: false, punhoMetal: true },
  manopla: { mao: 'ouro', costura: '#b97813', punho: 'vermelho', aba: 'ouro', botao: 'vermelho', metal: true, punhoMetal: false },
  vinho: { mao: '#7c1b30', costura: '#4a0f1f', punho: 'ouro', aba: 'ouroClaro', botao: 'ouro', metal: false, punhoMetal: true },
};

/* ---------------- geometria ---------------- */
function palmaGeo(THREE) {
  const g = new THREE.SphereGeometry(1, 64, 44); const p = g.attributes.position;
  const sup = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = sup(x, 0.74), Y = sup(y, 0.8), Z = sup(z, 0.88);
    const afina = 1 + 0.13 * Y;                               // mais larga nos nós dos dedos, mais fina no pulso
    X *= 0.3 * afina; Y *= 0.275; Z *= Z > 0 ? 0.165 : 0.125;   // dorso mais abaulado que a palma
    Z += 0.035 * (1 - X * X * 9) * (Z > 0 ? 1 : 0.4);            // leve "almofada" no centro
    p.setXYZ(i, X, Y + 0.02, Z);
  }
  g.computeVertexNormals(); return g;
}
/** Falange torneada: base de raio r0, topo r1, comprimento L, pontas arredondadas (ponta bulbosa se `ponta`). */
function falangeGeo(THREE, L, r0, r1, ponta = false) {
  const pts = []; const n = 10;
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
  const rt = ponta ? r1 * 1.1 : r1;
  for (let i = 1; i <= 6; i++) { const k = i / 7; const bojo = ponta ? Math.sin(Math.PI * k) * 0.012 : Math.sin(Math.PI * k) * 0.006; pts.push(new THREE.Vector2(mix(r0, rt, k) + bojo, L * k)); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * rt, L + Math.sin(a) * rt * (ponta ? 1.05 : 1))); }
  pts[pts.length - 1].x = 0.0001;
  const g = new THREE.LatheGeometry(pts, 28); g.computeVertexNormals(); return g;
}
function punhoGeo(THREE) {
  const perfil = [[0.0001, -0.47], [0.232, -0.47], [0.246, -0.43], [0.24, -0.355], [0.222, -0.285], [0.205, -0.225], [0.196, -0.17], [0.0001, -0.15]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(perfil, 40); g.computeVertexNormals(); return g;
}

/* ---------------- poses ---------------- */
// i, m, a: curvatura (0 reto … 1 fechado) do indicador, médio e anelar · ab: abertura entre dedos
// pc: curvatura do polegar · pa: abdução do polegar (0 colado … 1 aberto) · po: oposição (polegar à frente da palma)
export const POSES = {
  aberta:   { i: 0.04, m: 0.03, a: 0.06, ab: 0.75, pc: 0.05, pa: 0.95, po: 0.05 },
  relaxada: { i: 0.22, m: 0.3, a: 0.4, ab: 0.25, pc: 0.25, pa: 0.55, po: 0.15 },
  aponta:   { i: 0.0, m: 1, a: 1, ab: 0.05, pc: 0.72, pa: 0.3, po: 0.65 },
  joinha:   { i: 1, m: 1, a: 1, ab: 0, pc: 0, pa: 1.45, po: -0.1 },
  ok:       { i: 0.66, m: 0.08, a: 0.14, ab: 0.55, pc: 0.55, pa: 0.5, po: 0.95 },
  punho:    { i: 1, m: 1, a: 1, ab: 0, pc: 0.62, pa: 0.28, po: 0.72 },
  paz:      { i: 0, m: 0, a: 1, ab: 1, pc: 0.75, pa: 0.3, po: 0.7 },
  um:       { i: 0, m: 1, a: 1, ab: 0, pc: 0.75, pa: 0.3, po: 0.7 },
  dois:     { i: 0, m: 0, a: 1, ab: 0.55, pc: 0.75, pa: 0.3, po: 0.7 },
  tres:     { i: 0, m: 0, a: 0, ab: 0.6, pc: 0.8, pa: 0.25, po: 0.75 },
  estalo:   { i: 0.15, m: 0.5, a: 0.75, ab: 0.2, pc: 0.5, pa: 0.4, po: 0.95 },
  estalou:  { i: 0.2, m: 1, a: 0.85, ab: 0.2, pc: 0.05, pa: 0.85, po: 0.2 },
  garra:    { i: 0.5, m: 0.5, a: 0.55, ab: 0.5, pc: 0.45, pa: 0.6, po: 0.5 },
  peteleco: { i: 0.1, m: 0.92, a: 0.6, ab: 0.15, pc: 0.62, pa: 0.4, po: 0.9 },
};
export const misturarMao = (a, b, k) => Object.fromEntries(Object.keys(a).map((c) => [c, mix(a[c], b[c] ?? a[c], k)]));
/** Trilha de poses: [[t, 'nome' | {pose}, curva?], ...] → pose no tempo t (com sobressalto se a curva for 'volta'). */
export function trilhaPoses(chaves) {
  const ps = chaves.map(([t, p, c]) => [t, typeof p === 'string' ? POSES[p] : p, c]);
  return (t) => {
    if (t <= ps[0][0]) return { ...ps[0][1] };
    for (let i = 1; i < ps.length; i++) if (t <= ps[i][0]) { const [t0, p0] = ps[i - 1]; const [t1, p1, c = 'suave'] = ps[i]; return misturarMao(p0, p1, CURVAS[c](clamp((t - t0) / (t1 - t0 || 1)))); }
    return { ...ps[ps.length - 1][1] };
  };
}

/* ---------------- objeto da biblioteca ---------------- */
function criarDefinicao(variante) {
  const V = VARIANTES[variante];
  return {
    pouso: [2.15, 0.45, 0.6], escala: 1.35, variante,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const estica = new THREE.Group(); const pulso = new THREE.Group(); raiz.add(estica); estica.add(pulso);
      const mat = (geo, cor, op = {}) => f.malha(geo, cor, { metalico: op.metal ?? (cor === V.mao ? V.metal : cor === V.punho ? V.punhoMetal : cor === 'ouro' || cor === 'ouroClaro'), espessura: op.espessura ?? 0.016, contorno: op.contorno ?? true });

      // palma e costuras no dorso
      const palma = mat(palmaGeo(THREE), V.mao, { espessura: 0.018 }); pulso.add(palma);
      palma.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(); const naSuperficie = (x, y) => { ray.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)); const h = ray.intersectObject(palma, false)[0]; return h ? h.point.add(h.face.normal.clone().multiplyScalar(0.006)) : new THREE.Vector3(x, y, 0.16); };
      const y0 = variante === 'manopla' ? 0.06 : -0.12;
      for (const x of [-0.1, 0, 0.1]) {
        const curva = new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map((k) => naSuperficie(x * (1 + 0.12 * k), mix(y0, 0.2, k))));
        const costura = f.malha(new THREE.TubeGeometry(curva, 24, 0.0105, 8, false), V.costura, { contorno: false, metalico: V.metal }); costura.userData.semCaixa = true; pulso.add(costura);
      }
      if (variante === 'manopla') {
        const gema = f.malha(new THREE.SphereGeometry(0.072, 24, 16), 'vermelho', { espessura: 0.012 }); gema.scale.set(1, 1, 0.55); gema.position.copy(naSuperficie(0, -0.06)); pulso.add(gema);
        const aro = f.malha(new THREE.TorusGeometry(0.075, 0.018, 10, 28), 'ouroClaro', { metalico: true, contorno: false }); aro.position.copy(gema.position); aro.lookAt(gema.position.clone().add(new THREE.Vector3(0, 0.12, 1))); pulso.add(aro);
      }

      // dedos: indicador (lado do polegar), médio e anelar
      const DEDOS = [{ x: -0.172, y: 0.27, L: [0.15, 0.12, 0.11], r: 0.078, inc: 0.07 }, { x: 0, y: 0.305, L: [0.165, 0.13, 0.12], r: 0.082, inc: 0 }, { x: 0.172, y: 0.27, L: [0.145, 0.115, 0.105], r: 0.076, inc: -0.08 }];
      const dedos = DEDOS.map((d) => {
        const base = new THREE.Group(); base.position.set(d.x, d.y, 0.005); base.rotation.z = d.inc; pulso.add(base);
        const juntas = []; let pai = base;
        d.L.forEach((L, k) => {
          const j = new THREE.Group(); if (k > 0) j.position.y = d.L[k - 1]; pai.add(j);
          const r0 = d.r * (1 - k * 0.06), r1 = d.r * (1 - (k + 1) * 0.06);
          j.add(mat(falangeGeo(THREE, L, r0, r1, k === 2), V.mao));
          juntas.push(j); pai = j;
        });
        return { base, juntas, inc: d.inc };
      });
      // polegar: base presa na lateral da palma, duas falanges
      const polBase = new THREE.Group(); polBase.position.set(-0.25, -0.06, -0.02); pulso.add(polBase);
      const polOrient = new THREE.Group(); polBase.add(polOrient);
      const pol1 = new THREE.Group(); polOrient.add(pol1); pol1.add(mat(falangeGeo(THREE, 0.14, 0.088, 0.082), V.mao));
      const pol2 = new THREE.Group(); pol2.position.y = 0.14; pol1.add(pol2); pol2.add(mat(falangeGeo(THREE, 0.12, 0.082, 0.076, true), V.mao));

      // punho em sino, aba enrolada e botão CK
      const punho = mat(punhoGeo(THREE), V.punho, { espessura: 0.018 }); pulso.add(punho);
      const aba = f.malha(new THREE.TorusGeometry(0.24, 0.04, 14, 48), V.aba, { metalico: true, espessura: 0.014 }); aba.rotation.x = Math.PI / 2; aba.position.y = -0.455; pulso.add(aba);
      const friso = f.malha(new THREE.TorusGeometry(0.2, 0.018, 10, 40), V.aba, { metalico: true, contorno: false }); friso.rotation.x = Math.PI / 2; friso.position.y = -0.19; pulso.add(friso);
      const botao = f.malha(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 24), V.botao, { metalico: V.botao === 'ouro', espessura: 0.01 }); botao.rotation.x = Math.PI / 2; botao.position.set(0, -0.34, 0.236); pulso.add(botao);
      return { raiz, partes: { estica, pulso, dedos, polBase, polOrient, pol1, pol2 } };
    },
    aplicar(p, e) {
      const P = { ...POSES.relaxada, ...(typeof e.pose === 'string' ? POSES[e.pose] : e.pose) };
      const pesos = [1.0, 1.32, 0.92];
      const curl = [P.i, P.m, P.a];
      p.dedos.forEach((d, k) => {
        d.base.rotation.z = d.inc + (k === 0 ? 1 : k === 2 ? -1 : 0) * P.ab * 0.17;
        d.juntas.forEach((j, n) => { j.rotation.x = -curl[k] * pesos[n] * (k === 0 && e.estaloIndicador ? 0.6 : 1) * (n === 0 ? 1.05 : 1.12); });
      });
      // polegar: abdução abre para o lado, oposição traz para a frente da palma, curvatura dobra as falanges
      p.polOrient.rotation.set(-0.15 - P.po * 0.95, -P.po * 0.55, 0.25 + P.pa * 0.85);
      p.pol1.rotation.x = -P.pc * 0.55; p.pol2.rotation.x = -P.pc * 1.1;
      p.pulso.rotation.set((e.dobra?.[0] ?? 0) * G, (e.dobra?.[1] ?? 0) * G, (e.dobra?.[2] ?? 0) * G);
      const s = e.estica ?? 1; p.estica.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    },
    dur: { entrada: 0.55, ocioso: 2.4, interacao: 2.2, saida: 0.45 },
    entrada(t) { const k = clamp(t / 0.55); return { pos: [this.pouso[0] + 1.4 * (1 - CURVAS.volta(k)), this.pouso[1] - 0.6 * (1 - CURVAS.sai(k)), this.pouso[2]], rot: [0, -20, 70 - 30 * (1 - k)], esc: 1, pose: misturarMao(POSES.punho, POSES.aberta, CURVAS.volta(k)), estica: 1 + 0.15 * sino01(t, 0, 0.4) }; },
    ocioso(t) { return { pos: [this.pouso[0], this.pouso[1] + 0.03 * Math.sin(t * 2.4), this.pouso[2]], rot: [0, -20, 70 + 5 * Math.sin(t * 1.9)], esc: 1, pose: misturarMao(POSES.relaxada, POSES.aberta, 0.5 + 0.5 * Math.sin(t * 1.3)) }; },
    interacao(t, p) {
      // peteleco: recua, arma o médio atrás do polegar, solta no aro e comemora com joinha
      const pos = trilha([[0, this.pouso], [0.45, [2.45, 0.55, 0.62], 'sai'], [0.62, [1.62, 0.22, 0.6], 'entra'], [0.9, [1.85, 0.3, 0.6], 'sai'], [1.5, this.pouso, 'suave']])(t);
      const pose = trilhaPoses([[0, 'relaxada'], [0.4, 'peteleco', 'volta'], [0.6, 'peteleco'], [0.66, 'estalou', 'sai'], [1.1, 'relaxada', 'suave'], [1.4, 'joinha', 'volta'], [2.2, 'joinha']])(t);
      reagirGolpe(p, t, 0.64, { forca: 0.9, lado: 1, texto: 'PLIM!' });
      if (t > 0.5 && t < 0.64) p.hq.push({ tipo: 'velocidade', vida: (t - 0.5) / 0.14, em: [1.9, 0.3, 0.6], dir: 'esquerda' });
      if (t > 1.45 && t < 2.0) p.hq.push({ tipo: 'brilho', vida: (t - 1.45) / 0.55, em: [2.05, 0.9, 0.6] });
      return { pos, rot: [0, -20, t < 1.3 ? 70 : mix(70, -90, CURVAS.volta(clamp((t - 1.3) / 0.35)))], esc: 1, pose, estica: 1 + 0.18 * sino01(t, 0.56, 0.14) };
    },
    saida(t) { const k = clamp(t / 0.45); return { pos: [this.pouso[0] + 1.8 * CURVAS.entra(k), this.pouso[1], this.pouso[2]], rot: [0, -20, -90], esc: 1, pose: 'joinha' }; },
  };
}
for (const v of Object.keys(VARIANTES)) OBJETOS[`mao_${v}`] = criarDefinicao(v);
export const VARIANTES_MAO = { luva: 'Luva clássica', manopla: 'Manopla dourada CK', vinho: 'Luva vinho' };

/* ---------------- gestos (estúdio da mão) ----------------
   Cada gesto devolve o estado completo do objeto no tempo t (laço), com antecipação, ação, sobressalto e
   assentamento. Movimento secundário: os dedos atrasam um pouco em relação ao pulso. */
const base = (extra) => ({ pos: [0, 0.05, 0], rot: [0, 0, 0], esc: 1, ...extra });
export const GESTOS = {
  aceno: { nome: 'Aceno', dur: 2.4, quadro(t) {
    const amp = 22 * (1 - 0.25 * Math.sin(t * Math.PI / 2.4)); const onda = Math.sin(t * 2 * Math.PI * 1.25);
    const atraso = Math.sin((t - 0.09) * 2 * Math.PI * 1.25);
    return base({ rot: [0, 10, onda * amp], pos: [0, 0.05 + 0.02 * Math.abs(onda), 0], pose: misturarMao(POSES.aberta, POSES.relaxada, 0.25 + 0.2 * atraso), dobra: [0, 0, -atraso * 8] });
  } },
  joinha: { nome: 'Joinha', dur: 2.2, quadro(t) {
    const pose = trilhaPoses([[0, 'relaxada'], [0.35, 'punho', 'sai'], [0.55, 'punho'], [0.78, 'joinha', 'volta'], [2.2, 'joinha']])(t);
    const z = trilha([[0, 0], [0.35, -12, 'sai'], [0.6, 8, 'sai'], [0.9, 0, 'volta']])(t);
    const brilho = sino01(t, 0.8, 0.6);
    return base({ pose, rot: [0, -50 * CURVAS.suave(clamp((t - 0.3) / 0.35)), -90 * CURVAS.suave(clamp((t - 0.3) / 0.35)) + z], estica: 1 - 0.08 * sino01(t, 0.4, 0.2) + 0.1 * sino01(t, 0.7, 0.25), pos: [0, 0.05 + 0.06 * sino01(t, 0.7, 0.3), 0], hq: brilho > 0 ? [{ tipo: 'brilho', vida: (t - 0.8) / 0.6, em: [-0.3, 0.75, 0.2] }] : [] });
  } },
  aponta: { nome: 'Apontar', dur: 2.2, quadro(t) {
    const pose = trilhaPoses([[0, 'relaxada'], [0.3, 'aponta', 'volta'], [2.2, 'aponta']])(t);
    const avanco = 0.12 * (sino01(t, 0.6, 0.28) + sino01(t, 1.0, 0.28));
    return base({ pose, rot: [0, -20, 90 + 6 * Math.sin(t * 3)], pos: [-avanco, 0.05, 0], estica: 1 + 0.12 * (sino01(t, 0.6, 0.2) + sino01(t, 1.0, 0.2)) });
  } },
  estalo: { nome: 'Estalar os dedos', dur: 2.2, quadro(t) {
    const pose = trilhaPoses([[0, 'relaxada'], [0.45, 'estalo', 'suave'], [0.75, 'estalo'], [0.81, 'estalou', 'sai'], [1.5, 'estalou'], [2.1, 'relaxada', 'suave']])(t);
    const tre = t > 0.6 && t < 0.78 ? Math.sin(t * 90) * 1.5 : 0;
    const hq = t > 0.8 && t < 1.3 ? [{ tipo: 'texto', texto: 'ESTALO!', vida: (t - 0.8) / 0.5, em: [0.15, 0.95, 0.2] }, { tipo: 'impacto', vida: (t - 0.8) / 0.1, em: [0, 0.45, 0.2] }] : [];
    return base({ pose, rot: [0, -25, 12 + tre - 10 * sino01(t, 0.8, 0.3)], estica: 1 + 0.1 * sino01(t, 0.8, 0.16), hq });
  } },
  contar: { nome: 'Contar 1, 2, 3', dur: 3.0, quadro(t) {
    const pose = trilhaPoses([[0, 'punho'], [0.3, 'um', 'volta'], [0.9, 'um'], [1.15, 'dois', 'volta'], [1.75, 'dois'], [2.0, 'tres', 'volta'], [2.7, 'tres'], [3.0, 'punho', 'suave']])(t);
    const pulo = 0.05 * (sino01(t, 0.2, 0.25) + sino01(t, 1.05, 0.25) + sino01(t, 1.9, 0.25));
    const n = t < 1.05 ? '1' : t < 1.9 ? '2' : '3';
    return base({ pose, pos: [0, 0.05 + pulo, 0], rot: [0, -8, 0], hq: t > 0.25 && t < 2.7 ? [{ tipo: 'texto', texto: n, vida: ((t - 0.25) % 0.85) / 0.85, em: [0.45, 0.85, 0.2] }] : [] });
  } },
  apertar: { nome: 'Apertar botão', dur: 2.0, quadro(t) {
    const pose = trilhaPoses([[0, 'relaxada'], [0.3, 'aponta', 'volta'], [2.0, 'aponta']])(t);
    const z = trilha([[0, 0.2], [0.5, 0.35, 'sai'], [0.7, -0.15, 'entra'], [0.82, -0.1, 'sai'], [1.3, 0.2, 'suave']])(t);
    return base({ pose, rot: [-60, 0, 0], pos: [0, 0.05, z], estica: t > 0.68 && t < 0.86 ? 0.86 : 1, hq: t > 0.7 && t < 1.1 ? [{ tipo: 'texto', texto: 'CLIQUE!', vida: (t - 0.7) / 0.4, em: [0.25, 0.7, 0.2] }] : [] });
  } },
  ok: { nome: 'Tudo certo (OK)', dur: 2.2, quadro(t) {
    const pose = trilhaPoses([[0, 'relaxada'], [0.4, 'ok', 'volta'], [2.2, 'ok']])(t);
    return base({ pose, rot: [0, -15, 8 * Math.sin(t * 2.2)], hq: t > 0.5 && t < 1.2 ? [{ tipo: 'estrelas', vida: (t - 0.5) / 0.7, em: [-0.15, 0.55, 0.2] }] : [] });
  } },
  soco: { nome: 'Soco de comemoração', dur: 2.0, quadro(t) {
    const pose = trilhaPoses([[0, 'relaxada'], [0.25, 'punho', 'sai'], [2.0, 'punho']])(t);
    const y = trilha([[0, 0.05], [0.35, -0.12, 'sai'], [0.55, 0.38, 'entra'], [0.7, 0.32, 'sai'], [1.4, 0.05, 'suave']])(t);
    return base({ pose, pos: [0, y, 0], rot: [0, -10, -6], estica: 1 + 0.22 * sino01(t, 0.38, 0.2) - 0.08 * sino01(t, 0.15, 0.2), hq: t > 0.42 && t < 0.62 ? [{ tipo: 'velocidade', vida: (t - 0.42) / 0.2, em: [0, -0.2, 0.2], dir: 'cima' }] : t > 0.55 && t < 1.0 ? [{ tipo: 'texto', texto: 'ISSO!', vida: (t - 0.55) / 0.45, em: [0.2, 0.95, 0.2] }] : [] });
  } },
  pegar: { nome: 'Pegar', dur: 2.0, quadro(t) {
    const pose = trilhaPoses([[0, 'aberta'], [0.4, 'aberta'], [0.62, 'garra', 'sai'], [0.8, 'punho', 'sai'], [1.5, 'punho'], [1.9, 'aberta', 'volta']])(t);
    return base({ pose, rot: [20, -10, 0], pos: [0, 0.05 - 0.06 * sino01(t, 0.4, 0.4), 0] });
  } },
  aberta: { nome: 'Parada (poses)', dur: 1, quadro() { return base({ pose: 'aberta' }); } },
};
export const ENQ_MAO = Object.freeze({ meiaAltura: 0.95, meiaLargura: 0.95, deslocX: 0, deslocY: 0 });
