// Objetos 3D procedurais do universo AutoniCK (categoria D e usos nas categorias B, I e no combinador).
// Nada é baixado: toda a geometria nasce aqui, com primitivas do Three.js, materiais matcap gerados em canvas
// e contorno de tinta por casco invertido. Unidades = unidades do sino (altura do sino ≈ 2,26; aro em x 0,84).
//
// Cada definição tem: construir(f) → partes · aplicar(partes, estado) · pouso · dur{entrada,ocioso,interacao,saida}
// e as trilhas entrada(t) / ocioso(t) / interacao(t, pose) / saida(t), que devolvem o estado do objeto.
// interacao() também altera a pose do sino (reação), por isso cada objeto conversa com o personagem.

import { clamp, mix, CURVAS, trilha, oscila, arco, sino01, reagirGolpe, G } from './curvas.js';
import { PALETA, texturaCanvas } from './materiais.js';

const fonteTitulo = (px) => `italic 800 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`;
const fonteTexto = (px, peso = 700) => `${peso} ${px}px "IBM Plex Sans", system-ui, sans-serif`;

/* ---------- auxiliares de coreografia ---------- */
const est = (pos, rot = [0, 0, 0], esc = 1, extra = {}) => ({ pos, rot, esc, ...extra });
function popEntrada(t, dur, pouso, rot, extra) { const k = clamp(t / dur); return est(pouso, rot, Math.max(0.0001, CURVAS.volta(k)), extra); }
function popSaida(t, dur, pouso, rot, extra) { const k = clamp(t / dur); return est(pouso, rot, Math.max(0.0001, 1 - CURVAS.entra(k)), extra); }
function quedaEntrada(t, dur, pouso, rot, extra, altura = 2.4) {
  const k = clamp(t / dur); const y = pouso[1] + altura * (1 - CURVAS.quica(k));
  const amassa = k > 0.36 && k < 0.5 ? 1 - 0.12 * Math.sin(Math.PI * (k - 0.36) / 0.14) : 1;
  return est([pouso[0], y, pouso[2]], rot, 1, { amassa, ...extra });
}
function sobeSaida(t, dur, pouso, rot, extra) { const k = clamp(t / dur); return est([pouso[0], pouso[1] + 3 * CURVAS.entra(k), pouso[2]], rot, 1 - 0.3 * k, extra); }
const flutua = (t, amp = 0.025, f = 0.45) => amp * Math.sin(2 * Math.PI * f * t);
/** O sino vira o rosto para um ponto x (direita positiva). */
function olhar(p, x, k = 1, y = 0) { p.sino.ry += clamp(x * 9, -18, 18) * k; p.sino.rx += clamp(-y * 5, -8, 8) * k; }

/* ---------- formas 2D auxiliares ---------- */
function retanguloArredondado(THREE, w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function engrenagemShape(THREE, dentes, rExt, rInt, rFuro) {
  const s = new THREE.Shape(); const passo = (Math.PI * 2) / dentes;
  for (let i = 0; i < dentes; i++) {
    const a = i * passo; const pts = [[a, rInt], [a + passo * 0.12, rExt], [a + passo * 0.42, rExt], [a + passo * 0.54, rInt]];
    pts.forEach(([ang, r], j) => { const x = Math.cos(ang) * r, y = Math.sin(ang) * r; if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  const furo = new THREE.Path(); furo.absarc(0, 0, rFuro, 0, Math.PI * 2, true); s.holes.push(furo);
  return s;
}
function estrelaShape(THREE, pontas, rExt, rInt) {
  const s = new THREE.Shape();
  for (let i = 0; i < pontas * 2; i++) { const a = Math.PI / 2 + (i * Math.PI) / pontas; const r = i % 2 ? rInt : rExt; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
  s.closePath(); return s;
}

/* ======================================================================
   DEFINIÇÕES
   ====================================================================== */
export const OBJETOS = {
  /* D01 · Campainha de balcão CK ------------------------------------------------ */
  campainha: {
    pouso: [1.85, 0, 0.4], escala: 1.15,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const base = f.malha(new THREE.CylinderGeometry(0.46, 0.52, 0.13, 40), 'vermelho'); base.position.y = 0.065;
      const aro = f.malha(new THREE.TorusGeometry(0.47, 0.03, 10, 48), 'ouro', { metalico: true, contorno: false }); aro.rotation.x = Math.PI / 2; aro.position.y = 0.13;
      const cupula = f.malha(new THREE.SphereGeometry(0.38, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), 'ouro', { metalico: true }); cupula.position.y = 0.13;
      const pino = new THREE.Group(); pino.position.y = 0.13 + 0.38;
      const haste = f.malha(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), 'prata'); haste.position.y = 0.07;
      const botao = f.malha(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 24), 'tinta2'); botao.position.y = 0.17;
      pino.add(haste, botao);
      raiz.add(base, aro, cupula, pino);
      return { raiz, partes: { pino, cupula } };
    },
    aplicar(p, e) { p.pino.position.y = 0.51 - 0.085 * (e.aperta || 0); p.cupula.scale.set(1 + 0.04 * (e.aperta || 0), 1 - 0.06 * (e.aperta || 0), 1 + 0.04 * (e.aperta || 0)); p.cupula.rotation.z = (e.vibra || 0) * G; },
    dur: { entrada: 0.7, ocioso: 2.4, interacao: 2.8, saida: 0.5 },
    entrada(t) { return quedaEntrada(t, 0.7, this.pouso, [0, -20, 0], {}, 1.6); },
    ocioso(t) { return est(this.pouso, [0, -20, 0], 1); },
    interacao(t, p) {
      const aperta = t < 0.38 ? 0 : t < 0.44 ? (t - 0.38) / 0.06 : t < 0.62 ? 1 : 1 - clamp((t - 0.62) / 0.12);
      const vibra = oscila(t, 0.44, 1.6, 4, 9, 0.3, 0.3);
      if (t > 0.2 && t < 0.44) p.hq.push({ tipo: 'velocidade', vida: (t - 0.2) / 0.24, em: [1.85, 1.05, 0.4], dir: 'baixo' });
      if (t >= 0.44 && t < 1.05) p.hq.push({ tipo: 'texto', texto: 'DING!', vida: (t - 0.44) / 0.61, em: [1.85, 0.95, 0.4] });
      if (t >= 0.44 && t < 0.52) p.hq.push({ tipo: 'impacto', vida: (t - 0.44) / 0.08, em: [1.85, 0.62, 0.4] });
      // o sino percebe a concorrente, olha, e responde com um toque curto
      const k = trilha([[0.5, 0], [0.8, 1, 'sai'], [1.6, 1], [2.2, 0, 'suave']])(t);
      olhar(p, 1.8, k); p.olhoD = mix(p.olhoD, 0.55, k * 0.6);
      if (t > 1.0 && t < 1.7) p.boca = 'canto';
      reagirGolpe(p, t, 1.75, { forca: 0.45, lado: -1, texto: 'TIM.', alvo: 'topo', ondas: false });
      p.impacto = Math.max(p.impacto, t >= 0.44 && t < 0.8 ? 1 - (t - 0.44) / 0.36 : 0);
      return est(this.pouso, [0, -20, 0], 1, { aperta, vibra });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [0, -20, 0]); },
  },

  /* D02 · Manopla dourada (a luva do mascote) ----------------------------------- */
  manopla: {
    pouso: [2.2, 0.35, 0.55], escala: 1.3,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const mao = new THREE.Group(); raiz.add(mao);
      const palma = f.malha(new THREE.SphereGeometry(0.28, 28, 18), 'ouro', { metalico: true }); palma.scale.set(1, 1.08, 0.6);
      const punho = f.malha(new THREE.CylinderGeometry(0.24, 0.27, 0.26, 28), 'vermelho'); punho.position.y = -0.36;
      const anel = f.malha(new THREE.TorusGeometry(0.255, 0.035, 10, 32), 'ouro', { metalico: true, contorno: false }); anel.rotation.x = Math.PI / 2; anel.position.y = -0.22;
      const dedos = [];
      [-0.16, -0.055, 0.055, 0.16].forEach((x, i) => {
        const g = new THREE.Group(); g.position.set(x, 0.22, 0.02);
        const seg1 = f.malha(new THREE.CapsuleGeometry(0.058, 0.13, 6, 12), 'ouro', { metalico: true }); seg1.position.y = 0.09;
        const art = new THREE.Group(); art.position.y = 0.19;
        const seg2 = f.malha(new THREE.CapsuleGeometry(0.054, 0.1, 6, 12), 'ouro', { metalico: true }); seg2.position.y = 0.07;
        art.add(seg2); g.add(seg1, art); mao.add(g); dedos.push({ g, art, i });
      });
      const polegar = new THREE.Group(); polegar.position.set(-0.24, -0.02, 0.06); polegar.rotation.z = 0.9;
      const pol = f.malha(new THREE.CapsuleGeometry(0.062, 0.15, 6, 12), 'ouro', { metalico: true }); pol.position.y = 0.1; polegar.add(pol);
      const rebite = f.malha(new THREE.SphereGeometry(0.06, 16, 10), 'vermelho', { contorno: false }); rebite.position.set(0, 0.02, 0.165);
      mao.add(palma, punho, anel, polegar, rebite);
      return { raiz, partes: { mao, dedos, polegar } };
    },
    aplicar(p, e) {
      const fecha = e.fecha ?? 0.15, dedo = e.dedo ?? 1;
      for (const d of p.dedos) { const c = d.i === 3 ? 1 - dedo : fecha; d.g.rotation.x = -c * 1.35; d.art.rotation.x = -c * 1.5; }
      p.polegar.rotation.x = -fecha * 0.6;
    },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.3, saida: 0.5 },
    entrada(t) { const k = clamp(t / 0.6); return est([this.pouso[0] + 1.6 * (1 - CURVAS.volta(k)), this.pouso[1], this.pouso[2]], [0, -25, 90], 1, { fecha: 0.9, dedo: 1 }); },
    ocioso(t) { return est([this.pouso[0], this.pouso[1] + flutua(t), this.pouso[2]], [0, -25, 90 + 4 * Math.sin(t * 2)], 1, { fecha: 0.9, dedo: 1 }); },
    interacao(t, p) {
      // recua dobrando o indicador, avança e dá o peteleco no aro; volta e faz sinal de positivo
      const pos = t < 0.55 ? arco(t, 0, 0.55, this.pouso, [2.6, 0.55, 0.6], [2.4, 0.2, 0.55])
        : t < 0.78 ? arco(t, 0.55, 0.78, [2.4, 0.2, 0.55], [2.0, 0.12, 0.55], [1.54, 0.1, 0.55], 'entra')
          : arco(t, 0.78, 1.5, [1.54, 0.1, 0.55], [2.0, 0.3, 0.6], this.pouso, 'sai');
      const dedo = trilha([[0, 1], [0.5, 0.25], [0.74, 0.25], [0.8, 1.15, 'sai'], [1.2, 1]])(t);
      const fecha = trilha([[1.5, 0.9], [1.8, 0.95], [2.0, 0.9]])(t);
      if (t > 0.6 && t < 0.78) p.hq.push({ tipo: 'velocidade', vida: (t - 0.6) / 0.18, em: [1.9, 0.35, 0.55], dir: 'esquerda' });
      reagirGolpe(p, t, 0.78, { forca: 0.85, lado: 1, texto: 'TOC!' });
      const k = trilha([[0, 0], [0.4, 1, 'suave'], [0.78, 1], [1.2, 0, 'suave']])(t); olhar(p, 1.6, k * 0.7); p.olhoD = mix(p.olhoD, 0.6, k);
      if (t > 1.5) p.boca = 'canto';
      return est(pos, [0, -25, 90 + (t > 1.6 ? -90 * sino01(t, 1.6, 0.9) : 0)], 1, { dedo, fecha });
    },
    saida(t) { const k = clamp(t / 0.5); return est([this.pouso[0] + 2 * CURVAS.entra(k), this.pouso[1], this.pouso[2]], [0, -25, 90], 1, { fecha: 0.9 }); },
  },

  /* D03 · Engrenagem da forja ---------------------------------------------------- */
  engrenagem: {
    pouso: [-1.95, 0.75, 0.3], escala: 1.0,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const ext = { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 18 };
      const g1 = new THREE.Group(); const m1 = f.malha(new THREE.ExtrudeGeometry(engrenagemShape(THREE, 12, 0.44, 0.35, 0.11), ext), 'ouro', { metalico: true }); m1.position.z = -0.06; g1.add(m1);
      const cubo = f.malha(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 6), 'vermelho'); cubo.rotation.x = Math.PI / 2; g1.add(cubo);
      const g2 = new THREE.Group(); g2.position.set(0.56, -0.42, -0.04);
      const m2 = f.malha(new THREE.ExtrudeGeometry(engrenagemShape(THREE, 8, 0.27, 0.2, 0.07), ext), 'prata', { metalico: true }); m2.position.z = -0.06; g2.add(m2);
      raiz.add(g1, g2);
      return { raiz, partes: { g1, g2 } };
    },
    aplicar(p, e) { const g = (e.giro || 0) * G; p.g1.rotation.z = g; p.g2.rotation.z = -g * 1.5 + 0.2; const k = e.encaixe ?? 1; p.g2.position.set(0.56 + (1 - k) * 0.9, -0.42 - (1 - k) * 0.35, -0.04); },
    dur: { entrada: 0.7, ocioso: 2.4, interacao: 2.6, saida: 0.5 },
    entrada(t) { const k = clamp(t / 0.7); return est([this.pouso[0] - 1.8 * (1 - CURVAS.sai(k)), this.pouso[1], this.pouso[2]], [0, 18, 0], 1, { giro: -260 * (1 - CURVAS.sai(k)) }); },
    ocioso(t) { return est(this.pouso, [0, 18, 0], 1, { giro: t * 25 }); },
    interacao(t, p) {
      // a engrenagem acelera, o sino vibra em frequência alta (TRRRIM!) e desacelera junto
      const giro = trilha([[0, 0], [0.5, 40, 'entra'], [1.6, 1100, 'linear'], [2.4, 1240, 'sai']])(t);
      const vib = sino01(t, 0.55, 1.2);
      p.sino.rz += 2.2 * vib * Math.sin(t * 2 * Math.PI * 14); p.badalo.rz += 9 * vib * Math.sin(t * 2 * Math.PI * 7 + 1);
      if (t > 0.6 && t < 1.6) { p.hq.push({ tipo: 'texto', texto: 'TRRRIM!', vida: (t - 0.6) / 1.0, em: 'topo' }); p.olhoE = p.olhoD = 0.4 + 0.15 * Math.sin(t * 40); }
      if (t > 0.5 && t < 1.7 && Math.sin(t * 31) > 0.6) p.hq.push({ tipo: 'faiscas', vida: (t * 3) % 1, em: [-1.45, 0.62, 0.35] });
      p.impacto = Math.max(p.impacto, vib * 0.6);
      olhar(p, -1.6, sino01(t, 1.7, 0.9) * 0.8); if (t > 1.9) p.boca = 'canto';
      return est([this.pouso[0] + 0.02 * vib * Math.sin(t * 90), this.pouso[1], this.pouso[2]], [0, 18, 0], 1, { giro });
    },
    saida(t) { const k = clamp(t / 0.5); return est([this.pouso[0] - 2 * CURVAS.entra(k), this.pouso[1], this.pouso[2]], [0, 18, 0], 1, { giro: 300 * k }); },
  },

  /* D04 · Moeda CK ----------------------------------------------------------------- */
  moeda: {
    pouso: [1.8, 0.38, 0.5], escala: 1.1,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const face = texturaCanvas(THREE, 256, 256, (c, w) => {
        const g = c.createRadialGradient(w * 0.4, w * 0.35, 10, w / 2, w / 2, w / 2);
        g.addColorStop(0, '#fff3c0'); g.addColorStop(0.55, '#f5b70a'); g.addColorStop(1, '#b97813');
        c.fillStyle = g; c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#191418'; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 22, 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#7a4a00'; for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; c.beginPath(); c.arc(w / 2 + Math.cos(a) * (w / 2 - 11), w / 2 + Math.sin(a) * (w / 2 - 11), 3.5, 0, Math.PI * 2); c.fill(); }
        c.font = fonteTitulo(120); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 14; c.strokeStyle = '#191418';
        c.strokeText('CK', w / 2 + 4, w / 2 + 8); c.fillStyle = '#fff6d0'; c.fillText('CK', w / 2 + 4, w / 2 + 8);
      });
      const matFace = new THREE.MeshBasicMaterial({ map: face }); matFace.toneMapped = false;
      const corpo = f.malha(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 48), 'ouro', { metalico: true, faces: matFace });
      corpo.rotation.x = Math.PI / 2;
      const giro = new THREE.Group(); giro.add(corpo); raiz.add(giro);
      return { raiz, partes: { giro } };
    },
    aplicar(p, e) { p.giro.rotation.y = (e.vira || 0) * G; },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.6, saida: 0.5 },
    entrada(t) { return popEntrada(t, 0.6, this.pouso, [0, -15, 0], { vira: 720 * (1 - clamp(t / 0.6)) }); },
    ocioso(t) { return est([this.pouso[0], this.pouso[1] + flutua(t, 0.04), this.pouso[2]], [0, -15, 0], 1, { vira: Math.sin(t * 1.3) * 35 }); },
    interacao(t, p) {
      // salta girando, quica no pino do topo (TLIM!), o sino olha para cima, a moeda volta ao lugar
      let pos; let vira;
      if (t < 0.9) { pos = arco(t, 0, 0.9, this.pouso, [1.2, 3.6, 0.4], [0.18, 2.5, 0.1], 'linear'); vira = 900 * t; }
      else if (t < 1.7) { pos = arco(t, 0.9, 1.7, [0.18, 2.5, 0.1], [1.2, 3.1, 0.4], this.pouso, 'linear'); vira = 810 + 700 * (t - 0.9); }
      else { pos = this.pouso; vira = 1370 + oscila(t, 1.7, 2.6, 25, 2.5, 0.25); }
      reagirGolpe(p, t, 0.9, { forca: 0.5, lado: 1, texto: 'TLIM!', alvo: 'topo', ondas: false });
      const olha = trilha([[0, 0], [0.5, 1, 'suave'], [1.2, 1], [1.7, 0, 'suave']])(t);
      p.sino.rx += -9 * olha; p.testa.ty += 0.02 * olha; p.olhoE = mix(p.olhoE, 1.15, olha); p.olhoD = mix(p.olhoD, 1.15, olha);
      if (t > 1.8) p.boca = 'canto';
      return est(pos, [0, -15, 0], 1, { vira });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [0, -15, 0], { vira: 600 * t }); },
  },

  /* D05 · Caixa de produto ---------------------------------------------------------- */
  caixa: {
    pouso: [1.95, 0, 0.35], escala: 1.15,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const corpo = new THREE.Group(); raiz.add(corpo);
      const cx = f.malha(new THREE.BoxGeometry(0.66, 0.48, 0.48), 'kraft'); cx.position.y = 0.24;
      const fita = f.malha(new THREE.BoxGeometry(0.14, 0.485, 0.485), 'ouro', { metalico: true, contorno: false }); fita.position.y = 0.24;
      const rot = texturaCanvas(THREE, 256, 160, (c, w, h) => {
        c.fillStyle = '#fffdf8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#191418'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
        c.fillStyle = '#c3161e'; c.font = fonteTitulo(54); c.fillText('CK', 18, 62);
        c.fillStyle = '#191418'; c.font = fonteTexto(22); c.fillText('PEDIDO 0142', 92, 52);
        for (let i = 0; i < 26; i++) c.fillRect(20 + i * 8.5, 86, i % 3 ? 3 : 5, 52);
      });
      const etiqueta = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.21), new THREE.MeshBasicMaterial({ map: rot })); etiqueta.material.toneMapped = false;
      etiqueta.position.set(0.12, 0.2, 0.243);
      const abas = [-1, 1].map((lado) => {
        const piv = new THREE.Group(); piv.position.set(0, 0.48, lado * 0.24);
        const aba = f.malha(new THREE.BoxGeometry(0.66, 0.025, 0.24), 'kraft'); aba.position.z = -lado * 0.12; piv.add(aba); return { piv, lado };
      });
      corpo.add(cx, fita, etiqueta, ...abas.map((a) => a.piv));
      return { raiz, partes: { corpo, abas } };
    },
    aplicar(p, e) { const a = e.abre || 0; for (const { piv, lado } of p.abas) piv.rotation.x = lado * a * 2.1; p.corpo.scale.set(1 + (1 - (e.amassa ?? 1)) * 0.6, e.amassa ?? 1, 1 + (1 - (e.amassa ?? 1)) * 0.6); },
    dur: { entrada: 0.9, ocioso: 2.4, interacao: 2.6, saida: 0.6 },
    entrada(t) { return quedaEntrada(t, 0.9, this.pouso, [0, -22, 0]); },
    ocioso(t) { return est(this.pouso, [0, -22, 0], 1); },
    interacao(t, p) {
      // as abas se abrem com um brilho; o sino se inclina para espiar e sorri
      const abre = trilha([[0.2, 0], [0.55, 1, 'volta'], [1.9, 1], [2.3, 0, 'suave']])(t);
      if (t > 0.45 && t < 1.3) p.hq.push({ tipo: 'brilho', vida: (t - 0.45) / 0.85, em: [1.95, 0.85, 0.35] });
      const espia = trilha([[0.3, 0], [0.8, 1, 'suave'], [1.8, 1], [2.3, 0, 'suave']])(t);
      olhar(p, 1.8, espia); p.sino.rz += -4 * espia; p.olhoE = mix(p.olhoE, 1.2, espia); p.olhoD = mix(p.olhoD, 1.2, espia);
      if (t > 0.9 && t < 2.0) p.boca = 'canto';
      p.impacto = Math.max(p.impacto, sino01(t, 0.45, 0.6) * 0.5);
      return est(this.pouso, [0, -22, 0], 1, { abre });
    },
    saida(t) { return sobeSaida(t, 0.6, this.pouso, [0, -22, 0]); },
  },

  /* D06 · Etiqueta de preço ------------------------------------------------------------ */
  etiqueta: {
    pouso: [1.75, 1.75, 0.45], escala: 1.2,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const piv = new THREE.Group(); raiz.add(piv);
      const s = new THREE.Shape(); s.moveTo(-0.24, 0); s.lineTo(-0.1, 0.15); s.lineTo(0.26, 0.15); s.lineTo(0.26, -0.15); s.lineTo(-0.1, -0.15); s.closePath();
      const furo = new THREE.Path(); furo.absarc(-0.12, 0, 0.035, 0, Math.PI * 2, true); s.holes.push(furo);
      const placa = f.malha(new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }), 'vermelho');
      placa.rotation.z = -Math.PI / 2; placa.position.y = -0.62;
      const tx = texturaCanvas(THREE, 256, 128, (c, w, h) => { c.font = fonteTitulo(74); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 10; c.strokeStyle = '#191418'; c.strokeText('R$ 69', w / 2, h / 2 + 4); c.fillStyle = '#ffdf7e'; c.fillText('R$ 69', w / 2, h / 2 + 4); });
      const rotulo = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: tx, transparent: true })); rotulo.material.toneMapped = false;
      rotulo.rotation.z = -Math.PI / 2; rotulo.position.set(0, -0.74, 0.05);
      const fio = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.52, 6), f.basico('tinta')); fio.position.y = -0.26;
      const argola = f.malha(new THREE.TorusGeometry(0.035, 0.012, 6, 16), 'ouro', { contorno: false }); argola.position.y = -0.54;
      piv.add(placa, rotulo, fio, argola);
      return { raiz, partes: { piv } };
    },
    aplicar(p, e) { p.piv.rotation.z = (e.balanco || 0) * G; p.piv.rotation.y = (e.giro || 0) * G; },
    dur: { entrada: 0.7, ocioso: 2.4, interacao: 2.8, saida: 0.5 },
    entrada(t) { const k = clamp(t / 0.7); return est([this.pouso[0], this.pouso[1] + 1.6 * (1 - CURVAS.sai(k)), this.pouso[2]], [0, -10, 0], 1, { balanco: oscila(t, 0.3, 2.5, 18, 0.9, 0.6) }); },
    ocioso(t) { return est(this.pouso, [0, -10, 0], 1, { balanco: 7 * Math.sin(t * 2.2), giro: 15 * Math.sin(t * 0.9) }); },
    interacao(t, p) {
      // voa até o pino do topo do sino e fica pendurada ao lado do rosto; o sino confere o preço
      const gancho = [0.78, 2.05, 0.62];
      const pos = t < 0.8 ? arco(t, 0, 0.8, this.pouso, [1.4, 2.8, 0.6], gancho)
        : t < 1.9 ? gancho : arco(t, 1.9, 2.6, gancho, [1.4, 2.6, 0.6], this.pouso);
      const balanco = t < 0.8 ? 25 * Math.sin(t * 8) : oscila(t, 0.8, 1.9, 30, 1.2, 0.5) + (t > 1.9 ? 8 * Math.sin(t * 6) : 0);
      reagirGolpe(p, t, 0.8, { forca: 0.3, lado: -1, texto: null, alvo: 'topo', ondas: false, olhos: false, boca: false });
      const k = trilha([[0.6, 0], [1.0, 1, 'suave'], [1.8, 1], [2.2, 0, 'suave']])(t);
      p.sino.ry += 10 * k; p.sino.rx += -5 * k; p.olhoD = mix(p.olhoD, 0.7, k); p.testa.rz += 4 * k;
      if (t > 1.2 && t < 2.2) { p.boca = 'canto'; if (t < 1.8) p.hq.push({ tipo: 'texto', texto: 'HUM…', vida: (t - 1.2) / 0.6, em: 'cabeca', pequeno: true }); }
      return est(pos, [0, -10, 0], 1, { balanco });
    },
    saida(t) { const k = clamp(t / 0.5); return est([this.pouso[0], this.pouso[1] + 2.4 * CURVAS.entra(k), this.pouso[2]], [0, -10, 0], 1, {}); },
  },

  /* D07 · Calculadora / caixa registradora ------------------------------------------- */
  calculadora: {
    pouso: [2.05, 0.55, 0.4], escala: 1.3,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const corpo = f.malha(new THREE.ExtrudeGeometry(retanguloArredondado(THREE, 0.56, 0.78, 0.07), { depth: 0.09, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }), 'tinta2');
      corpo.position.z = -0.045;
      const visor = texturaCanvas(THREE, 256, 96, (c, w, h) => desenharVisor(c, w, h, '0'));
      const tela = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.17), new THREE.MeshBasicMaterial({ map: visor })); tela.material.toneMapped = false; tela.position.set(0, 0.24, 0.068);
      const teclas = [];
      for (let l = 0; l < 4; l++) for (let c = 0; c < 4; c++) {
        const igual = l === 3 && c === 3; const op = c === 3;
        const tk = f.malha(new THREE.BoxGeometry(0.095, 0.075, 0.04), igual ? 'laranja' : op ? 'ouro' : 'papel2', { espessura: 0.012 });
        tk.position.set(-0.165 + c * 0.11, 0.07 - l * 0.1, 0.07); corpo.add(tk); teclas.push(tk);
      }
      raiz.add(corpo, tela);
      return { raiz, partes: { teclas, visor, valor: '0' } };
    },
    aplicar(p, e) {
      p.teclas.forEach((tk, i) => { tk.position.z = 0.115 - (i === e.tecla ? 0.025 : 0); });
      const v = e.valor ?? '0'; if (v !== p.valor) { p.valor = v; p.visor.redesenhar((c, w, h) => desenharVisor(c, w, h, v)); }
    },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.6, saida: 0.5 },
    entrada(t) { return popEntrada(t, 0.6, this.pouso, [-14, -24, 0], { valor: '0' }); },
    ocioso(t) { return est(this.pouso, [-14, -24, 0], 1, { valor: '0', tecla: -1 }); },
    interacao(t, p) {
      const seq = [[0.15, 1, '6'], [0.4, 2, '69'], [0.65, 13, '69,'], [0.9, 6, '69,9'], [1.15, 4, '69,90'], [1.45, 15, 'R$ 69,90']];
      let tecla = -1, valor = '0';
      for (const [t0, k, v] of seq) if (t >= t0) { valor = v; if (t < t0 + 0.12) tecla = k; }
      if (t > 1.45 && t < 1.6) p.hq.push({ tipo: 'impacto', vida: (t - 1.45) / 0.15, em: [2.15, 0.25, 0.5] });
      reagirGolpe(p, t, 1.5, { forca: 0.8, lado: -1, texto: 'DING!', alvo: 'topo' });
      const k = trilha([[0, 0], [0.3, 1], [1.4, 1], [1.6, 0]])(t); olhar(p, 1.8, k * 0.8); p.olhoD = mix(p.olhoD, 0.75, k);
      if (t > 2.0) p.boca = 'canto';
      return est(this.pouso, [-14, -24, 0], 1, { tecla, valor });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [-14, -24, 0], { valor: 'R$ 69,90' }); },
  },

  /* D08 · Recibo saindo da impressora ---------------------------------------------- */
  recibo: {
    pouso: [1.95, 0, 0.35], escala: 1.15,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const corpo = f.malha(new THREE.BoxGeometry(0.62, 0.3, 0.42), 'tinta2'); corpo.position.y = 0.15;
      const faixa = f.malha(new THREE.BoxGeometry(0.625, 0.06, 0.425), 'ouro', { metalico: true, contorno: false }); faixa.position.y = 0.08;
      const tx = texturaCanvas(THREE, 192, 420, (c, w, h) => {
        c.fillStyle = '#fffdf8'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#191418'; c.font = fonteTitulo(40); c.textAlign = 'center'; c.fillText('AutoniCK', w / 2, 48);
        c.font = fonteTexto(15, 400); c.textAlign = 'left';
        [['Capa de silicone', '29,90'], ['Película', '19,90'], ['Mão de obra', '20,10']].forEach(([a, b], i) => { c.fillText(a, 14, 100 + i * 32); c.textAlign = 'right'; c.fillText(b, w - 14, 100 + i * 32); c.textAlign = 'left'; });
        c.setLineDash([6, 5]); c.beginPath(); c.moveTo(12, 210); c.lineTo(w - 12, 210); c.stroke(); c.setLineDash([]);
        c.font = fonteTitulo(34); c.fillText('TOTAL', 14, 252); c.textAlign = 'right'; c.fillStyle = '#c3161e'; c.fillText('R$ 69,90', w - 14, 252);
        c.fillStyle = '#191418'; c.textAlign = 'center'; c.font = fonteTexto(13, 400); c.fillText('Documento de teste · sem valor fiscal', w / 2, 300);
        for (let i = 0; i < 30; i++) c.fillRect(22 + i * 5, 330, i % 3 ? 2 : 3, 50);
      });
      const papel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.88), new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide })); papel.material.toneMapped = false;
      const rolo = new THREE.Group(); rolo.position.set(0, 0.3, 0.02); papel.position.y = 0.44; rolo.add(papel);
      raiz.add(corpo, faixa, rolo);
      return { raiz, partes: { rolo, papel } };
    },
    aplicar(p, e) { const s = e.saida ?? 0; p.papel.position.y = -0.46 + 0.9 * s; p.rolo.rotation.x = -0.25 * s; p.papel.visible = s > 0.01; },
    dur: { entrada: 0.7, ocioso: 2.4, interacao: 2.6, saida: 0.5 },
    entrada(t) { return quedaEntrada(t, 0.7, this.pouso, [0, -20, 0], { saida: 0 }, 1.4); },
    ocioso(t) { return est(this.pouso, [0, -20, 0], 1, { saida: 0 }); },
    interacao(t, p) {
      const corre = CURVAS.suave(clamp((t - 0.1) / 1.3)); const saida = t < 1.9 ? corre : 1 - CURVAS.suave(clamp((t - 1.9) / 0.5));
      if (t > 0.1 && t < 1.4) { p.hq.push({ tipo: 'texto', texto: 'trrr', vida: ((t - 0.1) % 0.65) / 0.65, em: [2.35, 0.55, 0.35], pequeno: true }); p.sino.rz += 0.6 * Math.sin(t * 60); }
      reagirGolpe(p, t, 1.5, { forca: 0.6, lado: -1, texto: 'TRIM!', alvo: 'topo' });
      const k = trilha([[0.1, 0], [0.5, 1], [1.4, 1], [1.8, 0]])(t); olhar(p, 1.8, k * 0.7, -0.5);
      if (t > 1.9) p.boca = 'canto';
      return est(this.pouso, [0, -20, 0], 1, { saida });
    },
    saida(t) { return sobeSaida(t, 0.5, this.pouso, [0, -20, 0], { saida: 0 }); },
  },

  /* D09 · Prancheta de ordem de serviço ------------------------------------------- */
  prancheta: {
    pouso: [2.05, 0.75, 0.45], escala: 1.2,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const placa = f.malha(new THREE.BoxGeometry(0.62, 0.86, 0.04), 'vermelhoEscuro');
      const presilha = f.malha(new THREE.BoxGeometry(0.28, 0.09, 0.07), 'ouro', { metalico: true }); presilha.position.set(0, 0.41, 0.03);
      const tx = texturaCanvas(THREE, 256, 330, (c, w) => {
        c.fillStyle = '#fffdf8'; c.fillRect(0, 0, w, 330); c.fillStyle = '#191418'; c.font = fonteTitulo(36); c.fillText('OS Nº 3', 16, 50);
        c.font = fonteTexto(19, 600); ['Diagnóstico', 'Troca de tela', 'Teste final'].forEach((s, i) => { c.strokeStyle = '#191418'; c.lineWidth = 3; c.strokeRect(16, 92 + i * 72, 34, 34); c.fillText(s, 64, 116 + i * 72); });
      });
      const folha = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.7), new THREE.MeshBasicMaterial({ map: tx })); folha.material.toneMapped = false; folha.position.set(0, -0.03, 0.022);
      const marcas = [0, 1, 2].map((i) => {
        const g = new THREE.Group(); g.position.set(-0.188, 0.135 - i * 0.153, 0.04);
        const a = f.malha(new THREE.BoxGeometry(0.03, 0.07, 0.02), 'verde', { espessura: 0.01 }); a.position.set(-0.02, -0.005, 0); a.rotation.z = 0.7;
        const b = f.malha(new THREE.BoxGeometry(0.03, 0.13, 0.02), 'verde', { espessura: 0.01 }); b.position.set(0.035, 0.03, 0); b.rotation.z = -0.55;
        g.add(a, b); return g;
      });
      raiz.add(placa, presilha, folha, ...marcas);
      return { raiz, partes: { marcas } };
    },
    aplicar(p, e) { const n = e.checks ?? 0; p.marcas.forEach((m, i) => { const k = clamp(n - i); m.scale.setScalar(Math.max(0.0001, k < 1 ? CURVAS.volta(k) : 1)); m.visible = k > 0.001; }); },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.8, saida: 0.5 },
    entrada(t) { return popEntrada(t, 0.6, this.pouso, [-10, -22, 5], { checks: 0 }); },
    ocioso(t) { return est([this.pouso[0], this.pouso[1] + flutua(t, 0.02), this.pouso[2]], [-10, -22, 5], 1, { checks: 0 }); },
    interacao(t, p) {
      const checks = clamp((t - 0.3) / 0.2) + clamp((t - 0.8) / 0.2) + clamp((t - 1.3) / 0.2);
      for (const tc of [0.3, 0.8, 1.3]) p.sino.rx += 5 * sino01(t, tc, 0.3); // concorda com a cabeça a cada item
      reagirGolpe(p, t, 1.65, { forca: 0.9, lado: -1, texto: 'PRONTO!', alvo: 'topo' });
      const k = trilha([[0.1, 0], [0.3, 1], [1.5, 1], [1.8, 0]])(t); olhar(p, 1.7, k * 0.7);
      if (t > 2.1) p.boca = 'canto';
      return est(this.pouso, [-10, -22, 5], 1, { checks: t > 2.5 ? 3 * (1 - clamp((t - 2.5) / 0.3)) : checks });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [-10, -22, 5], { checks: 0 }); },
  },

  /* D10 · Chave inglesa (manutenção, ordem de serviço) ------------------------------ */
  chave: {
    pouso: [2.15, 1.0, 0.45], escala: 1.25,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const piv = new THREE.Group(); raiz.add(piv);
      const ext = { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 };
      const cabo = f.malha(new THREE.ExtrudeGeometry(retanguloArredondado(THREE, 0.13, 0.78, 0.06), ext), 'aco', { metalico: true }); cabo.position.set(0, -0.4, -0.035);
      const r = 0.19, y1 = Math.sqrt(r * r - 0.055 * 0.055);
      const s = new THREE.Shape(); s.moveTo(0.055, y1); s.absarc(0, 0, r, Math.atan2(y1, 0.055), Math.atan2(y1, -0.055) - Math.PI * 2, true); s.lineTo(-0.055, 0.04); s.lineTo(0.055, 0.04); s.closePath();
      const cabeca = f.malha(new THREE.ExtrudeGeometry(s, ext), 'aco', { metalico: true }); cabeca.position.z = -0.035;
      const punho = f.malha(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 18), 'vermelho'); punho.position.y = -0.62;
      piv.add(cabo, cabeca, punho);
      return { raiz, partes: { piv } };
    },
    aplicar(p, e) { p.piv.rotation.z = (e.giro || 0) * G; },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.2, saida: 0.5 },
    entrada(t) { return popEntrada(t, 0.6, this.pouso, [0, -10, 0], { giro: 30 - 360 * (1 - clamp(t / 0.6)) }); },
    ocioso(t) { return est([this.pouso[0], this.pouso[1] + flutua(t), this.pouso[2]], [0, -10, 0], 1, { giro: 30 + 6 * Math.sin(t * 1.8) }); },
    interacao(t, p) {
      // gira para trás, desce no aro (TÉIN!) e o sino aperta os olhos, como quem testa a afinação
      const giro = trilha([[0, 30], [0.5, 65, 'suave'], [0.68, -32, 'entra'], [0.85, 0, 'sai'], [1.4, 30, 'suave']])(t);
      const pos = trilha([[0, this.pouso], [0.5, [2.2, 1.2, 0.45]], [0.68, [1.12, 0.4, 0.55], 'entra'], [1.0, [1.5, 0.7, 0.5], 'sai'], [1.5, this.pouso, 'suave']])(t);
      if (t > 0.52 && t < 0.68) p.hq.push({ tipo: 'velocidade', vida: (t - 0.52) / 0.16, em: [1.5, 0.6, 0.5], dir: 'esquerda' });
      reagirGolpe(p, t, 0.68, { forca: 1, lado: 1, texto: 'TÉIN!' });
      if (t > 1.1 && t < 1.9) { p.olhoE = mix(p.olhoE, 0.35, sino01(t, 1.1, 0.8)); p.olhoD = mix(p.olhoD, 0.35, sino01(t, 1.1, 0.8)); }
      if (t > 1.7) p.boca = 'canto';
      return est(pos, [0, -10, 0], 1, { giro });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [0, -10, 0], { giro: 30 + 200 * t }); },
  },

  /* D11 · Cesta de pedidos ------------------------------------------------------------ */
  cesta: {
    pouso: [1.95, 0, 0.4], escala: 1.15,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const corpo = new THREE.Group(); raiz.add(corpo);
      const parede = f.malha(new THREE.CylinderGeometry(0.38, 0.29, 0.34, 28, 1, true), 'vermelho', { duplo: true }); parede.position.y = 0.17;
      const fundo = f.malha(new THREE.CircleGeometry(0.29, 28), 'vermelhoEscuro', { contorno: false }); fundo.rotation.x = -Math.PI / 2; fundo.position.y = 0.01;
      const borda = f.malha(new THREE.TorusGeometry(0.38, 0.035, 8, 36), 'ouro', { metalico: true }); borda.rotation.x = Math.PI / 2; borda.position.y = 0.34;
      const alca = f.malha(new THREE.TorusGeometry(0.34, 0.03, 8, 30, Math.PI), 'ouro', { metalico: true }); alca.position.y = 0.34; alca.rotation.y = 0.5;
      const itens = [
        f.malha(new THREE.BoxGeometry(0.2, 0.16, 0.16), 'kraft', { espessura: 0.012 }),
        f.malha(new THREE.SphereGeometry(0.1, 18, 12), 'laranja', { espessura: 0.012 }),
        f.malha(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 16), 'verde', { espessura: 0.012 }),
      ];
      corpo.add(parede, fundo, borda, alca, ...itens);
      return { raiz, partes: { corpo, itens } };
    },
    aplicar(p, e) {
      const its = e.itens ?? []; p.itens.forEach((m, i) => { const v = its[i]; m.visible = Boolean(v); if (v) { m.position.set(...v); m.rotation.z = (v[3] || 0) * G; } });
      const a = e.amassa ?? 1; p.corpo.scale.set(1 + (1 - a) * 0.5, a, 1 + (1 - a) * 0.5);
    },
    dur: { entrada: 0.9, ocioso: 2.4, interacao: 2.6, saida: 0.6 },
    entrada(t) { return quedaEntrada(t, 0.9, this.pouso, [0, -15, 0], { itens: [] }); },
    ocioso(t) { return est(this.pouso, [0, -15, 0], 1, { itens: [] }); },
    interacao(t, p) {
      const destinos = [[-0.1, 0.3, 0.02], [0.12, 0.3, 0.06], [0.02, 0.36, -0.1]]; const t0s = [0.15, 0.55, 0.95];
      const itens = destinos.map((d, i) => {
        const k = clamp((t - t0s[i]) / 0.35); if (k <= 0) return null;
        return [d[0], d[1] + 1.8 * (1 - CURVAS.quica(k)), d[2], (1 - k) * 200 * (i % 2 ? 1 : -1)];
      });
      let amassa = 1; for (const t0 of t0s) amassa -= 0.1 * sino01(t, t0 + 0.13, 0.12);
      reagirGolpe(p, t, 1.4, { forca: 0.75, lado: -1, texto: 'PLIM!', alvo: 'topo' });
      const k = trilha([[0, 0], [0.3, 1], [1.3, 1], [1.6, 0]])(t); olhar(p, 1.8, k * 0.8, -0.6);
      if (t > 1.9) p.boca = 'canto';
      return est(this.pouso, [0, -15, 0], 1, { itens: t > 2.3 ? [] : itens, amassa });
    },
    saida(t) { return sobeSaida(t, 0.6, this.pouso, [0, -15, 0], { itens: [] }); },
  },

  /* D12 · Escudo de segurança (o brasão do logo) ------------------------------------- */
  escudo: {
    pouso: [1.6, 0.95, 0.95], escala: 0.95,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const corpo = new THREE.Group(); raiz.add(corpo);
      const forma = (k) => { const s = new THREE.Shape(); s.moveTo(-0.46 * k, 0.5 * k); s.lineTo(0, 0.42 * k); s.lineTo(0.46 * k, 0.5 * k); s.lineTo(0.42 * k, -0.08 * k); s.quadraticCurveTo(0.3 * k, -0.42 * k, 0, -0.6 * k); s.quadraticCurveTo(-0.3 * k, -0.42 * k, -0.42 * k, -0.08 * k); s.closePath(); return s; };
      const ext = { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 };
      const moldura = f.malha(new THREE.ExtrudeGeometry(forma(1), ext), 'ouro', { metalico: true }); moldura.position.z = -0.06;
      const campo = f.malha(new THREE.ExtrudeGeometry(forma(0.82), { ...ext, depth: 0.06 }), 'tinta2', { contorno: false }); campo.position.z = 0.0;
      const estrela = f.malha(new THREE.ExtrudeGeometry(estrelaShape(THREE, 5, 0.2, 0.085), { ...ext, depth: 0.05 }), 'ouro', { metalico: true }); estrela.position.set(0, 0.02, 0.07);
      const brilho = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: f.texturaBrilho(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      brilho.position.set(0.24, 0.3, 0.16);
      corpo.add(moldura, campo, estrela, brilho);
      return { raiz, partes: { corpo, estrela, brilho } };
    },
    aplicar(p, e) { const b = e.brilho || 0; p.brilho.scale.setScalar(Math.max(0.0001, b * 1.4)); p.brilho.visible = b > 0.01; p.brilho.rotation.z = b * 1.2; p.estrela.rotation.y = (e.giroEstrela || 0) * G; p.corpo.rotation.x = (e.recuo || 0) * G; },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.4, saida: 0.5 },
    entrada(t) { return popEntrada(t, 0.6, this.pouso, [0, -18, 0], { giroEstrela: 360 * (1 - clamp(t / 0.6)) }); },
    ocioso(t) { return est([this.pouso[0], this.pouso[1] + flutua(t, 0.02), this.pouso[2]], [0, -18, 0], 1, { brilho: sino01((t % 2.4), 0.2, 0.5) * 0.7 }); },
    interacao(t, p) {
      // um raio de ameaça bate no escudo e se desfaz; o sino, protegido, acende os visores
      if (t > 0.1 && t < 0.55) p.hq.push({ tipo: 'raio', vida: (t - 0.1) / 0.45, em: [1.6, 0.95, 0.95] });
      if (t >= 0.55 && t < 0.66) p.hq.push({ tipo: 'impacto', vida: (t - 0.55) / 0.11, em: [1.75, 1.05, 1.05] });
      if (t >= 0.55 && t < 1.25) p.hq.push({ tipo: 'texto', texto: 'BLOQUEADO', vida: (t - 0.55) / 0.7, em: [1.6, 1.6, 0.95], pequeno: true });
      const recuo = -14 * sino01(t, 0.55, 0.3); const brilho = sino01(t, 0.6, 0.6);
      p.visor = Math.max(p.visor, sino01(t, 0.7, 1.4)); if (t > 0.8 && t < 2.0) p.boca = 'canto';
      p.impacto = Math.max(p.impacto, t >= 0.55 && t < 0.9 ? 0.7 * (1 - (t - 0.55) / 0.35) : 0);
      p.sino.rz += oscila(t, 0.6, 1.6, -2.5, 1.4, 0.4);
      return est(this.pouso, [0, -18, 0], 1, { recuo, brilho, giroEstrela: t > 0.6 ? 360 * CURVAS.suave(clamp((t - 0.6) / 0.7)) : 0 });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [0, -18, 0]); },
  },

  /* D13 · Carimbo de aprovação ------------------------------------------------------- */
  carimbo: {
    pouso: [1.75, 0, 0.75], escala: 1.15,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const folhaTx = texturaCanvas(THREE, 256, 180, (c, w, h) => { c.fillStyle = '#fffdf8'; c.fillRect(0, 0, w, h); c.fillStyle = '#d9cbb0'; for (let i = 0; i < 6; i++) c.fillRect(18, 22 + i * 24, i === 0 ? 120 : 200 - (i % 2) * 40, 7); });
      const folha = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.5), new THREE.MeshBasicMaterial({ map: folhaTx })); folha.material.toneMapped = false; folha.rotation.x = -Math.PI / 2; folha.position.y = 0.005;
      const marcaTx = texturaCanvas(THREE, 320, 110, (c, w, h) => { c.strokeStyle = '#c3161e'; c.lineWidth = 9; c.strokeRect(8, 8, w - 16, h - 16); c.font = fonteTitulo(62); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#c3161e'; c.fillText('APROVADO', w / 2, h / 2 + 4); });
      const marca = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), new THREE.MeshBasicMaterial({ map: marcaTx, transparent: true, depthWrite: false })); marca.material.toneMapped = false;
      marca.rotation.set(-Math.PI / 2, 0, 0.14); marca.position.set(0.02, 0.012, 0.02);
      const sobe = new THREE.Group();
      const borracha = f.malha(new THREE.BoxGeometry(0.4, 0.035, 0.2), 'vermelhoEscuro'); borracha.position.y = 0.018;
      const bloco = f.malha(new THREE.BoxGeometry(0.44, 0.12, 0.24), 'ouro', { metalico: true }); bloco.position.y = 0.095;
      const pescoco = f.malha(new THREE.CylinderGeometry(0.05, 0.065, 0.2, 14), 'tinta2'); pescoco.position.y = 0.25;
      const pomo = f.malha(new THREE.SphereGeometry(0.11, 20, 14), 'vermelho'); pomo.position.y = 0.39;
      sobe.add(borracha, bloco, pescoco, pomo);
      raiz.add(folha, marca, sobe);
      return { raiz, partes: { sobe, marca } };
    },
    aplicar(p, e) { p.sobe.position.y = e.altura ?? 0.55; p.sobe.rotation.z = (e.inclina || 0) * G; const m = e.marca || 0; p.marca.visible = m > 0.01; p.marca.scale.setScalar(Math.max(0.0001, m < 1 ? 1.25 - 0.25 * m : 1)); p.marca.material.opacity = Math.min(1, m * 1.5); },
    dur: { entrada: 0.6, ocioso: 2.4, interacao: 2.4, saida: 0.5 },
    entrada(t) { return popEntrada(t, 0.6, this.pouso, [0, -18, 0], { altura: 0.55 }); },
    ocioso(t) { return est(this.pouso, [0, -18, 0], 1, { altura: 0.55 + flutua(t, 0.03), marca: 0 }); },
    interacao(t, p) {
      const altura = trilha([[0, 0.55], [0.45, 0.85, 'suave'], [0.62, 0, 'entra'], [0.95, 0, 'linear'], [1.3, 0.75, 'sai'], [1.9, 0.55, 'suave']])(t);
      const inclina = trilha([[0, 0], [0.45, -10], [0.62, 0, 'entra']])(t);
      const marca = t < 0.62 ? 0 : t < 2.2 ? 1 : 1 - clamp((t - 2.2) / 0.2);
      if (t >= 0.62 && t < 1.15) p.hq.push({ tipo: 'texto', texto: 'PÁ!', vida: (t - 0.62) / 0.53, em: [1.75, 0.6, 0.75] });
      if (t >= 0.62 && t < 0.7) p.hq.push({ tipo: 'impacto', vida: (t - 0.62) / 0.08, em: [1.75, 0.1, 0.75] });
      p.sino.ty += 0.06 * sino01(t, 0.62, 0.22);
      p.impacto = Math.max(p.impacto, t >= 0.62 && t < 1 ? 0.8 * (1 - (t - 0.62) / 0.38) : 0);
      const k = trilha([[0.6, 0], [0.75, 1], [1.4, 1], [1.8, 0]])(t); p.olhoE = mix(p.olhoE, 1.2, k); p.olhoD = mix(p.olhoD, 1.2, k); olhar(p, 1.6, k * 0.6, -0.8);
      if (t > 1.3) { p.boca = 'canto'; p.sino.rx += 4 * sino01(t, 1.4, 0.4); }
      return est(this.pouso, [0, -18, 0], 1, { altura, inclina, marca });
    },
    saida(t) { return popSaida(t, 0.5, this.pouso, [0, -18, 0], { altura: 0.55 }); },
  },

  /* D14 · Balão de conversa ------------------------------------------------------------ */
  balao: {
    pouso: [1.4, 2.05, 0.4], escala: 1.0,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const corpo = new THREE.Group(); raiz.add(corpo);
      const s = retanguloArredondado(THREE, 0.86, 0.52, 0.2);
      const cauda = new THREE.Shape(); cauda.moveTo(-0.28, -0.2); cauda.lineTo(-0.42, -0.46); cauda.lineTo(-0.08, -0.22); cauda.closePath();
      const ext = { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 };
      const b1 = f.malha(new THREE.ExtrudeGeometry(s, ext), 'branco'); const b2 = f.malha(new THREE.ExtrudeGeometry(cauda, ext), 'branco');
      b1.position.z = b2.position.z = -0.05;
      const pontos = [-0.2, 0, 0.2].map((x) => { const m = f.malha(new THREE.SphereGeometry(0.055, 16, 10), 'tinta2', { contorno: false }); m.position.set(x, 0, 0.09); return m; });
      const exc = new THREE.Group(); exc.position.z = 0.09;
      const e1 = f.malha(new THREE.CapsuleGeometry(0.045, 0.16, 4, 10), 'vermelho', { espessura: 0.012 }); e1.position.y = 0.06;
      const e2 = f.malha(new THREE.SphereGeometry(0.05, 14, 10), 'vermelho', { espessura: 0.012 }); e2.position.y = -0.14;
      exc.add(e1, e2);
      corpo.add(b1, b2, ...pontos, exc);
      return { raiz, partes: { pontos, exc, corpo } };
    },
    aplicar(p, e) {
      const modo = e.modo ?? 'digitando'; const t = e.t ?? 0;
      p.pontos.forEach((m, i) => { m.visible = modo === 'digitando'; m.position.y = e.parado ? 0 : 0.05 * Math.max(0, Math.sin(t * 7 - i * 0.9)); m.scale.setScalar(e.parado ? 0.8 : 1); });
      p.exc.visible = modo === 'alerta'; p.exc.scale.setScalar(modo === 'alerta' ? CURVAS.volta(clamp(e.pop ?? 1)) : 1);
    },
    dur: { entrada: 0.5, ocioso: 2.4, interacao: 2.4, saida: 0.4 },
    entrada(t) { return popEntrada(t, 0.5, this.pouso, [0, -15, 0], { t }); },
    ocioso(t) { return est([this.pouso[0], this.pouso[1] + flutua(t, 0.02), this.pouso[2]], [0, -15, 0], 1, { t }); },
    interacao(t, p) {
      const alerta = t > 0.5 && t < 1.9;
      const pulo = alerta ? 1 + 0.12 * sino01(t, 0.5, 0.25) : 1;
      reagirGolpe(p, t, 0.55, { forca: 0.7, lado: -1, texto: 'PLIM!', alvo: 'topo' });
      const k = trilha([[0.5, 0], [0.8, 1], [1.6, 1], [2.0, 0]])(t); olhar(p, 1.2, k * 0.8, 1); if (t > 1.0) p.boca = 'canto';
      return est([this.pouso[0], this.pouso[1] + 0.05 * sino01(t, 0.5, 0.3), this.pouso[2]], [0, -15, 0], pulo, { modo: alerta ? 'alerta' : 'digitando', pop: (t - 0.5) / 0.3, t });
    },
    saida(t) { return popSaida(t, 0.4, this.pouso, [0, -15, 0], { t }); },
  },

  /* D15 · Orbe de energia (a esfera do logo) ----------------------------------------- */
  orbe: {
    pouso: [1.55, 1.45, 0.7], escala: 1,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 20), new THREE.MeshMatcapMaterial({ matcap: f.texturaOrbe() })); esfera.material.toneMapped = false;
      const contorno = new THREE.Mesh(esfera.geometry, f.contornoMaterial(0.018)); esfera.add(contorno);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: f.texturaHalo(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const runas = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: f.texturaRunas(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      raiz.add(halo, runas, esfera);
      return { raiz, partes: { esfera, halo, runas } };
    },
    aplicar(p, e) { const c = e.carga ?? 0.4; p.halo.scale.setScalar(0.6 + c * 1.1); p.halo.material.opacity = 0.5 + c * 0.5; p.runas.rotation.z = (e.giro || 0) * G; p.runas.scale.setScalar(0.7 + c * 0.5); p.runas.material.opacity = 0.35 + c * 0.6; p.esfera.scale.setScalar(1 + c * 0.15); },
    dur: { entrada: 0.7, ocioso: 2.4, interacao: 2.6, saida: 0.6 },
    entrada(t) { return popEntrada(t, 0.7, this.pouso, [0, 0, 0], { carga: clamp(t / 0.7), giro: t * 60 }); },
    ocioso(t) { const a = t * 0.9; return est([Math.cos(a) * 1.55, 1.45 + 0.12 * Math.sin(t * 1.7), 0.7 + Math.sin(a) * 0.4], [0, 0, 0], 1, { carga: 0.4 + 0.1 * Math.sin(t * 3), giro: t * 40 }); },
    interacao(t, p) {
      // a orbe carrega, mergulha nos visores e o sino absorve a energia: visores acesos e onda dourada
      const carga = trilha([[0, 0.4], [0.7, 1, 'suave'], [1.0, 1.2, 'entra'], [1.05, 0, 'linear'], [1.9, 0, 'linear'], [2.5, 0.4, 'suave']])(t);
      const pos = t < 0.7 ? this.pouso : t < 1.05 ? arco(t, 0.7, 1.05, this.pouso, [1.1, 1.7, 1.4], [0, 1.05, 0.75], 'entra') : t < 1.9 ? [0, 1.05, 0.7] : arco(t, 1.9, 2.5, [0, 1.05, 0.7], [0.9, 2.2, 0.9], this.pouso, 'sai');
      const esc = t >= 1.05 && t < 1.9 ? 0.0001 : t >= 1.9 ? CURVAS.volta(clamp((t - 1.9) / 0.5)) : 1;
      if (t > 0.6 && t < 1.05) p.hq.push({ tipo: 'velocidade', vida: (t - 0.6) / 0.45, em: [0.7, 1.3, 0.75], dir: 'esquerda' });
      p.visor = Math.max(p.visor, t < 1.05 ? 0 : 1 - clamp((t - 1.6) / 0.9));
      reagirGolpe(p, t, 1.05, { forca: 0.7, lado: 1, texto: 'FWOOM!', alvo: 'topo' });
      p.sino.ty += 0.05 * sino01(t, 1.05, 0.5); if (t > 1.6) p.boca = 'canto';
      const k = trilha([[0, 0], [0.4, 1], [1.0, 1], [1.05, 0]])(t); olhar(p, 1.4, k * 0.7, 0.5);
      return est(pos, [0, 0, 0], esc, { carga, giro: t * 200 });
    },
    saida(t) { return popSaida(t, 0.6, this.pouso, [0, 0, 0], { carga: 1 - t, giro: t * 100 }); },
  },

  /* ---------- auxiliares das animações do sino (não aparecem na categoria D) ---------- */
  /* B03 · mecanismo de alavanca: puxar a alavanca gira a engrenagem e solta o braço que bate no aro */
  alavanca: {
    auxiliar: true, pouso: [2.45, 0, 0.45], escala: 1.2,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const caixa = f.malha(new THREE.BoxGeometry(0.7, 0.42, 0.5), 'tinta2'); caixa.position.y = 0.21;
      const faixa = f.malha(new THREE.BoxGeometry(0.705, 0.07, 0.505), 'ouro', { metalico: true, contorno: false }); faixa.position.y = 0.34;
      const engr = new THREE.Group(); engr.position.set(0, 0.24, 0.27);
      const eg = f.malha(new THREE.ExtrudeGeometry(engrenagemShape(THREE, 10, 0.16, 0.12, 0.04), { depth: 0.05, bevelEnabled: false, curveSegments: 10 }), 'ouro', { metalico: true, espessura: 0.012 }); eg.position.z = -0.02; engr.add(eg);
      const alav = new THREE.Group(); alav.position.set(0.26, 0.42, 0);
      const haste = f.malha(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), 'prata'); haste.position.y = 0.25;
      const bola = f.malha(new THREE.SphereGeometry(0.08, 16, 12), 'vermelho'); bola.position.y = 0.52; alav.add(haste, bola);
      const braco = new THREE.Group(); braco.position.set(-0.3, 0.36, 0.05);
      const vara = f.malha(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 10), 'prata'); vara.rotation.z = Math.PI / 2; vara.position.x = -0.47;
      const ponta = f.malha(new THREE.SphereGeometry(0.1, 18, 12), 'ouro', { metalico: true }); ponta.position.x = -0.95;
      braco.add(vara, ponta);
      raiz.add(caixa, faixa, engr, alav, braco);
      return { raiz, partes: { engr, alav, braco } };
    },
    aplicar(p, e) { p.alav.rotation.z = (e.alavanca || 0) * G; p.engr.rotation.z = (e.giro || 0) * G; p.braco.rotation.z = (e.braco || 0) * G; },
  },
  /* B10 · ímã em ferradura */
  ima: {
    auxiliar: true, pouso: [2.1, 0.55, 0.45], escala: 1.4,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group(); const giro = new THREE.Group(); raiz.add(giro);
      const arco = f.malha(new THREE.TorusGeometry(0.24, 0.09, 12, 28, Math.PI), 'vermelho'); arco.rotation.z = -Math.PI / 2;
      const pernas = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(0, s * 0.24, 0);
        const perna = f.malha(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 16), 'vermelho'); perna.rotation.z = Math.PI / 2; perna.position.x = -0.11;
        const ponta = f.malha(new THREE.CylinderGeometry(0.092, 0.092, 0.12, 16), 'prata', { metalico: true }); ponta.rotation.z = Math.PI / 2; ponta.position.x = -0.28;
        g.add(perna, ponta); return g; });
      giro.add(arco, ...pernas);
      return { raiz, partes: { giro } };
    },
    aplicar(p, e) { p.giro.rotation.x = (e.vira || 0) * G; },
  },
  /* B12 · círculo rúnico atrás do sino (o círculo mágico do logo) */
  circulo: {
    auxiliar: true, pouso: [0, 1.15, -0.95], escala: 1,
    construir(f) {
      const { THREE } = f; const raiz = new THREE.Group();
      const placa = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: f.texturaRunas(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: f.texturaHalo(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.z = -0.05; raiz.add(halo, placa);
      return { raiz, partes: { placa, halo } };
    },
    aplicar(p, e) { const v = e.forca ?? 1; p.placa.material.opacity = v; p.halo.material.opacity = v * 0.8; p.placa.rotation.z = (e.giro || 0) * G; },
  },
};

function desenharVisor(c, w, h, v) {
  c.fillStyle = '#aae75a'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(41,75,53,0.18)'; for (let x = 0; x < w; x += 6) c.fillRect(x, 0, 1, h);
  c.strokeStyle = '#191418'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  c.fillStyle = '#21392a'; c.font = fonteTitulo(64); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(v, w - 18, h / 2 + 4);
}

/** Cria a biblioteca de objetos ligada ao THREE em uso (construção sob demanda, um exemplar por objeto). */
export function criarBiblioteca(THREE, mats, mergeVertices) {
  const prontos = new Map();
  let modoAtual = 'hq', luzAtual = 'frontal', contornoAtual = true;
  const malhas = [];
  const cascos = [];
  const texturas = {};
  const tex = (nome, fn) => texturas[nome] ?? (texturas[nome] = fn());
  const radial = (stops, tam = 128) => { const cv = document.createElement('canvas'); cv.width = cv.height = tam; const c = cv.getContext('2d'); const g = c.createRadialGradient(tam / 2, tam / 2, 0, tam / 2, tam / 2, tam / 2); stops.forEach(([p, cor]) => g.addColorStop(p, cor)); c.fillStyle = g; c.fillRect(0, 0, tam, tam); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };

  const f = {
    THREE,
    basico(cor) { const m = new THREE.MeshBasicMaterial({ color: PALETA[cor] ?? cor }); m.toneMapped = false; return m; },
    contornoMaterial: (e) => mats.contorno(e),
    matcapDe: (cor, modo = 'metal') => mats.obter(cor, modo, luzAtual).matcap,
    malha(geom, cor, { contorno = true, metalico = false, espessura = 0.022, faces = null, duplo = false } = {}) {
      const mat = mats.obter(cor, modoAtual, luzAtual, { metalico });
      const m = new THREE.Mesh(geom, faces ? [mat, faces, faces] : mat);
      if (duplo) (Array.isArray(m.material) ? m.material[0] : m.material).side = THREE.DoubleSide;
      m.userData = { cor, metalico, faces: Boolean(faces), duplo };
      malhas.push(m);
      if (contorno) {
        const g = geom.clone(); g.deleteAttribute('normal'); if (g.getAttribute('uv')) g.deleteAttribute('uv');
        const gm = mergeVertices(g, 1e-3); gm.computeVertexNormals();
        const casco = new THREE.Mesh(gm, mats.contorno(espessura)); casco.userData.casco = true; casco.visible = contornoAtual; m.add(casco); cascos.push(casco);
      }
      return m;
    },
    texturaBrilho: () => tex('brilho', () => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'); c.translate(64, 64); const g = c.createRadialGradient(0, 0, 0, 0, 0, 60); g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.25, 'rgba(255,223,126,0.6)'); g.addColorStop(1, 'rgba(255,180,40,0)'); c.fillStyle = g; for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 4); c.beginPath(); c.ellipse(0, 0, 62, i % 2 ? 6 : 10, 0, 0, Math.PI * 2); c.fill(); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }),
    texturaHalo: () => tex('halo', () => radial([[0, 'rgba(255,240,180,0.95)'], [0.25, 'rgba(255,181,71,0.55)'], [0.6, 'rgba(226,67,27,0.18)'], [1, 'rgba(163,22,15,0)']])),
    texturaOrbe: () => tex('orbe', () => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'); const g = c.createRadialGradient(40, 36, 2, 64, 64, 66); [[0, '#fffbe8'], [0.22, '#ffd56a'], [0.52, '#ff9a2e'], [0.82, '#e2431b'], [1, '#a3160f']].forEach(([p, cor]) => g.addColorStop(p, cor)); c.fillStyle = g; c.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }),
    texturaRunas: () => tex('runas', () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d'); c.translate(128, 128);
      c.strokeStyle = 'rgba(255,223,126,0.9)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 112, 0, Math.PI * 2); c.stroke(); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 92, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 12; i++) { c.save(); c.rotate((i / 12) * Math.PI * 2); c.translate(0, -102); if (i % 3 === 0) { c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.moveTo(-5, -5); c.lineTo(5, 5); c.moveTo(5, -5); c.lineTo(-5, 5); c.stroke(); } else { c.beginPath(); c.moveTo(0, -6); c.lineTo(0, 6); c.moveTo(-5, 0); c.lineTo(5, 0); c.stroke(); } c.restore(); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }),
  };

  return {
    ids: Object.keys(OBJETOS),
    definicao: (id) => OBJETOS[id],
    /** Devolve o objeto pronto (construído na primeira vez). */
    obter(id) {
      if (prontos.has(id)) return prontos.get(id);
      const def = OBJETOS[id]; if (!def) return null;
      const { raiz, partes } = def.construir(f);
      const ancora = new THREE.Group(); ancora.add(raiz); ancora.visible = false;
      const o = { id, def, ancora, raiz, partes };
      prontos.set(id, o); return o;
    },
    /** Aplica um estado (posição, giro em graus, escala e parâmetros próprios). */
    aplicar(o, e) {
      const s = (e.esc ?? 1) * (o.def.escala ?? 1);
      o.ancora.position.set(...(e.pos ?? o.def.pouso)); o.ancora.rotation.set((e.rot?.[0] || 0) * G, (e.rot?.[1] || 0) * G, (e.rot?.[2] || 0) * G);
      o.ancora.scale.setScalar(Math.max(0.0001, s)); o.ancora.visible = s > 0.001;
      o.def.aplicar(o.partes, e);
    },
    /** Troca material, luz e contorno de todos os objetos construídos (barato: só troca referências). */
    estilo({ modo = 'hq', luz = 'frontal', contorno = true } = {}) {
      if (modo !== modoAtual || luz !== luzAtual) {
        modoAtual = modo; luzAtual = luz;
        for (const m of malhas) {
          const mat = mats.obter(m.userData.cor, modo, luz, { metalico: m.userData.metalico });
          if (m.userData.duplo) mat.side = THREE.DoubleSide;
          if (Array.isArray(m.material)) m.material[0] = mat; else m.material = mat;
        }
      }
      if (contorno !== contornoAtual) { contornoAtual = contorno; for (const c of cascos) c.visible = contorno; }
    },
    todos: () => [...prontos.values()],
  };
}
