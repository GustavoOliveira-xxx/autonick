/**
 * Busca de CEP pela API Java (GET /api/enderecos/cep/{cep}), que consulta a BrasilAPI com host fixo, cache e limite.
 * O navegador nunca chama a BrasilAPI diretamente (a CSP continua só 'self') e só o CEP sai do computador.
 * Sem a API Java (backend Neon puro), a busca não existe e o endereço é preenchido à mão.
 * Devolve { ok: true, endereco } ou { ok: false, codigo, mensagem }; nunca lança, para a tela manter o que foi digitado.
 */
import { neon, backendAtivo } from './sessao.js';
import { CONFIG_PUBLICA } from '../config/public-config.js';
import { normalizarCep, cepValido } from '../domain/documentos.js';

export const cepDisponivel = backendAtivo === 'java-local' || backendAtivo === 'java-online';
const base = (typeof CONFIG_PUBLICA.apiJava === 'string' ? CONFIG_PUBLICA.apiJava.replace(/\/+$/, '') : '/api');
export const MENSAGEM_FALHA_CEP = 'Não foi possível buscar o CEP. Preencha o endereço manualmente.';

export async function buscarCep(texto, sinal) {
  const cep = normalizarCep(texto);
  if (!cepValido(cep)) return { ok: false, codigo: 'CEP_INVALIDO', mensagem: 'CEP inválido: use 8 dígitos (00000-000).' };
  if (!cepDisponivel) return { ok: false, codigo: 'CEP_DESLIGADO', mensagem: 'A busca de CEP funciona no AutoniCK com a API Java. Preencha o endereço manualmente.' };
  if (globalThis.navigator?.onLine === false) return { ok: false, codigo: 'SEM_CONEXAO', mensagem: `Sem conexão. ${MENSAGEM_FALHA_CEP}` };
  try {
    const token = await neon.tokenDeAcesso();
    const r = await fetch(`${base}/enderecos/cep/${cep}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: sinal, credentials: 'omit' });
    const corpo = await r.json().catch(() => null);
    if (r.ok && corpo && typeof corpo === 'object') return { ok: true, endereco: corpo };
    return { ok: false, codigo: corpo?.hint ?? `HTTP_${r.status}`, mensagem: corpo?.message || MENSAGEM_FALHA_CEP };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, codigo: 'CANCELADA', mensagem: '' };
    return { ok: false, codigo: 'CEP_INDISPONIVEL', mensagem: MENSAGEM_FALHA_CEP };
  }
}
