/**
 * Gerador de parcelas (pacote 27/11, item 1.1). Datas são DATAS LOCAIS (AAAA-MM-DD, como LocalDate): toda a conta é feita
 * em dias civis pelo calendário UTC, sem horário nem fuso, então nenhuma data "anda" um dia por causa do relógio.
 * Valores em centavos inteiros.
 *
 * DDL = dias corridos contados a partir da data-base (30 DDL = 30 dias depois da data-base; 0 DDL = na própria data).
 * Modos de vencimento:
 *  - 'intervalo': primeira em `primeiraDias` DDL (ou numa data explícita) e as demais a cada `intervaloDias` dias corridos;
 *  - 'mensal': mesmo dia de referência a cada mês (o dia da data-base, ou o da primeira data explícita); a primeira vence
 *    no mês seguinte (ou no próprio dia, com `primeiraMeses: 0`); em mês curto usa o último dia válido e volta ao dia de
 *    referência nos meses seguintes (31/01 -> 28/02 -> 31/03, sem deriva). Mensal NÃO é "a cada 30 dias";
 *  - 'prazos': prazos individuais em DDL, crescentes (ex.: 30/60/90).
 * Os centavos que sobram na divisão vão para a ÚLTIMA parcela (R$ 100,00 em 3 = 33,33 + 33,33 + 33,34).
 */

export const MAXIMO_PARCELAS = 24;   // limite real do banco (parcelas_financeiras.sequencia 1..24; criar_titulo_venda: 2 a 24)
export const MAXIMO_DIAS = 3650;     // o banco recusa vencimento além de 10 anos
export const INTERVALOS = [7, 15, 30, 45, 60];

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Converte 'AAAA-MM-DD' em número de dias civis (ou null se inválida). */
export function diaCivil(texto) {
  const m = RE_DATA.exec(texto ?? '');
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(a, me - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== me - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(ms / 86_400_000);
}

export function dataDoDia(n) {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export const somarDiasCivis = (data, dias) => dataDoDia(diaCivil(data) + dias);
export const diferencaDias = (de, ate) => diaCivil(ate) - diaCivil(de);

/** Último dia do mês (mes 1..12). */
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** Data `meses` meses depois de `base`, no dia de referência `dia` (limitado ao último dia do mês). */
export function somarMeses(base, meses, dia = null) {
  const m = RE_DATA.exec(base);
  const ano0 = Number(m[1]);
  const mes0 = Number(m[2]) - 1 + meses;
  const ano = ano0 + Math.floor(mes0 / 12);
  const mes = ((mes0 % 12) + 12) % 12 + 1;
  const ref = dia ?? Number(m[3]);
  const d = Math.min(ref, ultimoDia(ano, mes));
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Divide o total em n parcelas; a sobra de centavos vai para a última. */
export function dividirCentavos(total, n) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(n) || n < 1) return [];
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i === n - 1 ? total - base * n : 0));
}

/** Lê "30/60/90", "30, 60, 90" ou "30 60 90" em dias inteiros. */
export function lerPrazos(texto) {
  const partes = String(texto ?? '').split(/[\s,;/]+/).filter(Boolean);
  if (!partes.length) return { ok: false, erro: 'Informe os prazos em dias, por exemplo 30/60/90.' };
  const dias = [];
  for (const p of partes) {
    if (!/^\d+$/.test(p)) return { ok: false, erro: `"${p}" não é um número de dias. Use só números, por exemplo 30/60/90.` };
    dias.push(Number(p));
  }
  return { ok: true, dias };
}

/**
 * Gera as parcelas. Devolve { ok, parcelas: [{ numero, ddl, vencimento, valor_centavos }], erro, campo }.
 * @param {object} o
 * @param {number} o.total total em centavos
 * @param {string} o.dataBase 'AAAA-MM-DD'
 * @param {number} o.quantidade número de parcelas (modos intervalo e mensal)
 * @param {'intervalo'|'mensal'|'prazos'} o.modo
 * @param {number} [o.primeiraDias] DDL da primeira (modo intervalo), padrão 30
 * @param {number} [o.primeiraMeses] modo mensal: 1 = primeira no mês seguinte (padrão), 0 = na data-base
 * @param {string} [o.primeiraData] data explícita da primeira (substitui primeiraDias)
 * @param {number} [o.intervaloDias] dias corridos entre parcelas (modo intervalo), padrão 30
 * @param {number[]} [o.prazos] prazos individuais em DDL (modo prazos)
 * @param {string} [o.hoje] data mínima permitida (o banco recusa vencimento antes de hoje)
 */
export function gerarParcelas({ total, dataBase, quantidade, modo = 'intervalo', primeiraDias = 30, primeiraMeses = 1, primeiraData = null, intervaloDias = 30, prazos = [], hoje = null }) {
  const falha = (erro, campo) => ({ ok: false, erro, campo, parcelas: [] });
  if (!Number.isSafeInteger(total) || total <= 0) return falha('O total da venda precisa ser maior que zero para parcelar.', 'total');
  if (diaCivil(dataBase) === null) return falha('Data-base inválida.', 'data_base');
  let ddls;
  if (modo === 'prazos') {
    if (!Array.isArray(prazos) || prazos.length < 2) return falha('Informe pelo menos dois prazos, por exemplo 30/60.', 'prazos');
    if (prazos.length > MAXIMO_PARCELAS) return falha(`No máximo ${MAXIMO_PARCELAS} parcelas.`, 'prazos');
    for (let i = 0; i < prazos.length; i += 1) {
      if (!Number.isInteger(prazos[i]) || prazos[i] < 0) return falha('Os prazos não podem ser negativos.', 'prazos');
      if (i && prazos[i] <= prazos[i - 1]) return falha('Os prazos precisam ser crescentes (ex.: 30/60/90).', 'prazos');
    }
    ddls = prazos;
  } else {
    if (!Number.isInteger(quantidade) || quantidade < 2 || quantidade > MAXIMO_PARCELAS) return falha(`Escolha de 2 a ${MAXIMO_PARCELAS} parcelas.`, 'quantidade');
    let primeira;
    if (primeiraData) {
      if (diaCivil(primeiraData) === null) return falha('Data da primeira parcela inválida.', 'primeira_data');
      primeira = diferencaDias(dataBase, primeiraData);
      if (primeira < 0) return falha('A primeira parcela não pode vencer antes da data-base.', 'primeira_data');
    } else {
      if (!Number.isInteger(primeiraDias) || primeiraDias < 0) return falha('O prazo da primeira parcela não pode ser negativo.', 'primeira_dias');
      primeira = primeiraDias;
    }
    if (modo === 'mensal') {
      if (![0, 1].includes(primeiraMeses) && !primeiraData) return falha('Escolha quando vence a primeira parcela.', 'primeira_dias');
      const inicio = primeiraData ?? dataBase;
      const dia = Number(inicio.slice(8, 10));
      const desloc = primeiraData ? 0 : primeiraMeses;
      ddls = Array.from({ length: quantidade }, (_, i) => diferencaDias(dataBase, somarMeses(inicio, i + desloc, dia)));
    } else {
      if (!Number.isInteger(intervaloDias) || intervaloDias < 1) return falha('O intervalo entre parcelas precisa ser de pelo menos 1 dia.', 'intervalo');
      ddls = Array.from({ length: quantidade }, (_, i) => primeira + i * intervaloDias);
    }
  }
  if (ddls.at(-1) > MAXIMO_DIAS) return falha('O último vencimento passa de 10 anos. Reduza as parcelas ou os prazos.', 'quantidade');
  const valores = dividirCentavos(total, ddls.length);
  if (valores.some((v) => v <= 0)) return falha('Parcelas demais para este valor: cada parcela precisa ter pelo menos R$ 0,01.', 'quantidade');
  const parcelas = ddls.map((ddl, i) => ({ numero: i + 1, ddl, vencimento: somarDiasCivis(dataBase, ddl), valor_centavos: valores[i] }));
  if (hoje && diaCivil(parcelas[0].vencimento) < diaCivil(hoje)) return falha('A primeira parcela não pode vencer antes de hoje.', 'data_base');
  return { ok: true, parcelas };
}

/** Confere parcelas editadas antes de enviar: valores positivos, datas válidas e em ordem, soma igual ao total. */
export function conferirParcelas(parcelas, total, hoje = null) {
  if (!Array.isArray(parcelas) || parcelas.length < 2 || parcelas.length > MAXIMO_PARCELAS) return { ok: false, erro: `Parcelado: de 2 a ${MAXIMO_PARCELAS} parcelas.` };
  let soma = 0;
  for (let i = 0; i < parcelas.length; i += 1) {
    const p = parcelas[i];
    if (!Number.isSafeInteger(p.valor_centavos) || p.valor_centavos <= 0) return { ok: false, erro: `Parcela ${i + 1}: valor precisa ser maior que zero.`, indice: i, campo: 'valor' };
    if (diaCivil(p.vencimento) === null) return { ok: false, erro: `Parcela ${i + 1}: vencimento inválido.`, indice: i, campo: 'vencimento' };
    if (hoje && diaCivil(p.vencimento) < diaCivil(hoje)) return { ok: false, erro: `Parcela ${i + 1}: vencimento antes de hoje.`, indice: i, campo: 'vencimento' };
    if (i && diaCivil(p.vencimento) < diaCivil(parcelas[i - 1].vencimento)) return { ok: false, erro: `Parcela ${i + 1}: os vencimentos precisam estar em ordem.`, indice: i, campo: 'vencimento' };
    soma += p.valor_centavos;
  }
  return soma === total ? { ok: true, soma, diferenca: 0 } : { ok: false, soma, diferenca: total - soma, erro: 'A soma das parcelas precisa ser igual ao total.' };
}
