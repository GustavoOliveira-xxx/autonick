/**
 * Arquivos e logos (E03). O envio e a leitura passam pela API Java (validação do conteúdo real, armazenamento local e
 * metadados no PostgreSQL); vínculos e remoção são funções do catálogo. No backend Neon puro não há armazenamento de
 * arquivos: `arquivosDisponiveis` fica falso e as telas mostram a alternativa visual (iniciais, etiqueta CK).
 */
import { neon, backendAtivo } from './sessao.js';
import { CONFIG_PUBLICA } from '../config/public-config.js';

export const arquivosDisponiveis = backendAtivo === 'java-local' || backendAtivo === 'java-online';
const base = (typeof CONFIG_PUBLICA.apiJava === 'string' ? CONFIG_PUBLICA.apiJava.replace(/\/+$/, '') : '/api');
export const LIMITES_PADRAO = Object.freeze({ imagemKb: 2048, documentoKb: 5120 });
export const TIPOS_IMAGEM = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

export async function enviarArquivo(arquivo, { finalidade, empresaId = null, referenciaTipo = null, referenciaId = null, chave }) {
  if (!arquivosDisponiveis) throw Object.assign(new Error('O envio de arquivos está disponível no AutoniCK com a API Java.'), { codigo: 'RECURSO_INDISPONIVEL' });
  const f = new FormData();
  f.append('arquivo', arquivo);
  f.append('finalidade', finalidade);
  if (empresaId) f.append('empresa_id', empresaId);
  if (referenciaTipo) f.append('referencia_tipo', referenciaTipo);
  if (referenciaId) f.append('referencia_id', referenciaId);
  f.append('chave', chave);
  return neon.enviarArquivo(`${base}/arquivos`, f);
}

/** URL utilizável em <img>: arquivos protegidos são lidos com o token e viram object URL (uma vez por endereço). */
const cache = new Map();
export function urlDeImagem(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(url, neon.lerArquivo(url).then((blob) => URL.createObjectURL(blob)).catch(() => { cache.delete(url); return null; }));
  }
  return cache.get(url);
}
export function esquecerImagem(url) {
  const p = cache.get(url);
  cache.delete(url);
  p?.then((u) => u && URL.revokeObjectURL(u));
}

export const removerArquivo = (arquivoId, chave) => neon.rpc('arquivo_remover', { p_arquivo_id: arquivoId, p_operation_key: chave });
export const definirLogoEmpresa = (empresaId, arquivoId, chave) =>
  neon.rpc('definir_logo_empresa', { p_empresa_id: empresaId, p_arquivo_id: arquivoId, p_operation_key: chave });
export const logosDasMinhasEmpresas = () => (arquivosDisponiveis ? neon.rpc('logos_das_minhas_empresas', {}) : Promise.resolve({}));
export const logosPublicos = (ids) => (arquivosDisponiveis && ids.length ? neon.rpcPublica('logos_publicos', { p_empresas: ids }) : Promise.resolve({}));
export const definirImagemProduto = (produtoId, arquivoId, chave) =>
  neon.rpc('definir_imagem_produto', { p_produto_id: produtoId, p_arquivo_id: arquivoId, p_operation_key: chave });
export const imagensDeProdutos = (empresaId) => (arquivosDisponiveis ? neon.rpc('imagens_de_produtos', { p_empresa_id: empresaId }) : Promise.resolve({}));
export const imagensPublicasDeProdutos = (empresaId) => (arquivosDisponiveis ? neon.rpcPublica('imagens_publicas_de_produtos', { p_empresa_id: empresaId }) : Promise.resolve({}));
export const arquivosDoRegistro = (tipo, id) => neon.rpc('arquivos_do_registro', { p_referencia_tipo: tipo, p_referencia_id: id });

/** Validação rápida no navegador (o backend confere de novo o conteúdo real). */
export function conferirImagem(arquivo, limiteKb = LIMITES_PADRAO.imagemKb) {
  if (!arquivo) return 'Escolha uma imagem.';
  if (!TIPOS_IMAGEM.includes(arquivo.type)) return 'Use uma imagem PNG, JPG ou WebP.';
  if (arquivo.size > limiteKb * 1024) return `A imagem passa de ${Math.round(limiteKb / 1024)} MB. Reduza e tente de novo.`;
  return null;
}
