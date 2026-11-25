/**
 * Navegação viva (CK Forja Noturna, H02 + F14 + G01).
 *
 * 1. Clique "Forja": no pointerdown (ou Enter/Espaço) o controle afunda, acende e solta uma onda dourada a partir do
 *    ponto tocado. É resposta ao toque, não indicador de carregamento: acontece mesmo em ações instantâneas.
 * 2. Troca de página: ao seguir um link interno, o fio dourado aparece no topo na hora e o link marcado mostra que está
 *    abrindo. Nada segura a navegação: o navegador segue o link imediatamente. O fio some ao voltar pelo histórico
 *    (pageshow), se a navegação for cancelada (Esc / parar) ou depois de um tempo de segurança.
 * 3. Entrada: o conteúdo da nova página entra com um deslize curto. Com View Transitions entre documentos (CSS
 *    @view-transition), o navegador cuida da passagem; nos demais, só a entrada.
 * Movimento reduzido: sem onda e sem deslize; o fio continua (é informação), sem animação de varredura.
 */
const ALVOS_CLIQUE = '.botao, button, .menu-lateral a, .navegacao-local a, .barra-celular a, .cartao-acao, [data-clique]';
const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function onda(alvo, x, y) {
  const r = alvo.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const o = document.createElement('span');
  o.className = 'onda-forja';
  o.setAttribute('aria-hidden', 'true');
  o.style.left = `${x - r.left}px`;
  o.style.top = `${y - r.top}px`;
  o.style.setProperty('--onda-escala', String(Math.ceil(Math.hypot(r.width, r.height) / 6)));
  let camada = alvo.querySelector(':scope > .camada-onda');
  if (!camada) {
    camada = document.createElement('span');
    camada.className = 'camada-onda';
    camada.setAttribute('aria-hidden', 'true');
    if (getComputedStyle(alvo).position === 'static') alvo.style.position = 'relative';
    alvo.append(camada);
  }
  camada.append(o);
  o.addEventListener('animationend', () => o.remove(), { once: true });
  setTimeout(() => o.remove(), 900);
}

function pressionar(alvo, x, y) {
  alvo.classList.add('pressionado');
  if (reduzido()) return;
  alvo.classList.remove('lampejo');
  void alvo.offsetWidth; // reinicia a animação do lampejo
  alvo.classList.add('lampejo');
  onda(alvo, x, y);
}
function soltar() {
  for (const a of document.querySelectorAll('.pressionado')) a.classList.remove('pressionado');
}

let fio = null;
let seguranca = 0;
function mostrarFio() {
  if (!fio) {
    fio = document.createElement('div');
    fio.className = 'fio-navegacao';
    fio.setAttribute('role', 'progressbar');
    fio.setAttribute('aria-label', 'Abrindo a página');
    document.body.append(fio);
  }
  fio.hidden = false;
  document.documentElement.classList.add('navegando');
  clearTimeout(seguranca);
  seguranca = setTimeout(esconderFio, 15000);
}
function esconderFio() {
  clearTimeout(seguranca);
  if (fio) fio.hidden = true;
  document.documentElement.classList.remove('navegando');
  for (const a of document.querySelectorAll('.abrindo')) a.classList.remove('abrindo');
}

/** É uma navegação interna comum (mesma origem, sem nova aba, sem download, sem âncora na própria página)? */
export function ehNavegacaoInterna(evento, link) {
  if (!link || evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return false;
  if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return false;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return false;
  return !(url.pathname === location.pathname && url.search === location.search);
}

/**
 * Âncora tardia: as telas montam o conteúdo depois de ler o banco, então "#titulo-novo-cliente" ainda não existe no carregamento.
 * Espera o alvo aparecer (até 8 s), rola até ele e leva o foco; se o alvo tiver data-ancora-abre (ex.: "Novo compromisso"), abre.
 */
function seguirAncoraTardia() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || !/^[a-z0-9_-]{2,60}$/i.test(id) || document.getElementById(id)) return;
  const fim = Date.now() + 8000;
  const obs = new MutationObserver(() => {
    const alvo = document.getElementById(id);
    if (!alvo && Date.now() < fim) return;
    obs.disconnect();
    if (!alvo) return;
    requestAnimationFrame(() => {
      alvo.scrollIntoView({ block: 'start', behavior: 'auto' });
      if (alvo.hasAttribute('data-ancora-abre')) { alvo.click(); return; }
      if (!alvo.matches('a, button, input, select, textarea, [tabindex]')) alvo.setAttribute('tabindex', '-1');
      alvo.focus({ preventScroll: true });
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 8500);
}

export function iniciarNavegacaoViva() {
  if (document.documentElement.dataset.navegacaoViva) return;
  document.documentElement.dataset.navegacaoViva = 'sim';
  seguirAncoraTardia();
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const alvo = e.target.closest?.(ALVOS_CLIQUE);
    if (!alvo || alvo.disabled || alvo.getAttribute('aria-disabled') === 'true') return;
    pressionar(alvo, e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('pointerup', soltar, { passive: true });
  document.addEventListener('pointercancel', soltar, { passive: true });
  document.addEventListener('dragstart', soltar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.documentElement.classList.contains('navegando')) esconderFio();
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const alvo = e.target.closest?.(ALVOS_CLIQUE);
    if (!alvo || alvo.disabled) return;
    const r = alvo.getBoundingClientRect();
    pressionar(alvo, r.left + r.width / 2, r.top + r.height / 2);
    setTimeout(() => alvo.classList.remove('pressionado'), 140);
  });
  // Clique em link interno: fio dourado na hora (fase de captura não é necessária: só observa, nunca impede).
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[href]');
    if (!ehNavegacaoInterna(e, link)) return;
    queueMicrotask(() => {
      if (e.defaultPrevented) return; // a tela tratou o clique sem sair (ex.: lista que abre o detalhe na mesma página)
      link.classList.add('abrindo');
      mostrarFio();
    });
  });
  window.addEventListener('pageshow', esconderFio);
  window.addEventListener('pagehide', () => clearTimeout(seguranca));
  // Entrada da página (sem View Transitions do navegador): deslize curto do conteúdo principal.
  const raiz = document.documentElement;
  if (!reduzido() && !CSS.supports?.('view-transition-name: none')) {
    raiz.classList.add('pagina-entrando');
    setTimeout(() => raiz.classList.remove('pagina-entrando'), 420);
  }
}
