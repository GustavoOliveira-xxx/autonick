/**
 * Dicas de primeiros passos (E08): curtas, no topo da tela, dispensáveis ("Entendi"); a escolha fica salva no servidor para a
 * pessoa. Só aparecem com a flag "onboarding_contextual" ligada para a empresa (padrão ligado; o proprietário pode desligar).
 */
import { el } from './dom.js';
import { flagLigada } from '../data/flags.js';
import { meuOnboarding, dispensarOnboarding } from '../data/notificacoes.js';

let dispensadas = null;

export function dicaContextual({ chave, titulo, texto, empresaId = null }) {
  const caixa = el('div', { class: 'dica-contextual', id: `dica-${chave.replace(/[^a-z0-9-]/g, '-')}`, hidden: true, role: 'note', 'aria-label': `Dica: ${titulo}` });
  (async () => {
    try {
      if (!(await flagLigada('onboarding_contextual', empresaId))) return;
      dispensadas ??= meuOnboarding().then((l) => new Set(Array.isArray(l) ? l : [])).catch(() => new Set());
      if ((await dispensadas).has(chave)) return;
      const entendi = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Entendi');
      entendi.addEventListener('click', async () => {
        caixa.hidden = true;
        (await dispensadas).add(chave);
        dispensarOnboarding(chave).catch(() => {});
      });
      caixa.replaceChildren(el('div', {}, el('strong', {}, titulo), el('p', {}, texto)), entendi);
      caixa.hidden = false;
    } catch { /* dica é opcional */ }
  })();
  return caixa;
}
