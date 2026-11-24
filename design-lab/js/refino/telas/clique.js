// Clique vivo e carregamentos por contexto. A resposta visual começa no pointerdown (0 ms); o indicador de
// operação só aparece depois de 120 ms (sem piscar em respostas rápidas) e some quando a resposta real chega.
import { h, ic, operar, simular, SIM, aviso, SIMBOLO } from '../pecas.js';

const ESTILOS = [['forja', 'Forja', 'Prensa + onda dourada do ponto tocado + lampejo metálico. Recomendado.'], ['prensa', 'Prensa', 'Só a compressão física, sem brilho. Mais sóbrio, bom para o CK Admin.'], ['faisca', 'Faísca', 'Prensa + onda + faíscas curtas. Mais divertido; bom para ações de destaque.']];

function cardLoader(titulo, quando, demo, rodar) {
  const c = h(`<article class="rf-cartao rf-cartao--p" style="display:grid;gap:10px;align-content:start"><div><b>${titulo}</b><p class="rf-fraco" style="margin:2px 0 0">${quando}</p></div>
    <div style="min-height:120px;display:grid;place-items:center;border-radius:12px;background:var(--rf-sup2);border:1px solid var(--rf-linha);position:relative;overflow:hidden;padding:12px" data-demo>${demo}</div>
    <button type="button" class="rf-bt rf-bt--s">${ic('atualizar')}Testar</button></article>`);
  c.querySelector('button').addEventListener('click', () => rodar(c.querySelector('[data-demo]'), c.querySelector('button')));
  return c;
}
async function comLimiar(mostrar, esconder) {
  const t = setTimeout(mostrar, SIM.limiar); let ok = true;
  try { await simular(); } catch (e) { ok = false; aviso('erro', 'Falhou', e.message); }
  clearTimeout(t); esconder(ok); return ok;
}

export function montar() {
  const s = h(`<section class="lb-sec"><header class="lb-cab"><h1>Clique e <em>carregamento</em></h1><p>O botão responde no mesmo instante em que o dedo ou o mouse descem: afunda, acende e solta uma onda dourada a partir do ponto tocado. Se a operação demorar, o contorno corre pela borda e o rótulo diz o que está acontecendo. Quando o servidor confirma, aparece um ✓; no erro, o botão treme de leve e o aviso explica.</p></header>
    <div class="lb-objetivo" style="margin-top:14px"><div class="lb-obj"><b>0 ms · toque</b><p>Compressão de 2 px, brilho e onda (no pointerdown, antes de soltar).</p></div><div class="lb-obj"><b>120 ms · operação</b><p>Se ainda não respondeu: contorno que corre, rótulo "Salvando…" e o sininho.</p></div><div class="lb-obj"><b>Resposta</b><p>✓ "Pronto" por 0,7 s ou tremida curta + aviso com o motivo.</p></div><div class="lb-obj"><b>Sem atraso falso</b><p>Nada espera de propósito. Respostas rápidas nem mostram o contorno.</p></div></div>
    <div class="rf-cartao rf-cartao--p" style="display:grid;gap:14px;margin-top:18px"><div class="rf-secao-t"><h3>Estilo do clique</h3><div class="rf-abas" role="radiogroup" aria-label="Estilo do clique" data-estilos>${ESTILOS.map(([id, n]) => `<button type="button" role="radio" aria-checked="${SIM.clique === id}" data-estilo="${id}">${n}</button>`).join('')}</div></div>
      <p class="rf-fraco" style="margin:0" data-desc-estilo></p>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center" data-botoes>
        <button type="button" class="rf-bt rf-bt--p" data-op="Salvando…">${ic('check')}Salvar produto</button>
        <button type="button" class="rf-bt rf-bt--p rf-bt--g" data-op="Confirmando…">${ic('vendas')}Confirmar venda</button>
        <button type="button" class="rf-bt rf-bt--s" data-op="Enviando…">${ic('convidar')}Convidar</button>
        <button type="button" class="rf-bt rf-bt--f" data-op="Atualizando…">${ic('atualizar')}Atualizar</button>
        <button type="button" class="rf-bt rf-bt--perigo" data-op="Cancelando…">${ic('x')}Cancelar venda</button>
        <button type="button" class="rf-bt rf-bt--s rf-bt--icone" aria-label="Editar" data-op="">${ic('editar')}</button></div>
      <p class="rf-fraco" style="margin:0">Use "Resposta" e "Resultado" no topo do lab para ver respostas rápidas, lentas e com erro. Pelo teclado (Enter ou espaço) o botão também afunda.</p></div>
    <div class="rf-secao-t" style="margin-top:22px"><div><h3>Carregamento por contexto</h3><p>Cada situação tem o seu indicador. Todos representam uma operação real e somem quando ela termina.</p></div></div>
    <div class="rf-marcas" data-loaders style="margin-top:12px"></div></section>`);
  const desc = s.querySelector('[data-desc-estilo]'); const mostrarDesc = () => { desc.textContent = ESTILOS.find(([id]) => id === SIM.clique)[2]; };
  mostrarDesc();
  s.querySelector('[data-estilos]').addEventListener('click', (e) => { const b = e.target.closest('[data-estilo]'); if (!b) return; SIM.clique = b.dataset.estilo; for (const x of b.parentElement.children) x.setAttribute('aria-checked', String(x === b)); mostrarDesc(); document.dispatchEvent(new CustomEvent('lab:clique')); });
  s.querySelector('[data-botoes]').addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) operar(b, b.dataset.op || '…').then((ok) => ok && aviso('ok', 'Feito', 'O servidor confirmou.')); });

  const L = s.querySelector('[data-loaders]');
  L.append(
    cardLoader('Troca de tela', 'Ao clicar num item do menu: barra fina no topo enquanto a próxima página carrega.', '<div style="width:100%;height:96px;border-radius:8px;background:var(--rf-sup);border:1px solid var(--rf-linha);position:relative;overflow:hidden" data-tela><div style="padding:14px"><span class="rf-esq" style="width:50%"></span><span class="rf-esq" style="width:80%;margin-top:10px"></span></div></div>',
      async (demo, bt) => { const tela = demo.querySelector('[data-tela]'); bt.disabled = true; await comLimiar(() => tela.insertAdjacentHTML('afterbegin', '<div class="rf-carga-tela" role="progressbar" aria-label="Abrindo a tela"></div>'), () => tela.querySelector('.rf-carga-tela')?.remove()); bt.disabled = false; }),
    cardLoader('Salvamento', 'Botão de salvar de qualquer formulário: contorno que corre + sininho + rótulo.', '<button type="button" class="rf-bt rf-bt--p" data-s>Salvar cliente</button>',
      (demo) => operar(demo.querySelector('[data-s]'), 'Salvando…')),
    cardLoader('Tabela', 'Lista ou filtro: linhas fantasma no formato da tabela; depois as linhas entram em sequência.', '<div style="width:100%;display:grid;gap:8px" data-t>' + [1, 2, 3].map(() => '<div style="display:flex;gap:10px;align-items:center;font-size:.82rem;white-space:nowrap"><b style="width:40px">24/11</b><span style="flex:1">Venda 118</span><b>R$ 86,50</b></div>').join('') + '</div>',
      async (demo, bt) => { const t = demo.querySelector('[data-t]'); const orig = t.innerHTML; bt.disabled = true; await comLimiar(() => { t.innerHTML = [1, 2, 3].map(() => '<div style="display:flex;gap:10px"><span class="rf-esq" style="width:44px"></span><span class="rf-esq" style="flex:1"></span><span class="rf-esq" style="width:60px"></span></div>').join(''); }, () => { t.innerHTML = orig; t.classList.remove('rf-entra'); void t.offsetWidth; t.classList.add('rf-entra'); }); bt.disabled = false; }),
    cardLoader('Atualização de dados', 'Tela já aberta buscando números novos: selo discreto, sem apagar o que já está na tela.', '<div style="display:grid;gap:8px;justify-items:center"><b style="font:800 1.8rem/1 var(--rf-titulo)" data-n>R$ 1.284,50</b><span data-st class="rf-fraco">Atualizado às 14:02</span></div>',
      async (demo, bt) => { const st = demo.querySelector('[data-st]'); bt.disabled = true; await comLimiar(() => { st.className = 'rf-atualizando'; st.innerHTML = `${ic('atualizar')}Atualizando`; }, (ok) => { st.className = 'rf-fraco'; st.textContent = ok ? 'Atualizado agora' : 'Mantivemos os números anteriores'; if (ok) { const n = demo.querySelector('[data-n]'); n.textContent = 'R$ 1.371,00'; n.classList.add('rf-atualizou'); setTimeout(() => n.classList.remove('rf-atualizou'), 900); } }); bt.disabled = false; }),
    cardLoader('Painel (dashboard)', 'Cartões com o número no lugar certo e brilho metálico, um por indicador.', '<div class="rf-kpis" style="width:100%;grid-template-columns:1fr" data-k><div class="rf-kpi" style="padding:10px 12px"><small>Vendas hoje</small><strong style="font-size:1.3rem">R$ 312,00</strong></div><div class="rf-kpi" style="padding:10px 12px"><small>Pedidos novos</small><strong style="font-size:1.3rem">3</strong></div></div>',
      async (demo, bt) => { const k = demo.querySelectorAll('.rf-kpi'); bt.disabled = true; await comLimiar(() => k.forEach((x) => x.classList.add('rf-kpi--carregando')), () => k.forEach((x) => x.classList.remove('rf-kpi--carregando'))); bt.disabled = false; }),
    cardLoader('Ações administrativas', 'Aprovar, suspender, salvar limites (CK Admin): engrenagem enquanto o servidor decide.', '<span class="rf-fraco" data-a>Fila: 1 envio aguardando</span>',
      async (demo, bt) => { const a = demo.querySelector('[data-a]'); bt.disabled = true; await comLimiar(() => { a.innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center;font-weight:700;color:var(--rf-texto)">${ic('engrenagem', 'class="rf-engrenagem"')}Registrando a decisão…</span>`; }, (ok) => { a.textContent = ok ? 'Decisão registrada · fila vazia' : 'Nada mudou'; }); bt.disabled = false; }),
    cardLoader('Estoque', 'Movimentar estoque: caixinha saltando ao lado da quantidade, que só muda com a confirmação.', '<span data-e style="font-weight:700">Farinha 1 kg · <b>42 un.</b></span>',
      async (demo, bt) => { const e = demo.querySelector('[data-e]'); bt.disabled = true; await comLimiar(() => { e.innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center">${ic('caixa', 'class="rf-caixinha"')}Movimentando… <b>42 un.</b></span>`; }, (ok) => { e.innerHTML = `Farinha 1 kg · <b>${ok ? '52' : '42'} un.</b>`; }); bt.disabled = false; }),
    cardLoader('Vendas', 'Confirmar venda: cupom sendo impresso enquanto o servidor confirma.', '<span data-v style="font-weight:700">Venda nº 119 · R$ 86,50</span>',
      async (demo, bt) => { const v = demo.querySelector('[data-v]'); bt.disabled = true; await comLimiar(() => { v.innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center"><span class="rf-cupom">${ic('cupom')}</span>Confirmando a venda…</span>`; }, (ok) => { v.innerHTML = ok ? `<span class="rf-chip rf-chip--ok">Venda nº 119 confirmada</span>` : 'Venda nº 119 · R$ 86,50'; }); bt.disabled = false; }),
    cardLoader('Abertura do app', 'Só no app instalado e só enquanto ele carrega de verdade.', `<div style="display:grid;gap:6px;justify-items:center" data-ab><span style="display:block;width:54px;height:54px">${SIMBOLO}</span><b style="font:800 italic 1.1rem/1 var(--rf-titulo);text-transform:uppercase">AutoniCK</b></div>`,
      async (demo, bt) => { const a = demo.querySelector('[data-ab] span'); bt.disabled = true; await comLimiar(() => a.classList.add('rf-simbolo--balanca'), () => a.classList.remove('rf-simbolo--balanca')); bt.disabled = false; }),
  );
  return s;
}
