// Materiais do universo CK para objetos procedurais.
// Matcap gerado em canvas (sem luzes na cena, como o sino, que é todo MeshBasicMaterial):
//  hq      faixas chapadas de luz e sombra, brilho pequeno e sombra puxada para o roxo-tinta (quadrinho)
//  metal   a rampa de --metal do tokens.css aplicada à esfera (dourado forjado)
//  chapado cor sólida, idêntica ao tratamento do sino
// Luz: frontal | recorte (contraluz dourada) | quente (sombras avermelhadas do herói)

export const PALETA = {
  ouro: '#f5b70a', ouroClaro: '#ffdf7e', ouroEscuro: '#b97813', vermelho: '#c3161e', vermelhoEscuro: '#8c0d13',
  tinta: '#191418', tinta2: '#3a2f48', papel: '#fbf5e9', papel2: '#f3e7cf', branco: '#fffdf8', verde: '#6ea13e',
  verdeClaro: '#aae75a', prata: '#cfd8e6', aco: '#9fbde8', madeira: '#a8642a', kraft: '#d9a86a', laranja: '#ff9a2e',
  azul: '#1e4d8c', ciano: '#6fd8ff', roxo: '#2d2063',
};

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const METAL = [[0, '#fff8dc'], [0.3, '#ffe07f'], [0.5, '#f1ad0b'], [0.58, '#b97813'], [0.82, '#f6c43b'], [1, '#fff0b3']].map(([p, c]) => [p, hex(c)]);
function rampa(stops, k) {
  for (let i = 1; i < stops.length; i++) if (k <= stops[i][0]) { const [p0, c0] = stops[i - 1], [p1, c1] = stops[i]; return lerp3(c0, c1, (k - p0) / (p1 - p0)); }
  return stops[stops.length - 1][1];
}

/** Desenha um matcap 96×96 para a cor, o modo e a luz dados. */
export function desenharMatcap(cor, modo = 'hq', luz = 'frontal', tam = 96) {
  const cv = document.createElement('canvas'); cv.width = cv.height = tam;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(tam, tam); const d = img.data;
  const base = hex(PALETA[cor] ?? cor);
  const sombraTinta = luz === 'quente' ? [120, 20, 24] : luz === 'forja' ? [44, 22, 62] : [58, 34, 70];
  const L = luz === 'recorte' ? [-0.2, 0.35, 0.92] : [-0.45, 0.6, 0.66];
  const nl = Math.hypot(...L); const l = L.map((v) => v / nl);
  const ehMetal = modo === 'metal' || cor === 'ouro' && modo === 'hq-metal';
  const lum = (base[0] * 0.3 + base[1] * 0.59 + base[2] * 0.11) / 255;
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    let nx = (x + 0.5 - tam / 2) / (tam / 2), ny = -(y + 0.5 - tam / 2) / (tam / 2);
    let r2 = nx * nx + ny * ny; if (r2 > 1) { const r = Math.sqrt(r2); nx /= r; ny /= r; r2 = 1; }
    const nz = Math.sqrt(Math.max(0, 1 - r2));
    const lam = nx * l[0] + ny * l[1] + nz * l[2];
    let c;
    if (modo === 'chapado') c = base;
    else if (ehMetal) {
      // rampa de --metal pela altura da normal, tingida pela cor base quando não é ouro
      const k = Math.min(1, Math.max(0, 0.5 - ny * 0.48 + nx * 0.06));
      const m = rampa(METAL, k);
      c = cor === 'ouro' || cor === 'ouroClaro' ? m : lerp3(base, [m[0] * base[0] / 245, m[1] * base[1] / 183, m[2] * base[2] / 40].map((v) => Math.min(255, v)), 0.55);
      const esp = Math.pow(Math.max(0, lam), 28); c = lerp3(c, [255, 252, 235], esp * 0.9);
    } else {
      const faixa = lam > 0.62 ? 1 : lam > 0.18 ? 0.83 : 0.62;
      c = base.map((v) => v * (faixa === 1 ? 1.04 : faixa));
      c = lerp3(c, sombraTinta, (1 - faixa) * (0.55 - lum * 0.25));
      const h = nx * (l[0]) + ny * (l[1] + 0.25) + nz * l[2];
      if (h > 0.965) c = lerp3(c, [255, 251, 232], 0.75);
    }
    if (luz === 'recorte' && modo !== 'chapado') {
      const aro = Math.pow(1 - nz, 2.2) * Math.max(0, 0.4 + ny * 0.6 + nx * 0.2);
      c = lerp3(c, [255, 214, 106], Math.min(1, aro * 1.6));
    }
    if (luz === 'forja' && modo !== 'chapado') {
      // Forja Noturna: luz-chave quente de cima, contraluz dourado à direita e reflexo vinho embaixo (separa do fundo escuro)
      const aro = Math.pow(1 - nz, 2.4); const dir = Math.max(0, 0.25 + nx * 0.75 + ny * 0.35);
      c = lerp3(c, [255, 206, 96], Math.min(0.85, aro * dir * 1.7));
      const baixo = Math.max(0, -ny) * aro; c = lerp3(c, [150, 30, 52], Math.min(0.45, baixo * 0.9));
    }
    if (luz === 'quente' && modo !== 'chapado') {
      const aro = Math.pow(1 - nz, 2) * Math.max(0, -nx * 0.6 - ny * 0.2 + 0.3);
      c = lerp3(c, [255, 120, 46], Math.min(0.7, aro * 1.4));
    }
    const i = (y * tam + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Fábrica de materiais com cache, ligada ao THREE em uso. */
export function criarMateriais(THREE) {
  const cache = new Map();
  const texturas = new Map();
  function matcap(cor, modo, luz) {
    const k = `${cor}|${modo}|${luz}`;
    if (!texturas.has(k)) { const t = new THREE.CanvasTexture(desenharMatcap(cor, modo, luz)); t.colorSpace = THREE.SRGBColorSpace; texturas.set(k, t); }
    return texturas.get(k);
  }
  return {
    obter(cor, modo = 'hq', luz = 'frontal', { metalico = false } = {}) {
      const m = metalico && modo === 'hq' ? 'metal' : modo;
      const k = `${cor}|${m}|${luz}`;
      if (cache.has(k)) return cache.get(k);
      let mat;
      if (m === 'chapado') mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETA[cor] ?? cor) });
      else mat = new THREE.MeshMatcapMaterial({ matcap: matcap(cor, m, luz) });
      mat.toneMapped = false;
      cache.set(k, mat);
      return mat;
    },
    contorno(espessura = 0.022) {
      return new THREE.ShaderMaterial({
        uniforms: { espessura: { value: espessura }, cor: { value: new THREE.Color(PALETA.tinta) } },
        vertexShader: 'uniform float espessura; void main(){ vec3 p = position + normal * espessura; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
        fragmentShader: 'uniform vec3 cor; void main(){ gl_FragColor = vec4(cor, 1.0); }',
        side: THREE.BackSide,
      });
    },
    liberar() { for (const m of cache.values()) m.dispose(); for (const t of texturas.values()) t.dispose(); cache.clear(); texturas.clear(); },
  };
}

/** Textura de texto/desenho em canvas (rótulos, visores, recibos). */
export function texturaCanvas(THREE, w, h, desenhar) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); desenhar(ctx, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.redesenhar = (fn) => { ctx.clearRect(0, 0, w, h); fn(ctx, w, h); t.needsUpdate = true; };
  return t;
}
