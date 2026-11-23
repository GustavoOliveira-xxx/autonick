/** Registro da exportação em PDF (M13, D13-10 = A): o banco confere a permissão de origem e guarda só o fato. */
import { neon } from './sessao.js';

export const registrarExportacaoPdf = (empresaId, documento, referenciaId, de, ate, chave) =>
  neon.rpc('registrar_exportacao_pdf', { p_empresa_id: empresaId, p_documento: documento, p_referencia_id: referenciaId ?? null,
    p_de: de ?? null, p_ate: ate ?? null, p_operation_key: chave });
