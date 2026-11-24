// Grafismos de HQ desenhados em canvas 2D por cima do 3D (onomatopeias, linhas de ação, faíscas, anéis).
import { G, clamp } from './curvas.js';

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
