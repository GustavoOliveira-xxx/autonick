import { h, cabecalho, ficha, segmentado } from '../ui.js';
import { H, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { folhaComponentes } from './folha.js';

export function montar(main) {
  let ling = loja.escolhida('H') ?? 'H01';
  main.append(cabecalho('H', 'Componentes e microinterações', 'Três linguagens de interação aplicadas aos mesmos componentes reais do app: botões, cartões, menus, links, campos, seletores, abas, notificações, modal, dicas, tabela, estados, progresso, confirmação, erro, vazio e acordeão. Use mouse, toque e teclado (Tab, setas nas abas, Esc no modal).', [
    ['Estados cobertos', 'hover, foco, pressionado, desabilitado, sucesso, erro, expandir e recolher, troca de conteúdo'],
    ['Tempos', 'Prensa <b>90 ms</b> · Forja <b>200 ms</b> · Quadro a quadro <b>120 ms</b> em passos'],
    ['Movimento reduzido', 'todas mantêm só cor e contorno; nada desloca ou gira'],
  ]));
  const area = h('<div class="cat" style="gap:1rem"></div>');
  const fichaBox = h('<div class="painel"></div>');
  const barra = h('<div class="palco-barra"><div class="titulo-palco"><b>Linguagem</b></div></div>');
  barra.append(segmentado('Linguagem', [['H01', 'H01 · Prensa'], ['H02', 'H02 · Forja'], ['H03', 'H03 · Quadro a quadro'], ['lado', 'As três lado a lado']], ling, (v) => { ling = v; render(); }));
  function render() {
    area.innerHTML = '';
    if (ling === 'lado') {
      const g = h('<div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))"></div>');
      for (const p of H) { const col = h(`<div style="display:grid;gap:.5rem;align-content:start"><p><span class="id">${p.id}</span> <b>${p.nome}</b></p></div>`); const f = folhaComponentes(p.id, { compacta: true }); f.style.gridTemplateColumns = '1fr'; col.append(f); g.append(col); }
      area.append(g); fichaBox.replaceChildren(ficha('H', porId('H01')));
    } else { area.append(folhaComponentes(ling)); fichaBox.replaceChildren(ficha('H', porId(ling))); }
  }
  const bloco = h('<section class="palco-bloco"></section>'); bloco.append(barra, area);
  main.append(bloco, fichaBox); render();
  return () => {};
}
