/**
 * Dinheiro no AutoniCK (resolução C-13).
 *
 * No JavaScript e no transporte, valores são centavos inteiros
 * (`amount_minor`, API-001 §1). No banco, `numeric(14,2)` (BDD-001).
 * Este módulo é só apresentação e validação de entrada: a autoridade
 * sobre valores é sempre o servidor (FIN-P1, RF-183).
 */

/** Maior valor representável em numeric(14,2): 999.999.999.999,99. */
export const MAXIMO_CENTAVOS = 99_999_999_999_999;

const formatador = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Formata centavos inteiros como moeda brasileira.
 * @param {number} centavos inteiro, pode ser negativo apenas para exibição de estornos já calculados no servidor
 * @returns {string} ex.: "R$ 1.234,56"
 */
export function formatarCentavos(centavos) {
  if (!Number.isSafeInteger(centavos)) {
    throw new TypeError('Valor monetário deve ser um número inteiro de centavos.');
  }
  // Divisão só para exibir; nunca usada como valor de cálculo.
  return formatador.format(centavos / 100).replace(/ /g, ' ');
}

/**
 * Converte o texto digitado em centavos inteiros, sem usar parseFloat.
 * Aceita "100", "100,00", "R$ 100,00", "1.234,56" (UX-001 §3).
 * Rejeita negativos, mais de duas casas, letras e ponto decimal ambíguo
 * como "100.50" (FIN-001 §7).
 * @param {string} texto
 * @returns {{ok: true, centavos: number} | {ok: false, erro: string}}
 */
export function lerValorEmReais(texto) {
  if (typeof texto !== 'string') {
    return { ok: false, erro: 'Informe um valor.' };
  }
  const limpo = texto.replace(/R\$/i, '').replace(/[\s ]/g, '');
  if (limpo === '') {
    return { ok: false, erro: 'Informe um valor.' };
  }
  if (limpo.startsWith('-')) {
    return { ok: false, erro: 'O valor não pode ser negativo.' };
  }
  const padrao = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
  const partes = padrao.exec(limpo);
  if (!partes) {
    if (/^\d+\.\d{1,2}$/.test(limpo)) {
      return { ok: false, erro: 'Use vírgula para os centavos. Exemplo: 100,50.' };
    }
    if (/,\d{3,}$/.test(limpo)) {
      return { ok: false, erro: 'Use no máximo duas casas para os centavos.' };
    }
    return { ok: false, erro: 'Valor inválido. Exemplos aceitos: 100, 100,00 ou R$ 1.234,56.' };
  }
  const inteiros = partes[1].replace(/\./g, '');
  const decimais = (partes[2] ?? '').padEnd(2, '0');
  if (inteiros.length > 12) {
    return { ok: false, erro: 'Valor acima do limite permitido.' };
  }
  const centavos = Number(inteiros) * 100 + Number(decimais);
  if (!Number.isSafeInteger(centavos) || centavos > MAXIMO_CENTAVOS) {
    return { ok: false, erro: 'Valor acima do limite permitido.' };
  }
  return { ok: true, centavos };
}

/**
 * Soma valores em centavos garantindo inteiros (prévia de interface).
 * @param {number[]} valores
 */
export function somarCentavos(valores) {
  return valores.reduce((total, valor) => {
    if (!Number.isSafeInteger(valor)) {
      throw new TypeError('Todos os valores devem ser centavos inteiros.');
    }
    return total + valor;
  }, 0);
}
