// Lab de refino de UX do AutoniCK: moldura, rotas, controles de simulação e a paleta "Ir para…".
import { h, ic, esc, SIM, ligarClique, abrirModal } from './pecas.js';
import { seletor } from './telas/empresas.js';
import * as visao from './telas/visao.js';
import * as clique from './telas/clique.js';
import * as navegacao from './telas/navegacao.js';
import * as empresas from './telas/empresas.js';
import * as equipe from './telas/equipe.js';
import * as agenda from './telas/agenda.js';
import * as financeiro from './telas/financeiro.js';
import * as admin from './telas/admin.js';
import * as tema from './telas/tema.js';
import * as marca from './telas/marca.js';

const ROTAS = [['visao', 'Visão geral', visao], ['clique', 'Clique e carregamento', clique], ['navegacao', 'Navegação e legibilidade', navegacao], ['empresas', 'Central de empresas', empresas],
  ['equipe', 'Equipe', equipe], ['agenda', 'Agenda', agenda], ['financeiro', 'Financeiro', financeiro], ['admin', 'CK Admin', admin], ['tema', 'Tema claro', tema], ['marca', 'Marca']];
ROTAS[ROTAS.length - 1].push(marca);
const raiz = document.documentElement;
const conteudo = document.getElementById('conteudo');
const nav = document.getElementById('nav');

const guardar = (k, v) => { try { localStorage.setItem(`lab-refino:${k}`, v); } catch { /* sem armazenamento */ } };
const ler = (k, p) => { try { return localStorage.getItem(`lab-refino:${k}`) ?? p; } catch { return p; } };

nav.innerHTML = ROTAS.map(([id, n]) => `<a href="#${id}">${n}</a>`).join('') + '<a href="animacoes.html">Lab de animações →</a>';
function rota() {
  const id = (location.hash.slice(1) || 'visao'); const r = ROTAS.find(([x]) => x === id) ?? ROTAS[0];
  for (const a of nav.querySelectorAll('a')) { if (a.getAttribute('href') === `#${r[0]}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  conteudo.replaceChildren(r[2].montar());
  document.title = `${r[1]} · Lab de refino · AutoniCK`;
  return r;
}
window.addEventListener('hashchange', () => { rota(); window.scrollTo({ top: 0 }); });

/* ---------------- controles ---------------- */
const seg = (sel, aplicar) => {
  const g = document.querySelector(sel);
  g.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; for (const x of g.children) x.setAttribute('aria-pressed', String(x === b)); aplicar(b.dataset.v); });
  return (v) => { for (const x of g.children) x.setAttribute('aria-pressed', String(x.dataset.v === v)); aplicar(v); };
};
const definirTema = seg('[data-ctl="tema"]', (v) => { if (v === 'claro') raiz.dataset.tema = 'claro'; else delete raiz.dataset.tema; guardar('tema', v); });
const definirDisp = seg('[data-ctl="disp"]', (v) => { conteudo.dataset.disp = v; guardar('disp', v); });
definirTema(ler('tema', 'escuro')); definirDisp(ler('disp', 'desktop'));
const lat = document.getElementById('lat'); const latV = document.getElementById('lat-v');
lat.addEventListener('input', () => { SIM.latencia = Number(lat.value); latV.textContent = `${lat.value} ms`; });
document.getElementById('res').addEventListener('change', (e) => { SIM.resultado = e.target.value; });
const selClique = document.getElementById('estilo-clique');
selClique.addEventListener('change', () => { SIM.clique = selClique.value; if (location.hash === '#clique') rota(); });
document.addEventListener('lab:clique', () => { selClique.value = SIM.clique; });
document.getElementById('bt-red').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); if (on) raiz.dataset.reduzido = 'sim'; else delete raiz.dataset.reduzido; });
const barra = document.querySelector('.lb-barra');
new ResizeObserver(() => raiz.style.setProperty('--lb-alt', `${barra.offsetHeight}px`)).observe(barra);

/* ---------------- comportamento global ---------------- */
ligarClique(document);
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sem-nav]')) e.preventDefault();
  if (e.target.closest('[data-trocar-empresa]')) seletor(() => rota());
  if (e.target.closest('[data-paleta]')) paleta();
});
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!document.querySelector('dialog[open]')) paleta(); } });

/* ---------------- paleta "Ir para…" ---------------- */
const ITENS = [
  ['Ações', 'saida', 'Lançar uma saída', 'Financeiro · Saiu dinheiro', () => irE('financeiro', '[data-lancar="saida"]')],
  ['Ações', 'entrada', 'Lançar uma entrada', 'Financeiro · Entrou dinheiro', () => irE('financeiro', '[data-lancar="entrada"]')],
  ['Ações', 'convidar', 'Convidar pessoa', 'Equipe', () => irE('equipe', '[data-convidar]')],
  ['Ações', 'mais', 'Cadastrar nova empresa', 'Central de empresas', () => irE('empresas', '[data-nova-empresa]')],
  ['Ações', 'trocar', 'Trocar de empresa', 'Escolher outra empresa', () => seletor(() => rota())],
  ['Ir para', 'relogio', 'Horários de atendimento', 'Agenda', () => { location.hash = 'agenda'; }],
  ['Ir para', 'equipe', 'Equipe', 'Pessoas, perfis e histórico', () => { location.hash = 'equipe'; }],
  ['Ir para', 'financeiro', 'Movimentações', 'Financeiro', () => { location.hash = 'financeiro'; }],
  ['Registros', 'vendas', 'Venda nº 118', 'R$ 86,50 · Bruno Caixa · hoje', () => etapas('Venda nº 118', 'R$ 86,50 · balcão · cliente sem cadastro', [['Registrada', '24/11 10:02'], ['Confirmada', '24/11 10:03'], ['Recebida', 'Pix · 24/11 10:03'], ['Entregue', 'aguardando retirada']], 2)],
  ['Registros', 'ordens', 'OS nº 41 · Troca de bateria', 'Cliente Fábio · como o cliente vê', () => etapas('OS nº 41 · Troca de bateria', 'Assim o cliente vê o andamento do serviço.', [['Pedido aceito', '20/11'], ['Em execução', 'desde 22/11'], ['Concluída', 'previsão 26/11'], ['Recebida pelo cliente', '']], 1)],
  ['Registros', 'orcamentos', 'Orçamento nº 8 · Pintura', 'Cliente César · aguardando resposta', () => etapas('Orçamento nº 8 · Pintura de parede', 'R$ 1.250,00 · válido até 30/11', [['Pedido', '18/11'], ['Orçamento enviado', '19/11'], ['Resposta do cliente', 'aguardando'], ['Serviço', '']], 2)],
];
function irE(id, seletorBotao) { if (location.hash !== `#${id}`) location.hash = id; requestAnimationFrame(() => setTimeout(() => conteudo.querySelector(seletorBotao)?.click(), 60)); }
function etapas(titulo, sub, lista, atual) {
  abrirModal(`<div class="rf-modal__painel"><div class="rf-modal__cab"><div><h3>${esc(titulo)}</h3><p>${esc(sub)}</p></div><button type="button" class="rf-bt rf-bt--f rf-bt--icone" data-fechar aria-label="Fechar">${ic('x')}</button></div>
    <div class="rf-modal__corpo"><ol class="rf-etapas" style="--n:${lista.length}" aria-label="Andamento">${lista.map(([n, q], i) => `<li class="${i < atual ? 'rf-feita' : i === atual ? 'rf-agora' : ''}" ${i === atual ? 'aria-current="step"' : ''}>${n}<small>${q}</small></li>`).join('')}</ol>
      <p class="rf-fraco" style="margin:0">Etapa atual: <b style="color:var(--rf-texto)">${lista[atual][0]}</b>. O detalhe completo continua na tela do registro.</p></div>
    <div class="rf-modal__pe"><button type="button" class="rf-bt rf-bt--f" data-fechar>Fechar</button><button type="button" class="rf-bt rf-bt--p" data-fechar>Abrir registro completo</button></div></div>`, { classe: 'rf-modal' });
}
function paleta() {
  const d = abrirModal(`<div class="rf-modal__painel"><label class="rf-paleta-busca">${ic('busca')}<span class="visualmente-oculto">Buscar ou ir para</span><input type="search" placeholder="O que você quer fazer? Ex.: saída, 118, horários" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="paleta-lista" data-q></label>
    <div class="rf-modal__corpo" style="padding:8px"><div class="rf-paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados" data-lista></div></div>
    <div class="rf-modal__pe" style="justify-content:flex-start"><span class="rf-fraco">↑ ↓ para escolher · Enter para abrir · Esc para fechar</span></div></div>`, { classe: 'rf-modal rf-modal--estreito', aoAbrir: (x) => x.querySelector('[data-q]').focus() });
  const lista = d.querySelector('[data-lista]'); const q = d.querySelector('[data-q]'); let vis = []; let sel = 0;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const desenhar = () => {
    const t = norm(q.value.trim()); vis = ITENS.filter((it) => !t || norm(`${it[2]} ${it[3]}`).includes(t)); sel = Math.min(sel, Math.max(0, vis.length - 1));
    let grupo = ''; lista.innerHTML = vis.length ? vis.map((it, i) => `${it[0] !== grupo ? `<p>${(grupo = it[0])}</p>` : ''}<button type="button" role="option" id="op-${i}" aria-selected="${i === sel}" data-i="${i}"><i>${ic(it[1])}</i><span>${esc(it[2])}<small>${esc(it[3])}</small></span>${i === sel ? '<span class="rf-kbd">Enter</span>' : ''}</button>`).join('')
      : '<div class="rf-vazio">Nada com esse nome. Tente "venda", "saída" ou "horários".</div>';
    q.setAttribute('aria-activedescendant', vis.length ? `op-${sel}` : '');
  };
  const abrir = (i) => { const it = vis[i]; if (!it) return; d.close(); it[4](); };
  q.addEventListener('input', () => { sel = 0; desenhar(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, vis.length); desenhar(); lista.querySelector(`#op-${sel}`)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + vis.length) % Math.max(1, vis.length); desenhar(); lista.querySelector(`#op-${sel}`)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); abrir(sel); }
  });
  lista.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) abrir(Number(b.dataset.i)); });
  desenhar();
}

rota();
