import { h, cabecalho, ficha, grade, palco, linhaTempo } from '../ui.js';
import { B, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { ANIMACOES, criarLaco, RITMOS, tempoRepresentativo } from '../motor/animacoes.js';
import { slotReplica, vitrine3D, aoReiniciar } from './comum.js';

export function montar(main) {
  main.append(cabecalho('B', 'Novas animações do sino', 'Quinze cenas com o mesmo modelo e o mesmo rig. A B00 é a animação em produção, carregada do próprio código do app. Clique no sino durante a reprodução para disparar a ação principal de novo (na B09, para tocá-lo).', [
    ['Cena atual', '<b>8,0 s</b>, impacto em <b>4,36 s</b>, movimento até <b>~7,06 s</b>'],
    ['Rig usado', 'pivôs do sino, badalo, martelo, olhos, testeira, 3 bocas e efeitos do GLB'],
    ['Novos objetos', 'todos procedurais (Three.js), sem assets externos'],
  ]));
  const linhas = [];
  const pal = palco({
    titulo: 'Palco', inicial: loja.escolhida('B') ?? 'B02',
    criar: (m, id, modo, o) => {
      o.legenda.textContent = porId(id)?.nome ?? '';
      const r = slotReplica(m, { a: 'A01', anim: id }, modo, o);
      const lt = linhaTempo(); m.parentElement.append(lt.el); linhas[o.lado] = { r, lt, id };
      return r;
    },
  });
  const fichaBox = h('<div class="painel"></div>');
  const mostrar = (id) => { fichaBox.replaceChildren(ficha('B', porId(id), { aoComparar: (p) => pal.comparar(p.id) })); g.marcar(id); };
  const g = grade('B', B, {
    classeVitrine: 'vitrine--quadrada',
    miniatura: (el, p) => {
      const a = ANIMACOES[p.id]; const laco = criarLaco(a, RITMOS.C01);
      return vitrine3D(el, { fonte: (t, ctx) => laco.quadro(t, ctx), enquadramento: a.enquadramento, t: tempoRepresentativo(a), ponteiro: a.livre });
    },
    aoVer: (p) => { linhas.length = 0; pal.selecionar(p.id); mostrar(p.id); pal.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    aoComparar: (p) => { linhas.length = 0; pal.comparar(p.id); },
  });
  main.append(pal.el, fichaBox, h('<div class="secao-titulo"><h2>Todas as animações</h2><p>Paradas no quadro mais expressivo; passe o mouse para tocar.</p></div>'), g);
  mostrar(pal.est.a);
  let raf = 0;
  const loop = () => { for (const l of linhas) if (l?.r?.info) l.lt.atualizar(l.r.info, ANIMACOES[l.r.cfg.anim]); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const parar = aoReiniciar(() => pal.controles.forEach((c) => c.reiniciar()));
  return () => { cancelAnimationFrame(raf); parar(); pal.destruir(); g.__destruir(); };
}
