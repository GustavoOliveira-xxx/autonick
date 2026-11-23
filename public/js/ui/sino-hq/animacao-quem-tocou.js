// Cena "Quem tocou?" (opção A, escolhida) do sino HQ do AutoniCK, com o laço da página de apresentação.
// As curvas, a pose neutra e a cena A são cópia literal da revisão aprovada (artefato "Sino HQ em cena", versão 2,
// arquivo js/sino-animacoes.js); só o laço no fim deste arquivo é novo.
// Módulo puro: não depende de Three.js nem do DOM, então roda também nos testes de unidade do Node.

/* ---------- curvas ---------- */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const CURVAS = {
  linear: (k) => k,
  entra: (k) => k * k * k,
  sai: (k) => 1 - Math.pow(1 - k, 3),
  suave: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  seno: (k) => (1 - Math.cos(Math.PI * k)) / 2, // pico de velocidade menor que o de 'suave': bom para giros longos
  volta: (k) => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  degrau: (k) => (k < 1 ? 0 : 1),
};

/**
 * Trilha de quadros-chave: [[tempo, valor, curva?], ...]. A curva vale para o trecho que termina naquela chave.
 * Valores podem ser números ou listas de números.
 */
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
/** Escolhe um estado discreto: [[desde, estado], ...]. */
const estados = (lista) => (t) => { let e = lista[0][1]; for (const [t0, v] of lista) if (t >= t0) e = v; return e; };
/** Oscilação amortecida que começa em t0 e termina exatamente em zero em t1. */
function oscila(t, t0, t1, amp, freq, tau, fim = 0.35) {
  if (t <= t0 || t >= t1) return 0;
  const u = t - t0; const janela = 1 - CURVAS.suave(clamp((t - (t1 - fim)) / fim));
  return amp * Math.exp(-u / tau) * Math.sin(2 * Math.PI * freq * u) * janela;
}

/** Pose de repouso: tudo neutro. A cena interpreta cada campo. */
export function poseNeutra() {
  return {
    sino: { rx: 0, ry: 0, rz: 0, sy: 1 },          // graus; sy = achatamento no pivô
    badalo: { rx: 0, rz: 0 },                      // graus, relativo ao sino
    testa: { ty: 0, rz: 0 },                       // deslocamento vertical e inclinação da testeira
    olhoE: 1, olhoD: 1,                            // escala vertical dos visores (1 = aberto)
    boca: 'neutra',                                // 'neutra' (carranca) | 'o' | 'canto'
    martelo: null,                                 // { desloc: [x,y,z], giro: graus } relativo à pose de contato
    fx: { estrela: 0, onda1: 0, onda2: 0, estrelaEm: null }, // escala das camadas FX; estrelaEm: 'visorD' leva a estrela ao visor
    hq: [],                                        // grafismos 2D: { tipo: 'toc' | 'velocidade' | 'impacto' | 'zzz' | 'exclama' | 'fiu', vida: 0..1 }
    camera: { az: 0, el: 4, dist: 1, alvoY: 0 },   // graus; dist multiplica o enquadramento
    painel: null,                                  // variante C: { corte: 0..1 } enquanto o quadro 2D aparece
  };
}

/* ======================================================================
   A · QUEM TOCOU?  (martelinho) · versão refinada, 8 s
   Desconfia → martelinho entra em arco e hesita → ensaio → sino relaxa cedo
   → recuo → TOC! → oscilação que morre aos poucos → martelo sai de fininho
   → sino olha para quem está vendo, pisca e segura o sorriso de canto.
   ====================================================================== */
/** Ponto numa curva de Bézier quadrática, com curva de tempo. */
function arco(t, t0, t1, p0, pc, p1, curva = 'suave') {
  const k = CURVAS[curva](clamp((t - t0) / (t1 - t0)));
  const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
  return p0.map((v, i) => a * v + b * pc[i] + c * p1[i]);
}
const A = {
  CONTATO: 4.36, PISCA: [6.2, 6.52], CANTO: 6.36,
  // sino: os olhos lideram, a cabeça vem depois; volta ao zero exato antes do contato
  ry: trilha([[0, 0], [0.75, 0], [1.55, 12, 'suave'], [2.3, 14, 'suave'], [2.95, 17, 'suave'], [3.38, 17], [3.98, 0, 'suave'], [4.95, 0], [5.45, -12, 'suave'], [5.68, -12], [6.16, 0, 'suave']]),
  rx: trilha([[0, 0], [5.75, 0], [6.15, -3, 'suave']]), // olha para a câmera (um pouco acima)
  rzAntes: trilha([[0, 0], [0.9, 0], [1.7, 2.5, 'suave'], [2.9, 3.2, 'suave'], [3.45, 3.2], [3.95, 0, 'suave']]),
  olhoD: trilha([[0, 1], [0.55, 1], [1.25, 0.62, 'suave'], [1.9, 0.62], [2.35, 0.5, 'suave'], [2.85, 0.45], [3.0, 0.3, 'sai'], [3.25, 0.5, 'suave'], [3.5, 0.55], [3.95, 1, 'suave'], [4.36, 1], [4.42, 1.28, 'sai'], [4.95, 1.22], [5.25, 0.86, 'suave'], [5.75, 0.86], [6.1, 1, 'suave'], [6.45, 0.86, 'suave']]),
  olhoE: trilha([[0, 1], [0.55, 1], [1.25, 1.08, 'suave'], [2.85, 1.1], [3.0, 0.75, 'sai'], [3.25, 1.08, 'suave'], [3.5, 1.08], [3.95, 1, 'suave'], [4.36, 1], [4.42, 1.28, 'sai'], [4.95, 1.22], [5.25, 0.86, 'suave'], [5.75, 0.86], [6.1, 1, 'suave'], [6.2, 1], [6.28, 0.07, 'entra'], [6.4, 0.07], [6.52, 1, 'sai']]),
  testaTy: trilha([[0, 0], [0.55, 0], [1.3, -0.012, 'suave'], [2.9, -0.014], [3.0, -0.02, 'sai'], [3.3, -0.012, 'suave'], [3.5, -0.012], [3.95, 0.006, 'suave'], [4.36, 0.006], [4.42, 0.055, 'sai'], [4.95, 0.045], [5.3, -0.008, 'suave'], [5.75, -0.008], [6.1, 0, 'suave'], [6.5, 0.018, 'suave']]),
  testaRz: trilha([[0, 0], [0.6, 0], [1.5, -5, 'suave'], [3.5, -5], [3.95, 0, 'suave'], [6.3, 0], [6.65, 4.5, 'suave']]),
  boca: estados([[0, 'neutra'], [4.38, 'o'], [5.1, 'neutra'], [6.36, 'canto']]),
  // martelo (deslocamento relativo à pose de contato, em unidades do modelo)
  pairar: [0.3, 0.12, 0.04],
  giro: trilha([[1.4, -70], [2.6, -40, 'suave'], [2.85, -46, 'suave'], [3.0, -16, 'suave'], [3.3, -42, 'suave'], [3.95, -40], [4.22, -68, 'suave'], [4.36, 0, 'entra'], [4.58, -26, 'sai'], [4.95, -22, 'suave'], [5.95, -30, 'suave']]),
  posHesita: trilha([[2.6, [0.3, 0.12, 0.04]], [2.85, [0.36, 0.16, 0.04], 'suave'], [3.0, [0.2, 0.06, 0.02], 'suave'], [3.3, [0.34, 0.14, 0.04], 'suave'], [3.95, [0.34, 0.14, 0.04]], [4.22, [0.44, 0.2, 0.05], 'suave'], [4.36, [0, 0, 0], 'entra'], [4.58, [0.08, 0.03, 0.02], 'sai'], [4.95, [0.08, 0.03, 0.02]]]),
};
function deslocMartelo(t) {
  if (t < 2.6) return arco(t, 1.4, 2.6, [2.3, 1.9, 0.35], [1.55, 1.55, 0.3], A.pairar);
  if (t < 4.95) {
    const p = A.posHesita(t);
    if (t > 2.6 && t < 3.95 && !(t > 2.8 && t < 3.35)) { // pairando: leve flutuação, some antes do ensaio e do recuo
      const j = Math.sin(Math.PI * clamp((t - 2.6) / 1.35));
      p[1] += 0.012 * Math.sin(2 * Math.PI * 1.3 * (t - 2.6)) * j;
    }
    return p;
  }
  // sai de fininho: arco de volta, com passinhos
  const p = arco(t, 4.95, 5.95, [0.08, 0.03, 0.02], [0.9, 0.25, 0.2], [2.3, 0.55, 0.35]);
  p[1] += 0.05 * Math.abs(Math.sin(Math.PI * 4 * clamp((t - 4.95) / 1.0)));
  return p;
}
function poseQuemTocou(t, reduzido) {
  const p = poseNeutra(); const c = A.CONTATO; const k = reduzido ? 0.4 : 1;
  p.sino.ry = A.ry(t) * k; p.sino.rx = A.rx(t);
  // oscilação do impacto: perde força aos poucos (a envoltória cai a ~3% antes da janela final)
  p.sino.rz = A.rzAntes(t) * k + oscila(t, c, c + 2.4, reduzido ? -3 : -9, 1.35, 0.62, 0.7);
  if (!reduzido && t >= c && t < c + 0.11) p.sino.sy = 1 - 0.045 * Math.sin(Math.PI * (t - c) / 0.11);
  p.badalo.rz = oscila(t, c + 0.09, c + 2.7, reduzido ? 8 : 24, 1.35, 0.7, 0.8); // reage um pouco depois do casco
  p.olhoE = A.olhoE(t); p.olhoD = A.olhoD(t);
  p.testa.ty = A.testaTy(t); p.testa.rz = A.testaRz(t);
  p.boca = A.boca(t);
  if (t >= 1.4 && t <= 5.95) {
    const balanço = t > 4.95 ? 4 * Math.sin(Math.PI * 4 * clamp((t - 4.95) / 1.0)) : 0;
    p.martelo = { desloc: deslocMartelo(t), giro: A.giro(t) + balanço };
  }
  if (t >= c) {
    const u = t - c;
    p.fx.estrela = u < 0.08 ? 1.25 : u < 0.22 ? 1.25 * (1 - (u - 0.08) / 0.14) : 0;
    if (!reduzido) {
      p.fx.onda1 = u < 0.5 ? 0.7 + 1.65 * CURVAS.sai(u / 0.5) : 0;
      p.fx.onda2 = u >= 0.12 && u < 0.62 ? 0.7 + 1.65 * CURVAS.sai((u - 0.12) / 0.5) : 0;
    }
    if (u < 0.6) p.hq.push({ tipo: 'toc', vida: u / 0.6 });
    if (!reduzido && u < 0.085) p.hq.push({ tipo: 'impacto', vida: u / 0.085 });
  }
  if (!reduzido && t >= 4.25 && t < c) p.hq.push({ tipo: 'velocidade', vida: (t - 4.25) / 0.11 });
  p.camera.dist = trilha([[5.7, 1], [6.3, 0.9, 'suave']])(t);
  p.camera.alvoY = trilha([[5.6, -0.14], [6.2, 0, 'suave']])(t); // espaço para o cabo do martelo; depois foca o rosto
  return p;
}

/* ======================================================================
   LAÇO DA PÁGINA DE APRESENTAÇÃO
   cena (8 s) → pausa na pose final (3,5 s) → volta suave à pose inicial (1 s) → recomeça.
   No fim do retorno a pose é exatamente a pose inicial da cena: o recomeço não tem salto.
   ====================================================================== */
export const QUEM_TOCOU = Object.freeze({
  dur: 8.0,
  contato: A.CONTATO,
  // mesmo enquadramento da opção A no artefato: espaço à direita para o martelinho
  enquadramento: Object.freeze({ meiaAltura: 1.62, meiaLargura: 2.05, deslocX: 0.35 }),
  pose: poseQuemTocou,
});
export const LACO = Object.freeze({ cena: QUEM_TOCOU.dur, pausaFinal: 3.5, retorno: 1.0 });
export const DURACAO_CICLO = LACO.cena + LACO.pausaFinal + LACO.retorno;

const misturar = (a, b, k) => a + (b - a) * k;
/** Mistura duas poses numéricas (sem martelo, sem efeitos). A boca troca no início do retorno. */
export function misturarPoses(de, para, k, bocaFinal) {
  const p = poseNeutra();
  for (const grupo of ['sino', 'badalo', 'testa', 'camera']) for (const c in p[grupo]) p[grupo][c] = misturar(de[grupo][c], para[grupo][c], k);
  p.olhoE = misturar(de.olhoE, para.olhoE, k); p.olhoD = misturar(de.olhoD, para.olhoD, k);
  p.boca = bocaFinal;
  return p;
}

/**
 * Pose num instante do laço (t em segundos, qualquer valor ≥ 0; o laço se repete a cada DURACAO_CICLO).
 * Com `soUmaVez`, a cena para na pose final em vez de voltar (uso manual com movimento reduzido).
 */
export function poseDoLaco(t, { reduzido = false, soUmaVez = false } = {}) {
  const u = soUmaVez ? Math.min(t, LACO.cena + LACO.pausaFinal) : ((t % DURACAO_CICLO) + DURACAO_CICLO) % DURACAO_CICLO;
  if (u <= LACO.cena) return poseQuemTocou(u, reduzido);
  const final = poseQuemTocou(LACO.cena, reduzido);
  if (u <= LACO.cena + LACO.pausaFinal) return final;
  // retorno: o sino desfaz o sorriso de canto, volta à cara de durão e a câmera recua até o enquadramento inicial
  const k = CURVAS.suave(clamp((u - LACO.cena - LACO.pausaFinal) / LACO.retorno));
  return misturarPoses(final, poseQuemTocou(0, reduzido), k, k < 0.18 ? final.boca : 'neutra');
}
