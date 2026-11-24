// Prévia do site inteiro na direção CK Forja Noturna.
import { carregarFontes } from '../fontes.js';
import { obterMotor } from '../motor/motor.js';
import { ANIMACOES, RITMOS, criarLaco } from '../motor/animacoes.js';
import { RUNTIME } from '../estado.js';
import { SIMULACAO } from '../feedback.js';
import { TELAS, ICONES } from './telas.js';
import { ESTILO } from './pecas.js';

globalThis.__SIMULACAO = SIMULACAO;
SIMULACAO.latencia = 900; SIMULACAO.resultado = 'sucesso'; SIMULACAO.limiar = 120;
const LOGO = 'public/assets/brand/autonick-geral-320.webp', LOGO_EMP = 'public/assets/brand/autonick-empresarial-320.webp';
const AREAS = { publico: 'Público', business: 'Business', cliente: 'Cliente', ck: 'CK Admin' };
const estado = { area: 'publico', tela: 'home', dispositivo: 'desktop', tema: 'escuro', autenticado: false, metaConfigurada: false, apiInformaEtapas: true, leitura: false };
const quadro = document.getElementById('quadro'); const ctlTela = document.getElementById('ctl-tela');
let desmontar = null, conteudo = null, app = null;

/* ---------- cascas das áreas ---------- */
const faixa = '<p class="fn-faixa"><b>VERSÃO DE DESENVOLVIMENTO</b> Dados fictícios de teste. Nenhum pagamento é real.</p>';
const marca = (emp = false, sub = '') => `<a class="fn-marca" href="#" data-ir="publico/home"><img src="${emp ? LOGO_EMP : LOGO}" alt=""><span>Autoni<b>CK</b>${sub ? `<small>${sub}</small>` : ''}</span></a>`;
const leitura = '<button type="button" class="fn-leitura" data-leitura aria-pressed="false"><b>Aa</b><span>Leitura ampliada</span></button>';
function casca(area) {
  const telas = TELAS[area];
  if (area === 'business') {
    const grupos = [['OPERAÇÃO', ['painel', 'vendas', 'ordens', 'agenda']], ['CATÁLOGO', ['produtos', 'estoque']], ['GESTÃO', ['financeiro', 'relatorios']]];
    return `${faixa}<div class="fn-biz"><aside class="fn-lateral">${marca(true, 'EMPRESARIAL')}<div class="fn-empresa"><small>EMPRESA ATIVA</small>[TESTE] Conserta Celular</div>
      ${grupos.map(([g, ids]) => `<p class="fn-grupo-menu">${g}</p><nav class="fn-menu" aria-label="${g}">${ids.map((id) => `<a href="#" data-tela="${id}">${ICONES[id]}<span>${telas.find((t) => t.id === id).nome.replace(' (dashboard)', '')}</span>${id === 'painel' ? '<span class="fn-conta-n">1</span>' : ''}</a>`).join('')}</nav>`).join('')}
      </aside><main class="fn-biz-main" data-main></main></div>`;
  }
  if (area === 'cliente') {
    const nav = [['descobrir', 'Buscar', 'buscar'], ['pedidos', 'Pedidos', 'pedidos'], ['orcamentos', 'Orçamentos', 'orcamentos'], ['servico', 'Serviços', 'servicos']];
    // correção: cliente autenticado vê a própria conta, nunca o botão "Entrar"
    const conta = estado.autenticado ? '<span class="fn-conta"><i>CR</i><span>Cida Ramos</span></span>' : '<button type="button" class="fn-bt fn-bt--p" data-ir="publico/entrar"><span class="fb-rot">Entrar</span></button>';
    return `${faixa}<header class="fn-cab fn-cli-cab">${marca()}<nav class="fn-nav-pub" aria-label="Cliente">${nav.map(([id, n]) => `<a href="#" data-tela="${id}">${n}</a>`).join('')}</nav>${leitura}${conta}</header>
      <main class="fn-cli-main" data-main></main><nav class="fn-barra-cli" aria-label="Cliente (celular)">${[...nav, ['aceite', 'Conta', 'conta']].map(([id, n, ic]) => `<a href="#" data-tela="${id}">${ICONES[ic]}${n}</a>`).join('')}</nav>`;
  }
  if (area === 'ck') {
    return `${faixa}<header class="fn-cab fn-adm-cab">${marca(false, 'CK ADMIN')}${leitura}<span class="fn-conta"><i>CK</i><span>Moderação</span></span></header>
      <div class="fn-adm-main"><nav class="fn-tabs-adm" aria-label="CK Admin">${telas.map((t) => `<a href="#" data-tela="${t.id}">${t.nome}</a>`).join('')}</nav><main data-main style="display:grid;gap:1.3rem"></main></div>`;
  }
  return `${faixa}<header class="fn-cab">${marca()}<nav class="fn-nav-pub" aria-label="Principal"><a href="#" data-tela="home">Início</a><a href="#" data-ir="cliente/descobrir">Encontrar serviços</a><a href="#" data-ir="business/painel">Gerenciar meu negócio</a><a href="#" data-tela="entrar">Entrar</a></nav>${leitura}${estado.autenticado ? '<span class="fn-conta"><i>CR</i><span>Cida</span></span>' : '<button type="button" class="fn-bt fn-bt--p" data-tela="entrar"><span class="fb-rot">Entrar</span></button>'}</header><div data-main></div><footer class="fn-rodape">AutoniCK · uma iniciativa da CK Group · versão de desenvolvimento</footer>`;
}

/* ---------- montagem ---------- */
function montarArea() {
  desmontar?.(); desmontar = null;
  quadro.innerHTML = `<div class="fn-app" data-area="${estado.area}" data-tema="${estado.tema}" ${RUNTIME.reduzido ? 'data-reduzido' : ''} ${estado.leitura ? 'data-leitura="ampliada"' : ''}>${casca(estado.area)}</div>`;
  app = quadro.firstElementChild; conteudo = app.querySelector('[data-main]');
  app.addEventListener('click', aoClicar);
  mostrarTela(estado.tela, false);
}
function pintarNav() {
  app.querySelectorAll('[data-tela]').forEach((a) => { if (a.dataset.tela === estado.tela) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  app.querySelectorAll('[data-leitura]').forEach((b) => b.setAttribute('aria-pressed', String(estado.leitura)));
  const sel = document.getElementById('sel-tela'); sel.innerHTML = TELAS[estado.area].map((t) => `<option value="${t.id}">${t.nome}</option>`).join(''); sel.value = estado.tela;
  document.querySelectorAll('[data-area-bt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.areaBt === estado.area)));
  try { history.replaceState(null, '', `#${estado.area}-${estado.tela}`); } catch { /* sem histórico */ }
}
function mostrarTela(id, comCarga = true, origem = null) {
  const tela = TELAS[estado.area].find((t) => t.id === id) ?? TELAS[estado.area][0];
  const trocar = () => {
    desmontar?.(); ctlTela.innerHTML = '';
    estado.tela = tela.id;
    conteudo.innerHTML = `<div class="fn-conteudo-in" style="display:grid;gap:1.3rem">${tela.html()}</div>`;
    conteudo.removeAttribute('aria-busy'); origem?.classList.remove('fn-carregando-item'); origem?.querySelector('.fn-selo-abrindo')?.remove();
    desmontar = tela.ativar(conteudo.firstElementChild, ctx) ?? null;
    pintarNav();
  };
  if (!comCarga) { trocar(); return; }
  // G10 adaptado: o próprio item mostra "abrindo" só se a navegação passar do limiar
  const ms = Math.min(900, SIMULACAO.latencia * 0.5);
  const sinal = setTimeout(() => { conteudo.setAttribute('aria-busy', 'true'); if (origem) { origem.classList.add('fn-carregando-item'); if (origem.closest('.fn-menu')) origem.insertAdjacentHTML('beforeend', '<span class="fn-selo-abrindo"><i></i>abrindo</span>'); } }, SIMULACAO.limiar);
  setTimeout(() => { clearTimeout(sinal); trocar(); }, ms);
}
function aoClicar(e) {
  const alvo = e.target.closest('[data-tela], [data-ir], [data-leitura]'); if (!alvo || !app.contains(alvo)) return;
  e.preventDefault();
  if (alvo.dataset.leitura !== undefined) { estado.leitura = !estado.leitura; app.toggleAttribute('data-leitura', estado.leitura); if (estado.leitura) app.dataset.leitura = 'ampliada'; pintarNav(); return; }
  if (alvo.dataset.tela) { if (alvo.dataset.tela !== estado.tela) mostrarTela(alvo.dataset.tela, true, alvo); return; }
  const [area, tela] = alvo.dataset.ir.split('/');
  if (area === estado.area) mostrarTela(tela, true, alvo); else irPara(area, tela);
}
function irPara(area, tela) { estado.area = area; estado.tela = tela; montarArea(); }
const ctx = {
  estado,
  irPara,
  recarregar: () => mostrarTela(estado.tela, false),
  entrar: () => { estado.autenticado = true; },
  controles(lista) { ctlTela.innerHTML = lista.length ? '<b>Simular eventos desta tela:</b>' : ''; for (const [rot, f] of lista) { const b = document.createElement('button'); b.type = 'button'; b.className = 'fl-bt'; b.textContent = rot; b.addEventListener('click', f); ctlTela.append(b); } },
};

/* ---------- G08 expressivo: abertura do app ---------- */
async function abertura() {
  const el = document.createElement('div'); el.className = 'fn-abertura'; el.setAttribute('role', 'status');
  el.innerHTML = '<div class="fn-cena"></div><b>Autoni<em>CK</em></b><div class="fn-indeterminado" aria-hidden="true"><i></i></div><small>Preparando o AutoniCK</small>';
  app.append(el); let v = null;
  const pronto = obterMotor().then((m) => { const laco = criarLaco(ANIMACOES.B13, RITMOS.C04); v = m.criarVista(el.querySelector('.fn-cena'), { fonte: (t, c) => laco.quadro(t, c), enquadramento: ANIMACOES.B13.enquadramento, tocando: true, estilo: ESTILO }); }).catch(() => {});
  await Promise.all([pronto, new Promise((r) => setTimeout(r, 1800))]); // o app só "abre" quando o 3D e a página estão prontos
  el.classList.add('saindo'); setTimeout(() => { v?.liberar(); el.remove(); }, 450);
}

/* ---------- bancada ---------- */
function ligarBancada(motorP) {
  const barra = document.getElementById('barra');
  barra.querySelector('[data-areas]').innerHTML = Object.entries(AREAS).map(([k, n]) => `<button type="button" data-area-bt="${k}">${n}</button>`).join('');
  barra.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.areaBt) { irPara(b.dataset.areaBt, TELAS[b.dataset.areaBt][0].id); return; }
    if (b.dataset.disp) { estado.dispositivo = b.dataset.disp; quadro.dataset.dispositivo = estado.dispositivo; seg(b); return; }
    if (b.dataset.tema) { estado.tema = b.dataset.tema; app.dataset.tema = estado.tema; seg(b); return; }
    if (b.id === 'bt-red') { RUNTIME.reduzido = !RUNTIME.reduzido; b.setAttribute('aria-pressed', String(RUNTIME.reduzido)); const m = await motorP.catch(() => null); if (m) { m.config.reduzido = RUNTIME.reduzido; } montarArea(); return; }
    if (b.id === 'bt-abertura') abertura();
  });
  const seg = (b) => b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  document.getElementById('sel-tela').addEventListener('change', (e) => mostrarTela(e.target.value, true, null));
  const lat = document.getElementById('lat'); lat.addEventListener('input', () => { SIMULACAO.latencia = Number(lat.value); document.getElementById('lat-v').textContent = `${lat.value} ms`; });
  document.getElementById('res').addEventListener('change', (e) => { SIMULACAO.resultado = e.target.value; });
  const prefere = window.matchMedia('(prefers-reduced-motion: reduce)'); if (prefere.matches) { RUNTIME.reduzido = true; document.getElementById('bt-red').setAttribute('aria-pressed', 'true'); motorP.then((m) => { m.config.reduzido = true; }).catch(() => {}); }
}

async function iniciar() {
  const h = (location.hash || '').slice(1).split('-');
  if (AREAS[h[0]] && TELAS[h[0]].some((t) => t.id === h[1])) { estado.area = h[0]; estado.tela = h[1]; }
  const motorP = obterMotor(); motorP.catch(() => {});
  ligarBancada(motorP);
  await carregarFontes();
  montarArea();
  if (!h[0] || h[0] === 'publico') abertura();
}
iniciar();
