// Utilidades das páginas: réplicas no palco, miniaturas e vitrines 3D avulsas.
import { criarReplica } from '../replica.js';
import { obterMotor, URL_POSTER } from '../motor/motor.js';
import { RUNTIME } from '../estado.js';

export const LARG = { desktop: 1280, celular: 390, ampla: 1680 };

/** Réplica no palco (desktop, celular ou tela ampla). */
export function slotReplica(moldura, cfg, modo, { rolagem = false, tela = 'home', aoPronto } = {}) {
  return criarReplica(moldura, cfg, { tela, largura: LARG[modo] ?? 1280, recorte: rolagem || tela === 'business' ? 'tudo' : 'heroi', tocando: !RUNTIME.reduzido, aoPronto });
}
/** Miniatura estática de réplica; toca ao passar o mouse ou focar. */
export function miniReplica(el, cfg, t = 4.4, op = {}) {
  const r = criarReplica(el, cfg, { largura: op.largura ?? 1280, recorte: op.recorte ?? 'heroi', miniatura: true, tocando: false, t, tela: op.tela });
  return { tocar: () => r.tocar(), pausar: () => r.pausar(), destruir: () => r.destruir(), replica: r };
}
/** Vitrine 3D avulsa (sem réplica): fonte(t, ctx) → { pose, info }. */
export function vitrine3D(el, { fonte, enquadramento, t = 0, tocando = false, miniatura = true, sino = true, estilo, zoom, aoQuadro, aoTocar, hq, ponteiro } = {}) {
  let v = null, morto = false;
  const poster = document.createElement('img'); poster.className = 'poster-3d'; poster.alt = ''; poster.src = URL_POSTER; el.append(poster);
  const p = obterMotor().then((m) => {
    if (morto) return null;
    v = m.criarVista(el, { fonte, enquadramento, t, tocando, miniatura, sino, estilo, zoom, aoQuadro, aoTocar, hq, ponteiro }); poster.remove(); return v;
  }).catch(() => null);
  return {
    pronto: p, get vista() { return v; },
    tocar() { v?.tocar(); }, pausar() { v?.pausar(); }, irPara(t2) { v?.irPara(t2); },
    destruir() { morto = true; v?.liberar(); poster.remove(); },
  };
}
export function aoReiniciar(fn) { document.addEventListener('lab:reiniciar', fn); return () => document.removeEventListener('lab:reiniciar', fn); }
export const opcoes = (lista, sel) => lista.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${p.id} · ${p.nome}</option>`).join('');
