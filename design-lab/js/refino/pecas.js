// Peças comuns do lab de refino: ícones, clique vivo, operação simulada, modal, gaveta, avisos e menus.
// A simulação existe só no laboratório (latência e resultado vêm dos controles do topo); no app, o
// indicador acompanha a operação real e nenhuma espera é inventada.

export const SIM = { latencia: 900, resultado: 'sucesso', clique: 'forja', limiar: 120 };
export const reduzido = () => document.documentElement.dataset.reduzido === 'sim' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cria elementos a partir de HTML (conteúdo do próprio lab, sem dados externos). */
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content; }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const P = {
  painel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  vendas: '<path d="M6 3h12l1 18H5z"/><path d="M9 7a3 3 0 0 0 6 0"/>',
  pedidos: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  orcamentos: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/>',
  ordens: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2 2 0 0 1-2.8-2.8z"/><path d="m6 6 3 3M4 4l2 2"/>',
  produtos: '<path d="m21 8-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  estoque: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M8 7h.01M8 17h.01"/>',
  fornecedores: '<path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  financeiro: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.7c1.9.7 3.1 2.6 3.5 5.3"/>',
  equipe: '<circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c.6-3.8 3.2-6 6.5-6s5.9 2.2 6.5 6"/><circle cx="4.5" cy="10" r="2"/><circle cx="19.5" cy="10" r="2"/>',
  agenda: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/>',
  empresa: '<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>',
  conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.4 4-6.5 8-6.5s7 2.1 8 6.5"/>',
  ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1V14M12 17.5h.01"/>',
  sair: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  convidar: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M19 8v6M16 11h6"/>',
  copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  entrada: '<path d="M12 19V5M5 12l7 7 7-7"/>',
  saida: '<path d="M12 5v14M5 12l7-7 7 7"/>',
  transferir: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  dono: '<path d="M3 9.5 12 4l9 5.5M5 10v8h14v-8"/><path d="M10 18v-4h4v4"/>',
  seta: '<path d="m9 6 6 6-6 6"/>',
  baixo: '<path d="m6 9 6 6 6-6"/>',
  pontos: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  trocar: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  atualizar: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M4 4v4h4M20 20v-4h-4"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
  caixa: '<path d="m21 8-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  cupom: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6"/>',
  escudo: '<path d="M12 3 4.5 6v6c0 4.4 3.2 7.8 7.5 9 4.3-1.2 7.5-4.6 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  folga: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
  estrela: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  filtro: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
};
export const ic = (nome, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[nome] ?? ''}</svg>`;

/** Símbolo simplificado provisório (sino + CK), pensado para tamanhos pequenos. Fica num só lugar para ser trocado depois. */
export const SIMBOLO = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true"><defs><linearGradient id="sb-o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b3"/><stop offset=".45" stop-color="#f8c22c"/><stop offset="1" stop-color="#c98a14"/></linearGradient></defs>
<path d="M32 5c2.4 0 4 1.7 4 3.8v2.4c9.6 1.9 15.4 9.8 15.4 20.3v10.2l5.1 7.3c.8 1.2 0 2.8-1.5 2.8H9c-1.5 0-2.3-1.6-1.5-2.8l5.1-7.3V31.5c0-10.5 5.8-18.4 15.4-20.3V8.8C28 6.7 29.6 5 32 5z" fill="url(#sb-o)" stroke="#191418" stroke-width="3" stroke-linejoin="round"/>
<path d="M24 58a8 8 0 0 0 16 0" fill="#c3161e" stroke="#191418" stroke-width="3"/>
<path d="M22.5 37.5c0-5.4 3.7-9 8.3-9 2.3 0 4.2.8 5.5 2.2l-3.2 3.1c-.6-.7-1.4-1.1-2.3-1.1-2.1 0-3.4 1.9-3.4 4.8s1.3 4.8 3.4 4.8c.9 0 1.7-.4 2.3-1.1l3.2 3.1a7.6 7.6 0 0 1-5.5 2.2c-4.6 0-8.3-3.6-8.3-9z" fill="#191418"/>
<path d="M38 29h4.4v6.3l5-6.3h5.2l-5.8 7 6.1 9.5h-5.2l-3.9-6.3-1.4 1.7v4.6H38z" fill="#191418"/>
<path d="M18 26c1-5 4-8.5 8.5-10" fill="none" stroke="#fffbe8" stroke-width="2.6" stroke-linecap="round" opacity=".85"/></svg>`;

/* ---------------- clique vivo ---------------- */
function onda(bt, x, y) {
  const r = bt.getBoundingClientRect(); const o = document.createElement('span'); o.className = 'rf-onda';
  o.style.left = `${x - r.left}px`; o.style.top = `${y - r.top}px`; o.style.setProperty('--rf-onda-esc', String(Math.ceil(Math.hypot(r.width, r.height) / 6)));
  bt.append(o); o.addEventListener('animationend', () => o.remove(), { once: true });
}
function faiscas(bt, x, y) {
  const r = bt.getBoundingClientRect();
  for (let i = 0; i < 7; i++) {
    const f = document.createElement('span'); f.className = 'rf-faisca'; const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5; const d = 16 + Math.random() * 14;
    f.style.left = `${x - r.left}px`; f.style.top = `${y - r.top}px`; f.style.setProperty('--dx', `${Math.cos(a) * d}px`); f.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    bt.append(f); f.addEventListener('animationend', () => f.remove(), { once: true });
  }
}
/** Liga o clique vivo em todo o documento: responde no pointerdown (antes do clique terminar). */
export function ligarClique(raiz = document) {
  raiz.addEventListener('pointerdown', (e) => {
    const bt = e.target.closest?.('.rf-bt, .rf-acao-g'); if (!bt || bt.disabled || e.button !== 0) return;
    bt.classList.add('rf-pressionado');
    if (reduzido()) return;
    const modo = SIM.clique;
    if (modo !== 'prensa') onda(bt, e.clientX, e.clientY);
    if (modo === 'forja') { bt.classList.remove('rf-lampejo'); void bt.offsetWidth; bt.classList.add('rf-lampejo'); }
    if (modo === 'faisca') faiscas(bt, e.clientX, e.clientY);
  });
  const soltar = () => document.querySelectorAll('.rf-pressionado').forEach((b) => b.classList.remove('rf-pressionado'));
  raiz.addEventListener('pointerup', soltar); raiz.addEventListener('pointercancel', soltar); raiz.addEventListener('pointerleave', soltar, true);
  raiz.addEventListener('keydown', (e) => { const bt = e.target.closest?.('.rf-bt'); if (bt && (e.key === 'Enter' || e.key === ' ')) { bt.classList.add('rf-pressionado'); setTimeout(() => bt.classList.remove('rf-pressionado'), 120); } });
}

/** Simula a resposta do servidor (só no lab). */
export function simular(ms = SIM.latencia) {
  return new Promise((ok, falha) => setTimeout(() => (SIM.resultado === 'sucesso' ? ok() : falha(new Error(SIM.resultado === 'conexao' ? 'Sem conexão. Nada foi gravado; tente de novo.' : 'O servidor recusou a operação. Nada foi gravado.'))), ms));
}

/**
 * Operação com o botão: desabilita, mostra o contorno e o rótulo de estado só depois do limiar (sem piscar),
 * confirma com um traço de ✓ quando a resposta chega e treme de leve no erro. Devolve true/false.
 */
export async function operar(bt, rotuloOcupado, acao = () => simular()) {
  if (bt.getAttribute('aria-busy') === 'true') return false;
  const original = bt.innerHTML; const largura = bt.getBoundingClientRect().width;
  bt.setAttribute('aria-busy', 'true'); bt.disabled = true; bt.style.minWidth = `${largura}px`;
  const sinal = setTimeout(() => {
    bt.innerHTML = `<span class="rf-bt__estado">${bt.classList.contains('rf-bt--p') ? '<i class="rf-sininho"></i>' : ''}${esc(rotuloOcupado)}</span><svg class="rf-contorno" aria-hidden="true"><rect pathLength="100"/></svg>`;
  }, SIM.limiar);
  try {
    await acao(); clearTimeout(sinal);
    bt.innerHTML = `<span class="rf-bt__estado"><svg class="rf-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" pathLength="24"/></svg>Pronto</span>`;
    bt.classList.add('rf-ok'); await new Promise((r) => setTimeout(r, reduzido() ? 300 : 700)); return true;
  } catch (erro) {
    clearTimeout(sinal); bt.classList.add('rf-falhou'); aviso('erro', 'Não foi possível concluir', erro.message); return false;
  } finally {
    bt.innerHTML = original; bt.classList.remove('rf-ok', 'rf-falhou'); bt.removeAttribute('aria-busy'); bt.disabled = false; bt.style.minWidth = '';
  }
}

/* ---------------- avisos ---------------- */
export function aviso(tipo, titulo, texto = '') {
  let caixa = document.querySelector('.rf-avisos'); if (!caixa) { caixa = h('<div class="rf-avisos" role="status" aria-live="polite"></div>'); document.body.append(caixa); }
  const t = h(`<div class="rf-toast ${tipo === 'erro' ? 'rf-toast--erro' : ''}">${ic(tipo === 'erro' ? 'alerta' : 'check')}<div><b>${esc(titulo)}</b>${texto ? `<span>${esc(texto)}</span>` : ''}</div></div>`);
  caixa.append(t); setTimeout(() => { t.classList.add('rf-saindo'); t.addEventListener('animationend', () => t.remove(), { once: true }); setTimeout(() => t.remove(), 400); }, 3800);
}

/* ---------------- modal e gaveta (dialog nativo: foco preso e Esc de graça) ---------------- */
export function abrirModal(html, { classe = 'rf-modal', aoAbrir } = {}) {
  const d = h(`<dialog class="${classe}" aria-modal="true">${html}</dialog>`);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); if (e.target.closest('[data-fechar]')) d.close(); });
  d.showModal(); aoAbrir?.(d);
  return d;
}

/* ---------------- menu de ações (⋯) ---------------- */
export function ligarMenus(raiz) {
  raiz.addEventListener('click', (e) => {
    const gat = e.target.closest('[data-menu]');
    for (const l of raiz.querySelectorAll('.rf-pop__lista:not([hidden])')) if (!gat || l !== gat.nextElementSibling) { l.hidden = true; l.previousElementSibling?.setAttribute('aria-expanded', 'false'); }
    if (!gat) return;
    const lista = gat.nextElementSibling; lista.hidden = !lista.hidden; gat.setAttribute('aria-expanded', String(!lista.hidden));
    if (!lista.hidden) lista.querySelector('button')?.focus();
  });
  raiz.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const l = e.target.closest('.rf-pop__lista'); if (l) { l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false'); l.previousElementSibling.focus(); } } });
}

/* ---------------- moldura de cada seção ---------------- */
export function secao({ titulo, destaque = '', texto, objetivos = [], antes = null, notas = [], selos = [] }) {
  return h(`<section class="lb-sec">
    <header class="lb-cab"><h1>${titulo} ${destaque ? `<em>${destaque}</em>` : ''}</h1><p>${texto}</p></header>
    ${objetivos.length ? `<div class="lb-objetivo" style="margin-top:14px">${objetivos.map(([t, d]) => `<div class="lb-obj"><b>${t}</b><p>${d}</p></div>`).join('')}</div>` : ''}
    <div class="lb-comparar" style="margin-top:18px">
      <div class="lb-antes">${antes ? `<span class="lb-rotulo">Hoje no app</span><figure tabindex="0" aria-label="Captura da tela atual do app (role para ver)"><img src="${antes}" alt="Captura da tela atual do app" loading="lazy"></figure>` : ''}
        ${selos.length ? `<div class="lb-selos">${selos.map(([t, tipo]) => `<span class="lb-selo lb-selo--${tipo}">${t}</span>`).join('')}</div>` : ''}
        ${notas.length ? `<span class="lb-rotulo">O que mudou</span><ul class="lb-notas">${notas.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
      </div>
      <div style="display:grid;gap:10px;min-width:0"><span class="lb-rotulo lb-rotulo--proposta">Proposta (interativa)</span><div data-palco style="min-width:0"></div></div>
    </div></section>`);
}

/* ---------------- casca proposta do Business ---------------- */
export const EMPRESAS = [
  { id: 'e1', nome: 'Doces da Vila', cidade: 'Campinas', uf: 'SP', papel: 'Proprietária', erp: 'ativo', vitrine: 'publicada', cor: ['#7c1b30', '#3a0e1d'], logo: null },
  { id: 'e2', nome: 'Conserta Celular Centro', cidade: 'São Paulo', uf: 'SP', papel: 'Gerente', erp: 'ativo', vitrine: 'analise', cor: ['#1e4d8c', '#0f2547'], logo: null },
  { id: 'e3', nome: 'Pintores Fictícios', cidade: 'Sorocaba', uf: 'SP', papel: 'Estoque', erp: 'ativo', vitrine: 'rascunho', cor: ['#2c6b3d', '#14321c'], logo: null },
];
export const estadoApp = { empresa: 'e1' };
export const iniciais = (n) => n.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export function logoEmp(e, classe = '') {
  return `<span class="rf-logo-emp ${classe}" style="background:linear-gradient(135deg,${e.cor[0]},${e.cor[1]})">${e.logo ? `<img src="${e.logo}" alt="">` : esc(iniciais(e.nome))}</span>`;
}
const MENU = [['OPERAÇÃO', [['painel', 'Painel'], ['vendas', 'Vendas'], ['pedidos', 'Pedidos', 3], ['orcamentos', 'Orçamentos'], ['ordens', 'Ordens de serviço'], ['agenda', 'Agenda']]],
  ['CATÁLOGO', [['produtos', 'Produtos'], ['estoque', 'Estoque'], ['fornecedores', 'Fornecedores']]],
  ['GESTÃO', [['financeiro', 'Financeiro'], ['clientes', 'Clientes'], ['equipe', 'Equipe'], ['empresa', 'Empresa e vitrine']]]];

export function casca({ atual, trilha = [], titulo, subtitulo = '', acoes = '', corpo = '' }) {
  const e = EMPRESAS.find((x) => x.id === estadoApp.empresa);
  const troca = `<button type="button" class="rf-troca" data-trocar-empresa aria-haspopup="dialog">${logoEmp(e)}<span><small>Empresa ativa</small><strong>${esc(e.nome)}</strong></span>${ic('trocar')}</button>`;
  return h(`<div class="rf-app">
    <aside class="rf-lateral" aria-label="Menu do Business">
      <a class="rf-marca" href="#" data-sem-nav>${SIMBOLO}<span>Autoni<b>CK</b><small>BUSINESS</small></span></a>
      ${troca}
      <button type="button" class="rf-ir" data-paleta>${ic('busca')}Buscar ou ir para… <kbd>Ctrl K</kbd></button>
      ${MENU.map(([g, itens]) => `<p class="rf-grupo">${g}</p><nav class="rf-menu" aria-label="${g}">${itens.map(([id, n, c]) => `<a href="#" data-sem-nav ${id === atual ? 'aria-current="page"' : ''}>${ic(id)}<span>${n}</span>${c ? `<span class="rf-n" aria-label="${c} novos">${c}</span>` : ''}</a>`).join('')}</nav>`).join('')}
      <div class="rf-lateral__pe"><span class="rf-avatar">PD</span><div><b>Pessoa Dona</b><br><small>pessoa@teste.example</small></div></div>
    </aside>
    <div class="rf-principal">
      <div class="rf-cel-topo">${troca}<button type="button" class="rf-bt rf-bt--f rf-bt--icone" aria-label="Menu" style="color:inherit">${ic('pedidos')}</button></div>
      <header class="rf-topo"><div>${trilha.length ? `<div class="rf-trilha">${trilha.map((t) => `<span>${t}</span>`).join('')}</div>` : ''}<h2>${titulo}</h2>${subtitulo ? `<p>${subtitulo}</p>` : ''}</div><div class="rf-acoes">${acoes}</div></header>
      <div class="rf-corpo" data-corpo>${corpo}</div>
    </div></div>`);
}
