/**
 * Padrão "consulta primeiro" (pacote 27/11, item 9): barra com busca (com espera curta enquanto digita), a ação principal
 * ao lado (ex.: "Adicionar cliente") e filtros compactos revelados sob demanda. A busca também funciona com Enter.
 */
import { el } from './dom.js';

export function barraConsulta({ id, rotulo, valor = '', dica = '', aoBuscar, acoes = [], filtros = [], filtrosAbertos = false, espera = 300 }) {
  const entrada = el('input', { type: 'search', id, name: 'busca', value: valor ?? '', autocomplete: 'off', placeholder: dica, 'aria-describedby': `${id}-estado` });
  const estado = el('span', { class: 'visualmente-oculto', id: `${id}-estado`, 'aria-live': 'polite' });
  let relogio = null;
  let ultimo = valor ?? '';
  const disparar = () => {
    clearTimeout(relogio);
    const v = entrada.value.trim();
    if (v === ultimo) return;
    ultimo = v;
    aoBuscar(v);
  };
  entrada.addEventListener('input', () => { clearTimeout(relogio); relogio = setTimeout(disparar, espera); });
  const form = el('form', { class: 'barra-consulta__busca', role: 'search', 'aria-label': rotulo },
    el('label', { for: id, class: 'visualmente-oculto' }, rotulo),
    el('span', { class: 'barra-consulta__lupa', 'aria-hidden': 'true' }), entrada, estado);
  form.addEventListener('submit', (e) => { e.preventDefault(); ultimo = null; disparar(); });
  const filtrosEl = filtros.filter(Boolean).length
    ? el('details', { class: 'barra-consulta__filtros', open: filtrosAbertos }, el('summary', {}, 'Filtros'), el('div', { class: 'grade-filtros' }, ...filtros.filter(Boolean)))
    : null;
  const barra = el('div', { class: 'barra-consulta' }, form, acoes.filter(Boolean).length ? el('div', { class: 'barra-consulta__acoes' }, ...acoes.filter(Boolean)) : null);
  return { elemento: el('div', { class: 'pilha barra-consulta__grupo' }, barra, filtrosEl), entrada, anunciar: (t) => { estado.textContent = t; } };
}

/** Estado vazio orientativo: o que fazer em seguida, com a ação quando houver. */
export function vazio(texto, acao = null, id = null) {
  return el('div', { class: 'estado-vazio', id }, el('p', {}, texto), acao);
}

/**
 * Cadastro sob demanda: um botão abre o formulário existente da tela num modal. O formulário continua com as mesmas
 * regras e chamadas; o modal fecha quando a tela anuncia sucesso, e avisos de erro aparecem também dentro dele.
 */
/** Mostra dentro de um modal os avisos de erro e alerta que a tela escreve em #avisos (atrás do modal). Devolve o desligamento. */
export function espelharAvisos(destino) {
  const avisos = document.getElementById('avisos');
  if (!avisos) return () => {};
  const obs = new MutationObserver(() => {
    const problema = avisos.querySelector('.aviso--erro, .aviso--alerta');
    destino.replaceChildren(...(problema ? [problema.cloneNode(true)] : []));
  });
  obs.observe(avisos, { childList: true, subtree: true });
  return () => obs.disconnect();
}

export async function abrirEmModal({ titulo, construir, origem = null, descricao = null }) {
  const { abrirModal } = await import('./modal.js');
  const avisosModal = el('div', { class: 'avisos-modal', 'aria-live': 'polite' });
  const modal = abrirModal({ titulo, descricao, corpo: el('div', { class: 'pilha cadastro-em-modal' }, avisosModal, construir()), tamanho: 'grande', aoFechar: () => { observador.disconnect(); origem?.focus(); } });
  const avisos = document.getElementById('avisos');
  const observador = new MutationObserver(() => {
    if (avisos.querySelector('.aviso--sucesso')) { observador.disconnect(); modal.fechar(); return; }
    const problema = avisos.querySelector('.aviso--erro, .aviso--alerta');
    avisosModal.replaceChildren(...(problema ? [problema.cloneNode(true)] : []));
  });
  if (avisos) { avisos.replaceChildren(); observador.observe(avisos, { childList: true, subtree: true }); }
  return modal;
}

export function botaoCadastro({ id, rotulo, titulo, construir, descricao = null }) {
  const b = el('button', { type: 'button', class: 'botao', id }, rotulo);
  b.addEventListener('click', () => abrirEmModal({ titulo, construir, origem: b, descricao }));
  return b;
}
