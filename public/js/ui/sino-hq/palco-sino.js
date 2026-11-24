/**
 * Palco 3D do sino HQ da página inicial (renderização do "Chamado da Forja").
 * Lê o rig do GLB do app (mesmos nós de sempre), desenha os objetos da cena (círculo rúnico e orbe da marca) e os
 * grafismos de HQ numa camada 2D por cima. Informa onde o sino está para o palco em perspectiva do fundo.
 *
 * Só depende do Three.js copiado em /vendor/three (sem CDN). Quem controla o tempo é o componente do herói.
 */
import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from '../../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { montarRig } from '../forja3d/motor.js';
import { criarMateriais } from '../forja3d/materiais.js';
import { criarBiblioteca } from '../forja3d/objetos.js';
import { desenharHq } from '../forja3d/hq.js';
import { G } from '../forja3d/curvas.js';

/** Lança erro se o navegador não tiver WebGL; assim o herói fica na imagem estática. */
export function webglDisponivel() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const ESTILO = Object.freeze({ modo: 'hq', luz: 'forja', contorno: true });

export class PalcoSino {
  /** @param {{ palco: HTMLElement, canvas: HTMLCanvasElement, camadaHq: HTMLCanvasElement }} o */
  constructor({ palco, canvas, camadaHq }) {
    this.palco = palco; this.canvas = canvas; this.camadaHq = camadaHq;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // materiais unlit: cores chapadas como no SVG
    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    this.alvo = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.naCena = new Set();
    this.redimensionar();
  }

  /** Lê o GLB (bytes já baixados), prepara o rig e a biblioteca de objetos da cena. */
  async montar(bytes) {
    const gltf = await new Promise((ok, erro) => new GLTFLoader().parse(bytes, '', ok, erro));
    this.rig = montarRig(THREE, gltf);
    this.raiz = gltf.scene;
    this.cena.add(gltf.scene);
    this.materiais = criarMateriais(THREE);
    this.biblioteca = criarBiblioteca(THREE, this.materiais, mergeVertices);
    this.biblioteca.estilo(ESTILO);
  }

  aplicarPose(p) {
    this.rig.aplicarPose(p);
    for (const o of this.biblioteca.todos()) o.ancora.visible = false;
    for (const e of p.objetos ?? []) {
      const o = this.biblioteca.obter(e.id); if (!o) continue;
      if (!this.naCena.has(o)) { this.cena.add(o.ancora); this.naCena.add(o); }
      this.biblioteca.aplicar(o, e);
    }
  }

  posicionarCamera(cam, enq) {
    const w = this.palco.clientWidth || 1, h = this.palco.clientHeight || 1, asp = w / h;
    const tg = Math.tan((this.camera.fov * G) / 2);
    const dist = Math.max(enq.meiaAltura / tg, enq.meiaLargura / (tg * asp)) * cam.dist;
    const az = cam.az * G, el = cam.el * G;
    this.alvo.set((enq.deslocX || 0) + (cam.alvoX || 0), this.rig.centroY + cam.alvoY + (enq.deslocY || 0), 0);
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

  _projetar(v, w, h) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  }

  /** Centro e base do sino, em px do palco (para o fundo em perspectiva nascer da base real do personagem). */
  projecao() {
    if (!this.rig) return null;
    const w = this.palco.clientWidth, h = this.palco.clientHeight;
    const r = this.rig;
    return {
      centro: this._projetar(r.n.centro.getWorldPosition(this.v), w, h),
      base: this._projetar(r.n.sino.localToWorld(r.locais.base.clone()), w, h),
      w, h,
    };
  }

  _desenharHq(p) {
    const cv = this.camadaHq; const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (!p.hq?.length) return;
    const w = cv.width, h = cv.height; const r = this.rig;
    const proj = (v) => this._projetar(v, w, h);
    const pontos = {
      aro: proj(r.n.aro.getWorldPosition(this.v)), martelo: proj(r.n.faceMartelo.getWorldPosition(this.v)), centro: proj(r.n.centro.getWorldPosition(this.v)),
      topo: proj(r.n.sino.localToWorld(r.locais.topo.clone())), cabeca: proj(r.n.sino.localToWorld(r.locais.cabeca.clone())), base: proj(r.n.sino.localToWorld(r.locais.base.clone())),
      mundo: (a) => proj(this.v.set(a[0], a[1], a[2])),
    };
    desenharHq(ctx, p.hq, pontos, w, h, 1);
  }

  /** Libera geometrias, materiais, texturas e o contexto WebGL. */
  liberar() {
    this.cena.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose(); for (const m of [].concat(o.material)) m?.dispose(); }
    });
    this.materiais?.liberar();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.naCena.clear(); this.rig = null; this.raiz = null;
  }
}
