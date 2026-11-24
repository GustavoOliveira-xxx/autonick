// Curvas, trilhas e poses do sino. Base copiada de public/js/ui/sino-hq/animacao-quem-tocou.js
// (trilha, estados, oscila, arco e a pose neutra), com campos extras para as novas propostas:
// deslocamento e escala do sino, brilho dos visores, objetos 3D e grafismos de HQ com texto.
// Módulo puro: não depende de Three.js nem do DOM.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const mix = (a, b, k) => a + (b - a) * k;
export const G = Math.PI / 180;
/** Preferência de movimento em vigor para a vista que está sendo calculada (o motor ajusta antes de cada quadro). */
export const AMBIENTE = { reduzido: false };

export const CURVAS = {
  linear: (k) => k,
  entra: (k) => k * k * k,
  sai: (k) => 1 - Math.pow(1 - k, 3),
  suave: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  seno: (k) => (1 - Math.cos(Math.PI * k)) / 2,
  volta: (k) => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  elastico: (k) => (k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  quica: (k) => {
    const n = 7.5625, d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
  degrau: (k) => (k < 1 ? 0 : 1),
};

/** Trilha de quadros-chave: [[tempo, valor, curva?], ...]. Valores numéricos ou listas. */
export function trilha(chaves) {
  return (t) => {
    if (t <= chaves[0][0]) return chaves[0][1];
    for (let i = 1; i < chaves.length; i++) {
      const [t1, v1, c = 'suave'] = chaves[i];
      if (t <= t1) {
        const [t0, v0] = chaves[i - 1];
        const k = CURVAS[c](clamp((t - t0) / (t1 - t0 || 1)));
        return Array.isArray(v0) ? v0.map((a, j) => a + (v1[j] - a) * k) : v0 + (v1 - v0) * k;
      }
    }
    return chaves[chaves.length - 1][1];
  };
}
/** Estado discreto: [[desde, estado], ...]. */
export const estados = (lista) => (t) => { let e = lista[0][1]; for (const [t0, v] of lista) if (t >= t0) e = v; return e; };

/** Oscilação amortecida que começa em t0 e termina exatamente em zero em t1. */
export function oscila(t, t0, t1, amp, freq, tau, fim = 0.35) {
  if (t <= t0 || t >= t1) return 0;
  const u = t - t0; const janela = 1 - CURVAS.suave(clamp((t - (t1 - fim)) / fim));
  return amp * Math.exp(-u / tau) * Math.sin(2 * Math.PI * freq * u) * janela;
}
/** Ponto numa Bézier quadrática com curva de tempo. */
export function arco(t, t0, t1, p0, pc, p1, curva = 'suave') {
  const k = CURVAS[curva](clamp((t - t0) / (t1 - t0)));
  const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
  return p0.map((v, i) => a * v + b * pc[i] + c * p1[i]);
}
/** 0 → 1 → 0 entre t0 e t0+dur (seno). */
export const sino01 = (t, t0, dur) => (t < t0 || t > t0 + dur ? 0 : Math.sin(Math.PI * (t - t0) / dur));
/** Gerador pseudoaleatório determinístico (mesma sequência a cada execução). */
export function semente(n) { let s = (n * 9301 + 49297) % 233280; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

/** Pose de repouso. Campos novos em relação ao app: sino.tx/ty/tz/esc, visor, bochecha, objetos, impacto. */
export function poseNeutra() {
  return {
    sino: { rx: 0, ry: 0, rz: 0, sy: 1, tx: 0, ty: 0, tz: 0, esc: 1 },
    badalo: { rx: 0, rz: 0 },
    testa: { ty: 0, rz: 0 },
    olhoE: 1, olhoD: 1,
    boca: 'neutra',
    martelo: null,
    fx: { estrela: 0, onda1: 0, onda2: 0 },
    visor: 0,            // 0..1: brilho extra dos visores verdes
    hq: [],              // grafismos 2D: { tipo, vida, texto?, em?, dir? }
    camera: { az: 0, el: 4, dist: 1, alvoY: 0, alvoX: 0 },
    objetos: [],         // [{ id, pos:[x,y,z], rot:[x,y,z] (graus), esc, ...parametros do objeto }]
    impacto: 0,          // 0..1: pulso para o fundo reagir
    clipe: null,         // { t } para tocar o clipe embutido no GLB
  };
}

const CAMPOS_GRUPO = ['sino', 'badalo', 'testa', 'camera'];
/** Mistura duas poses numéricas (sem objetos nem grafismos). */
export function misturarPoses(de, para, k, boca) {
  const p = poseNeutra();
  for (const g of CAMPOS_GRUPO) for (const c in p[g]) p[g][c] = mix(de[g][c] ?? p[g][c], para[g][c] ?? p[g][c], k);
  p.olhoE = mix(de.olhoE, para.olhoE, k); p.olhoD = mix(de.olhoD, para.olhoD, k);
  p.visor = mix(de.visor, para.visor, k);
  p.boca = boca ?? (k < 0.18 ? de.boca : para.boca);
  return p;
}

/**
 * Reação do sino a um golpe em tc (usada por várias propostas).
 * forca 0..1.4 · lado +1 (golpe pela direita) ou -1 · texto da onomatopeia · alvo 'aro' | 'topo'.
 */
export function reagirGolpe(p, t, tc, { forca = 1, lado = 1, texto = 'TOC!', alvo = 'aro', reduzido = AMBIENTE.reduzido, olhos = true, boca = true, ondas = true } = {}) {
  if (t < tc) return p;
  const u = t - tc; const f = reduzido ? forca * 0.35 : forca;
  p.sino.rz += oscila(t, tc, tc + 2.4, -9 * f * lado, 1.35, 0.62, 0.7);
  if (!reduzido && u < 0.11) p.sino.sy *= 1 - 0.045 * f * Math.sin(Math.PI * u / 0.11);
  p.badalo.rz += oscila(t, tc + 0.09, tc + 2.7, 24 * f * lado, 1.35, 0.7, 0.8);
  if (olhos && u < 0.7) { const k = u < 0.06 ? u / 0.06 : 1 - clamp((u - 0.3) / 0.4); p.olhoE = mix(p.olhoE, 1.28, k); p.olhoD = mix(p.olhoD, 1.28, k); p.testa.ty += 0.05 * k; }
  if (boca && u < 0.72) p.boca = 'o';
  const est = u < 0.08 ? 1.25 : u < 0.22 ? 1.25 * (1 - (u - 0.08) / 0.14) : 0;
  if (alvo === 'aro') p.fx.estrela = Math.max(p.fx.estrela, est * Math.min(1, f));
  if (ondas && !reduzido) {
    p.fx.onda1 = Math.max(p.fx.onda1, u < 0.5 ? 0.7 + 1.65 * CURVAS.sai(u / 0.5) : 0);
    p.fx.onda2 = Math.max(p.fx.onda2, u >= 0.12 && u < 0.62 ? 0.7 + 1.65 * CURVAS.sai((u - 0.12) / 0.5) : 0);
  }
  if (texto && u < 0.6) p.hq.push({ tipo: 'texto', texto, vida: u / 0.6, em: alvo });
  if (!reduzido && u < 0.085) p.hq.push({ tipo: 'impacto', vida: u / 0.085, em: alvo });
  p.impacto = Math.max(p.impacto, u < 0.5 ? 1 - u / 0.5 : 0) * Math.min(1, f);
  return p;
}
