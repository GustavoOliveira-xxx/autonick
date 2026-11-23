/**
 * Diálogo de confirmação acessível (UX-001 §3): explica o que vai
 * acontecer, prende o foco (dialog modal nativo), fecha com Esc e
 * devolve o foco a quem abriu.
 */
import { el } from './dom.js';

let contador = 0;

export function abrirDialogo({ titulo, mensagens = [], rotuloConfirmar = 'Entendi', rotuloCancelar = null }) {
  const gatilho = document.activeElement;
  const id = `dialogo-${++contador}`;
  return new Promise((resolver) => {
    const confirmar = el('button', { type: 'button', class: 'botao', value: 'confirmar' }, rotuloConfirmar);
    const cancelar = rotuloCancelar
      ? el('button', { type: 'button', class: 'botao botao--secundario', value: 'cancelar' }, rotuloCancelar)
      : null;
    const dialogo = el('dialog', { class: 'dialogo', 'aria-labelledby': `${id}-titulo`, 'aria-describedby': `${id}-texto` },
      el('div', { class: 'dialogo__corpo' },
        el('h2', { id: `${id}-titulo` }, titulo),
        el('div', { id: `${id}-texto`, class: 'pilha' }, mensagens.map((m) => el('p', {}, m))),
        el('div', { class: 'grupo-botoes' }, confirmar, cancelar),
      ),
    );
    let resultado = false;
    confirmar.addEventListener('click', () => { resultado = true; dialogo.close(); });
    cancelar?.addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (gatilho instanceof HTMLElement) gatilho.focus();
      resolver(resultado);
    });
    // O diálogo nativo não impede que Tab leve o foco à interface do
    // navegador; aqui o foco circula só entre os botões do diálogo.
    dialogo.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Tab') return;
      const focaveis = [...dialogo.querySelectorAll('button, [href], input, select, textarea')];
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    });
    document.body.append(dialogo);
    dialogo.showModal();
    confirmar.focus();
  });
}
