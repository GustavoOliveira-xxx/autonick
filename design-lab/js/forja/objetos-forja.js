// Objetos refeitos para a direção CK Forja Noturna (substituem os protótipos com defeito do Design Lab).
//  moedaCK      IB01: perfil torneado com aro elevado e chanfro, borda serrilhada, relevo CK nas duas faces
//  comprovante  IB03: recibo de papel com borda picotada e selo CONFIRMADA (confirma a venda; não sugere impressão)
//  etiquetaCK   IB05: etiqueta suspensa por um gancho fixo, cordão real, preço legível e balanço de pêndulo
// Todos com o mesmo tratamento do universo: matcap em faixas, contorno de tinta e sombra de contato.

import { OBJETOS } from '../motor/objetos.js';
import { texturaCanvas, PALETA } from '../motor/materiais.js';
import { G } from '../motor/curvas.js';

const fonteTitulo = (px) => `italic 800 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`;
const fonteTexto = (px, peso = 600) => `${peso} ${px}px "IBM Plex Sans", system-ui, sans-serif`;

/** Sombra de contato macia (plano com gradiente radial), comum aos objetos refinados. */
function sombra(f, largura, profundidade) {
  const { THREE } = f;
  const t = texturaCanvas(THREE, 128, 64, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(8,4,14,0.55)'); g.addColorStop(1, 'rgba(8,4,14,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(largura, profundidade), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.material.toneMapped = false; m.userData.semCaixa = true; return m;
}

function desenharFaceMoeda(c, w) {
  const r = w / 2;
  const g = c.createRadialGradient(w * 0.36, w * 0.3, 8, r, r, r);
  g.addColorStop(0, '#fff6cf'); g.addColorStop(0.45, '#f6c43b'); g.addColorStop(0.8, '#d8920f'); g.addColorStop(1, '#a8680a');
  c.fillStyle = g; c.beginPath(); c.arc(r, r, r, 0, Math.PI * 2); c.fill();
  // anel de pontos e anel interno (cunhagem)
  c.fillStyle = 'rgba(122,70,0,0.75)'; for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; c.beginPath(); c.arc(r + Math.cos(a) * r * 0.86, r + Math.sin(a) * r * 0.86, w * 0.011, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = 'rgba(122,70,0,0.8)'; c.lineWidth = w * 0.012; c.beginPath(); c.arc(r, r, r * 0.76, 0, Math.PI * 2); c.stroke();
  // CK em relevo: sombra embaixo à direita, brilho em cima à esquerda, letra dourada com contorno de tinta
  c.font = fonteTitulo(Math.round(w * 0.46)); c.textAlign = 'center'; c.textBaseline = 'middle';
  const x = r + w * 0.012, y = r + w * 0.035;
  c.fillStyle = 'rgba(90,48,0,0.8)'; c.fillText('CK', x + w * 0.012, y + w * 0.014);
  c.fillStyle = 'rgba(255,250,225,0.9)'; c.fillText('CK', x - w * 0.008, y - w * 0.01);
  c.lineWidth = w * 0.022; c.strokeStyle = '#191418'; c.strokeText('CK', x, y);
  const gl = c.createLinearGradient(0, y - w * 0.2, 0, y + w * 0.2); gl.addColorStop(0, '#fff1b0'); gl.addColorStop(0.55, '#f5b70a'); gl.addColorStop(1, '#c98a14');
  c.fillStyle = gl; c.fillText('CK', x, y);
}

Object.assign(OBJETOS, {
  moedaCK: {
    pouso: [0, 0.5, 0], escala: 1,
    construir(f) {
      const { THREE } = f; const R = 0.34, T = 0.1;
      const raiz = new THREE.Group(); const giro = new THREE.Group(); const corpo = new THREE.Group(); corpo.rotation.x = Math.PI / 2; giro.add(corpo); raiz.add(giro);
      const perfil = [[0, T / 2 - 0.014], [R * 0.79, T / 2 - 0.014], [R * 0.83, T / 2], [R * 0.96, T / 2], [R, T / 2 - 0.018], [R, -T / 2 + 0.018], [R * 0.96, -T / 2], [R * 0.83, -T / 2], [R * 0.79, -T / 2 + 0.014], [0, -T / 2 + 0.014]].map(([x, y]) => new THREE.Vector2(x, y));
      const torno = f.malha(new THREE.LatheGeometry(perfil, 72), 'ouro', { metalico: true, espessura: 0.014 }); corpo.add(torno);
      // serrilha: faixa fina com listras escuras sobre a borda
      const ser = texturaCanvas(THREE, 512, 16, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = '#8a5a10'; for (let x = 0; x < w; x += 8) c.fillRect(x, 0, 3, h); });
      ser.wrapS = THREE.RepeatWrapping; ser.repeat.set(3, 1);
      const borda = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.002, R + 0.002, T - 0.04, 72, 1, true), new THREE.MeshMatcapMaterial({ matcap: f.matcapDe('ouro', 'metal'), map: ser }));
      borda.material.toneMapped = false; corpo.add(borda);
      const face = texturaCanvas(THREE, 512, 512, desenharFaceMoeda); face.anisotropy = 8;
      for (const lado of [1, -1]) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(R * 0.79, 64), new THREE.MeshBasicMaterial({ map: face })); d.material.toneMapped = false;
        d.position.y = lado * (T / 2 - 0.013); d.rotation.x = -lado * Math.PI / 2; if (lado < 0) d.rotation.z = Math.PI; corpo.add(d);
      }
      const chao = sombra(f, 0.75, 0.2); chao.position.y = -0.42; raiz.add(chao);
      return { raiz, partes: { giro, chao } };
    },
    aplicar(p, e) { p.giro.rotation.y = (e.giro || 0) * G; p.giro.rotation.x = (e.inclina || 0) * G; p.chao.material.opacity = e.sombra ?? 1; p.chao.position.y = -0.42 - (e.altura || 0); },
  },

  comprovante: {
    pouso: [0, 0.5, 0], escala: 1,
    construir(f) {
      const { THREE } = f; const W = 0.64, H = 0.92;
      const raiz = new THREE.Group(); const folha = new THREE.Group(); raiz.add(folha);
      const geo = new THREE.PlaneGeometry(W, H, 1, 24); const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setZ(i, 0.028 * Math.sin((y / H) * Math.PI * 1.4) + 0.02 * ((y + H / 2) / H) ** 3); }
      geo.computeVertexNormals();
      const tx = texturaCanvas(THREE, 384, 552, (c, w, h) => {
        const dente = 16; c.beginPath(); c.moveTo(4, 4); c.lineTo(w - 4, 4); c.lineTo(w - 4, h - dente);
        for (let x = w - 4; x > 4; x -= dente * 2) { c.lineTo(x - dente, h - 4); c.lineTo(Math.max(4, x - dente * 2), h - dente); }
        c.closePath(); c.fillStyle = '#fffaf0'; c.fill(); c.lineWidth = 6; c.strokeStyle = '#191418'; c.stroke();
        c.save(); c.clip();
        c.fillStyle = '#191418'; c.fillRect(0, 0, w, 74); c.fillStyle = '#f5b70a'; c.fillRect(0, 74, w, 6);
        c.font = fonteTitulo(42); c.fillStyle = '#fff'; c.fillText('Autoni', 26, 52); c.fillStyle = '#f5b70a'; c.fillText('CK', 26 + c.measureText('Autoni').width, 52);
        c.fillStyle = '#4b4158'; c.font = fonteTexto(17, 600); c.fillText('REGISTRO DE VENDA', 26, 120);
        c.fillStyle = '#191418'; c.font = fonteTitulo(46); c.fillText('Venda nº 18', 26, 166);
        c.font = fonteTexto(18, 400); c.fillStyle = '#4b4158';
        [['Cliente', 'Cida Ramos'], ['Pagamento', 'Pix'], ['Itens', '2']].forEach(([a, b], i) => { c.fillText(a, 26, 214 + i * 34); c.textAlign = 'right'; c.fillStyle = '#191418'; c.fillText(b, w - 26, 214 + i * 34); c.textAlign = 'left'; c.fillStyle = '#4b4158'; });
        c.setLineDash([7, 6]); c.strokeStyle = '#9d91ab'; c.lineWidth = 2; c.beginPath(); c.moveTo(26, 330); c.lineTo(w - 26, 330); c.stroke(); c.setLineDash([]);
        c.font = fonteTitulo(40); c.fillStyle = '#191418'; c.fillText('TOTAL', 26, 378); c.textAlign = 'right'; c.fillStyle = '#c3161e'; c.fillText('R$ 69,90', w - 26, 378); c.textAlign = 'left';
        c.font = fonteTexto(14, 400); c.fillStyle = '#6b5f7a'; c.fillText('Registro interno do AutoniCK.', 26, 430); c.fillText('Não é documento fiscal.', 26, 452);
        c.restore();
      });
      const frente = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tx, transparent: true, alphaTest: 0.5 })); frente.material.toneMapped = false;
      const verso = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#efe4cd', side: THREE.BackSide, map: tx, transparent: true, alphaTest: 0.5 })); verso.material.toneMapped = false;
      folha.add(frente, verso);
      const seloTx = texturaCanvas(THREE, 256, 256, (c, w) => {
        const r = w / 2; c.translate(r, r); c.rotate(-0.2); c.strokeStyle = '#c3161e'; c.fillStyle = '#c3161e';
        c.lineWidth = 10; c.beginPath(); c.arc(0, 0, r - 10, 0, Math.PI * 2); c.stroke(); c.lineWidth = 4; c.beginPath(); c.arc(0, 0, r - 30, 0, Math.PI * 2); c.stroke();
        c.font = fonteTitulo(34); c.textAlign = 'center'; c.textBaseline = 'middle';
        const txt = 'CONFIRMADA · CONFIRMADA · '; const passo = (Math.PI * 2) / txt.length;
        for (let i = 0; i < txt.length; i++) { c.save(); c.rotate(i * passo); c.fillText(txt[i], 0, -(r - 50)); c.restore(); }
        c.font = fonteTitulo(70); c.fillText('CK', 0, 6);
      });
      const selo = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: seloTx, transparent: true, depthWrite: false })); selo.material.toneMapped = false;
      selo.position.set(0.15, -0.26, 0.05); folha.add(selo);
      const chao = sombra(f, 0.9, 0.24); chao.position.y = -0.62; raiz.add(chao);
      return { raiz, partes: { folha, selo, chao } };
    },
    aplicar(p, e) {
      const s = e.selo ?? 0; p.selo.visible = s > 0.01; p.selo.scale.setScalar(Math.max(0.0001, s < 1 ? 1.6 - 0.6 * s : 1)); p.selo.material.opacity = Math.min(1, s * 1.4);
      p.folha.rotation.x = (e.dobra || 0) * G; p.chao.material.opacity = e.sombra ?? 1;
    },
  },

  etiquetaCK: {
    pouso: [0, 1.6, 0], escala: 1,
    construir(f) {
      const { THREE } = f; const L = 0.42; // comprimento do cordão
      const raiz = new THREE.Group();
      const gancho = f.malha(new THREE.TorusGeometry(0.045, 0.016, 10, 24), 'ouro', { metalico: true, espessura: 0.01 }); gancho.rotation.y = Math.PI / 2;
      const pendulo = new THREE.Group(); raiz.add(gancho, pendulo);
      const cordao = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, L, 8), f.basico('papel2')); cordao.position.y = -L / 2 - 0.04;
      const forma = (k, z0 = 0) => { const s = new THREE.Shape(); const w = 0.21 * k, h = 0.3 * k, c = 0.09 * k; s.moveTo(-w, -h); s.lineTo(w, -h); s.lineTo(w, h - c); s.lineTo(0, h + c * 0.4); s.lineTo(-w, h - c); s.closePath(); return s; };
      const placa = new THREE.Group(); placa.position.y = -L - 0.04 - 0.36; pendulo.add(cordao, placa);
      const furo = new THREE.Path(); furo.absarc(0, 0.24, 0.032, 0, Math.PI * 2, true); const sf = forma(1); sf.holes.push(furo);
      const ext = { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 };
      const moldura = f.malha(new THREE.ExtrudeGeometry(sf, ext), 'ouro', { metalico: true, espessura: 0.014 }); moldura.position.z = -0.03;
      const campoForma = forma(0.9); const campo = f.malha(new THREE.ExtrudeGeometry(campoForma, { ...ext, depth: 0.03, bevelSize: 0.006, bevelThickness: 0.006 }), 'vermelhoEscuro', { contorno: false }); campo.position.set(0, -0.012, 0.012);
      const texto = { valor: '' };
      const tx = texturaCanvas(THREE, 256, 256, () => {});
      const rotulo = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: tx, transparent: true })); rotulo.material.toneMapped = false; rotulo.position.set(0, -0.07, 0.06);
      placa.add(moldura, campo, rotulo);
      const chao = sombra(f, 0.6, 0.16); chao.position.y = -1.25; raiz.add(chao);
      return { raiz, partes: { pendulo, placa, tx, texto, chao } };
    },
    aplicar(p, e) {
      p.pendulo.rotation.z = (e.balanco || 0) * G; p.placa.rotation.y = (e.giro || 0) * G;
      const v = e.preco ?? 'R$ 29,90';
      if (v !== p.texto.valor) {
        p.texto.valor = v; const [r, c] = v.replace('R$ ', '').split(',');
        if (!v) p.tx.redesenhar(() => {}); else
        p.tx.redesenhar((ctx, w) => {
          const cent = `,${c ?? '00'}`;
          ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
          ctx.font = fonteTitulo(122); const wr = ctx.measureText(r).width; ctx.font = fonteTitulo(58); const wc = ctx.measureText(cent).width;
          const x0 = (w - (wr + wc + 4)) / 2;
          ctx.font = fonteTexto(28, 700); ctx.fillStyle = '#ffdf7e'; ctx.textAlign = 'center'; ctx.fillText('R$', w / 2, 66); ctx.textAlign = 'left';
          ctx.font = fonteTitulo(122); ctx.lineWidth = 12; ctx.strokeStyle = '#191418'; ctx.strokeText(r, x0, 182); ctx.fillStyle = '#fff6e2'; ctx.fillText(r, x0, 182);
          ctx.font = fonteTitulo(58); ctx.lineWidth = 9; ctx.strokeText(cent, x0 + wr + 4, 132); ctx.fillStyle = '#ffdf7e'; ctx.fillText(cent, x0 + wr + 4, 132);
        });
      }
      p.chao.material.opacity = 0.6 - Math.abs(e.balanco || 0) / 40;
    },
  },
});

export { PALETA };
