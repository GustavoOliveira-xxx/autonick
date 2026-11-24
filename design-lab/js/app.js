// Casca do AutoniCK Design Lab: navegação por categorias (rotas por #nome), controles globais e medidor.
import { carregarFontes } from './fontes.js';
import { obterMotor } from './motor/motor.js';
import { RUNTIME, loja } from './estado.js';
import { CATEGORIAS } from './catalogo.js';
import { agendarFx } from './replica.js';
import { esc } from './ui.js';

const PAGINAS = {
  inicio: () => import('./paginas/inicio.js'),
  fundo: () => import('./paginas/fundo.js'),
  sino: () => import('./paginas/sino.js'),
  ritmo: () => import('./paginas/ritmo.js'),
  objetos: () => import('./paginas/objetos.js'),
  ambiente: () => import('./paginas/ambiente.js'),
  clique: () => import('./paginas/clique.js'),
  carregamento: () => import('./paginas/carregamento.js'),
  componentes: () => import('./paginas/componentes.js'),
  areas: () => import('./paginas/areas.js'),
  direcoes: () => import('./paginas/direcoes.js'),
  combinador: () => import('./paginas/combinador.js'),
  combinacoes: () => import('./paginas/combinacoes.js'),
  escolhas: () => import('./paginas/escolhas.js'),
};
const EXTRAS = [['combinador', '✦', 'Combinador visual'], ['combinacoes', 'K', 'Combinações prontas'], ['escolhas', '♥', 'Minhas escolhas']];

const lab = document.getElementById('lab'); const main = document.getElementById('conteudo'); const nav = document.getElementById('nav');
let atual = null, rotaAtual = '';

function montarNav() {
  const item = (rota, letra, nome, marca = '') => `<li><a href="#${rota}" data-rota="${rota}"><span class="letra">${esc(letra)}</span><span>${esc(nome)}</span>${marca}</a></li>`;
  nav.innerHTML = `<ol>${item('inicio', '◆', 'Início')}
    <li class="sep">Categorias</li>
    ${CATEGORIAS.map((c) => item(c.rota, c.id, c.nome, `<span class="marca-escolha" data-marca="${c.id}"></span>`)).join('')}
    <li class="sep">Montar e decidir</li>${EXTRAS.map(([r, l, n]) => item(r, l, n)).join('')}</ol>`;
}
function pintarNav() {
  nav.querySelectorAll('a').forEach((a) => { if (a.dataset.rota === rotaAtual) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  let n = 0;
  for (const c of CATEGORIAS) { const id = loja.escolhida(c.id); const m = nav.querySelector(`[data-marca="${c.id}"]`); if (id) n++; if (m) { m.textContent = id ?? '·'; m.classList.toggle('feita', Boolean(id)); } }
  document.getElementById('contador').textContent = `${n}/${CATEGORIAS.length}`;
}

async function irPara() {
  const rota = (location.hash || '#inicio').slice(1);
  const chave = PAGINAS[rota] ? rota : 'inicio';
  if (chave === rotaAtual) return;
  try { atual?.(); } catch { /* página já desmontada */ }
  atual = null; rotaAtual = chave; main.innerHTML = ''; pintarNav();
  const mod = await PAGINAS[chave]();
  if (rotaAtual !== chave) return;
  atual = await mod.montar(main, { irPara: (r) => { location.hash = r; } });
  main.focus({ preventScroll: true }); window.scrollTo({ top: 0 });
  document.title = `${CATEGORIAS.find((c) => c.rota === chave)?.nome ?? { combinador: 'Combinador', combinacoes: 'Combinações', escolhas: 'Minhas escolhas' }[chave] ?? 'Início'} · AutoniCK Design Lab`;
}

/* ---------- controles globais ---------- */
function ligarControles(motorP) {
  const btTocar = document.getElementById('ctl-tocar');
  btTocar.addEventListener('click', async () => {
    RUNTIME.pausado = !RUNTIME.pausado; btTocar.setAttribute('aria-pressed', String(RUNTIME.pausado));
    btTocar.textContent = RUNTIME.pausado ? '▶ Tocar tudo' : '❚❚ Pausar tudo';
    lab.toggleAttribute('data-pausado', RUNTIME.pausado);
    const m = await motorP.catch(() => null); if (m) { m.config.pausado = RUNTIME.pausado; m.agendar(); }
    agendarFx();
  });
  document.getElementById('ctl-reiniciar').addEventListener('click', () => document.dispatchEvent(new CustomEvent('lab:reiniciar')));
  const btLaco = document.getElementById('ctl-laco');
  btLaco.addEventListener('click', () => { RUNTIME.laco = !RUNTIME.laco; btLaco.setAttribute('aria-pressed', String(RUNTIME.laco)); document.dispatchEvent(new CustomEvent('lab:reiniciar')); });
  document.getElementById('ctl-vel').addEventListener('change', async (e) => { RUNTIME.velocidade = Number(e.target.value); const m = await motorP.catch(() => null); if (m) m.config.velocidade = RUNTIME.velocidade; });
  const int = document.getElementById('ctl-int');
  int.addEventListener('input', async () => {
    RUNTIME.intensidade = Number(int.value) / 100; document.getElementById('ctl-int-v').textContent = `${int.value}%`;
    lab.style.setProperty('--int-global', RUNTIME.intensidade);
    const m = await motorP.catch(() => null); if (m) { m.config.intensidade = RUNTIME.intensidade; m.redesenharTodas(); }
  });
  const btRed = document.getElementById('ctl-reduzido');
  const prefere = window.matchMedia('(prefers-reduced-motion: reduce)');
  const aplicarRed = async (v) => {
    RUNTIME.reduzido = v; btRed.setAttribute('aria-pressed', String(v)); lab.toggleAttribute('data-reduzido', v);
    const m = await motorP.catch(() => null); if (m) { m.config.reduzido = v; m.redesenharTodas(); }
  };
  btRed.addEventListener('click', () => aplicarRed(!RUNTIME.reduzido));
  RUNTIME.reduzidoSistema = prefere.matches; if (prefere.matches) aplicarRed(true);
  prefere.addEventListener?.('change', (e) => { RUNTIME.reduzidoSistema = e.matches; aplicarRed(e.matches); });

  const medidor = document.getElementById('medidor');
  motorP.then((m) => {
    setInterval(() => {
      if (document.hidden) return;
      medidor.innerHTML = m.medicao.amostras.length ? `3D: <b>${m.medicao.msPorQuadro.toFixed(1).replace('.', ',')} ms</b>/quadro · ${m.medicao.vistasDesenhadas} vitrine(s) ativas` : '3D pronto';
    }, 600);
  }).catch((e) => { medidor.textContent = 'sem 3D: ' + e.message; medidor.title = 'O laboratório continua funcionando com a imagem estática do sino.'; });
}

async function iniciar() {
  montarNav(); loja.ouvir(pintarNav);
  const motorP = obterMotor(); motorP.catch(() => {});
  ligarControles(motorP);
  await carregarFontes();
  window.addEventListener('hashchange', irPara);
  await irPara();
}
iniciar();
