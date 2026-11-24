/** Favoritos e atalhos (E05): guardados no servidor; nunca concedem acesso. */
import { neon } from './sessao.js';

export const meusFavoritos = (empresaId = null) => neon.rpc('meus_favoritos', { p_empresa_id: empresaId });
export const alternarFavorito = (tipo, chave, { empresaId = null, rotulo = null } = {}) =>
  neon.rpc('alternar_favorito', { p_tipo: tipo, p_chave: chave, p_empresa_id: empresaId, p_rotulo: rotulo });
