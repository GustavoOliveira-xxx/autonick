import { h, esc, cabecalho, segmentado, toast, linhaTempo } from '../ui.js';
import { A, B, C, D, D_CHAVES, E, F, H, J, K, CATEGORIAS } from '../catalogo.js';
import { LOADERS } from '../loaders.js';
import { loja } from '../estado.js';
import { ORIGINAL } from '../replica.js';
import { ANIMACOES } from '../motor/animacoes.js';
import { SIMULACAO } from '../feedback.js';
import { slotReplica, aoReiniciar } from './comum.js';
import { folhaComponentes } from './folha.js';

const op = (lista, rot = (p) => `${p.id} · ${p.nome}`) => lista.map((p) => [p.id, rot(p)]);
const CAMPOS = [
  ['dir', 'Direção artística (J)', op(J)],
  ['a', 'Composição do fundo (A)', op(A)],
  ['pos', 'Posição do sino', [['direita', 'Direita (atual)'], ['centro-direita', 'Mais perto do texto'], ['esquerda', 'Esquerda'], ['centro', 'Centro (composição central)']]],
  ['escala', 'Escala do sino', [['0.85', '85%'], ['1', '100%'], ['1.15', '115%'], ['1.3', '130%']]],
  ['anim', 'Animação do sino (B)', op(B)],
  ['objeto', 'Objeto 3D complementar (D)', [['', 'Nenhum'], ...D.map((p, i) => [D_CHAVES[i], `${p.id} · ${p.nome}`])]],
  ['ritmo', 'Ritmo (C)', op(C)],
  ['e', 'Fundo animado (E)', op(E)],
  ['ie', 'Intensidade do fundo', [['1', 'Sutil'], ['2', 'Equilibrado'], ['3', 'Expressivo']]],
  ['botao', 'Estilo do botão principal', [['orbe', 'Orbe (atual)'], ['metal', 'Metal escovado'], ['tinta', 'Tinta e ouro'], ['contorno', 'Contorno HQ']]],
  ['feedback', 'Feedback de clique (F)', op(F)],
  ['loader', 'Loader de navegação (G)', Object.entries(LOADERS).map(([id, l]) => [id, `${id} · ${l.nome}`])],
  ['ling', 'Microinterações (H)', op(H)],
];
const NUM = new Set(['escala', 'ie']);

export function montar(main) {
  const cfg = { ...ORIGINAL, ...(loja.d.combinador ?? {}) };
  let modo = 'desktop';
  main.append(cabecalho('✦', 'Combinador visual', 'Monte a sua versão da página inicial misturando as categorias. Tudo funciona junto na réplica: o sino, o fundo, os botões (clique neles) e o loader de navegação. Abaixo da home, uma amostra dos componentes na linguagem escolhida.'));
  const painel = h('<section class="painel"><h2>Montagem</h2><div class="grade-campos" data-campos></div><div class="acoes-proposta" data-acoes></div><h3>Partir de uma combinação pronta</h3><div class="acoes-proposta" data-k></div></section>');
  const campos = painel.querySelector('[data-campos]'); const sels = {};
  for (const [chave, rot, lista] of CAMPOS) {
    const id = `cb-${chave}`;
    const c = h(`<label class="campo-lab" for="${id}">${esc(rot)}<select id="${id}">${lista.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`);
    const s = c.querySelector('select'); s.value = String(cfg[chave] ?? ''); sels[chave] = s;
    s.addEventListener('change', () => { cfg[chave] = NUM.has(chave) ? Number(s.value) : (s.value || null); aplicar(); });
    campos.append(c);
  }
  const acoes = painel.querySelector('[data-acoes]');
  const bt = (t, f, cls = 'bt') => { const b = h(`<button type="button" class="${cls}">${esc(t)}</button>`); b.addEventListener('click', f); acoes.append(b); };
  bt('Salvar em Minhas escolhas', () => {
    loja.d.combinador = { ...cfg };
    const mapa = { A: cfg.a, B: cfg.anim, C: cfg.ritmo, E: cfg.e, F: cfg.feedback, H: cfg.ling, J: cfg.dir };
    for (const [cat, id] of Object.entries(mapa)) if (id) loja.d.escolhas[cat] = id;
    if (cfg.objeto) loja.d.escolhas.D = `D${String(D_CHAVES.indexOf(cfg.objeto) + 1).padStart(2, '0')}`;
    loja.salvar(); toast('Montagem salva e escolhas de cada categoria atualizadas.');
  }, 'bt bt--ouro');
  bt('Usar minhas escolhas', () => {
    const e = loja.d.escolhas; const novo = { a: e.A, anim: e.B, ritmo: e.C, e: e.E, feedback: e.F, ling: e.H, dir: e.J, objeto: e.D ? D_CHAVES[Number(e.D.slice(1)) - 1] : undefined };
    for (const [k, v] of Object.entries(novo)) if (v) cfg[k] = v;
    sincronizar(); aplicar(); toast('Combinador preenchido com as escolhas de cada categoria.');
  });
  bt('Restaurar original', () => { Object.assign(cfg, ORIGINAL); sincronizar(); aplicar(); toast('De volta ao AutoniCK de hoje.'); }, 'bt bt--perigo');
  const kBox = painel.querySelector('[data-k]');
  for (const k of K) { const b = h(`<button type="button" class="bt bt--pequeno" title="${esc(k.porque)}">${k.id} · ${esc(k.nome)}</button>`); b.addEventListener('click', () => { Object.assign(cfg, ORIGINAL, k.cfg); sincronizar(); aplicar(); toast(`${k.id} aplicada. Ajuste o que quiser.`); }); kBox.append(b); }

  const palcoEl = h(`<section class="palco-bloco"><div class="palco-barra"><div class="titulo-palco"><b>Sua home</b></div></div><div class="moldura" data-m></div><div data-lt></div>
    <div class="grade-campos"><label class="campo-lab" for="cb-lat">Resposta simulada ao clicar nos botões <input id="cb-lat" type="range" min="0" max="5000" step="50" value="${SIMULACAO.latencia}"><output>${SIMULACAO.latencia} ms</output></label><div class="campo-lab">Resultado<span data-res></span></div></div></section>`);
  const barra = palcoEl.querySelector('.palco-barra');
  barra.append(segmentado('Tela', [['desktop', 'Desktop'], ['celular', 'Celular'], ['ampla', 'Tela ampla']], modo, (v) => { modo = v; montarReplica(); }));
  palcoEl.querySelector('#cb-lat').addEventListener('input', (e) => { SIMULACAO.latencia = Number(e.target.value); e.target.nextElementSibling.textContent = `${e.target.value} ms`; });
  palcoEl.querySelector('[data-res]').append(segmentado('Resultado', [['sucesso', 'Sucesso'], ['erro', 'Erro'], ['conexao', 'Sem conexão']], SIMULACAO.resultado, (v) => { SIMULACAO.resultado = v; }));
  const moldura = palcoEl.querySelector('[data-m]'); const lt = linhaTempo(); palcoEl.querySelector('[data-lt]').append(lt.el);
  const amostra = h('<section class="palco-bloco"><div class="palco-barra"><div class="titulo-palco"><b>Componentes na linguagem escolhida</b></div></div><div data-f></div></section>');
  let rep = null;
  function montarReplica() { rep?.destruir(); moldura.className = `moldura ${modo === 'celular' ? 'moldura--celular' : ''}`; rep = slotReplica(moldura, { ...cfg }, modo); }
  function aplicar() {
    rep?.definir({ ...cfg });
    amostra.querySelector('[data-f]').replaceChildren(folhaComponentes(cfg.ling, { compacta: true }));
  }
  function sincronizar() { for (const [k, s] of Object.entries(sels)) s.value = String(cfg[k] ?? ''); }
  const layout = h('<div class="duas-colunas layout-combinador"></div>');
  const col = h('<div style="display:grid;gap:1rem;min-width:0"></div>'); col.append(palcoEl, amostra); layout.append(col, painel);
  main.append(layout);
  montarReplica(); aplicar();
  let raf = 0; const loop = () => { if (rep?.info) lt.atualizar(rep.info, ANIMACOES[rep.cfg.anim]); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
  const parar = aoReiniciar(() => rep?.reiniciar());
  return () => { cancelAnimationFrame(raf); parar(); rep?.destruir(); };
}
export { CATEGORIAS };
