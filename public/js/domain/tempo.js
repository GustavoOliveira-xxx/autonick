/**
 * Datas exibidas no fuso de São Paulo (BDD-001 §2).
 * O banco guarda timestamptz em UTC; vencimentos civis são datas sem hora.
 */

const FUSO = 'America/Sao_Paulo';

const dataCurta = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** @param {string} instanteIso ex.: "2026-11-01T02:30:00Z" */
export function formatarDataHora(instanteIso) {
  const data = new Date(instanteIso);
  if (Number.isNaN(data.getTime())) {
    throw new RangeError('Data inválida.');
  }
  return dataHora.format(data);
}

/**
 * Formata uma data civil (vencimento) "AAAA-MM-DD" sem conversão de fuso.
 * @param {string} dataCivil
 */
export function formatarDataCivil(dataCivil) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataCivil);
  if (!partes) {
    throw new RangeError('Data civil deve estar no formato AAAA-MM-DD.');
  }
  const [, ano, mes, dia] = partes;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (data.getUTCMonth() !== Number(mes) - 1 || data.getUTCDate() !== Number(dia)) {
    throw new RangeError('Data inexistente.');
  }
  return `${dia}/${mes}/${ano}`;
}

/** @param {string} instanteIso */
export function formatarData(instanteIso) {
  const data = new Date(instanteIso);
  if (Number.isNaN(data.getTime())) {
    throw new RangeError('Data inválida.');
  }
  return dataCurta.format(data);
}
