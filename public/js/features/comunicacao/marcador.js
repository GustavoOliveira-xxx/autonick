/**
 * Marcador de novas mensagens nas listas (M13b; ADR-G13b D13b-10 = A; P-M12-06).
 * Linhas com `data-conversa="solicitacao:<id>" | "pedido:<id>" | "os:<id>"` recebem "N mensagens novas" ao lado do título.
 * O número vem do banco (mensagens_novas), com a mesma regra de leitura da conversa. Se a consulta falhar, a lista
 * continua igual: o marcador é só um auxílio.
 */
import { el } from '../../ui/dom.js';
import { mensagensNovas, indiceNovas } from '../../data/painel.js';

export const textoNovas = (n) => `${n} ${n === 1 ? 'mensagem nova' : 'mensagens novas'}`;

export async function marcarNovas(raiz, empresaId = null) {
  if (!raiz?.querySelector('[data-conversa]')) return;
  try {
    const indice = indiceNovas(await mensagensNovas(empresaId));
    for (const linha of raiz.querySelectorAll('[data-conversa]')) {
      linha.querySelector(':scope .marcador-novas')?.remove();
      const n = indice.get(linha.dataset.conversa);
      if (n) (linha.querySelector('h3') ?? linha).append(' ', el('span', { class: 'marcador-novas' }, textoNovas(n)));
    }
  } catch {
    // Silencioso de propósito: sem o número, a lista segue utilizável.
  }
}
