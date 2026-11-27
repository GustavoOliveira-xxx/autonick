/**
 * CPF, CNPJ (numérico e alfanumérico) e CEP: normalização, validação e máscara. Mesmas regras do banco
 * (app_private.normalizar_documento, cpf_valido, cnpj_valido), que é quem decide de verdade.
 *
 * CNPJ alfanumérico: 12 caracteres A-Z ou 0-9 seguidos de 2 dígitos verificadores. Cada caractere vale (código ASCII - 48),
 * ou seja, dígitos valem 0 a 9 e letras A a Z valem 17 a 42; pesos e módulo 11 como no CNPJ numérico.
 * O documento é guardado como texto sem máscara e em maiúsculas: zeros à esquerda e letras são preservados.
 */

/** Tira espaços, pontos, barras e hífens e passa para maiúsculas. Outros caracteres continuam (e invalidam). */
export function normalizarDocumento(texto) {
  const v = String(texto ?? '').replace(/[\s./-]/g, '').toUpperCase();
  return v || null;
}

export function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf ?? '') || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(cpf[i]) * (n + 1 - i);
    const d = (s * 10) % 11;
    return d === 10 ? 0 : d;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

const PESOS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const valor = (c) => c.charCodeAt(0) - 48;

/** Calcula os 2 dígitos verificadores de uma base de 12 caracteres (A-Z/0-9). */
export function digitosCnpj(base) {
  if (!/^[0-9A-Z]{12}$/.test(base ?? '')) return null;
  const mod = (s) => { const r = s % 11; return r < 2 ? 0 : 11 - r; };
  let s = 0;
  for (let i = 0; i < 12; i += 1) s += valor(base[i]) * PESOS[i + 1];
  const d1 = mod(s);
  s = 0;
  for (let i = 0; i < 12; i += 1) s += valor(base[i]) * PESOS[i];
  const d2 = mod(s + d1 * PESOS[12]);
  return `${d1}${d2}`;
}

export function cnpjValido(cnpj) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj ?? '') || /^(.)\1{13}$/.test(cnpj)) return false;
  return digitosCnpj(cnpj.slice(0, 12)) === cnpj.slice(12);
}

/** 'cpf', 'cnpj' ou null. */
export function tipoDocumento(texto) {
  const d = normalizarDocumento(texto);
  if (cpfValido(d)) return 'cpf';
  if (cnpjValido(d)) return 'cnpj';
  return null;
}

/**
 * Confere o documento conforme o tipo de pessoa (pf: CPF; pj: CNPJ). Vazio é aceito (o documento é opcional).
 * Devolve { ok, valor, erro }.
 */
export function conferirDocumento(texto, tipoPessoa) {
  const d = normalizarDocumento(texto);
  if (!d) return { ok: true, valor: null };
  if (tipoPessoa === 'pf') return cpfValido(d) ? { ok: true, valor: d } : { ok: false, erro: 'CPF inválido: confira os 11 dígitos.' };
  if (/[^0-9A-Z]/.test(d)) return { ok: false, erro: 'O CNPJ só tem letras e números (pontos, barra e hífen são opcionais).' };
  return cnpjValido(d) ? { ok: true, valor: d }
    : { ok: false, erro: 'CNPJ inválido: são 14 caracteres (letras e números) e os 2 últimos são dígitos verificadores.' };
}

/** Máscara de exibição: 000.000.000-00 ou AA.AAA.AAA/AAAA-00. Parcial enquanto digita. */
export function mascararDocumento(texto, tipoPessoa = null) {
  const d = (normalizarDocumento(texto) ?? '').replace(/[^0-9A-Z]/g, '');
  const cpf = tipoPessoa === 'pf' || (tipoPessoa !== 'pj' && d.length === 11 && /^\d+$/.test(d));
  if (cpf) {
    const n = d.replace(/\D/g, '').slice(0, 11);
    return n.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  const c = d.slice(0, 14);
  let r = c.slice(0, 2);
  if (c.length > 2) r += `.${c.slice(2, 5)}`;
  if (c.length > 5) r += `.${c.slice(5, 8)}`;
  if (c.length > 8) r += `/${c.slice(8, 12)}`;
  if (c.length > 12) r += `-${c.slice(12, 14)}`;
  return r;
}

/** Documento para listas: CPF parcialmente oculto (privacidade), CNPJ completo (dado empresarial). */
export function documentoParaLista(doc) {
  if (!doc) return '';
  if (/^\d{11}$/.test(doc)) return `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`;
  return mascararDocumento(doc, 'pj');
}

export function normalizarCep(texto) {
  const v = String(texto ?? '').replace(/\D/g, '');
  return v || null;
}
export const cepValido = (cep) => /^\d{8}$/.test(cep ?? '');
export function mascararCep(texto) {
  const v = String(texto ?? '').replace(/\D/g, '').slice(0, 8);
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v;
}
