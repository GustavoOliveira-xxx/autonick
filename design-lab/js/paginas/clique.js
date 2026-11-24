import { h, esc, cabecalho, ficha, acoes, seloInt, segmentado } from '../ui.js';
import { F, porId } from '../catalogo.js';
import { loja } from '../estado.js';
import { ligarBotao, SIMULACAO } from '../feedback.js';

export function montar(main) {
  main.append(cabecalho('F', 'Feedback imediato de clique', 'Quinze respostas de clique para você apertar. Todas seguem a mesma regra: o clique é reconhecido no mesmo quadro, o indicador de processamento só aparece se a operação passar do limiar anti-piscar, e sucesso só aparece quando a resposta chega. Ajuste a resposta simulada do servidor abaixo.', [
    ['Hoje no app', 'só <b>:active</b> (desce 3 px); sem estados depois do clique'],
    ['Sem atraso artificial', 'nenhuma animação segura a resposta; não há tempo mínimo de exibição'],
    ['Envio duplo', 'enquanto a operação corre, novos cliques são ignorados e registrados'],
  ]));
  const sim = h(`<section class="painel"><h2>Resposta simulada do servidor</h2>
    <div class="grade-campos">
      <label class="campo-lab">Tempo de resposta <input type="range" id="f-lat" min="0" max="6000" step="50" value="${SIMULACAO.latencia}"><output id="f-lat-v">${SIMULACAO.latencia} ms</output></label>
      <div class="campo-lab">Atalhos<div class="acoes-proposta" data-atalhos><button type="button" class="bt bt--pequeno" data-ms="60">60 ms</button><button type="button" class="bt bt--pequeno" data-ms="350">350 ms</button><button type="button" class="bt bt--pequeno" data-ms="1200">1,2 s</button><button type="button" class="bt bt--pequeno" data-ms="5000">5 s</button></div></div>
      <label class="campo-lab">Limiar anti-piscar <input type="range" id="f-lim" min="0" max="400" step="10" value="${SIMULACAO.limiar}"><output id="f-lim-v">${SIMULACAO.limiar} ms</output></label>
      <div class="campo-lab">Resultado<span data-res></span></div>
    </div>
    <p class="aviso-lab">O tempo de resposta representa a rede e o servidor. Com 60 ms, o indicador de processamento nem chega a aparecer: o botão vai direto do clique ao sucesso. Isso é o comportamento desejado.</p>
    <h3>Registro do último clique</h3><ol class="registro lista-limpa" aria-live="polite"><li><b>—</b><span>Clique em qualquer botão abaixo.</span></li></ol></section>`);
  const reg = sim.querySelector('.registro');
  const lat = sim.querySelector('#f-lat'), lim = sim.querySelector('#f-lim');
  const setLat = (v) => { SIMULACAO.latencia = Number(v); lat.value = v; sim.querySelector('#f-lat-v').textContent = `${v} ms`; };
  lat.addEventListener('input', () => setLat(lat.value));
  lim.addEventListener('input', () => { SIMULACAO.limiar = Number(lim.value); sim.querySelector('#f-lim-v').textContent = `${lim.value} ms`; });
  sim.querySelector('[data-atalhos]').addEventListener('click', (e) => { const b = e.target.closest('[data-ms]'); if (b) setLat(b.dataset.ms); });
  sim.querySelector('[data-res]').append(segmentado('Resultado', [['sucesso', 'Sucesso'], ['erro', 'Erro'], ['conexao', 'Sem conexão'], ['indisponivel', 'Indisponível']], SIMULACAO.resultado, (v) => { SIMULACAO.resultado = v; }));
  let ultimoBotao = null;
  const aoEvento = (btn, id) => (nome, ms, classe) => {
    if (btn !== ultimoBotao || /^clique recebido/.test(nome)) { if (/^clique recebido/.test(nome)) { reg.innerHTML = ''; ultimoBotao = btn; reg.append(h(`<li><b>${esc(id)}</b><span>${esc(porId(id).nome)}</span></li>`)); } }
    reg.append(h(`<li class="${classe ?? ''}"><b>${ms} ms</b><span>${esc(nome)}</span></li>`)); reg.scrollTop = reg.scrollHeight;
  };

  const contexto = h(`<section class="palco-bloco"><div class="palco-barra"><div class="titulo-palco"><b>Em contexto: nova venda</b></div><span class="ctl"><label for="f-ctx">Feedback</label><select id="f-ctx">${F.filter((f) => f.id !== 'F00').map((f) => `<option value="${f.id}"${f.id === (loja.escolhida('F') ?? 'F13') ? ' selected' : ''}>${f.id} · ${esc(f.nome)}</option>`).join('')}</select></span></div>
    <form class="papel-ck" style="display:grid;gap:.8rem;max-width:36rem" onsubmit="return false">
      <h3 style="font:800 1.6rem/1 var(--fonte-titulo);text-transform:uppercase">Nova venda</h3>
      <div class="grade-campos" style="color:#16111f"><label class="hc-campo"><span style="font-weight:700">Cliente</span><input value="Cida Ramos"></label><label class="hc-campo"><span style="font-weight:700">Total</span><input value="R$ 69,90"></label></div>
      <div class="hc-linha"><button type="submit" class="bt-ck" id="f-salvar"><span class="fb-rot">Salvar venda</span></button><button type="button" class="bt-ck bt-ck--sec">Cancelar</button></div>
      <p style="font-size:.85rem;color:#4b4158;margin-top:1.2rem">Formulário de demonstração: nada é gravado.</p></form></section>`);
  const salvar = contexto.querySelector('#f-salvar');
  const ligCtx = ligarBotao(salvar, { estilo: contexto.querySelector('select').value, aoEvento: aoEvento(salvar, contexto.querySelector('select').value), rotulos: { processando: 'Salvando…', sucesso: 'Venda salva', erro: 'Tentar de novo' } });
  contexto.querySelector('select').addEventListener('change', (e) => ligCtx.definirEstilo(e.target.value));

  const fichaBox = h('<div class="painel"></div>');
  const grade = h('<div class="grade"></div>');
  const ligados = [ligCtx];
  for (const p of F) {
    const c = h(`<article class="cartao-prop" data-id="${p.id}"><div class="papel-ck" style="border-radius:0;display:grid;place-items:center;min-height:7.5rem"><button type="button" class="bt-ck ${p.id === 'F00' ? 'ref-f00' : ''}"><span class="fb-rot">Salvar</span></button></div>
      <div class="corpo"><h3><span class="id">${p.id}</span>${esc(p.nome)}</h3><p>${esc(p.resumo)}</p><div class="rodape-cartao">${seloInt(p.intensidade)}<button type="button" class="bt bt--pequeno bt--fantasma" data-ficha>Ficha</button></div></div></article>`);
    c.querySelector('.rodape-cartao').append(acoes('F', p, { pequeno: true }));
    const btn = c.querySelector('.bt-ck');
    if (p.id !== 'F00') ligados.push(ligarBotao(btn, { estilo: p.id, aoEvento: aoEvento(btn, p.id) }));
    else btn.addEventListener('click', () => { reg.innerHTML = '<li><b>F00</b><span>Atual: só desce enquanto pressionado; nenhum estado depois do clique.</span></li>'; });
    c.querySelector('[data-ficha]').addEventListener('click', () => { fichaBox.replaceChildren(ficha('F', p)); grade.querySelectorAll('.cartao-prop').forEach((x) => x.setAttribute('aria-current', String(x === c))); fichaBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    grade.append(c);
  }
  fichaBox.replaceChildren(ficha('F', porId(loja.escolhida('F') ?? 'F13')));
  main.append(sim, h('<div class="secao-titulo"><h2>Aperte cada um</h2><p>Teste também com o teclado (Tab e Enter) e com "Movimento reduzido" ligado.</p></div>'), grade, fichaBox, contexto);
  return () => ligados.forEach((l) => l.destruir());
}
