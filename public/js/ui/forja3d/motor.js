/**
 * Motor 3D compartilhado das cenas do AutoniCK (direção CK Forja Noturna).
 *
 * Um único renderizador WebGL para todas as cenas da página: cada cena tem um canvas 2D e o motor copia o quadro.
 * Só desenha cenas visíveis, só avança as que estão tocando, para com a aba oculta e libera tudo ao sair da página.
 * O Three.js vem de /vendor/three (sem CDN). O sino (GLB) só é baixado quando uma cena precisa dele.
 */
import { G, AMBIENTE } from './curvas.js';
import { criarMateriais } from './materiais.js';
import { criarBiblioteca } from './objetos.js';
import { desenharHq } from './hq.js';
import './objetos-forja.js';

const URL_THREE = new URL('../../../vendor/three/three.module.min.js', import.meta.url).href;
const URL_GLTF = new URL('../../../vendor/three/addons/loaders/GLTFLoader.js', import.meta.url).href;
const URL_UTILS = new URL('../../../vendor/three/addons/utils/BufferGeometryUtils.js', import.meta.url).href;
const URL_MODELO = '/assets/sino/autonick-sino-hq.glb';

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
/** Carrega o motor uma única vez por página. Falha (sem WebGL) → as cenas mostram a alternativa estática. */
export function obterMotor() { return promessa ?? (promessa = criarMotor()); }

async function criarMotor() {
  if (!webglDisponivel()) throw new Error('WebGL indisponível neste navegador');
  const THREE = await import(URL_THREE);
  const [{ GLTFLoader }, { mergeVertices }] = await Promise.all([import(URL_GLTF), import(URL_UTILS)]);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  let bufW = 0, bufH = 0, perdido = false;
  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const biblioteca = criarBiblioteca(THREE, criarMateriais(THREE), mergeVertices);
  const naCena = new Set();
  let rig = null, raizSino = null, sinoP = null;
  const CENTRO_Y = 1.15;

  function carregarSino() {
    return sinoP ?? (sinoP = (async () => {
      const r = await fetch(URL_MODELO); if (!r.ok) throw new Error(`modelo respondeu ${r.status}`);
      const bytes = await r.arrayBuffer();
      const gltf = await new Promise((ok, erro) => new GLTFLoader().parse(bytes, '', ok, erro));
      rig = montarRig(THREE, gltf); raizSino = gltf.scene; raizSino.visible = false; cena.add(raizSino);
      return rig;
    })());
  }

  const vistas = new Set();
  const config = { reduzido: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  let raf = 0, ultimo = 0;
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); perdido = true; for (const v of vistas) v.el.classList.add('sem-3d'); });
  const v3 = new THREE.Vector3();
  const projetar = (p, w, h) => { const q = p.clone().project(camera); return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h }; };

  function desenhar(v) {
    if (perdido) return;
    const r = v.tamanho ?? v.canvas.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const dpr = v.tamanho ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w * h > 1200000) { const k = Math.sqrt(1200000 / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
    if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
    if (w > bufW || h > bufH) { bufW = Math.max(bufW, w); bufH = Math.max(bufH, h); renderer.setSize(bufW, bufH, false); }
    AMBIENTE.reduzido = config.reduzido;
    v.ctx.dt = v.ultimoDt;
    const pose = v.fonte(v.t, v.ctx);
    biblioteca.estilo(v.estilo);
    if (raizSino) { raizSino.visible = Boolean(v.sino && rig); if (raizSino.visible) rig.aplicarPose(pose); }
    for (const o of biblioteca.todos()) o.ancora.visible = false;
    for (const e of pose.objetos) {
      const o = biblioteca.obter(e.id); if (!o) continue;
      if (!naCena.has(o)) { cena.add(o.ancora); naCena.add(o); }
      biblioteca.aplicar(o, e);
    }
    posicionarCamera(pose.camera, v.enquadramento, w / h);
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
    renderer.clear(); renderer.render(cena, camera);
    const c = v.ctx2d; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    c.drawImage(renderer.domElement, 0, bufH - h, w, h, 0, 0, w, h);
    if (pose.hq?.length) desenharHq(c, pose.hq, pontos(w, h), w, h, 1);
  }

  function pontos(w, h) {
    const mundo = (arr) => projetar(v3.set(arr[0], arr[1], arr[2]), w, h);
    if (!rig) { const c = mundo([0, CENTRO_Y, 0]); return { aro: c, martelo: c, centro: c, topo: c, cabeca: c, base: c, mundo }; }
    rig.raiz.updateMatrixWorld(true);
    const p = (o) => projetar(o.getWorldPosition(v3), w, h);
    return { aro: p(rig.n.aro), martelo: p(rig.n.faceMartelo), centro: p(rig.n.centro), topo: projetar(rig.n.sino.localToWorld(rig.locais.topo.clone()), w, h),
      cabeca: projetar(rig.n.sino.localToWorld(rig.locais.cabeca.clone()), w, h), base: projetar(rig.n.sino.localToWorld(rig.locais.base.clone()), w, h), mundo };
  }

  function posicionarCamera(cam, enq, asp) {
    const tg = Math.tan((camera.fov * G) / 2);
    const dist = Math.max(enq.meiaAltura / tg, enq.meiaLargura / (tg * asp)) * cam.dist;
    const az = cam.az * G, el = cam.el * G;
    const alvo = new THREE.Vector3((enq.deslocX || 0) + (cam.alvoX || 0), CENTRO_Y + cam.alvoY + (enq.deslocY || 0), 0);
    camera.aspect = asp; camera.updateProjectionMatrix();
    camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(alvo);
    camera.lookAt(alvo); camera.updateMatrixWorld();
  }

  function laco(agora) {
    raf = 0;
    if (document.hidden) { ultimo = 0; return; }
    const dt = ultimo ? Math.min(0.1, (agora - ultimo) / 1000) : 0; ultimo = agora; // tempo real até 10 fps
    let continuar = false;
    for (const v of vistas) {
      if (!v.el.isConnected) { v.liberar(); continue; } // a tela redesenhou e a cena saiu da página
      if (v.visivel && v.tocando) { v.ultimoDt = dt; v.t += dt; v.sujo = true; continuar = true; }
      if (v.visivel && v.sujo) { desenhar(v); v.sujo = false; }
    }
    if (continuar) raf = requestAnimationFrame(laco); else ultimo = 0;
  }
  const agendar = () => { if (!raf) raf = requestAnimationFrame(laco); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) agendar(); });
  const io = new IntersectionObserver((es) => { for (const e of es) { const v = e.target.__vista; if (!v) continue; v.visivel = e.isIntersecting; if (v.visivel) v.sujo = true; } agendar(); }, { rootMargin: '60px' });

  const api = {
    THREE, config, biblioteca, carregarSino,
    criarVista(el, op = {}) {
      const canvas = document.createElement('canvas'); canvas.className = 'cena-3d__canvas'; canvas.setAttribute('aria-hidden', 'true');
      el.append(canvas);
      const v = {
        el, canvas, ctx2d: canvas.getContext('2d'), t: op.t ?? 0, tocando: false, visivel: false, sujo: true,
        fonte: op.fonte, enquadramento: op.enquadramento, sino: Boolean(op.sino), estilo: op.estilo ?? { modo: 'hq', luz: 'forja', contorno: true },
        ctx: { memoria: {}, dt: 0 }, ultimoDt: 0.016,
        tocar() { this.tocando = true; agendar(); },
        pausar() { this.tocando = false; this.sujo = true; agendar(); },
        irPara(t) { this.t = Math.max(0, t); this.sujo = true; agendar(); },
        redesenhar() { this.sujo = true; agendar(); },
        liberar() { io.unobserve(el); vistas.delete(v); canvas.remove(); el.__vista = null; },
      };
      el.__vista = v; vistas.add(v); io.observe(el);
      return v;
    },
    /** Enquadramento que contém a trajetória inteira (todas as poses de amostra), com margem. */
    enquadrarTrajetoria(poses, { comSino = false, margem = 1.14, minimo = 0.6 } = {}) {
      const caixa = new THREE.Box3(); const b = new THREE.Box3();
      for (const pose of poses) {
        for (const e of pose.objetos ?? []) {
          const o = biblioteca.obter(e.id); if (!o) continue;
          if (!naCena.has(o)) { cena.add(o.ancora); naCena.add(o); }
          biblioteca.aplicar(o, e); o.ancora.updateMatrixWorld(true);
          if (o.ancora.visible) o.ancora.traverse((m) => { if (m.isMesh && m.visible && !m.userData.semCaixa && !m.userData.casco) { b.setFromObject(m); if (!b.isEmpty()) caixa.union(b); } });
          o.ancora.visible = false;
        }
        if (comSino && rig) { rig.aplicarPose(pose); b.setFromObject(rig.n.sino); caixa.union(b); }
      }
      if (caixa.isEmpty()) return { meiaAltura: 1.62, meiaLargura: 2.05, deslocX: 0.35 };
      const c = caixa.getCenter(new THREE.Vector3()); const t = caixa.getSize(new THREE.Vector3()); const prof = t.z * 0.25;
      return { meiaAltura: Math.max(minimo, (t.y / 2 + prof) * margem), meiaLargura: Math.max(minimo, (t.x / 2 + prof) * margem), deslocX: c.x, deslocY: c.y - CENTRO_Y };
    },
    encerrar() {
      cancelAnimationFrame(raf); io.disconnect(); for (const v of [...vistas]) v.liberar();
      cena.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); for (const m of [].concat(o.material)) m?.dispose(); } });
      renderer.dispose(); renderer.forceContextLoss?.();
    },
  };
  window.addEventListener('pagehide', (e) => { if (!e.persisted) api.encerrar(); });
  return api;
}

/* ---------- rig do sino (os mesmos nós de palco-sino.js) ---------- */
export function montarRig(THREE, gltf) {
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
  const visores = [];
  for (const k of ['visorE', 'visorD']) n[k]?.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); visores.push({ m: o.material, cor: o.material.color.clone() }); } });
  const claro = new THREE.Color('#f4ffd0');
  const q = new THREE.Quaternion(); const e = new THREE.Euler(); const ez = new THREE.Vector3(0, 0, 1);
  return {
    n, raiz: gltf.scene, centroY, locais,
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
      for (const vz of visores) vz.m.color.copy(vz.cor).lerp(claro, Math.min(1, Math.max(0, p.visor || 0)) * 0.85);
      gltf.scene.updateMatrixWorld(true);
    },
  };
}
