/**
 * Comunicação, avaliações e moderação (M12) sobre a Neon Data API (migration 202611170001; ADR-G12 aprovada).
 *
 * Quem decide é o banco: quem participa de cada conversa (titular e equipe autorizada pela área), o prazo de envio, os
 * limites diários, a elegibilidade da avaliação, a moderação e os impedimentos da CK. O navegador só mostra o que o banco
 * devolve e nunca guarda mensagens. As chamadas passam pela fila de no máximo 2 requisições simultâneas (D6-12).
 */
import { neon } from './sessao.js';

// --- Conversa (D12-01 a D12-07) -------------------------------------------------
/** tipo: 'solicitacao', 'os' ou 'pedido'. */
export const conversaAtendimento = (tipo, id) => neon.rpc('conversa_atendimento', { p_tipo: tipo, p_id: id });
export const enviarMensagem = (tipo, id, texto, chave) =>
  neon.rpc('enviar_mensagem', { p_tipo: tipo, p_id: id, p_texto: texto, p_operation_key: chave });

// --- Avaliações (D12-09 a D12-14) -----------------------------------------------
export const minhaAvaliacaoOs = (osId) => neon.rpc('minha_avaliacao_os', { p_os_id: osId });
export const avaliarOs = (osId, nota, comentario, chave) =>
  neon.rpc('avaliar_os', { p_os_id: osId, p_nota: nota, p_comentario: comentario, p_operation_key: chave });
export const retirarAvaliacao = (avaliacaoId, chave) => neon.rpc('retirar_avaliacao', { p_avaliacao_id: avaliacaoId, p_operation_key: chave });
export const avaliacoesDaEmpresa = (empresaId) => neon.rpc('avaliacoes_da_empresa', { p_empresa_id: empresaId });
export const responderAvaliacao = (avaliacaoId, texto, chave) =>
  neon.rpc('responder_avaliacao', { p_avaliacao_id: avaliacaoId, p_texto: texto, p_operation_key: chave });

// --- Denúncia e contestação (D12-16, D12-18, D12-22) -----------------------------
export const CATEGORIAS_DENUNCIA = {
  ofensivo: 'Conteúdo ofensivo',
  falso: 'Informação falsa',
  dado_pessoal: 'Dado pessoal exposto',
  spam: 'Spam ou propaganda',
  golpe: 'Golpe ou fraude',
  outro: 'Outro motivo',
};
export const denunciar = (alvoTipo, alvoId, categoria, descricao, chave) =>
  neon.rpc('denunciar', { p_alvo_tipo: alvoTipo, p_alvo_id: alvoId, p_categoria: categoria, p_descricao: descricao, p_operation_key: chave });
export const minhasDenuncias = () => neon.rpc('minhas_denuncias');
export const contestarModeracao = (decisaoId, motivo, chave) =>
  neon.rpc('contestar_moderacao', { p_decisao_id: decisaoId, p_motivo: motivo, p_operation_key: chave });

// --- CK (RF-166, RF-172) --------------------------------------------------------
export const ckFilaModeracao = () => neon.rpc('ck_fila_moderacao');
export const ckAssumirDenuncia = (id, chave) => neon.rpc('ck_assumir_denuncia', { p_denuncia_id: id, p_operation_key: chave });
export const ckDecidirDenuncia = (id, medida, motivo, justificativa, chave) =>
  neon.rpc('ck_decidir_denuncia', { p_denuncia_id: id, p_medida: medida, p_motivo_resumo: motivo, p_justificativa: justificativa, p_operation_key: chave });
export const ckModerarPublicacao = (alvoTipo, alvoId, medida, motivo, justificativa, chave) =>
  neon.rpc('ck_moderar_publicacao', { p_alvo_tipo: alvoTipo, p_alvo_id: alvoId, p_medida: medida, p_motivo_resumo: motivo,
    p_justificativa: justificativa, p_operation_key: chave });
export const ckAssumirContestacaoModeracao = (id, chave) => neon.rpc('ck_assumir_contestacao_moderacao', { p_contestacao_id: id, p_operation_key: chave });
export const ckDecidirContestacaoModeracao = (id, medida, motivo, justificativa, chave) =>
  neon.rpc('ck_decidir_contestacao_moderacao', { p_contestacao_id: id, p_medida: medida, p_motivo_resumo: motivo,
    p_justificativa: justificativa, p_operation_key: chave });
