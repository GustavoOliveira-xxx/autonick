import { h, esc, cabecalho, ficha, grade, segmentado } from '../ui.js';
import { D, D_CHAVES, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { OBJETOS } from '../motor/objetos.js';
import { poseNeutra } from '../motor/curvas.js';
import { vitrine3D, aoReiniciar } from './comum.js';

const chaveDe = (id) => D_CHAVES[Number(id.slice(1)) - 1];
const FASES = [['ciclo', 'Ciclo completo'], ['entrada', 'Entrada'], ['ocioso', 'Ocioso'], ['interacao', 'Interação com o sino'], ['saida', 'Saída']];

/** Sequência de um objeto: devolve o estado e deixa a reação na pose do sino. */
function quadroObjeto(def, fase, t, p) {
  const d = def.dur; const ocioso = 1.4, folga = 0.7;
  const seq = fase === 'ciclo' ? [['entrada', d.entrada], ['ocioso', ocioso], ['interacao', d.interacao], ['saida', d.saida], ['vazio', folga]]
    : fase === 'ocioso' ? [['ocioso', 6]] : fase === 'entrada' ? [['entrada', d.entrada], ['ocioso', 1.2], ['vazio', 0.5]]
      : fase === 'saida' ? [['ocioso', 0.8], ['saida', d.saida], ['vazio', 0.8]] : [['interacao', d.interacao], ['ocioso', 0.9]];
  const total = seq.reduce((a, [, x]) => a + x, 0); let u = t % total;
  for (const [nome, dur] of seq) {
    if (u < dur) {
      if (nome === 'vazio') return null;
      if (nome === 'interacao') return def.interacao(u, p);
      return def[nome](u);
    }
    u -= dur;
  }
  return null;
}

export function montar(main) {
  const est = { id: loja.escolhida('D') ?? 'D01', fase: 'ciclo', modo: 'hq', luz: 'frontal', contorno: true, escala: 1, sino: true, giro: 0 };
  main.append(cabecalho('D', 'Interações com outros objetos 3D', 'Quinze objetos modelados por código, no mesmo traço do sino: cores chapadas, sombra em faixas (matcap gerado em canvas) e contorno de tinta. Nenhum arquivo extra é baixado. Troque material, luz, contorno e escala para avaliar cada aspecto.', [
    ['Técnica', 'primitivas do Three.js, extrusão de formas 2D e texturas desenhadas em canvas'],
    ['Contorno', 'casco invertido com normais suavizadas, cor <b>#191418</b> (a tinta do GLB)'],
    ['Renderização', 'o mesmo contexto WebGL do sino; objetos só existem depois do primeiro uso'],
  ]));
  const palcoEl = h(`<section class="palco-bloco"><div class="palco-barra"><div class="titulo-palco"><b>Palco</b><span class="id" data-id></span><span data-nome></span></div></div>
    <div class="duas-colunas" style="grid-template-columns:minmax(0,2fr) minmax(16rem,1fr)"><div class="moldura vista" style="aspect-ratio:16/9;background:radial-gradient(circle at 55% 40%,#ff9a2e,#c3161e 45%,#5a070b)"></div>
    <div class="painel" data-ctl><h3>Fase</h3></div></div></section>`);
  const ctl = palcoEl.querySelector('[data-ctl]');
  const add = (rot, el) => { ctl.append(h(`<h3>${esc(rot)}</h3>`), el); };
  ctl.querySelector('h3').after(segmentado('Fase', FASES.slice(0, 3), est.fase, (v) => { est.fase = v; reiniciar(); }), segmentado('Fase', FASES.slice(3), '', (v) => { est.fase = v; reiniciar(); }));
  add('Material', segmentado('Material', [['hq', 'HQ (faixas)'], ['metal', 'Metal'], ['chapado', 'Chapado']], est.modo, (v) => { est.modo = v; estilo(); }));
  add('Iluminação', segmentado('Luz', [['frontal', 'Frontal'], ['recorte', 'Contraluz'], ['quente', 'Quente']], est.luz, (v) => { est.luz = v; estilo(); }));
  add('Contorno e escala', h('<div class="acoes-proposta"></div>'));
  const linhaCE = ctl.lastElementChild;
  linhaCE.append(segmentado('Contorno', [['1', 'Com contorno'], ['0', 'Sem']], '1', (v) => { est.contorno = v === '1'; estilo(); }), segmentado('Escala', [['0.75', 'P'], ['1', 'M'], ['1.35', 'G']], '1', (v) => { est.escala = Number(v); v3.vista?.redesenhar(); }));
  add('Cena', h('<div class="acoes-proposta"></div>'));
  const linhaCena = ctl.lastElementChild;
  linhaCena.append(segmentado('Sino', [['1', 'Com o sino'], ['0', 'Só o objeto']], '1', (v) => { est.sino = v === '1'; v3.vista?.atualizar({ sino: est.sino, enquadramento: enq() }); }));
  const giro = h('<label class="campo-lab">Girar a câmera <input type="range" min="-60" max="60" value="0" id="d-giro"></label>'); ctl.append(giro);
  giro.querySelector('input').addEventListener('input', (e) => { est.giro = Number(e.target.value); v3.vista?.redesenhar(); });

  const def = () => OBJETOS[chaveDe(est.id)];
  function enq() { const d = def(); return est.sino ? { meiaAltura: 1.7, meiaLargura: 3.1, deslocX: d.pouso[0] * 0.42 } : { meiaAltura: 1.0, meiaLargura: 1.0, deslocX: d.pouso[0], deslocY: d.pouso[1] + 0.35 - 1.15 }; }
  function fonte(t) {
    const p = poseNeutra(); p.camera.az = est.giro; const d = def();
    const e = quadroObjeto(d, est.fase, t, p);
    if (e) p.objetos.push({ id: chaveDe(est.id), ...e, esc: (e.esc ?? 1) * est.escala });
    if (!est.sino) p.hq = p.hq.filter((g) => Array.isArray(g.em));
    return { pose: p, info: {} };
  }
  const v3 = vitrine3D(palcoEl.querySelector('.moldura'), { fonte, enquadramento: enq(), tocando: true, miniatura: false });
  const estilo = () => v3.vista?.atualizar({ estilo: { modo: est.modo, luz: est.luz, contorno: est.contorno } });
  function reiniciar() { v3.irPara(0); }
  function mostrar(id) {
    est.id = id; palcoEl.querySelector('[data-id]').textContent = id; palcoEl.querySelector('[data-nome]').textContent = porId(id).nome;
    v3.vista?.atualizar({ enquadramento: enq() }); reiniciar();
    fichaBox.replaceChildren(ficha('D', porId(id))); g.marcar(id);
  }
  const fichaBox = h('<div class="painel"></div>');
  const g = grade('D', D, {
    classeVitrine: 'vitrine--quadrada',
    miniatura: (el, p) => {
      const d = OBJETOS[chaveDe(p.id)];
      return vitrine3D(el, { sino: false, hq: false, enquadramento: { meiaAltura: 0.95, meiaLargura: 0.95, deslocX: d.pouso[0], deslocY: d.pouso[1] + 0.35 - 1.15 }, t: d.dur.interacao * 0.45,
        fonte: (t) => { const pz = poseNeutra(); const e = d.interacao(t % (d.dur.interacao + 0.6), pz); pz.objetos = [{ id: chaveDe(p.id), ...e }]; pz.hq = []; return { pose: pz, info: {} }; } });
    },
    aoVer: (p) => { mostrar(p.id); palcoEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  });
  main.append(palcoEl, fichaBox, h('<div class="secao-titulo"><h2>Todos os objetos</h2><p>Passe o mouse para ver a interação; clique para levar ao palco.</p></div>'), g);
  v3.pronto.then(() => { estilo(); mostrar(est.id); });
  mostrar(est.id);
  const parar = aoReiniciar(reiniciar);
  return () => { parar(); v3.destruir(); g.__destruir(); };
}
