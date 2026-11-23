/**
 * Palco 3D do sino HQ (renderização). Adaptado de js/sino-cena.js do artefato "Sino HQ em cena" (versão 2):
 * mesma leitura do rig, mesmo cálculo do contato do martelinho e mesmos grafismos (TOC!, linhas de impacto e de
 * velocidade). Ficou de fora o que só o comparador usava (órbita, quadro do SVG e relógio próprio).
 *
 * Só depende do Three.js copiado em /vendor/three (sem CDN). Quem controla o tempo é o componente do herói.
 */
import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/addons/loaders/GLTFLoader.js';

const G = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Nós do rig (GUIA-DO-MODELO.txt do kit do sino). */
const NOS = {
  sino: 'ANIM_BELL_PIVOT', badalo: 'ANIM_CLAPPER_PIVOT', martelo: 'ANIM_HAMMER_PIVOT', faceMartelo: 'LOC_HAMMER_FACE',
  aro: 'LOC_STRIKE_RIM', centro: 'LOC_BELL_CENTER', olhoE: 'ANIM_EYE_L', olhoD: 'ANIM_EYE_R', testa: 'ANIM_BROW',
  bocaNeutra: 'EXPR_MOUTH_NEUTRAL', bocaO: 'EXPR_MOUTH_SURPRISE', bocaCanto: 'EXPR_MOUTH_SMIRK',
  fxEstrela: 'FX_HIT', fxOnda1: 'FX_WAVE_1', fxOnda2: 'FX_WAVE_2',
};

/** Lança erro se o navegador não tiver WebGL; assim o herói fica na imagem estática. */
export function webglDisponivel() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

export class PalcoSino {
  /** @param {{ palco: HTMLElement, canvas: HTMLCanvasElement, camadaHq: HTMLCanvasElement }} o */
  constructor({ palco, canvas, camadaHq }) {
    this.palco = palco; this.canvas = canvas; this.camadaHq = camadaHq;
    this._base = new Map();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // materiais unlit: cores chapadas como no SVG
    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    this.alvo = new THREE.Vector3();
    this.redimensionar();
  }

  /** Lê o GLB (bytes já baixados) e prepara o rig. */
  async montar(bytes) {
    const gltf = await new Promise((ok, erro) => new GLTFLoader().parse(bytes, '', ok, erro));
    this.cena.add(gltf.scene);
    this.raiz = gltf.scene;
    const porChave = new Map();
    gltf.scene.traverse((o) => { for (const n of [o.userData?.name, o.name]) { const k = chave(n); if (k && !porChave.has(k)) porChave.set(k, o); } });
    const rig = {}; const faltando = [];
    for (const [k, nome] of Object.entries(NOS)) { rig[k] = porChave.get(chave(nome)) || null; if (!rig[k] && !k.startsWith('fx')) faltando.push(nome); }
    if (faltando.length) throw new Error('nós não encontrados no GLB: ' + faltando.join(', '));
    this.rig = rig;
    gltf.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.toneMapped = false; });
    gltf.scene.traverse((o) => this._base.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), v: o.visible }));

    // contato: matrizes atualizadas na pose original antes de medir aro e centro
    this.restaurar(); gltf.scene.updateMatrixWorld(true);
    const aro = rig.aro.getWorldPosition(new THREE.Vector3());
    const centro = rig.centro.getWorldPosition(new THREE.Vector3());
    const normal = aro.clone().sub(centro); normal.y = 0; normal.normalize();
    const giroBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-normal.z, normal.x));
    const faceLocal = rig.faceMartelo.position.clone();
    const pivoMundo = aro.clone().sub(faceLocal.clone().applyQuaternion(giroBase));
    this.contato = { giroBase, pivo: rig.martelo.parent.worldToLocal(pivoMundo.clone()) };
    const caixa = new THREE.Box3().setFromObject(rig.sino);
    this.centroY = (caixa.min.y + caixa.max.y) / 2;
  }

  restaurar() { for (const [o, b] of this._base) { o.position.copy(b.p); o.quaternion.copy(b.q); o.scale.copy(b.s); o.visible = b.v; } }

  aplicarPose(p) {
    this.restaurar();
    const r = this.rig; const q = new THREE.Quaternion(); const e = new THREE.Euler();
    if (p.sino.rx || p.sino.ry || p.sino.rz) r.sino.quaternion.multiply(q.setFromEuler(e.set(p.sino.rx * G, p.sino.ry * G, p.sino.rz * G, 'YXZ')));
    if (p.sino.sy !== 1) r.sino.scale.y *= p.sino.sy;
    if (p.badalo.rx || p.badalo.rz) r.badalo.quaternion.multiply(q.setFromEuler(e.set(p.badalo.rx * G, 0, p.badalo.rz * G, 'XYZ')));
    if (p.testa.ty) r.testa.position.y += p.testa.ty;
    if (p.testa.rz) r.testa.quaternion.multiply(q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.testa.rz * G));
    if (p.olhoE !== 1) r.olhoE.scale.y *= p.olhoE;
    if (p.olhoD !== 1) r.olhoD.scale.y *= p.olhoD;
    const bocas = { neutra: r.bocaNeutra, o: r.bocaO, canto: r.bocaCanto };
    for (const [nome, no] of Object.entries(bocas)) { const ativa = nome === p.boca; no.scale.setScalar(ativa ? 1 : 0.0001); no.visible = ativa; }
    if (p.martelo) {
      const m = r.martelo;
      m.position.copy(this.contato.pivo).add(new THREE.Vector3(...p.martelo.desloc));
      m.quaternion.copy(this.contato.giroBase).multiply(q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.martelo.giro * G));
      m.scale.setScalar(1); m.visible = true;
    } else { r.martelo.visible = false; }
    for (const [no, s] of [[r.fxEstrela, p.fx.estrela], [r.fxOnda1, p.fx.onda1], [r.fxOnda2, p.fx.onda2]]) {
      if (no) { no.visible = s > 0.001; no.scale.setScalar(Math.max(s, 0.0001)); }
    }
    this.raiz.updateMatrixWorld(true);
  }

  posicionarCamera(cam, enq) {
    const w = this.palco.clientWidth || 1, h = this.palco.clientHeight || 1, asp = w / h;
    const tg = Math.tan((this.camera.fov * G) / 2);
    const dist = Math.max(enq.meiaAltura / tg, enq.meiaLargura / (tg * asp)) * cam.dist;
    const az = cam.az * G, el = cam.el * G;
    this.alvo.set(enq.deslocX || 0, this.centroY + cam.alvoY, 0);
    this.camera.aspect = asp; this.camera.updateProjectionMatrix();
    this.camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(this.alvo);
    this.camera.lookAt(this.alvo); this.camera.updateMatrixWorld();
  }

  /** Desenha um quadro com a pose e o enquadramento dados. */
  desenhar(pose, enquadramento) {
    this.aplicarPose(pose);
    this.posicionarCamera(pose.camera, enquadramento);
    this.renderer.render(this.cena, this.camera);
    this._desenharHq(pose);
  }

  redimensionar() {
    const w = this.palco.clientWidth, h = this.palco.clientHeight; if (!w || !h) return false;
    this.renderer.setSize(w, h, false);
    const d = Math.min(window.devicePixelRatio || 1, 2);
    this.camadaHq.width = Math.round(w * d); this.camadaHq.height = Math.round(h * d);
    return true;
  }

  _projetar(v) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.palco.clientWidth, y: ((1 - p.y) / 2) * this.palco.clientHeight };
  }

  /** Grafismos 2D de HQ por cima do 3D: TOC!, linhas de impacto e de velocidade. */
  _desenharHq(p) {
    const cv = this.camadaHq; const ctx = cv.getContext('2d'); const w = this.palco.clientWidth, h = this.palco.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (!p.hq.length) return;
    ctx.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
    const esc = Math.min(w, h) / 520;
    const aro = this._projetar(this.rig.aro.getWorldPosition(new THREE.Vector3()));
    const tinta = '#191418', claro = '#FFF0A0', ouro = '#FFC63D';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pop = (k) => (k < 0.12 ? 0.6 + 0.55 * (k / 0.12) : k < 0.25 ? 1.15 - 0.15 * ((k - 0.12) / 0.13) : 1);
    for (const g of p.hq) {
      if (g.tipo === 'impacto') {
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI * 0.9 + (i / 8) * Math.PI * 1.3; const r0 = 22 * esc, r1 = (52 + (i % 2) * 18) * esc;
          ctx.strokeStyle = tinta; ctx.lineWidth = 7 * esc; ctx.beginPath();
          ctx.moveTo(aro.x + Math.cos(a) * r0, aro.y + Math.sin(a) * r0); ctx.lineTo(aro.x + Math.cos(a) * r1, aro.y + Math.sin(a) * r1); ctx.stroke();
          ctx.strokeStyle = claro; ctx.lineWidth = 3 * esc; ctx.stroke();
        }
      } else if (g.tipo === 'velocidade') {
        const f = this._projetar(this.rig.faceMartelo.getWorldPosition(new THREE.Vector3()));
        for (let i = -1; i <= 1; i++) {
          const ox = f.x + 26 * esc, oy = f.y + i * 16 * esc - 18 * esc;
          ctx.strokeStyle = tinta; ctx.lineWidth = 5 * esc; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + (46 - Math.abs(i) * 12) * esc, oy - 26 * esc); ctx.stroke();
          ctx.strokeStyle = claro; ctx.lineWidth = 2 * esc; ctx.stroke();
        }
      } else if (g.tipo === 'toc') {
        const k = g.vida; const tam = 58 * esc;
        ctx.save(); ctx.globalAlpha = clamp(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
        ctx.translate(aro.x + 58 * esc, aro.y - 78 * esc - 8 * esc * k); ctx.rotate(-12 * G); ctx.scale(pop(k), pop(k));
        ctx.font = `italic 800 ${Math.round(tam)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = tam * 0.17; ctx.strokeStyle = tinta; ctx.strokeText('TOC!', 0, 0); ctx.fillStyle = ouro; ctx.fillText('TOC!', 0, 0);
        ctx.restore();
      }
    }
  }

  /** Libera geometrias, materiais e o contexto WebGL. */
  liberar() {
    this.raiz?.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose(); for (const m of [].concat(o.material)) m?.dispose(); }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this._base.clear(); this.rig = null; this.raiz = null;
  }
}
