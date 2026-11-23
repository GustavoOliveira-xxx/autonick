/**
 * Avisos breves (toast) em região viva para leitores de tela.
 * Regra: nunca anunciar sucesso de operação sem confirmação do
 * servidor (RNF-034). No M01 só há avisos informativos.
 */
import { el } from './dom.js';

function regiao() {
  let r = document.getElementById('notificacoes');
  if (!r) {
    r = el('div', { id: 'notificacoes', class: 'notificacoes', role: 'status', 'aria-live': 'polite' });
    document.body.append(r);
  }
  return r;
}

export function notificar(texto, { acao, duracaoMs = 8000 } = {}) {
  const botao = acao ? el('button', { type: 'button', class: 'botao botao--destaque', onclick: acao.aoClicar }, acao.rotulo) : null;
  const item = el('div', { class: 'notificacao' }, el('span', {}, texto), botao);
  regiao().append(item);
  if (!acao) setTimeout(() => item.remove(), duracaoMs);
  return item;
}
