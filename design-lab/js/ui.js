// Peças de interface compartilhadas pelas páginas do laboratório.
import { loja } from './estado.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const seloInt = (i) => `<span class="selo selo--${{ Sutil: 'sutil', Equilibrado: 'equilibrado', Expressivo: 'expressivo' }[i] ?? 'ref'}">${esc(i)}</span>`;

let toastT = 0;
export function toast(msg) {
  document.querySelector('.toast-lab')?.remove();
  const el = h(`<div class="toast-lab" role="status">${esc(msg)}</div>`); document.body.append(el);
  clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 2600);
}

/** Cabeçalho de categoria com achados (fatos medidos no código). */
export function cabecalho(letra, titulo, texto, achados = []) {
  return h(`<header class="cat-cab"><p class="rotulo"><span class="letra">${esc(letra)}</span>Categoria ${esc(letra)}</p><h1>${esc(titulo)}</h1><p>${texto}</p>
    ${achados.length ? `<dl class="achados">${achados.map(([t, d]) => `<div class="achado"><dt>${esc(t)}</dt><dd>${d}</dd></div>`).join('')}</dl>` : ''}</header>`);
}

/** Botões ♥ e Escolher de uma proposta; atualizam sozinhos quando a loja muda. */
export function acoes(cat, p, { aoComparar, pequeno = false, semEscolher = false } = {}) {
  const el = h(`<div class="acoes-proposta">
    <button type="button" class="bt bt-fav ${pequeno ? 'bt--pequeno' : ''}" data-fav aria-label="Favoritar ${esc(p.id)}">♥</button>
    ${semEscolher ? '' : `<button type="button" class="bt ${pequeno ? 'bt--pequeno' : ''}" data-escolher></button>`}
    ${aoComparar ? `<button type="button" class="bt bt--fantasma ${pequeno ? 'bt--pequeno' : ''}" data-comparar>Comparar</button>` : ''}</div>`);
  const fav = el.querySelector('[data-fav]'); const esc_ = el.querySelector('[data-escolher]');
  const pintar = () => {
    fav.setAttribute('aria-pressed', String(loja.favorita(p.id)));
    if (esc_) { const ok = loja.escolhida(cat) === p.id; esc_.setAttribute('aria-pressed', String(ok)); esc_.textContent = ok ? '✓ Escolhida' : 'Escolher'; }
  };
  fav.addEventListener('click', (e) => { e.stopPropagation(); loja.favoritar(p.id); });
  esc_?.addEventListener('click', (e) => { e.stopPropagation(); loja.escolher(cat, p.id); });
  el.querySelector('[data-comparar]')?.addEventListener('click', (e) => { e.stopPropagation(); aoComparar(p); });
  const parar = loja.ouvir(pintar); pintar();
  el.__parar = parar;
  return el;
}

/** Ficha técnica completa de uma proposta. */
export function ficha(cat, p, op = {}) {
  const el = h(`<div class="ficha-tecnica">
    <div class="resumo"><h2><span class="id">${esc(p.id)}</span>${esc(p.nome)} ${seloInt(p.intensidade)}</h2><p>${esc(p.resumo)}</p></div>
    <dl>
      <dt>Objetivo visual</dt><dd>${esc(p.objetivo)}</dd>
      <dt>Relação com a CK</dt><dd>${esc(p.ck)}</dd>
      <dt>Vantagens</dt><dd>${esc(p.vantagens)}</dd>
      <dt>Limitações</dt><dd>${esc(p.limitacoes)}</dd>
      <dt>Complexidade</dt><dd>${esc(p.complexidade)}</dd>
      <dt>Desempenho</dt><dd>${esc(p.desempenho)} <span class="estimativa">(estimativa técnica, não medição)</span></dd>
      <dt>Desktop e celular</dt><dd>${esc(p.dispositivos)}</dd>
      <dt>Reaproveitamento</dt><dd>${esc(p.reuso)}</dd>
    </dl></div>`);
  el.querySelector('.resumo').append(acoes(cat, p, op));
  return el;
}

/**
 * Grade de cartões. miniatura(el, p) → { tocar(), pausar(), destruir() } (opcional).
 * aoVer(p) seleciona no palco; aoComparar(p) manda para o lado B.
 */
export function grade(cat, lista, { miniatura, aoVer, aoComparar, classeVitrine = '', larga = false } = {}) {
  const el = h(`<div class="grade ${larga ? 'grade--larga' : ''}"></div>`);
  const ctrls = [];
  for (const p of lista) {
    const c = h(`<article class="cartao-prop" data-id="${esc(p.id)}">
      <div class="vitrine ${classeVitrine}" tabindex="0" role="button" aria-label="Ver ${esc(p.id)} ${esc(p.nome)} no palco"><span class="tocar-dica">passe o mouse para tocar</span></div>
      <div class="corpo"><h3><span class="id">${esc(p.id)}</span>${esc(p.nome)}</h3><p>${esc(p.resumo)}</p><div class="rodape-cartao">${seloInt(p.intensidade)}</div></div></article>`);
    c.querySelector('.rodape-cartao').append(acoes(cat, p, { aoComparar, pequeno: true }));
    const vit = c.querySelector('.vitrine');
    let ctl = null;
    if (miniatura) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !ctl) { ctl = miniatura(vit, p); io.disconnect(); } }, { rootMargin: '200px' });
      io.observe(vit); ctrls.push({ destruir: () => { io.disconnect(); ctl?.destruir(); } });
      const tocar = () => ctl?.tocar(); const pausar = () => ctl?.pausar();
      vit.addEventListener('pointerenter', tocar); vit.addEventListener('pointerleave', pausar); vit.addEventListener('focus', tocar); vit.addEventListener('blur', pausar);
    } else vit.remove();
    const ver = () => aoVer?.(p);
    vit.addEventListener('click', ver); vit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ver(); } });
    el.append(c);
  }
  el.__destruir = () => ctrls.forEach((c) => c.destruir());
  el.marcar = (id) => el.querySelectorAll('.cartao-prop').forEach((c) => c.setAttribute('aria-current', String(c.dataset.id === id)));
  return el;
}

/**
 * Palco com modos de tela e comparação lado a lado.
 * criar(slot, id, modo) → controle com destruir() (e opcionalmente tocar/pausar/reiniciar).
 */
export function palco({ titulo, modos = ['desktop', 'celular', 'ampla'], comparar = true, inicial, criar, extrasBarra = null, rolavel = false }) {
  const est = { modo: modos[0], comparar: false, a: inicial, b: null, rolagem: false };
  const el = h(`<section class="palco-bloco" aria-label="Palco">
    <div class="palco-barra"><div class="titulo-palco"><b>${esc(titulo)}</b></div></div>
    <div class="palco"></div></section>`);
  const barra = el.querySelector('.palco-barra'); const area = el.querySelector('.palco');
  const rot = { desktop: 'Desktop', celular: 'Celular', ampla: 'Tela ampla' };
  if (modos.length > 1) {
    const g = h(`<div class="grupo-seg" role="group" aria-label="Tamanho da tela">${modos.map((m) => `<button type="button" data-modo="${m}">${rot[m] ?? m}</button>`).join('')}</div>`);
    g.addEventListener('click', (e) => { const b = e.target.closest('[data-modo]'); if (!b) return; est.modo = b.dataset.modo; render(); });
    barra.append(g);
  }
  if (rolavel) { const b = h('<button type="button" class="bt" data-rolagem aria-pressed="false">Página rolável</button>'); b.addEventListener('click', () => { est.rolagem = !est.rolagem; render(); }); barra.append(b); }
  if (comparar) { const b = h('<button type="button" class="bt" data-comp aria-pressed="false">Comparar lado a lado</button>'); b.addEventListener('click', () => { est.comparar = !est.comparar; if (est.comparar && !est.b) est.b = est.a; render(); }); barra.append(b); }
  if (extrasBarra) barra.append(extrasBarra);
  let ctrls = [];
  function render() {
    ctrls.forEach((c) => c?.destruir?.()); ctrls = []; area.innerHTML = '';
    area.classList.toggle('palco--comparar', est.comparar);
    barra.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === est.modo)));
    barra.querySelector('[data-comp]')?.setAttribute('aria-pressed', String(est.comparar));
    barra.querySelector('[data-rolagem]')?.setAttribute('aria-pressed', String(est.rolagem));
    const ids = est.comparar ? [est.a, est.b] : [est.a];
    ids.forEach((id, i) => {
      const slot = h(`<div class="palco-slot"><p class="legenda"><span class="id ${i ? 'id--b' : ''}">${esc(id)}</span><span data-nome></span></p><div class="moldura ${est.modo === 'celular' ? 'moldura--celular' : ''} ${est.rolagem ? 'moldura--rolavel' : ''}"></div></div>`);
      area.append(slot);
      ctrls.push(criar(slot.querySelector('.moldura'), id, est.modo, { rolagem: est.rolagem, lado: i, legenda: slot.querySelector('[data-nome]') }));
    });
  }
  render();
  return {
    el, est, render,
    get controles() { return ctrls; },
    selecionar(id) { est.a = id; render(); },
    comparar(id) { est.b = id; est.comparar = true; render(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    destruir() { ctrls.forEach((c) => c?.destruir?.()); },
  };
}

/** Linha do tempo de um ciclo: cena (fases), pausa e retorno, com cursor ao vivo. */
export function linhaTempo() {
  const el = h('<div class="linha-tempo" aria-label="Linha do tempo do ciclo"><div class="faixa"></div><div class="legenda-tempo"></div></div>');
  const faixa = el.querySelector('.faixa'); const leg = el.querySelector('.legenda-tempo');
  let chave = '';
  const cursor = h('<i class="cursor"></i>');
  return {
    el,
    atualizar(info, anim) {
      if (!info || !anim) return;
      const total = info.cena + info.pausa + info.ret; const k = `${anim.dur}|${info.cena}|${info.pausa.toFixed(2)}|${info.ret}|${info.variante}`;
      if (k !== chave) {
        chave = k; faixa.innerHTML = '';
        const fases = info.variante ? [['variação (olhadinha)', 0, info.cena]] : anim.fases.filter(([, a, b]) => b > a).reduce((acc, f) => { if (!acc.length || f[1] >= acc[acc.length - 1][2] - 0.001) acc.push(f); return acc; }, []);
        let ultimo = 0;
        for (const [n, a, b] of fases) { if (a > ultimo + 0.01) faixa.append(h(`<span class="seg seg--cena" style="width:${((a - ultimo) / total) * 100}%"></span>`)); faixa.append(h(`<span class="seg seg--cena" title="${esc(n)}" style="width:${((b - a) / total) * 100}%">${esc(n)}</span>`)); ultimo = b; }
        if (info.cena > ultimo) faixa.append(h(`<span class="seg seg--cena" style="width:${((info.cena - ultimo) / total) * 100}%"></span>`));
        faixa.append(h(`<span class="seg seg--pausa" style="width:${(info.pausa / total) * 100}%">pausa ${info.pausa.toFixed(2).replace('.', ',')} s</span>`));
        if (info.ret) faixa.append(h(`<span class="seg seg--retorno" style="width:${(info.ret / total) * 100}%">retorno</span>`));
        faixa.append(cursor);
        const parado = Math.max(0, info.cena - (info.variante ? info.cena : anim.fimMovimento)) + info.pausa;
        leg.innerHTML = `<span>cena <b>${info.cena.toFixed(2).replace('.', ',')} s</b></span><span>pausa <b>${info.pausa.toFixed(2).replace('.', ',')} s</b></span><span>retorno <b>${info.ret.toFixed(1).replace('.', ',')} s</b></span><span>ciclo <b>${total.toFixed(2).replace('.', ',')} s</b></span><span>parado percebido <b>${parado.toFixed(2).replace('.', ',')} s</b></span><span>ciclo nº <b>${info.indice + 1}</b></span>`;
      }
      const u = info.fase === 'cena' || info.fase === 'variação' ? info.u : info.u;
      cursor.style.left = `${Math.min(100, (u / total) * 100)}%`;
    },
  };
}

/** Pequeno grupo segmentado genérico. */
export function segmentado(rotulo, opcoes, valor, aoMudar) {
  const el = h(`<div class="grupo-seg" role="group" aria-label="${esc(rotulo)}">${opcoes.map(([v, t]) => `<button type="button" data-v="${esc(v)}">${esc(t)}</button>`).join('')}</div>`);
  const pintar = (v) => el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; pintar(b.dataset.v); aoMudar(b.dataset.v); });
  pintar(valor); el.definir = pintar; return el;
}
