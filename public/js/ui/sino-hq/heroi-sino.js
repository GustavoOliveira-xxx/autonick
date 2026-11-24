/**
 * Sino HQ do herói da página de apresentação (cena "Chamado da Forja" em laço, direção CK Forja Noturna).
 *
 * - A imagem estática já vem no HTML: reserva o espaço e é o plano B. Nada de "Carregando".
 * - O 3D (Three.js + GLB do próprio app) só carrega com a seção visível e depois do texto e dos botões.
 * - Laço: cena, pausa na pose final e volta suave à pose inicial (animacao-chamado-forja.js).
 * - O fundo do herói (palco em perspectiva, raios e contraluz) nasce da posição real do sino: este componente informa
 *   centro e base do sino em variáveis CSS (--sino-x, --sino-y, --sino-base, --sino-raio) e o pulso do impacto (--impacto).
 * - Para fora da tela e com a aba oculta; volta do mesmo ponto, com um só ciclo de quadros.
 * - Movimento reduzido: começa estático; tocar no sino (ou Enter/Espaço com ele em foco) toca a cena uma vez. Sem som.
 * - Sem WebGL, sem o GLB ou com erro: fica a imagem estática e a página segue funcionando.
 *
 * Estado exposto em atributos de dados (para estilo e testes): data-estado (estatico | carregando | pronto | falhou |
 * encerrado), data-rodando (sim | nao), data-ciclos (ciclos completos), data-t (tempo da cena, em décimos de segundo),
 * data-motivo (quando falha).
 */
import { DURACAO_CICLO, LACO, CHAMADO, poseDoLaco } from './animacao-chamado-forja.js';

const LIMITE_CARGA_MS = 20000;

export function montarHeroiSino(raiz, opcoes = {}) {
  const urlModelo = opcoes.modelo ?? raiz.dataset.modelo;
  const prefere = window.matchMedia('(prefers-reduced-motion: reduce)');
  const est = {
    t: 0, rodando: false, visivel: false, abaVisivel: !document.hidden,
    reduzido: prefere.matches, umaVez: false, palco: null, carregando: null, raf: 0, ultimo: 0, encerrado: false,
  };

  const cena = criar('canvas', 'heroi-sino__cena');
  const hq = criar('canvas', 'heroi-sino__hq');
  const palcoEl = raiz.querySelector('.heroi-sino__palco') ?? raiz;
  palcoEl.append(cena, hq);

  definir('estado', 'estatico');
  definir('ciclos', '0');
  definir('rodando', 'nao');
  atualizarToque();

  /* ---------- carregamento ---------- */
  function carregar() {
    if (est.carregando) return est.carregando;
    est.carregando = (async () => {
      definir('estado', 'carregando');
      let palco = null;
      try {
        const { PalcoSino, webglDisponivel } = await import('./palco-sino.js');
        if (!webglDisponivel()) throw new Error('WebGL indisponível neste navegador');
        const controle = new AbortController();
        const prazo = setTimeout(() => controle.abort(), LIMITE_CARGA_MS);
        let bytes;
        try {
          const resposta = await fetch(urlModelo, { signal: controle.signal });
          if (!resposta.ok) throw new Error(`modelo respondeu ${resposta.status}`);
          bytes = await resposta.arrayBuffer();
        } finally { clearTimeout(prazo); }
        if (est.encerrado) return;
        palco = new PalcoSino({ palco: palcoEl, canvas: cena, camadaHq: hq });
        await palco.montar(bytes);
        if (est.encerrado) { palco.liberar(); return; }
        est.palco = palco;
        desenharAgora();
        raiz.classList.add('heroi-sino--3d');
        definir('estado', 'pronto');
        atualizarToque(); agendar();
      } catch (erro) {
        palco?.liberar();
        est.palco = null;
        definir('estado', 'falhou');
        definir('motivo', erro?.name === 'AbortError' ? 'o modelo demorou demais para carregar' : String(erro?.message ?? erro));
        console.warn('Sino 3D indisponível; a imagem estática continua no lugar.', erro);
        atualizarToque();
      }
    })();
    return est.carregando;
  }

  /* ---------- laço ---------- */
  const deveRodar = () => Boolean(est.palco) && !est.encerrado && est.visivel && est.abaVisivel
    && (!est.reduzido || est.umaVez);
  function agendar() {
    const roda = deveRodar();
    if (roda !== est.rodando) { est.rodando = roda; definir('rodando', roda ? 'sim' : 'nao'); }
    if (!roda) { est.ultimo = 0; return; }
    if (!est.raf) est.raf = requestAnimationFrame(quadro); // nunca mais de um ciclo de quadros
  }
  function quadro(agora) {
    est.raf = 0;
    if (!deveRodar()) { agendar(); return; }
    const dt = est.ultimo ? Math.min(0.05, (agora - est.ultimo) / 1000) : 0;
    est.ultimo = agora;
    est.t += dt;
    if (est.umaVez && est.t >= LACO.cena + LACO.pausaFinal) { est.t = LACO.cena + LACO.pausaFinal; est.umaVez = false; }
    definir('ciclos', String(Math.floor(est.t / DURACAO_CICLO)));
    const tempo = est.t.toFixed(1); if (raiz.dataset.t !== tempo) definir('t', tempo);
    desenharAgora();
    agendar();
  }
  function desenharAgora() {
    if (!est.palco) return;
    const pose = poseDoLaco(est.t, { reduzido: est.reduzido, soUmaVez: est.reduzido });
    est.palco.desenhar(pose, CHAMADO.enquadramento);
    posicionarFundo(est.palco.projecao(), pose.impacto || 0);
  }

  /* ---------- fundo do herói alinhado ao sino ---------- */
  const heroi = raiz.closest('.heroi') ?? raiz.parentElement;
  let ultimoFundo = '';
  function posicionarFundo(proj, impacto = 0) {
    if (!heroi) return;
    const h = heroi.getBoundingClientRect(), p = palcoEl.getBoundingClientRect();
    if (!h.width || !p.width) return;
    // sem 3D: a imagem estática ocupa 16–67% × 19–78% do palco (mesma medida do pôster)
    const cx = proj ? proj.centro.x / proj.w : 0.415, cy = proj ? proj.centro.y / proj.h : 0.485, cb = proj ? proj.base.y / proj.h : 0.78;
    const x = p.left - h.left + cx * p.width, y = p.top - h.top + cy * p.height, base = p.top - h.top + cb * p.height + p.height * 0.03;
    const chave = `${Math.round(x)}|${Math.round(y)}|${Math.round(base)}|${Math.round(p.width)}`;
    if (chave !== ultimoFundo) {
      ultimoFundo = chave;
      heroi.style.setProperty('--sino-x', `${x}px`); heroi.style.setProperty('--sino-y', `${y}px`);
      heroi.style.setProperty('--sino-base', `${base}px`); heroi.style.setProperty('--sino-raio', `${p.width * 0.24}px`);
    }
    heroi.style.setProperty('--impacto', impacto.toFixed(3));
  }
  posicionarFundo(null);

  /* ---------- movimento reduzido: o próprio sino toca a cena uma vez, sob pedido ---------- */
  function atualizarToque() {
    const ativo = est.reduzido && !est.encerrado && raiz.dataset.estado !== 'falhou';
    if (ativo) {
      palcoEl.setAttribute('role', 'button'); palcoEl.tabIndex = 0;
      palcoEl.setAttribute('aria-label', 'Ver a animação do sino');
    } else {
      palcoEl.removeAttribute('role'); palcoEl.removeAttribute('tabindex'); palcoEl.removeAttribute('aria-label');
    }
    definir('toque', ativo ? 'sim' : 'nao');
  }
  async function tocarUmaVez() {
    if (!est.reduzido || est.rodando || est.encerrado) return;
    est.t = 0; est.umaVez = true;
    await carregar(); agendar();
  }
  palcoEl.addEventListener('click', tocarUmaVez);
  palcoEl.addEventListener('keydown', (e) => { if (est.reduzido && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tocarUmaVez(); } });

  /* ---------- visibilidade, aba e preferência de movimento ---------- */
  const io = new IntersectionObserver((entradas) => {
    est.visivel = entradas.some((e) => e.isIntersecting);
    if (est.visivel && !est.reduzido && !est.carregando) iniciarQuandoLivre();
    agendar();
  }, { threshold: 0.15 });
  io.observe(raiz);

  // espera o texto, os botões e a página terminarem de carregar antes de buscar o Three.js e o GLB
  function iniciarQuandoLivre() {
    const ir = () => { if (!est.encerrado && !est.reduzido) carregar(); };
    if (document.readyState === 'complete') setTimeout(ir, 0);
    else window.addEventListener('load', ir, { once: true });
  }

  const aoMudarAba = () => { est.abaVisivel = !document.hidden; agendar(); };
  document.addEventListener('visibilitychange', aoMudarAba);

  const aoMudarPreferencia = (e) => {
    est.reduzido = e.matches;
    if (est.reduzido) { est.umaVez = false; } else if (est.visivel && !est.carregando) iniciarQuandoLivre();
    agendar(); atualizarToque();
  };
  prefere.addEventListener?.('change', aoMudarPreferencia);

  const ro = new ResizeObserver(() => { if (est.palco && est.palco.redimensionar() && !est.rodando) desenharAgora(); else if (!est.palco) posicionarFundo(null); });
  ro.observe(palcoEl);

  const aoSair = (e) => { if (!e.persisted) desmontar(); };
  window.addEventListener('pagehide', aoSair);

  /** Encerra o laço e libera a cena (Three.js, GLB e contexto WebGL). A imagem estática volta a aparecer. */
  function desmontar() {
    if (est.encerrado) return;
    est.encerrado = true;
    if (est.raf) cancelAnimationFrame(est.raf);
    est.raf = 0;
    io.disconnect(); ro.disconnect();
    document.removeEventListener('visibilitychange', aoMudarAba);
    prefere.removeEventListener?.('change', aoMudarPreferencia);
    window.removeEventListener('pagehide', aoSair);
    est.palco?.liberar(); est.palco = null;
    raiz.classList.remove('heroi-sino--3d');
    cena.remove(); hq.remove();
    atualizarToque();
    est.rodando = false; definir('rodando', 'nao');
    definir('estado', 'encerrado');
  }

  function definir(nome, valor) { raiz.dataset[nome] = valor; }
  function criar(tag, classe) { const el = document.createElement(tag); el.className = classe; el.setAttribute('aria-hidden', 'true'); return el; }

  return { desmontar };
}
