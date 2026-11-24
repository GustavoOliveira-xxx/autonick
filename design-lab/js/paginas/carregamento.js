import { h, esc, cabecalho, acoes, seloInt, segmentado } from '../ui.js';
import { G } from '../catalogo.js';
import { loja } from '../estado.js';
import { LOADERS, CONTEXTOS, criarLoader } from '../loaders.js';
import { vitrine3D } from './comum.js';
import { ANIMACOES, criarLaco, RITMOS } from '../motor/animacoes.js';

const MOCKS = {
  navegacao: '<div data-slot style="margin:-1rem -1rem .6rem"></div><b>Produtos</b><div class="ld-esq" style="display:grid;gap:.4rem;margin-top:.5rem"><span style="height:.8rem;background:#f3e7cf;width:70%"></span><span style="height:.8rem;background:#f3e7cf;width:50%"></span></div><p data-depois hidden style="margin-top:.5rem">Página "Estoque" carregada.</p>',
  consulta: '<b>Vendas de novembro</b><div data-slot style="margin-top:.6rem"></div><table class="hc-tabela" data-depois hidden style="margin-top:.6rem"><tr><td>Cida Ramos</td><td>R$ 69,00</td></tr><tr><td>Jonas Prado</td><td>R$ 120,00</td></tr><tr><td>Ana Lu</td><td>R$ 115,00</td></tr></table>',
  salvamento: '<b>Editar produto</b><label class="hc-campo" style="margin:.5rem 0"><span>Nome</span><input value="Capa de silicone"></label><div data-slot></div><p data-depois hidden style="color:#13703a;font-weight:700">✓ Produto salvo.</p>',
  financeiro: '<b>Fechar caixa do dia</b><div data-slot style="margin-top:.6rem"></div><p data-depois hidden style="color:#13703a;font-weight:700;margin-top:.5rem">✓ Caixa fechado: R$ 184,00.</p>',
  estoque: '<b>Estoque</b><div style="display:grid;gap:.4rem;margin-top:.6rem"><div class="ld-linha" data-estado="feito" style="border-left-color:#d9cbb0"><span>Película 3D</span><span><b>12</b></span><span></span></div><div data-slot></div><div class="ld-linha" data-estado="feito" style="border-left-color:#d9cbb0"><span>Cabo USB-C</span><span><b>7</b></span><span></span></div></div>',
  dashboard: '<b>Painel</b><div style="display:flex;flex-wrap:wrap;gap:.6rem;margin-top:.6rem"><div data-slot></div><div data-depois hidden class="ld-card" data-estado="feito"><span class="ld-card-cab"></span><span class="ld-card-num">R$ <b>304,00</b></span><span class="ld-card-leg"></span></div></div>',
  documentos: '<b>Ordem de serviço nº 3</b><p style="margin:.3rem 0 .6rem;font-size:.85rem">Resumo em PDF</p><div data-slot></div><p data-depois hidden style="color:#13703a;font-weight:700;margin-top:.5rem">✓ PDF pronto para baixar.</p>',
  inicializacao: '<div data-slot></div><p data-depois hidden style="font-weight:700;margin-top:.5rem">AutoniCK aberto.</p>',
};

export function montar(main) {
  let dur = 2400, ok = true;
  main.append(cabecalho('G', 'Loaders próprios do AutoniCK', 'Treze indicadores e uma sugestão para cada contexto. Nenhum tem duração própria: aparecem enquanto a operação dura e somem quando ela termina. Só a abertura do app ocupa a tela inteira.', [
    ['Hoje no app', 'esqueletos simples (.esqueleto) e textos de estado; sem loader de marca'],
    ['Regra', 'bloquear a tela só quando não há o que mostrar (abertura do app)'],
    ['Progresso', 'barra com porcentagem só quando a operação informa progresso real'],
  ]));
  const ctl = h(`<section class="palco-bloco"><div class="palco-barra"><div class="titulo-palco"><b>Contextos de uso</b></div>
    <span class="ctl"><label for="g-dur">Duração da operação</label><input id="g-dur" type="range" min="200" max="8000" step="100" value="${dur}"><output id="g-dur-v">2,4 s</output></span><span data-res></span></div>
    <div class="tabela-lab-wrap"><table class="tabela-lab"><thead><tr><th>Contexto</th><th>Sugestão e motivo</th><th>Sua escolha</th><th>Ver</th></tr></thead><tbody></tbody></table></div>
    <div class="duas-colunas"><div class="papel-ck" data-mock style="min-height:12rem"></div><div class="painel" data-explica><p>Clique em "Simular" numa linha para ver o loader no contexto.</p></div></div></section>`);
  const out = ctl.querySelector('#g-dur-v');
  ctl.querySelector('#g-dur').addEventListener('input', (e) => { dur = Number(e.target.value); out.textContent = `${(dur / 1000).toFixed(1).replace('.', ',')} s`; });
  ctl.querySelector('[data-res]').append(segmentado('Resultado', [['ok', 'Termina bem'], ['falha', 'Falha']], 'ok', (v) => { ok = v === 'ok'; }));
  const tbody = ctl.querySelector('tbody'); const mock = ctl.querySelector('[data-mock]'); const explica = ctl.querySelector('[data-explica]');
  const opts = (sel) => Object.entries(LOADERS).map(([id, l]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${id} · ${esc(l.nome)}</option>`).join('');
  for (const c of CONTEXTOS) {
    const atual = loja.d.loadersPorContexto[c.id] ?? c.sugestao;
    const tr = h(`<tr><td><b>${esc(c.nome)}</b>${c.bloqueia ? '<br><small>pode bloquear a tela</small>' : ''}</td><td><span class="id">${c.sugestao}</span> ${esc(c.porque)}</td><td><select aria-label="Loader para ${esc(c.nome)}">${opts(atual)}</select></td><td><button type="button" class="bt bt--pequeno">Simular</button></td></tr>`);
    tr.querySelector('select').addEventListener('change', (e) => { loja.d.loadersPorContexto[c.id] = e.target.value; loja.salvar(); });
    tr.querySelector('button').addEventListener('click', () => simular(c, tr.querySelector('select').value));
    tbody.append(tr);
  }
  let timers = [], v3 = null;
  function limpar() { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; v3?.destruir(); v3 = null; }
  function montarSino(el) {
    const laco = criarLaco(ANIMACOES.B02, RITMOS.C04);
    v3 = vitrine3D(el, { fonte: (t, ctx) => laco.quadro(t, ctx), enquadramento: ANIMACOES.B02.enquadramento, tocando: true, miniatura: true, hq: false });
  }
  function simular(c, tipo) {
    limpar(); mock.innerHTML = MOCKS[c.id];
    explica.innerHTML = `<h3>${esc(c.nome)} com ${tipo} · ${esc(LOADERS[tipo].nome)}</h3><p>${esc(c.porque)}</p><p>Duração simulada: ${(dur / 1000).toFixed(1).replace('.', ',')} s. ${['G05', 'G09'].includes(tipo) ? 'Este loader mostra progresso informado pela operação (aqui, simulado em etapas).' : 'Este loader é indeterminado: não inventa porcentagem.'}</p>`;
    const slot = mock.querySelector('[data-slot]'); const depois = mock.querySelectorAll('[data-depois]');
    const ld = criarLoader(tipo, slot, { aoMontar3D: montarSino }); ld.iniciar();
    const t0 = performance.now();
    timers.push(setInterval(() => ld.progresso((performance.now() - t0) / dur), 120));
    timers.push(setTimeout(() => {
      limpar(); ld.concluir(ok);
      if (ok) timers.push(setTimeout(() => { if (['G06', 'G07', 'G13', 'G11', 'G03', 'G02', 'G12', 'G04', 'G08'].includes(tipo)) slot.innerHTML = ''; depois.forEach((d) => { d.hidden = false; }); }, 350));
      else explica.append(h('<p class="aviso-lab"><b>Falha:</b> o loader para e a interface mostra o erro no lugar, sem tela cheia.</p>'));
    }, dur));
  }
  const grade = h('<div class="grade"></div>');
  for (const g of G) {
    const p = { ...g, nome: LOADERS[g.id].nome };
    const c = h(`<article class="cartao-prop"><div class="papel-ck" style="border-radius:0;min-height:8rem;display:grid;place-items:center" data-demo></div>
      <div class="corpo"><h3><span class="id">${g.id}</span>${esc(p.nome)}</h3><p>${esc(g.resumo)}</p><p><b>Uso:</b> ${esc(g.uso)}</p><div class="rodape-cartao">${seloInt(g.intensidade)}<button type="button" class="bt bt--pequeno" data-sim>Simular</button></div></div></article>`);
    c.querySelector('.rodape-cartao').append(acoes('G', p, { pequeno: true }));
    const demo = c.querySelector('[data-demo]');
    let ld = null; const iniciar = () => { ld = criarLoader(g.id, demo, { aoMontar3D: (el) => { const laco = criarLaco(ANIMACOES.B13, RITMOS.C04); const v = vitrine3D(el, { fonte: (t, ctx) => laco.quadro(t, ctx), enquadramento: ANIMACOES.B13.enquadramento, tocando: true, hq: false }); c.__v = v; } }); ld.iniciar(); };
    iniciar();
    c.querySelector('[data-sim]').addEventListener('click', () => { c.__v?.destruir(); iniciar(); const t0 = performance.now(); const iv = setInterval(() => ld.progresso((performance.now() - t0) / dur), 120); setTimeout(() => { clearInterval(iv); ld.concluir(ok); }, dur); });
    grade.append(c);
  }
  // loaders da galeria só animam quando visíveis
  const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('fora', !e.isIntersecting)));
  grade.querySelectorAll('[data-demo]').forEach((d) => io.observe(d));
  main.append(ctl, h('<div class="secao-titulo"><h2>Todos os loaders</h2><p>Em execução contínua aqui só para você observar; no app, cada um aparece apenas durante uma operação.</p></div>'), grade);
  simular(CONTEXTOS[0], loja.d.loadersPorContexto.navegacao ?? 'G01');
  return () => { limpar(); io.disconnect(); grade.querySelectorAll('.cartao-prop').forEach((c) => c.__v?.destruir()); };
}
