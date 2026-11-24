import { h, cabecalho, ficha, grade, palco, segmentado } from '../ui.js';
import { A, E, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { slotReplica, miniReplica, aoReiniciar, opcoes } from './comum.js';

export function montar(main) {
  let a = loja.escolhida('A') ?? 'A01'; let ie = loja.d.intensidadeE ?? 2;
  main.append(cabecalho('E', 'Fundo animado', 'Dez movimentos de fundo, cada um em três intensidades. Todos são motivados pelo sino (golpe, balanço, posição) ou por quem usa (cursor, rolagem). Nada se move sozinho sem motivo, e os efeitos perdem força atrás da coluna de texto.', [
    ['Regra de leitura', 'canvas e luz com máscara: <b>20%</b> de força sobre o texto'],
    ['Pausa', 'fora da tela, com a aba oculta, com "Pausar tudo" e com movimento reduzido'],
    ['Rolagem (E10)', 'ligue "Página rolável" no palco e role dentro da moldura'],
  ]));
  const selA = h(`<span class="ctl"><label for="e-a">Composição</label><select id="e-a">${opcoes(A, a)}</select></span>`);
  const intens = segmentado('Intensidade', [['1', 'Sutil'], ['2', 'Equilibrado'], ['3', 'Expressivo']], ie, (v) => { ie = Number(v); loja.d.intensidadeE = ie; loja.salvar(); pal.controles.forEach((c) => c.definir({ ie })); });
  const extras = h('<span style="display:contents"></span>'); extras.append(selA, intens);
  const pal = palco({
    titulo: 'Palco', inicial: loja.escolhida('E') ?? 'E03', extrasBarra: extras, rolavel: true,
    criar: (m, id, modo, o) => { o.legenda.textContent = porId(id)?.nome ?? ''; return slotReplica(m, { a, e: id, ie, anim: loja.escolhida('B') ?? 'B00' }, modo, o); },
  });
  selA.querySelector('select').addEventListener('change', (ev) => { a = ev.target.value; pal.controles.forEach((c) => c.definir({ a })); });
  const fichaBox = h('<div class="painel"></div>');
  const mostrar = (id) => { fichaBox.replaceChildren(ficha('E', porId(id), { aoComparar: (p) => pal.comparar(p.id) })); g.marcar(id); };
  const g = grade('E', E, {
    classeVitrine: 'vitrine--replica',
    miniatura: (el, p) => miniReplica(el, { a: 'A01', e: p.id, ie: 2 }, 4.45),
    aoVer: (p) => { pal.selecionar(p.id); mostrar(p.id); pal.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    aoComparar: (p) => pal.comparar(p.id),
  });
  main.append(pal.el, fichaBox, h('<div class="secao-titulo"><h2>Todos os fundos animados</h2><p>Parados até você passar o mouse: o movimento só aparece tocando.</p></div>'), g);
  mostrar(pal.est.a);
  const parar = aoReiniciar(() => pal.controles.forEach((c) => c.reiniciar()));
  return () => { parar(); pal.destruir(); g.__destruir(); };
}
