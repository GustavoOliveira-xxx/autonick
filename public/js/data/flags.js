/**
 * Feature flags (E09; migration 202612010002). Só ligam ou desligam recursos opcionais; nunca decidem permissão.
 * Padrão conservador: sem resposta do servidor, tudo fica como sempre foi (ligado).
 * Consumidores reais: animacoes_decorativas (Bong e entradas animadas), busca_cep (botão Buscar CEP),
 * onboarding_contextual (dicas de primeiros passos, por empresa).
 */
import { neon } from './sessao.js';

const PADRAO = Object.freeze({ animacoes_decorativas: true, busca_cep: true, onboarding_contextual: true });
const cache = new Map();

export function flags(empresaId = null, { comSessao = null } = {}) {
  const k = empresaId ?? '';
  if (!cache.has(k)) {
    cache.set(k, (async () => {
      try {
        const r = (comSessao ?? await neon.temSessao()) ? await neon.rpc('flags_ativas', { p_empresa_id: empresaId })
          : await neon.rpcPublica('flags_ativas', { p_empresa_id: null });
        return r && typeof r === 'object' && !Array.isArray(r) ? { ...PADRAO, ...r } : { ...PADRAO };
      } catch {
        return { ...PADRAO };
      }
    })());
  }
  return cache.get(k);
}

export const flagLigada = async (chave, empresaId = null) => (await flags(empresaId))[chave] !== false;

export const ckFlags = () => neon.rpc('ck_flags', {});
export const ckDefinirFlag = (chave, ativa, motivo, versao, operacao) =>
  neon.rpc('ck_definir_flag', { p_chave: chave, p_ativa: ativa, p_motivo: motivo, p_expected_version: versao, p_operation_key: operacao });
export const definirFlagEmpresa = (empresaId, chave, ativa, operacao) =>
  neon.rpc('definir_flag_empresa', { p_empresa_id: empresaId, p_chave: chave, p_ativa: ativa, p_operation_key: operacao });
