/**
 * Regras de apresentação do financeiro (M07). Nada aqui decide valores: o banco calcula saldos, estados e totais.
 * Este módulo só traduz códigos em texto simples, sugere parcelas para o formulário e monta o arquivo CSV a partir
 * das linhas que o banco já autorizou (D7-01).
 */

export const TIPOS_CONTA = [['caixa', 'Caixa (dinheiro físico)'], ['banco', 'Conta em banco'], ['carteira_digital', 'Carteira digital ou maquininha'], ['outro', 'Outro']];
export const TIPO_CONTA = Object.fromEntries(TIPOS_CONTA);

export const NATUREZA = {
  receita: 'Receita', despesa: 'Despesa', interna: 'Transferência entre contas', proprietario: 'Dinheiro do proprietário', ajuste: 'Ajuste ou saldo inicial',
};

export const TIPO_LANCAMENTO = {
  saldo_inicial: 'Saldo inicial', recebimento: 'Recebimento', pagamento: 'Pagamento', receita_avulsa: 'Entrada avulsa', despesa_avulsa: 'Saída avulsa',
  transferencia_saida: 'Transferência enviada', transferencia_entrada: 'Transferência recebida', retirada: 'Retirada do proprietário',
  aporte: 'Aporte do proprietário', devolucao_cliente: 'Devolução ao cliente', estorno: 'Estorno', ajuste_conferencia: 'Ajuste da conferência de caixa',
};

/** D7-10: estados que a pessoa vê (o "vencido" é calculado pelo banco na hora). */
export const ESTADO_EXIBICAO = {
  previsto: 'Previsto', pendente: 'A vencer', vencido: 'Vencido', parcial: 'Pago em parte', liquidado: 'Quitado', cancelado: 'Cancelado',
};

export const SITUACOES = [['abertos', 'Em aberto'], ['vencidos', 'Vencidos'], ['liquidados', 'Quitados'], ['cancelados', 'Cancelados'], ['todos', 'Todos']];

/** Último dia do mês de uma data ISO (D7-09). */
function ultimoDia(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Mesma regra do banco (D7-09): dia inexistente vira o último dia do mês; sem ajuste por feriado. */
export function vencimentoNoMes(anoMes, dia) {
  const [ano, mes] = anoMes.split('-').map(Number);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia(ano, mes))).padStart(2, '0')}`;
}

/** Soma meses a uma data ISO mantendo o dia escolhido (ou o último dia, quando o mês é mais curto). */
export function somarMeses(iso, meses, dia = Number(iso.slice(8, 10))) {
  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7)) - 1 + meses;
  const alvo = new Date(Date.UTC(ano, mes, 1));
  return vencimentoNoMes(`${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}`, dia);
}

/**
 * Sugestão de parcelas mensais para o formulário: valores iguais em centavos (a diferença de arredondamento vai na
 * primeira) e vencimentos mês a mês a partir do primeiro. O banco confere a soma e a ordem.
 */
export function sugerirParcelas(totalCentavos, quantidade, primeiroVencimento) {
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) throw new RangeError('Total inválido.');
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 24) throw new RangeError('De 1 a 24 parcelas.');
  if (totalCentavos < quantidade) throw new RangeError('Cada parcela precisa ter pelo menos R$ 0,01.');
  const base = Math.floor(totalCentavos / quantidade);
  const dia = Number(primeiroVencimento.slice(8, 10));
  return Array.from({ length: quantidade }, (_, i) => ({
    valor_centavos: base + (i === 0 ? totalCentavos - base * quantidade : 0),
    vencimento: i === 0 ? primeiroVencimento : somarMeses(primeiroVencimento, i, dia),
  }));
}

/** Centavos como número em texto para planilha brasileira: "1234,56" (sem separador de milhar, sem R$). */
export function centavosParaCsv(centavos) {
  if (centavos === null || centavos === undefined || centavos === '') return '';
  if (!Number.isSafeInteger(centavos)) throw new TypeError('Valor monetário deve ser centavos inteiros.');
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Escapa um campo para CSV com separador ";" (Excel em português): aspas em volta quando há ; " ou quebra de linha. */
export function campoCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  // Impede que a planilha interprete o texto como fórmula (injeção de CSV).
  const seguro = /^[=+\-@\t\r]/.test(texto) && !/^-?\d+(,\d+)?$/.test(texto) ? `'${texto}` : texto;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/**
 * Monta o CSV (UTF-8 com BOM, separador ";", linhas com CRLF) a partir das colunas e linhas que o banco devolveu.
 * As colunas cujo título termina em "(R$)" chegam em centavos e são convertidas para reais com vírgula.
 */
export function montarCsv(colunas, linhas) {
  const dinheiro = colunas.map((c) => /\(R\$\)$/.test(c));
  const corpo = [colunas.map(campoCsv).join(';'),
    ...linhas.map((linha) => linha.map((v, i) => campoCsv(dinheiro[i] && v !== null && v !== '' ? centavosParaCsv(Number(v)) : v)).join(';'))];
  return `﻿${corpo.join('\r\n')}\r\n`;
}

/** Primeiro dia do mês de uma data ISO. */
export const inicioDoMes = (iso) => `${iso.slice(0, 7)}-01`;
/** Mês por extenso, ex.: "outubro de 2026". */
export function mesPorExtenso(iso) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 7)}-01T12:00:00Z`));
}
