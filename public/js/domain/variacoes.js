/**
 * Regras de exibição e leitura de variações e quantidades (M05).
 * Só PRÉVIAS de interface: o banco valida de novo e decide (MINI-ESPEC_M05 §3).
 */
import { formatarCentavos } from './moeda.js';

/** Lê uma quantidade inteira digitada. `comSinal` permite negativo (ajuste), nunca zero. */
export function lerQuantidade(texto, { comSinal = false } = {}) {
  const limpo = String(texto ?? '').trim().replace(/\s+/g, '');
  if (!/^[-+]?\d+$/.test(limpo)) return { ok: false, erro: 'Use um número inteiro, sem vírgula.' };
  const valor = Number(limpo);
  if (!Number.isSafeInteger(valor) || Math.abs(valor) > 1_000_000) return { ok: false, erro: 'Quantidade fora do limite.' };
  if (valor === 0) return { ok: false, erro: 'A quantidade não pode ser zero.' };
  if (valor < 0 && !comSinal) return { ok: false, erro: 'Use um número maior que zero.' };
  return { ok: true, valor };
}

/** Chave usada para comparar atributos como o banco faz (sem maiúsculas e espaços extras). */
export function chaveAtributos(atributos = {}) {
  const norma = (t) => String(t).trim().replace(/\s+/g, ' ').toLowerCase();
  return Object.entries(atributos)
    .map(([k, v]) => [norma(k), norma(v)])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
}

/** Rótulo legível: "Azul, M"; a variação padrão (produto simples) não tem rótulo próprio. */
export function rotuloVariacao({ atributos = {}, padrao = false } = {}) {
  if (padrao) return 'Padrão';
  const valores = Object.keys(atributos).sort((a, b) => a.localeCompare(b)).map((k) => atributos[k]);
  return valores.length ? valores.join(', ') : 'Padrão';
}

/** Faixa de preço das variações ativas: "R$ 49,90" ou "R$ 49,90 a R$ 54,90". */
export function faixaDePreco(variacoes = []) {
  const precos = variacoes.filter((v) => v.ativo !== false && Number.isSafeInteger(v.preco_centavos)).map((v) => v.preco_centavos);
  if (!precos.length) return '';
  const menor = Math.min(...precos);
  const maior = Math.max(...precos);
  return menor === maior ? formatarCentavos(menor) : `${formatarCentavos(menor)} a ${formatarCentavos(maior)}`;
}

/** Duplicatas na grade de variações antes de enviar (o banco confere de novo). */
export function variacoesRepetidas(linhas) {
  const vistas = new Set();
  const repetidas = [];
  linhas.forEach((linha, i) => {
    const chave = chaveAtributos(linha);
    if (chave && vistas.has(chave)) repetidas.push(i);
    vistas.add(chave);
  });
  return repetidas;
}
