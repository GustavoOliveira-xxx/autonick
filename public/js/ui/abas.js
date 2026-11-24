/**
 * Abas acessíveis (padrão WAI-ARIA "tabs" com ativação manual por clique ou Enter, setas para mover o foco).
 * A aba ativa fica no endereço (#chave), então recarregar ou compartilhar o link volta para a mesma aba.
 * Os painéis inativos ficam no DOM com `hidden`: o conteúdo continua disponível para leitores de tela ao abrir.
 */
import { el } from './dom.js';

/**
 * @param {{ rotulo: string, itens: Array<{ chave: string, titulo: string, contador?: number|null, painel: HTMLElement }>,
 *   ativa?: string, aoTrocar?: (chave: string) => void }} opcoes
 */
export function abas({ rotulo, itens, ativa, aoTrocar }) {
  const inicial = itens.some((i) => i.chave === ativa) ? ativa : itens[0].chave;
  const lista = el('div', { class: 'abas__lista', role: 'tablist', 'aria-label': rotulo });
  const botoes = new Map();
  const paineis = new Map();
  const ativar = (chave, { focar = false, registrar = true } = {}) => {
    for (const [k, b] of botoes) {
      const sim = k === chave;
      b.setAttribute('aria-selected', String(sim));
      b.tabIndex = sim ? 0 : -1;
      paineis.get(k).hidden = !sim;
    }
    if (focar) botoes.get(chave).focus();
    if (registrar) {
      history.replaceState(history.state, '', `${location.pathname}${location.search}#${chave}`);
      aoTrocar?.(chave);
    }
  };
  for (const item of itens) {
    const b = el('button', { type: 'button', role: 'tab', id: `aba-${item.chave}`, 'aria-controls': `painel-${item.chave}`, class: 'abas__aba' },
      item.titulo, item.contador !== null && item.contador !== undefined ? el('span', { class: 'abas__contador' }, String(item.contador)) : null);
    b.addEventListener('click', () => ativar(item.chave));
    botoes.set(item.chave, b);
    lista.append(b);
    paineis.set(item.chave, el('section', { role: 'tabpanel', id: `painel-${item.chave}`, 'aria-labelledby': `aba-${item.chave}`, tabindex: '0', class: 'abas__painel pilha-grande' },
      item.painel));
  }
  lista.addEventListener('keydown', (e) => {
    const chaves = [...botoes.keys()];
    const atual = chaves.indexOf(document.activeElement?.id?.replace(/^aba-/, ''));
    if (atual < 0) return;
    const destino = { ArrowRight: atual + 1, ArrowLeft: atual - 1, Home: 0, End: chaves.length - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    const k = chaves[(destino + chaves.length) % chaves.length];
    ativar(k, { focar: true });
  });
  ativar(inicial, { registrar: false });
  return { elemento: el('div', { class: 'abas pilha-grande' }, lista, ...paineis.values()), ativar };
}
