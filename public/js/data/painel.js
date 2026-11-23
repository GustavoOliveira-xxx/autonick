/**
 * Painel Business e marcador de novas mensagens (M13b; migration 202611180001; ADR-G13b D13b-09 e D13b-10).
 * Quem decide o que cada pessoa vê é o banco: cada bloco do painel só vem com a permissão correspondente, e as mensagens
 * novas seguem a mesma regra de leitura da conversa. O navegador não guarda nada disso.
 */
import { neon } from './sessao.js';

/** Indicadores da empresa numa leitura só. Blocos sem permissão vêm como null. */
export const painelEmpresa = (empresaId) => neon.rpc('painel_empresa', { p_empresa_id: empresaId });

/** Conversas com mensagens novas: como cliente (sem empresa) ou como equipe da empresa informada. */
export const mensagensNovas = (empresaId = null) => neon.rpc('mensagens_novas', empresaId ? { p_empresa_id: empresaId } : {});

/** Marca a conversa como lida até o último item visto (o banco nunca volta no tempo nem vai ao futuro). */
export const marcarConversaLida = (tipo, id, ate = null) =>
  neon.rpc('marcar_conversa_lida', { p_tipo: tipo, p_id: id, p_ate: ate });

/** Índice { 'solicitacao:<id>' | 'pedido:<id>' | 'os:<id>': quantidade } para marcar linhas de listas. */
export function indiceNovas(resposta) {
  const indice = new Map();
  for (const c of resposta?.conversas ?? []) {
    indice.set(`${c.tipo}:${c.id}`, c.novas);
    if (c.os_id) indice.set(`os:${c.os_id}`, c.novas);
  }
  return indice;
}
