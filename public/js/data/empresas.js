/**
 * Empresas, vitrine e administração CK (M03, ajustado no M04) sobre a Neon Data API.
 *
 * Toda regra (estado, permissão, versão, idempotência) é decidida no banco
 * pelas RPCs da migration 202611010003; este módulo só monta as chamadas.
 * Cada ação recebe uma `chave` de operação: a tela reaproveita a mesma chave
 * ao repetir um envio que pode ter chegado ao servidor (API-OP-037).
 */
import { neon } from './sessao.js';

export const novaChave = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const enc = encodeURIComponent;

export const SITUACOES_VITRINE = {
  rascunho: 'Rascunho',
  em_analise: 'Em análise pela CK',
  correcao_solicitada: 'Correção solicitada',
  rejeitada: 'Não aprovada',
  publicada: 'Aprovado para publicação',
  suspensa: 'Vitrine suspensa',
};

export const ROTULOS_CAMPOS = {
  nome_publico: 'Nome do negócio',
  categoria_id: 'Categoria principal',
  modalidade: 'Modalidade',
  cidade: 'Cidade',
  uf: 'UF',
  bairro: 'Bairro',
  area_atendimento: 'Área de atendimento',
  telefone_publico: 'Telefone público',
  whatsapp_publico: 'WhatsApp público',
  email_publico: 'E-mail público',
  descricao_publica: 'Descrição pública',
  horario_funcionamento: 'Horário de funcionamento',
  documento: 'CPF ou CNPJ',
  email_contato: 'E-mail de contato (privado)',
  endereco_privado: 'Endereço (privado)',
  observacoes_internas: 'Observações internas',
};

export const CAMPOS_RELEVANTES = ['nome_publico', 'categoria_id', 'modalidade', 'cidade', 'uf', 'bairro',
  'area_atendimento', 'telefone_publico', 'whatsapp_publico', 'email_publico'];
export const CAMPOS_MENOR_RISCO = ['descricao_publica', 'horario_funcionamento'];
export const CAMPOS_PRIVADOS = ['documento', 'email_contato', 'endereco_privado', 'observacoes_internas'];

export const MODALIDADES = { comercio: 'Comércio', servicos: 'Serviços', ambos: 'Comércio e serviços' };
export const FUNDAMENTOS = { fraude: 'Fraude', risco_consumidor: 'Risco ao consumidor', exigencia_legal: 'Exigência legal' };

// --- Gestor -----------------------------------------------------------------

export const categorias = () =>
  neon.consultar('/categorias_plataforma?select=id,nome,slug&tipo=eq.negocio&order=ordem.asc');

/** Empresas com vínculo ativo (proprietário ou funcionário), com papel e perfil (M04). */
export const minhasEmpresas = () => neon.rpc('minhas_empresas');

/** Colunas não privadas: desde o M04 a tabela não entrega documento, endereço, e-mail de contato nem observações. */
const COLUNAS_EMPRESA = ['id', 'nome_publico', 'modalidade', 'categoria_id', 'cidade', 'uf', 'bairro', 'area_atendimento',
  'telefone_publico', 'whatsapp_publico', 'email_publico', 'descricao_publica', 'horario_funcionamento', 'situacao_erp',
  'situacao_vitrine', 'suspensao_gravidade', 'suspensao_fundamento', 'dados_publicados', 'versao', 'criado_em',
  'atualizado_em', 'dado_de_teste'].join(',');

export async function empresa(id) {
  const linhas = await neon.consultar(`/empresas?id=eq.${enc(id)}&select=${COLUNAS_EMPRESA}`);
  return linhas[0] ?? null;
}

/** Dados privados: só com a permissão "Dados da empresa: visualizar" (conferida no banco). */
export const dadosPrivados = (id) => neon.rpc('empresa_dados_privados', { p_empresa_id: id });

export const vitrinePublicada = async (id) =>
  (await neon.consultar(`/public_empresa_cards?empresa_id=eq.${enc(id)}&select=*`))[0] ?? null;

export const historico = (id) =>
  neon.consultar(`/eventos_publicacao?empresa_id=eq.${enc(id)}&select=id,tipo,situacao_anterior,situacao_nova,papel_ator,motivo,gravidade,fundamento,mesmo_decisor,criado_em&order=criado_em.desc`);

export const solicitacoes = (id) =>
  neon.consultar(`/solicitacoes_publicacao?empresa_id=eq.${enc(id)}&select=id,tipo,estado,motivo,campos_corrigir,enviada_em,decidida_em&order=enviada_em.desc`);

export const contestacoes = (id) =>
  neon.consultar(`/contestacoes?empresa_id=eq.${enc(id)}&select=id,tipo_decisao,motivo_gestor,estado,aberta_em,decidida_em,justificativa_ck&order=aberta_em.desc`);

export const criarEmpresa = (dados, chave) =>
  neon.rpc('criar_empresa', { p_dados: dados, p_operation_key: chave });

export const atualizarEmpresa = (id, dados, versao, chave) =>
  neon.rpc('atualizar_empresa', { p_empresa_id: id, p_dados: dados, p_expected_version: versao, p_operation_key: chave });

export const enviarParaAnalise = (id, versao, chave) =>
  neon.rpc('enviar_vitrine_para_analise', { p_empresa_id: id, p_expected_version: versao, p_operation_key: chave });

export const abrirContestacao = (id, motivo, chave) =>
  neon.rpc('abrir_contestacao', { p_empresa_id: id, p_motivo: motivo, p_operation_key: chave });

// --- CK Admin ---------------------------------------------------------------

export const souCkAdmin = () => neon.rpc('sou_ck_admin');
export const ckEmpresas = () => neon.rpc('ck_listar_empresas');
export const ckHistorico = (id) => neon.rpc('ck_historico_empresa', { p_empresa_id: id });

export const ckFila = () =>
  neon.consultar('/solicitacoes_publicacao?estado=eq.aberta&select=id,empresa_id,tipo,dados_publicos,enviada_em,origem_contestacao_id&order=enviada_em.asc');

export const ckModeracoes = () =>
  neon.consultar('/moderacoes_vitrine?estado=eq.pendente&select=id,empresa_id,antes,depois,criada_em&order=criada_em.asc');

export const ckContestacoes = () =>
  neon.consultar('/contestacoes?estado=in.(aberta,em_revisao)&select=id,empresa_id,tipo_decisao,motivo_gestor,estado,aberta_em&order=aberta_em.asc');

export const ckDecidirSolicitacao = (id, decisao, motivo, campos, chave) =>
  neon.rpc('ck_decidir_solicitacao', { p_solicitacao_id: id, p_decisao: decisao, p_motivo: motivo || null, p_campos: campos?.length ? campos : null, p_operation_key: chave });

export const ckSuspender = (id, motivo, gravidade, fundamento, chave) =>
  neon.rpc('ck_suspender_vitrine', { p_empresa_id: id, p_motivo: motivo, p_gravidade: gravidade, p_fundamento: fundamento || null, p_operation_key: chave });

export const ckReativar = (id, motivo, chave) =>
  neon.rpc('ck_reativar_vitrine', { p_empresa_id: id, p_motivo: motivo, p_operation_key: chave });

export const ckAssumirContestacao = (id, chave) =>
  neon.rpc('ck_assumir_contestacao', { p_contestacao_id: id, p_operation_key: chave });

export const ckDecidirContestacao = (id, decisao, justificativa, chave) =>
  neon.rpc('ck_decidir_contestacao', { p_contestacao_id: id, p_decisao: decisao, p_justificativa: justificativa, p_operation_key: chave });

export const ckModerar = (id, decisao, motivo, chave) =>
  neon.rpc('ck_moderar_alteracao_direta', { p_moderacao_id: id, p_decisao: decisao, p_motivo: motivo || null, p_operation_key: chave });
