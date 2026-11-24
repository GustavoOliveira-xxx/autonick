import { h, cabecalho, ficha, grade, palco, linhaTempo } from '../ui.js';
import { B, C, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { ANIMACOES, paradoOriginal, LACO_ORIGINAL } from '../motor/animacoes.js';
import { slotReplica, aoReiniciar, opcoes } from './comum.js';

export function montar(main) {
  let anim = loja.escolhida('B') ?? 'B00'; let personalizado = null;
  const S0 = paradoOriginal(ANIMACOES.B00);
  main.append(cabecalho('C', 'Ritmo e intervalo das animações', 'O laço de cada animação é cena, pausa na pose final e retorno suave. Aqui a pausa muda sem mexer na cena. As porcentagens valem sobre o tempo parado percebido, e não só sobre a pausa do código.', [
    ['Laço atual (heroi-sino.js)', `cena <b>${LACO_ORIGINAL.cena} s</b> · pausa <b>${LACO_ORIGINAL.pausaFinal} s</b> · retorno <b>${LACO_ORIGINAL.retorno} s</b> · ciclo <b>${LACO_ORIGINAL.cena + LACO_ORIGINAL.pausaFinal + LACO_ORIGINAL.retorno} s</b>`],
    ['Parado percebido hoje', `<b>${S0.toFixed(2).replace('.', ',')} s</b> por ciclo (cauda imóvel de 0,94 s + pausa de 3,5 s)`],
    ['Fases da cena atual', 'antecipação até <b>4,22 s</b>, golpe e impacto em <b>4,36 s</b>, recuperação até <b>~7,06 s</b>'],
  ]));
  const seg = h(`<span class="ctl"><label for="c-seg">Parado personalizado</label><input id="c-seg" type="range" min="0.8" max="6" step="0.1" value="${S0.toFixed(1)}"><output id="c-seg-v">desligado</output><button type="button" class="bt bt--pequeno" id="c-seg-x">Desligar</button></span>`);
  const selAnim = h(`<span class="ctl"><label for="c-anim">Animação</label><select id="c-anim">${opcoes(B.filter((b) => b.id !== 'B09'), anim)}</select></span>`);
  const extras = h('<span style="display:contents"></span>'); extras.append(selAnim, seg);
  const linhas = [];
  const pal = palco({
    titulo: 'Palco', inicial: loja.escolhida('C') ?? 'C03', extrasBarra: extras,
    criar: (m, id, modo, o) => {
      o.legenda.textContent = porId(id)?.nome ?? '';
      const r = slotReplica(m, { a: 'A01', anim, ritmo: id, ritmoSeg: o.lado === 0 ? personalizado : null }, modo, o);
      const lt = linhaTempo(); m.parentElement.append(lt.el); linhas[o.lado] = { r, lt };
      return r;
    },
  });
  selAnim.querySelector('select').addEventListener('change', (e) => { anim = e.target.value; linhas.length = 0; pal.render(); });
  const inp = seg.querySelector('input'), out = seg.querySelector('output');
  inp.addEventListener('input', () => { personalizado = Number(inp.value); out.textContent = `${personalizado.toFixed(1).replace('.', ',')} s`; pal.controles[0]?.definir({ ritmoSeg: personalizado }); });
  seg.querySelector('#c-seg-x').addEventListener('click', () => { personalizado = null; out.textContent = 'desligado'; pal.controles[0]?.definir({ ritmoSeg: null }); });
  const fichaBox = h('<div class="painel"></div>');
  const mostrar = (id) => { fichaBox.replaceChildren(ficha('C', porId(id), { aoComparar: (p) => pal.comparar(p.id) })); g.marcar(id); };
  const g = grade('C', C, { aoVer: (p) => { linhas.length = 0; pal.selecionar(p.id); mostrar(p.id); pal.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, aoComparar: (p) => { linhas.length = 0; pal.comparar(p.id); } });
  const dica = h('<p class="aviso-lab"><b>Dica:</b> ligue "Comparar lado a lado" com C01 e outra opção e use "Reiniciar" no topo: os dois laços recomeçam juntos e a diferença de espera fica evidente a partir do segundo ciclo.</p>');
  main.append(pal.el, dica, fichaBox, h('<div class="secao-titulo"><h2>Opções de ritmo</h2><p>Clique num cartão para levar ao palco.</p></div>'), g);
  mostrar(pal.est.a);
  let raf = 0; const loop = () => { for (const l of linhas) if (l?.r?.info) l.lt.atualizar(l.r.info, ANIMACOES[l.r.cfg.anim]); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
  const parar = aoReiniciar(() => pal.controles.forEach((c) => c.reiniciar()));
  return () => { cancelAnimationFrame(raf); parar(); pal.destruir(); g.__destruir(); };
}
