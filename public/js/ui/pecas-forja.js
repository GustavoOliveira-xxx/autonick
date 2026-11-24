/**
 * Peças estáticas da direção CK Forja Noturna, desenhadas uma vez a partir dos modelos 3D reais (assets/forja/).
 * Servem a listas com muitos itens: nenhuma cena WebGL é criada aqui.
 */
import { el } from './dom.js';
import { formatarCentavos } from '../domain/moeda.js';

/** Etiqueta de preço no lugar da foto que o produto não tem (o preço é o valor real, em texto). */
export function etiquetaPreco(centavos) {
  if (!Number.isFinite(centavos)) return null;
  const valor = formatarCentavos(centavos).replace(/^R\$\s?/, '');
  return el('span', { class: 'etiqueta-preco', 'aria-hidden': 'true' }, el('span', {}, el('small', {}, 'R$'), valor));
}

/** Menor preço entre as variações ativas (o mesmo critério da faixa de preço exibida). */
export function menorPreco(variacoes) {
  const precos = variacoes.filter((v) => v.ativo && Number.isFinite(v.preco_centavos)).map((v) => v.preco_centavos);
  return precos.length ? Math.min(...precos) : null;
}

/**
 * G01: fio dourado no topo de uma área enquanto uma atualização real (ex.: estoque) acontece.
 * Só aparece se a operação passar de 120 ms; some quando ela termina, com sucesso ou erro.
 */
export async function comFioDourado(lugar, acao, rotulo = 'Atualizando') {
  const fio = el('div', { class: 'fio-dourado', role: 'progressbar', 'aria-label': rotulo });
  const sinal = setTimeout(() => lugar?.prepend(fio), 120);
  try { return await acao(); } finally { clearTimeout(sinal); fio.remove(); }
}

/** Contagem do zero até o valor confirmado pelo sistema (nunca inventa: o alvo é o número que veio do banco). */
export function contarAte(elemento, valor, formatar, duracaoMs = 1200) {
  if (!elemento || !Number.isFinite(valor)) return;
  const final = formatar(valor);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || valor === 0) { elemento.textContent = final; return; }
  const t0 = performance.now();
  const passo = (agora) => {
    const k = Math.min(1, (agora - t0) / duracaoMs);
    elemento.textContent = k < 1 ? formatar(Math.round(valor * (1 - Math.pow(1 - k, 3)))) : final;
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
