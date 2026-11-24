// Motor 3D do laboratório: UM renderizador WebGL para todas as vitrines.
// Cada vitrine tem um canvas 2D; o motor desenha a cena no renderizador compartilhado e copia o quadro.
// Só desenha vitrines visíveis; só avança as que estão tocando; para com a aba oculta.
// Lê o rig do GLB do app (mesmos nós de public/js/ui/sino-hq/palco-sino.js) e acrescenta objetos procedurais.

import { G, clamp, AMBIENTE } from './curvas.js';
import { criarMateriais } from './materiais.js';
import { criarBiblioteca } from './objetos.js';

const URL_THREE = new URL('../../public/vendor/three/three.module.min.js', import.meta.url).href;
const URL_GLTF = new URL('../../public/vendor/three/addons/loaders/GLTFLoader.js', import.meta.url).href;
const URL_UTILS = new URL('../../public/vendor/three/addons/utils/BufferGeometryUtils.js', import.meta.url).href;
export const URL_MODELO = new URL('../../public/assets/sino/autonick-sino-hq.glb', import.meta.url).href;
export const URL_POSTER = new URL('../../public/assets/sino/autonick-sino-hq-poster.webp', import.meta.url).href;

const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const NOS = {
  sino: 'ANIM_BELL_PIVOT', badalo: 'ANIM_CLAPPER_PIVOT', martelo: 'ANIM_HAMMER_PIVOT', faceMartelo: 'LOC_HAMMER_FACE',
  aro: 'LOC_STRIKE_RIM', centro: 'LOC_BELL_CENTER', olhoE: 'ANIM_EYE_L', olhoD: 'ANIM_EYE_R', testa: 'ANIM_BROW',
  bocaNeutra: 'EXPR_MOUTH_NEUTRAL', bocaO: 'EXPR_MOUTH_SURPRISE', bocaCanto: 'EXPR_MOUTH_SMIRK',
  fxEstrela: 'FX_HIT', fxOnda1: 'FX_WAVE_1', fxOnda2: 'FX_WAVE_2', visorE: 'Face_Visor_verde_L', visorD: 'Face_Visor_verde_R',
};

export function webglDisponivel() {
  try { const c = document.createElement('canvas'); return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

let promessa = null;
/** Carrega o motor uma única vez (Three.js + GLB). Falha → as vitrines ficam com a imagem estática do app. */
export function obterMotor() { return promessa ?? (promessa = criarMotor()); }

async function criarMotor() {
  if (!webglDisponivel()) throw new Error('WebGL indisponível neste navegador');
  const THREE = await import(URL_THREE);
  const [{ GLTFLoader }, { mergeVertices }] = await Promise.all([import(URL_GLTF), import(URL_UTILS)]);
  const resp = await fetch(URL_MODELO); if (!resp.ok) throw new Error(`modelo respondeu ${resp.status}`);
  const bytes = await resp.arrayBuffer();
  const gltf = await new Promise((ok, erro) => new GLTFLoader().parse(bytes, '', ok, erro));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  let bufW = 0, bufH = 0;
  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const rig = montarRig(THREE, gltf);
  cena.add(gltf.scene);
  const mats = criarMateriais(THREE);
  const biblioteca = criarBiblioteca(THREE, mats, mergeVertices);
  const naCena = new Set();

  const vistas = new Set();
  const config = { velocidade: 1, pausado: false, reduzido: false, intensidade: 1 };
  const medicao = { msPorQuadro: 0, quadros: 0, vistasDesenhadas: 0, amostras: [] };
  let raf = 0, ultimo = 0, perdido = false;
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); perdido = true; for (const v of vistas) v.el.classList.add('vista--sem-3d'); });

  const v3 = new THREE.Vector3();
  function projetar(p, w, h) { const q = p.clone().project(camera); return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h, z: q.z }; }

  function desenhar(v) {
    if (perdido) return;
    const r = v.canvas.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    const max = v.miniatura ? 260000 : 1800000; if (w * h > max) { const k = Math.sqrt(max / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
    if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
    if (w > bufW || h > bufH) { bufW = Math.max(bufW, w); bufH = Math.max(bufH, h); renderer.setSize(bufW, bufH, false); }
    const t0 = performance.now();
    AMBIENTE.reduzido = config.reduzido;
    v.ctx.dt = v.ultimoDt; v.ctx.clipeImpacto = rig.clipeImpacto;
    const { pose, info } = v.fonte(v.t, v.ctx);
    biblioteca.estilo(v.estilo);
    if (pose.clipe) rig.tocarClipe(pose.clipe.t, pose); else rig.aplicarPose(pose);
    gltf.scene.visible = v.sino !== false;
    for (const o of biblioteca.todos()) o.ancora.visible = false;
    for (const e of pose.objetos) {
      const o = biblioteca.obter(e.id); if (!o) continue;
      if (!naCena.has(o)) { cena.add(o.ancora); naCena.add(o); }
      biblioteca.aplicar(o, e);
    }
    posicionarCamera(pose.camera, v.enquadramento, w / h, v.zoom ?? 1);
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
    renderer.clear(); renderer.render(cena, camera);
    const c = v.ctx2d; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    c.drawImage(renderer.domElement, 0, bufH - h, w, h, 0, 0, w, h);
    const pontos = pontosHq(w, h);
    if (config.intensidade > 0 && v.hq !== false) desenharHq(c, pose.hq, pontos, w, h, config.intensidade * (v.intensidade ?? 1));
    const ms = performance.now() - t0; medicao.amostras.push(ms); if (medicao.amostras.length > 90) medicao.amostras.shift();
    medicao.msPorQuadro = medicao.amostras.reduce((a, b) => a + b, 0) / medicao.amostras.length;
    v.ultimoInfo = info;
    v.aoQuadro?.({ info, pose, sino: { x: pontos.centro.x / w, y: pontos.centro.y / h, topo: pontos.topo.y / h }, impacto: pose.impacto, rz: pose.sino.rz, vista: v });
  }

  function pontosHq(w, h) {
    rig.raiz.updateMatrixWorld(true);
    const p = (o) => projetar(o.getWorldPosition(v3), w, h);
    return {
      aro: p(rig.n.aro), martelo: p(rig.n.faceMartelo), centro: p(rig.n.centro),
      topo: projetar(rig.n.sino.localToWorld(rig.locais.topo.clone()), w, h),
      cabeca: projetar(rig.n.sino.localToWorld(rig.locais.cabeca.clone()), w, h),
      base: projetar(rig.n.sino.localToWorld(rig.locais.base.clone()), w, h),
      mundo: (arr) => projetar(v3.set(arr[0], arr[1], arr[2]), w, h),
    };
  }

  function posicionarCamera(cam, enq, asp, zoom) {
    const tg = Math.tan((camera.fov * G) / 2);
    const dist = Math.max(enq.meiaAltura / tg, enq.meiaLargura / (tg * asp)) * cam.dist / zoom;
    const az = cam.az * G, el = cam.el * G;
    const alvo = v3.set((enq.deslocX || 0) + (cam.alvoX || 0), rig.centroY + cam.alvoY + (enq.deslocY || 0), 0).clone();
    camera.aspect = asp; camera.updateProjectionMatrix();
    camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(alvo);
    camera.lookAt(alvo); camera.updateMatrixWorld();
  }

  function laco(agora) {
    raf = 0;
    if (document.hidden) { ultimo = 0; return; }
    const dt = ultimo ? Math.min(0.05, (agora - ultimo) / 1000) : 0; ultimo = agora;
    let continuar = false; let desenhadas = 0;
    for (const v of vistas) {
      const anima = v.visivel && v.tocando && !config.pausado && (!config.reduzido || v.umaVez);
      if (anima) {
        v.ultimoDt = dt; v.t += dt * config.velocidade * (v.velocidade ?? 1);
        if (v.limite != null && v.t >= v.limite) { v.t = v.limite; v.tocando = false; v.umaVez = false; v.aoParar?.(); }
        v.sujo = true; continuar = true;
      }
      if (v.visivel && v.sujo) { desenhar(v); v.sujo = false; desenhadas++; }
    }
    medicao.vistasDesenhadas = desenhadas;
    if (continuar) raf = requestAnimationFrame(laco); else ultimo = 0;
  }
  const agendar = () => { if (!raf) raf = requestAnimationFrame(laco); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) agendar(); });

  const io = new IntersectionObserver((entradas) => {
    for (const e of entradas) { const v = e.target.__vista; if (!v) continue; v.visivel = e.isIntersecting; if (v.visivel) v.sujo = true; }
    agendar();
  }, { rootMargin: '80px' });

  const api = {
    THREE, config, medicao, biblioteca, rig,
    /** Cria uma vitrine dentro de `el`. fonte(t, ctx) → { pose, info }. */
    criarVista(el, op = {}) {
      const canvas = document.createElement('canvas'); canvas.className = 'vista__canvas'; canvas.setAttribute('aria-hidden', 'true');
      el.classList.add('vista'); el.append(canvas);
      const v = {
        el, canvas, ctx2d: canvas.getContext('2d'), t: op.t ?? 0, tocando: op.tocando ?? false, visivel: false, sujo: true, umaVez: false,
        fonte: op.fonte, enquadramento: op.enquadramento ?? { meiaAltura: 1.62, meiaLargura: 2.05, deslocX: 0.35 }, sino: op.sino ?? true,
        estilo: op.estilo ?? { modo: 'hq', luz: 'frontal', contorno: true }, zoom: op.zoom ?? 1, velocidade: 1, intensidade: 1, miniatura: op.miniatura ?? false,
        aoQuadro: op.aoQuadro, limite: op.limite ?? null, hq: op.hq, ctx: { memoria: {}, ponteiro: { x: 0, y: 0, ativo: false, clique: 0 } }, ultimoDt: 0.016,
        tocar() { if (config.reduzido) this.umaVez = true; this.tocando = true; agendar(); },
        pausar() { this.tocando = false; this.sujo = true; agendar(); },
        irPara(t) { this.t = Math.max(0, t); this.sujo = true; agendar(); },
        atualizar(mud = {}) { Object.assign(this, mud); this.sujo = true; agendar(); },
        redesenhar() { this.sujo = true; agendar(); },
        liberar() { io.unobserve(el); vistas.delete(v); canvas.remove(); el.__vista = null; for (const [n, f] of ouvintes) el.removeEventListener(n, f); },
      };
      const ouvintes = [];
      const ouvir = (n, f) => { el.addEventListener(n, f); ouvintes.push([n, f]); };
      const rel = (e) => { const r = el.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 }; };
      ouvir('pointermove', (e) => { Object.assign(v.ctx.ponteiro, rel(e), { ativo: true }); if (op.ponteiro) { v.sujo = true; agendar(); } });
      ouvir('pointerleave', () => { v.ctx.ponteiro.ativo = false; });
      ouvir('pointerdown', (e) => { Object.assign(v.ctx.ponteiro, rel(e), { ativo: e.pointerType !== 'touch' || true, clique: performance.now() }); op.aoTocar?.(v, e); agendar(); });
      el.__vista = v; vistas.add(v); io.observe(el);
      return v;
    },
    agendar,
    redesenharTodas() { for (const v of vistas) v.sujo = true; agendar(); },
    encerrar() { cancelAnimationFrame(raf); io.disconnect(); for (const v of [...vistas]) v.liberar(); gltf.scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); for (const m of [].concat(o.material)) m?.dispose(); } }); mats.liberar(); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
  window.addEventListener('pagehide', (e) => { if (!e.persisted) api.encerrar(); });
  return api;
}

/* ---------- rig do sino (mesma leitura de nós do palco-sino.js do app) ---------- */
function montarRig(THREE, gltf) {
  const porChave = new Map();
  gltf.scene.traverse((o) => { for (const n of [o.userData?.name, o.name]) { const k = chave(n); if (k && !porChave.has(k)) porChave.set(k, o); } });
  const n = {}; const faltando = [];
  for (const [k, nome] of Object.entries(NOS)) { n[k] = porChave.get(chave(nome)) || null; if (!n[k] && !k.startsWith('fx') && !k.startsWith('visor')) faltando.push(nome); }
  if (faltando.length) throw new Error('nós não encontrados no GLB: ' + faltando.join(', '));
  gltf.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.toneMapped = false; });
  const base = new Map();
  gltf.scene.traverse((o) => base.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), v: o.visible }));
  const restaurar = () => { for (const [o, b] of base) { o.position.copy(b.p); o.quaternion.copy(b.q); o.scale.copy(b.s); o.visible = b.v; } };
  restaurar(); gltf.scene.updateMatrixWorld(true);
  const aro = n.aro.getWorldPosition(new THREE.Vector3()); const centro = n.centro.getWorldPosition(new THREE.Vector3());
  const normal = aro.clone().sub(centro); normal.y = 0; normal.normalize();
  const giroBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-normal.z, normal.x));
  const pivoMundo = aro.clone().sub(n.faceMartelo.position.clone().applyQuaternion(giroBase));
  const contato = { giroBase, pivo: n.martelo.parent.worldToLocal(pivoMundo.clone()) };
  const caixa = new THREE.Box3().setFromObject(n.sino); const centroY = (caixa.min.y + caixa.max.y) / 2;
  const locais = { topo: n.sino.worldToLocal(new THREE.Vector3(0, caixa.max.y + 0.12, 0)), cabeca: n.sino.worldToLocal(new THREE.Vector3(0, centroY + 0.1, 0.65)), base: n.sino.worldToLocal(new THREE.Vector3(0, caixa.min.y, 0.3)) };
  // visores: cores originais para o brilho
  const visores = [];
  for (const k of ['visorE', 'visorD']) n[k]?.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); visores.push({ m: o.material, cor: o.material.color.clone() }); } });
  const claro = new THREE.Color('#f4ffd0');
  // clipe embutido no GLB
  const clip = gltf.animations[0]; let mixer = null; let clipeImpacto = null;
  if (clip) {
    mixer = new THREE.AnimationMixer(gltf.scene); const acao = mixer.clipAction(clip); acao.play();
    const tr = clip.tracks.find((tk) => tk.name === 'FX_HIT.scale');
    if (tr) { let mx = -1, idx = 0; for (let i = 0; i < tr.times.length; i++) { const v = tr.values[i * 3]; if (v > mx) { mx = v; idx = i; } } clipeImpacto = tr.times[idx]; }
  }
  const q = new THREE.Quaternion(); const e = new THREE.Euler(); const ez = new THREE.Vector3(0, 0, 1);
  function visor(k) { for (const vz of visores) vz.m.color.copy(vz.cor).lerp(claro, clamp(k) * 0.85); }
  return {
    n, raiz: gltf.scene, centroY, locais, clipeImpacto,
    aplicarPose(p) {
      restaurar();
      const s = p.sino;
      if (s.rx || s.ry || s.rz) n.sino.quaternion.multiply(q.setFromEuler(e.set(s.rx * G, s.ry * G, s.rz * G, 'YXZ')));
      if (s.tx || s.ty || s.tz) n.sino.position.add(new THREE.Vector3(s.tx || 0, s.ty || 0, s.tz || 0));
      if (s.sy !== 1) n.sino.scale.y *= s.sy;
      if (s.esc && s.esc !== 1) n.sino.scale.multiplyScalar(s.esc);
      if (p.badalo.rx || p.badalo.rz) n.badalo.quaternion.multiply(q.setFromEuler(e.set(p.badalo.rx * G, 0, p.badalo.rz * G, 'XYZ')));
      if (p.testa.ty) n.testa.position.y += p.testa.ty;
      if (p.testa.rz) n.testa.quaternion.multiply(q.setFromAxisAngle(ez, p.testa.rz * G));
      if (p.olhoE !== 1) n.olhoE.scale.y *= p.olhoE;
      if (p.olhoD !== 1) n.olhoD.scale.y *= p.olhoD;
      const bocas = { neutra: n.bocaNeutra, o: n.bocaO, canto: n.bocaCanto };
      for (const [nome, no] of Object.entries(bocas)) { const ativa = nome === p.boca; no.scale.setScalar(ativa ? 1 : 0.0001); no.visible = ativa; }
      if (p.martelo) {
        n.martelo.position.copy(contato.pivo).add(new THREE.Vector3(...p.martelo.desloc));
        n.martelo.quaternion.copy(contato.giroBase).multiply(q.setFromAxisAngle(ez, p.martelo.giro * G));
        n.martelo.scale.setScalar(1); n.martelo.visible = true;
      } else n.martelo.visible = false;
      for (const [no, sc] of [[n.fxEstrela, p.fx.estrela], [n.fxOnda1, p.fx.onda1], [n.fxOnda2, p.fx.onda2]]) if (no) { no.visible = sc > 0.001; no.scale.setScalar(Math.max(sc, 0.0001)); }
      visor(p.visor || 0);
      gltf.scene.updateMatrixWorld(true);
    },
    tocarClipe(t, p) { restaurar(); if (mixer) mixer.setTime(t); visor(p.visor || 0); gltf.scene.updateMatrixWorld(true); },
  };
}

/* ---------- grafismos de HQ por cima do 3D ---------- */
const TINTA = '#191418', CLARO = '#FFF0A0', OURO = '#FFC63D', PAPEL = '#fbf5e9';
const pop = (k) => (k < 0.12 ? 0.6 + 0.55 * (k / 0.12) : k < 0.25 ? 1.15 - 0.15 * ((k - 0.12) / 0.13) : 1);
function contornado(c, larguraTinta, larguraClaro, corClaro = CLARO) { c.strokeStyle = TINTA; c.lineWidth = larguraTinta; c.stroke(); c.strokeStyle = corClaro; c.lineWidth = larguraClaro; c.stroke(); }
function estrela4(c, x, y, r) { c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; const rr = i % 2 ? r * 0.28 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); }

export function desenharHq(c, lista, P, w, h, intensidade = 1) {
  if (!lista?.length) return;
  const esc = (Math.min(w, h) / 520) * (0.75 + 0.25 * Math.min(1.5, intensidade));
  const onde = (em) => (Array.isArray(em) ? P.mundo(em) : P[em] ?? P.aro);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.save(); c.globalAlpha = Math.min(1, intensidade);
  for (const g of lista) {
    const k = clamp(g.vida ?? 0); const pt = onde(g.em);
    c.save();
    switch (g.tipo) {
      case 'impacto':
        for (let i = 0; i < 9; i++) { const a = -Math.PI * 0.9 + (i / 8) * Math.PI * 1.3; const r0 = 22 * esc, r1 = (52 + (i % 2) * 18) * esc; c.beginPath(); c.moveTo(pt.x + Math.cos(a) * r0, pt.y + Math.sin(a) * r0); c.lineTo(pt.x + Math.cos(a) * r1, pt.y + Math.sin(a) * r1); contornado(c, 7 * esc, 3 * esc); }
        break;
      case 'velocidade': {
        const dir = g.dir ?? 'martelo';
        for (let i = -1; i <= 1; i++) {
          let x0, y0, x1, y1; const comp = (46 - Math.abs(i) * 12) * esc;
          if (dir === 'martelo') { x0 = pt.x + 26 * esc; y0 = pt.y + i * 16 * esc - 18 * esc; x1 = x0 + comp; y1 = y0 - 26 * esc; }
          else if (dir === 'esquerda') { x0 = pt.x + 30 * esc; y0 = pt.y + i * 16 * esc; x1 = x0 + comp; y1 = y0; }
          else if (dir === 'direita') { x0 = pt.x - 30 * esc; y0 = pt.y + i * 16 * esc; x1 = x0 - comp; y1 = y0; }
          else { x0 = pt.x + i * 16 * esc; y0 = pt.y - 30 * esc; x1 = x0; y1 = y0 - comp; }
          c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); contornado(c, 5 * esc, 2 * esc);
        }
        break;
      }
      case 'texto': {
        const tam = (g.grande ? 84 : g.pequeno ? 34 : 58) * esc;
        c.globalAlpha *= clamp(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
        if (g.em === 'aro') c.translate(pt.x + 58 * esc, pt.y - 78 * esc - 8 * esc * k); else c.translate(pt.x + (g.pequeno ? 0 : 20 * esc), pt.y - (g.pequeno ? 20 : 46) * esc - 10 * esc * k);
        c.rotate((g.pequeno ? -6 : -12) * G); c.scale(pop(k), pop(k));
        c.font = `italic 800 ${Math.round(tam)}px "Barlow Condensed", "Arial Narrow", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = tam * 0.17; c.strokeStyle = TINTA; c.strokeText(g.texto, 0, 0); c.fillStyle = g.pequeno ? CLARO : OURO; c.fillText(g.texto, 0, 0);
        break;
      }
      case 'interroga': case 'exclama': {
        const tam = 70 * esc; c.globalAlpha *= clamp(k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1);
        c.translate(pt.x + 40 * esc, pt.y - 30 * esc + Math.sin(k * 12) * 4 * esc); c.rotate(10 * G);
        c.font = `italic 800 ${Math.round(tam)}px "Barlow Condensed", "Arial Narrow", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = tam * 0.16; c.strokeStyle = TINTA; c.strokeText(g.tipo === 'interroga' ? '?' : '!', 0, 0); c.fillStyle = OURO; c.fillText(g.tipo === 'interroga' ? '?' : '!', 0, 0);
        break;
      }
      case 'zzz':
        c.font = `italic 800 ${Math.round(30 * esc)}px "Barlow Condensed", sans-serif`; c.textAlign = 'center';
        for (let i = 0; i < 3; i++) { const kk = (k + i / 3) % 1; c.globalAlpha = Math.min(1, intensidade) * (kk < 0.2 ? kk / 0.2 : 1 - kk); const x = pt.x + (30 + kk * 40) * esc, y = pt.y - kk * 70 * esc; c.lineWidth = 5 * esc; c.strokeStyle = TINTA; c.strokeText('z', x, y); c.fillStyle = CLARO; c.fillText('z', x, y); }
        break;
      case 'brilho': { const r = 26 * esc * pop(k) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1); c.translate(pt.x + 30 * esc, pt.y - 30 * esc); c.rotate(k * 1.2); estrela4(c, 0, 0, r); c.fillStyle = CLARO; c.fill(); c.lineWidth = 3 * esc; c.strokeStyle = TINTA; c.stroke(); break; }
      case 'faiscas':
        for (let i = 0; i < 6; i++) { const a = i * 1.047 + k * 2; const d = (24 + k * 60) * esc; const r = 9 * esc * (1 - k); if (r <= 0.5) continue; estrela4(c, pt.x + Math.cos(a) * d, pt.y + Math.sin(a) * d, r); c.fillStyle = i % 2 ? OURO : CLARO; c.fill(); c.lineWidth = 2 * esc; c.strokeStyle = TINTA; c.stroke(); }
        break;
      case 'estrelas':
        for (let i = 0; i < 3; i++) { const a = k * 9 + (i * Math.PI * 2) / 3; estrela4(c, pt.x + Math.cos(a) * 46 * esc, pt.y - 10 * esc + Math.sin(a) * 12 * esc, 11 * esc); c.fillStyle = OURO; c.fill(); c.lineWidth = 2.5 * esc; c.strokeStyle = TINTA; c.stroke(); }
        break;
      case 'poeira':
        for (const lado of [-1, 1]) for (let i = 0; i < 3; i++) { const r = (10 + i * 5) * esc * (0.5 + k); c.globalAlpha = Math.min(1, intensidade) * (1 - k); c.beginPath(); c.arc(pt.x + lado * (50 + i * 22 + k * 40) * esc, pt.y - i * 6 * esc - k * 12 * esc, r, 0, Math.PI * 2); c.fillStyle = PAPEL; c.fill(); c.lineWidth = 3 * esc; c.strokeStyle = TINTA; c.stroke(); }
        break;
      case 'anel': { const r = (40 + 260 * Math.sqrt(k)) * esc; c.globalAlpha *= 1 - k; c.beginPath(); c.arc(pt.x, pt.y, r, 0, Math.PI * 2); contornado(c, 12 * esc * (1 - k * 0.5), 6 * esc * (1 - k * 0.5), OURO); break; }
      case 'raio': {
        const x0 = w + 10, y0 = pt.y - 120 * esc; const x = x0 + (pt.x + 30 * esc - x0) * Math.min(1, k * 1.4), y = y0 + (pt.y - y0) * Math.min(1, k * 1.4);
        c.beginPath(); c.moveTo(x0, y0); const n = 6; for (let i = 1; i <= n; i++) { const kk = i / n; c.lineTo(x0 + (x - x0) * kk + (i % 2 ? 12 : -12) * esc, y0 + (y - y0) * kk); }
        contornado(c, 9 * esc, 4 * esc, '#bfefff'); break;
      }
      case 'radial': {
        const o = P.aro; c.globalAlpha *= 0.85 * (1 - k * 0.6);
        for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2 + 0.05; const r0 = Math.max(w, h) * 0.32, r1 = Math.max(w, h) * 1.1; c.beginPath(); c.moveTo(o.x + Math.cos(a) * r0, o.y + Math.sin(a) * r0); c.lineTo(o.x + Math.cos(a + 0.03) * r1, o.y + Math.sin(a + 0.03) * r1); c.lineWidth = (i % 3 ? 4 : 9) * esc; c.strokeStyle = TINTA; c.stroke(); }
        break;
      }
      case 'flash': c.globalAlpha *= 0.75 * (1 - k); c.fillStyle = '#fffbe8'; c.fillRect(0, 0, w, h); break;
      default: break;
    }
    c.restore();
  }
  c.restore();
}
