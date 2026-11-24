import { h, cabecalho, ficha, grade, palco } from '../ui.js';
import { A, B, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { slotReplica, miniReplica, aoReiniciar, opcoes } from './comum.js';

export function montar(main) {
  let anim = 'B00';
  main.append(cabecalho('A', 'Composição e centralização do fundo', 'Onze composições aplicadas sobre a reprodução fiel da home. O foco de cada uma é calculado a partir da posição real do sino na tela, então continua certo em qualquer largura.', [
    ['Foco atual', 'raios e luz em <b>82% × 40%</b> do herói (componentes.css, .heroi)'],
    ['Sino atual', 'coluna direita, palco quadrado de até <b>30rem</b> (apresentacao.css)'],
    ['Desvio medido nesta réplica', '<span data-desvio>calculando…</span>'],
  ]));
  const selAnim = h(`<span class="ctl"><label for="a-anim">Sino no palco</label><select id="a-anim">${opcoes(B, anim)}</select></span>`);
  const pal = palco({
    titulo: 'Palco', inicial: loja.escolhida('A') ?? 'A01', extrasBarra: selAnim,
    criar: (m, id, modo, o) => { o.legenda.textContent = porId(id)?.nome ?? ''; return slotReplica(m, { a: id, anim }, modo, o); },
  });
  selAnim.querySelector('select').addEventListener('change', (e) => { anim = e.target.value; pal.controles.forEach((c) => c.definir({ anim })); });
  const fichaBox = h('<div class="painel"></div>');
  const mostrarFicha = (id) => { fichaBox.replaceChildren(ficha('A', porId(id), { aoComparar: (p) => pal.comparar(p.id) })); g.marcar(id); };
  const g = grade('A', A, {
    classeVitrine: 'vitrine--replica',
    miniatura: (el, p) => miniReplica(el, { a: p.id }, 4.45),
    aoVer: (p) => { pal.selecionar(p.id); mostrarFicha(p.id); pal.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    aoComparar: (p) => pal.comparar(p.id),
  });
  main.append(pal.el, fichaBox, h('<div class="secao-titulo"><h2>Todas as composições</h2><p>Miniaturas paradas no quadro do impacto; passe o mouse para tocar.</p></div>'), g);
  mostrarFicha(pal.est.a);
  // desvio real entre o centro dos raios e o centro do sino na proposta do palco
  const alvo = main.querySelector('[data-desvio]');
  const medir = setInterval(() => {
    const d = pal.controles[0]?.desvio?.(); if (!d) return;
    alvo.innerHTML = `<b>${Math.round(d.d)} px</b> em ${d.hw} px de largura (${pal.est.a}${pal.est.a === 'A00' ? ', atual' : ''})`;
  }, 700);
  const parar = aoReiniciar(() => pal.controles.forEach((c) => c.reiniciar()));
  return () => { clearInterval(medir); parar(); pal.destruir(); g.__destruir(); };
}
