/**
 * Modal acessível do AutoniCK (E02/E03): <dialog> nativo (foco preso e devolvido, Esc), cabeçalho com título,
 * corpo com rolagem própria e rodapé com as ações sempre visíveis. Com `protegerAlteracoes`, fechar com alterações
 * não salvas pede confirmação dentro do próprio modal (nada é descartado sem a pessoa escolher).
 */
import { el } from './dom.js';

export function abrirModal({ titulo, descricao = null, corpo, rodape = [], tamanho = 'medio', protegerAlteracoes = null, aoFechar = null, rotulo = null }) {
  const idTitulo = `modal-titulo-${Math.random().toString(36).slice(2, 8)}`;
  const fechar = el('button', { type: 'button', class: 'modal__fechar', 'aria-label': 'Fechar' });
  fechar.innerHTML = '<svg class="icone" aria-hidden="true" focusable="false"><use href="/assets/icons/icones.svg#i-fechar"></use></svg>';
  const aviso = el('div', { class: 'modal__descartar', role: 'alert', hidden: true },
    el('span', {}, 'Há alterações não salvas. Descartar?'),
    el('button', { type: 'button', class: 'botao botao--secundario', 'data-continuar': '' }, 'Continuar editando'),
    el('button', { type: 'button', class: 'botao botao--perigo', 'data-descartar': '' }, 'Descartar'));
  const pe = el('div', { class: 'modal__pe' }, aviso, ...rodape);
  const dialogo = el('dialog', { class: `modal modal--${tamanho}`, 'aria-labelledby': idTitulo, 'aria-label': rotulo },
    el('div', { class: 'modal__painel' },
      el('header', { class: 'modal__cab' }, el('div', {}, el('h2', { id: idTitulo, class: 'modal__titulo' }, titulo), descricao ? el('p', { class: 'modal__descricao' }, descricao) : null), fechar),
      el('div', { class: 'modal__corpo' }, corpo),
      pe));
  document.body.append(dialogo);
  let forcar = false;
  const tentarFechar = () => {
    if (!forcar && protegerAlteracoes?.()) { aviso.hidden = false; aviso.querySelector('[data-continuar]').focus(); return; }
    dialogo.close();
  };
  fechar.addEventListener('click', tentarFechar);
  dialogo.addEventListener('cancel', (e) => { e.preventDefault(); tentarFechar(); });
  dialogo.addEventListener('click', (e) => { if (e.target === dialogo) tentarFechar(); });
  aviso.querySelector('[data-continuar]').addEventListener('click', () => { aviso.hidden = true; });
  aviso.querySelector('[data-descartar]').addEventListener('click', () => { forcar = true; dialogo.close(); });
  dialogo.addEventListener('close', () => { aoFechar?.(); dialogo.remove(); });
  dialogo.showModal();
  dialogo.querySelector('[autofocus], input:not([type="hidden"]), select, textarea, button:not(.modal__fechar)')?.focus();
  return { dialogo, fechar: () => { forcar = true; dialogo.close(); }, corpo: dialogo.querySelector('.modal__corpo'), pe };
}
