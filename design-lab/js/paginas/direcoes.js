import { h, cabecalho, ficha, grade, palco } from '../ui.js';
import { J, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { criarReplica } from '../replica.js';
import { LARG, miniReplica, aoReiniciar } from './comum.js';

const HEROI = { J00: { a: 'A00' }, J01: { a: 'A01' }, J02: { a: 'A03', e: 'E06', ie: 2, anim: 'B05' }, J03: { a: 'A03', e: 'E04', ie: 1, anim: 'B14', botao: 'metal' }, J04: { a: 'A02', e: 'E01', ie: 2, anim: 'B01', feedback: 'F13' }, J05: { a: 'A02', e: 'E07', anim: 'B02', feedback: 'F13' }, J06: { a: 'A07', e: 'E08', ie: 1, anim: 'B12' } };

export function montar(main) {
  main.append(cabecalho('J', 'Evolução da linguagem visual CK', 'Seis direções completas, todas dentro da identidade CK. Cada uma aparece na página institucional (expressiva) e no painel Business (onde se trabalha por horas), para comparar como a intensidade muda de um contexto para o outro.', [
    ['Base preservada', 'HQ Heroica, Forja Dourada e Noite Elétrica (tokens.css, M13b)'],
    ['O que varia', 'contraste, sombras, cantos, tipografia de título, intensidade do herói'],
    ['Telas mostradas', 'home pública e painel Business, em desktop, celular e tela ampla'],
  ]));
  const pal = palco({
    titulo: 'Home e painel', inicial: loja.escolhida('J') ?? 'J05',
    criar: (m, id, modo, o) => {
      o.legenda.textContent = porId(id)?.nome ?? '';
      m.style.background = 'transparent'; m.style.boxShadow = 'none'; m.style.display = 'grid'; m.style.gap = '.8rem';
      const a = document.createElement('div'); const b = document.createElement('div');
      a.className = 'moldura'; b.className = 'moldura'; m.append(a, b);
      const r1 = criarReplica(a, { dir: id, ...HEROI[id] }, { largura: LARG[modo], recorte: 'tudo', tocando: true });
      const r2 = criarReplica(b, { dir: id }, { tela: 'business', largura: LARG[modo], recorte: 'tudo' });
      return { destruir() { r1.destruir(); r2.destruir(); }, reiniciar() { r1.reiniciar(); } };
    },
  });
  const fichaBox = h('<div class="painel"></div>');
  const mostrar = (id) => { fichaBox.replaceChildren(ficha('J', porId(id), { aoComparar: (p) => pal.comparar(p.id) })); g.marcar(id); };
  const g = grade('J', J, {
    classeVitrine: 'vitrine--replica',
    miniatura: (el, p) => miniReplica(el, { dir: p.id, ...HEROI[p.id] }, 4.45),
    aoVer: (p) => { pal.selecionar(p.id); mostrar(p.id); pal.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    aoComparar: (p) => pal.comparar(p.id),
  });
  main.append(fichaBox, pal.el, h('<div class="secao-titulo"><h2>Todas as direções</h2><p>Miniatura da home; o palco mostra também o painel Business.</p></div>'), g);
  mostrar(pal.est.a);
  const parar = aoReiniciar(() => pal.controles.forEach((c) => c.reiniciar?.()));
  return () => { parar(); pal.destruir(); g.__destruir(); };
}
