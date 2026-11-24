import { h, esc, cabecalho, acoes } from '../ui.js';
import { K, porId, D, D_CHAVES } from '../catalogo.js';
import { loja } from '../estado.js';
import { miniReplica } from './comum.js';

const nome = (id) => (id ? `${id} ${porId(id)?.nome ?? ''}` : 'nenhum');
export function montar(main, { irPara }) {
  main.append(cabecalho('K', 'Combinações prontas', 'Seis montagens completas, cada uma com um objetivo. Abra no combinador para experimentar e trocar qualquer peça. Elas são pontos de partida: a decisão continua sendo sua.'));
  const g = h('<div class="grade grade--larga"></div>'); const ctrls = [];
  for (const k of K) {
    const c = k.cfg;
    const obj = c.objeto ? D[D_CHAVES.indexOf(c.objeto)]?.id : null;
    const el = h(`<article class="cartao-prop"><div class="vitrine vitrine--replica"></div><div class="corpo">
      <h3><span class="id">${k.id}</span>${esc(k.nome)}</h3><p>${esc(k.porque)}</p>
      <dl class="ficha-tecnica" style="display:grid;grid-template-columns:max-content 1fr;gap:.15rem .6rem;font-size:.78rem;margin:.3rem 0 0">
        <dt>Direção</dt><dd>${esc(nome(c.dir))}</dd><dt>Fundo</dt><dd>${esc(nome(c.a))} + ${esc(nome(c.e))} (intensidade ${c.ie})</dd><dt>Sino</dt><dd>${esc(nome(c.anim))} · ${esc(nome(c.ritmo))}</dd>
        <dt>Objeto</dt><dd>${esc(nome(obj))}</dd><dt>Clique e loader</dt><dd>${esc(nome(c.feedback))} · ${esc(c.loader)}</dd><dt>Interação</dt><dd>${esc(nome(c.ling))} · botão ${esc(c.botao)}</dd></dl>
      <div class="rodape-cartao"><button type="button" class="bt bt--ouro bt--pequeno" data-abrir>Abrir no combinador</button></div></div></article>`);
    el.querySelector('.rodape-cartao').append(acoes('K', k, { pequeno: true, semEscolher: true }));
    el.querySelector('[data-abrir]').addEventListener('click', () => { loja.d.combinador = { ...c }; loja.salvar(); irPara('combinador'); });
    const vit = el.querySelector('.vitrine'); const m = miniReplica(vit, c, 4.45); ctrls.push(m);
    vit.addEventListener('pointerenter', () => m.tocar()); vit.addEventListener('pointerleave', () => m.pausar());
    g.append(el);
  }
  main.append(g);
  return () => ctrls.forEach((c) => c.destruir());
}
