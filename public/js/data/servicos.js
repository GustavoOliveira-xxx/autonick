/**
 * Serviços oferecidos, solicitações, orçamentos e agenda básica (M08) sobre a Neon Data API.
 *
 * Quem decide é o banco (migration 202611120003): permissão atual (M04, D8-22), estimativa por regras fechadas
 * (D8-07), versão vigente e validade (D8-12, D8-13), limite de desconto do perfil (D8-11), limites de solicitação
 * (D8-23) e chave de operação. O navegador nunca envia preço nem total: só respostas, quantidades e valores
 * unitários do orçamento, que o banco recalcula. Dinheiro sai e volta em CENTAVOS inteiros.
 * As chamadas passam pela fila de no máximo 2 requisições simultâneas (D6-12).
 */
import { neon } from './sessao.js';

// --- Catálogo ------------------------------------------------------------------
export const servicosDaEmpresa = (empresaId) => neon.rpc('servicos_da_empresa', { p_empresa_id: empresaId });
export const criarServico = (empresaId, dados, chave) => neon.rpc('criar_servico', { p_empresa_id: empresaId, p_dados: dados, p_operation_key: chave });
export const alterarServico = (servicoId, dados, versao, chave) =>
  neon.rpc('alterar_servico', { p_servico_id: servicoId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const definirServicoAtivo = (servicoId, ativo, versao, chave) =>
  neon.rpc('definir_servico_ativo', { p_servico_id: servicoId, p_ativo: ativo, p_expected_version: versao, p_operation_key: chave });
export const salvarFormulario = (servicoId, perguntas, versao, chave) =>
  neon.rpc('salvar_formulario_servico', { p_servico_id: servicoId, p_perguntas: perguntas, p_expected_version: versao, p_operation_key: chave });
export const salvarRegras = (servicoId, regras, versao, chave) =>
  neon.rpc('salvar_regras_servico', { p_servico_id: servicoId, p_regras: regras, p_expected_version: versao, p_operation_key: chave });
export const estimar = (servicoId, respostas) => neon.rpc('estimar_servico', { p_servico_id: servicoId, p_respostas: respostas });
export const servicosParaCliente = (empresaId) => neon.rpc('servicos_para_cliente', { p_empresa_id: empresaId });

// --- Solicitações --------------------------------------------------------------
export const criarSolicitacao = (servicoId, dados, chave) => neon.rpc('criar_solicitacao', { p_servico_id: servicoId, p_dados: dados, p_operation_key: chave });
export const criarSolicitacaoInterna = (empresaId, clienteId, servicoId, dados, chave) =>
  neon.rpc('criar_solicitacao_interna', { p_empresa_id: empresaId, p_cliente_id: clienteId, p_servico_id: servicoId, p_dados: dados, p_operation_key: chave });
export const solicitacoesDaEmpresa = (empresaId, filtros = {}, limite = 50, deslocamento = 0) =>
  neon.rpc('solicitacoes_da_empresa', { p_empresa_id: empresaId, p_filtros: filtros, p_limite: limite, p_deslocamento: deslocamento });
export const solicitacao = (id) => neon.rpc('solicitacao_detalhe', { p_solicitacao_id: id });
export const minhasSolicitacoes = () => neon.rpc('minhas_solicitacoes', {});
export const minhaSolicitacao = (id) => neon.rpc('minha_solicitacao', { p_solicitacao_id: id });
export const assumir = (id, versao, chave) => neon.rpc('assumir_solicitacao', { p_solicitacao_id: id, p_expected_version: versao, p_operation_key: chave });

// --- Orçamento -----------------------------------------------------------------
export const salvarRascunho = (solicitacaoId, dados, versao, chave) =>
  neon.rpc('salvar_rascunho_orcamento', { p_solicitacao_id: solicitacaoId, p_dados: dados, p_expected_version: versao, p_operation_key: chave });
export const enviarOrcamento = (versaoId, versao, chave) => neon.rpc('enviar_orcamento', { p_versao_id: versaoId, p_expected_version: versao, p_operation_key: chave });
export const aprovarOrcamento = (versaoId, versao, chave) => neon.rpc('aprovar_orcamento', { p_versao_id: versaoId, p_expected_version: versao, p_operation_key: chave });
export const registrarMensagem = (solicitacaoId, texto, interna, chave) =>
  neon.rpc('registrar_mensagem', { p_solicitacao_id: solicitacaoId, p_texto: texto, p_interna: interna, p_operation_key: chave });
export const pedirRevisao = (solicitacaoId, texto, chave) => neon.rpc('pedir_revisao', { p_solicitacao_id: solicitacaoId, p_texto: texto, p_operation_key: chave });
export const aceitarOrcamento = (solicitacaoId, versaoId, chave) =>
  neon.rpc('aceitar_orcamento', { p_solicitacao_id: solicitacaoId, p_versao_id: versaoId, p_condicoes_aceitas: true, p_operation_key: chave });
export const recusarOrcamento = (solicitacaoId, versaoId, motivo, chave) =>
  neon.rpc('recusar_orcamento', { p_solicitacao_id: solicitacaoId, p_versao_id: versaoId, p_motivo: motivo, p_operation_key: chave });
export const cancelarSolicitacao = (solicitacaoId, motivo, chave) =>
  neon.rpc('cancelar_solicitacao', { p_solicitacao_id: solicitacaoId, p_motivo: motivo || null, p_operation_key: chave });

// --- Agenda --------------------------------------------------------------------
export const horarios = (empresaId) => neon.rpc('horarios_empresa', { p_empresa_id: empresaId });
export const salvarHorarios = (empresaId, grade, chave) => neon.rpc('salvar_horarios_empresa', { p_empresa_id: empresaId, p_grade: grade, p_operation_key: chave });
export const confirmarHorario = (solicitacaoId, inicio, duracaoMin, aceitarAvisos, justificativa, chave) =>
  neon.rpc('confirmar_horario', { p_solicitacao_id: solicitacaoId, p_inicio: inicio, p_duracao_min: duracaoMin, p_aceitar_avisos: aceitarAvisos,
    p_justificativa: justificativa || null, p_operation_key: chave });
export const agendaBasica = (empresaId, de = null, ate = null) => neon.rpc('agenda_basica', { p_empresa_id: empresaId, p_de: de, p_ate: ate });

// --- Rótulos -------------------------------------------------------------------
export const POLITICA = { fixo: 'Preço fixo', a_partir_de: 'A partir de', sob_consulta: 'Sob consulta', por_regras: 'Calculado por regras', pacote: 'Pacote (preço fechado)' };
export const MODALIDADE = { analise_manual: 'Análise manual (padrão)', orcamento_automatico: 'Orçamento automático pelas regras' };
export const TIPO_PERGUNTA = { texto_curto: 'Texto curto', texto_longo: 'Texto longo', numero: 'Número', escolha_unica: 'Escolha única',
  escolha_multipla: 'Escolha múltipla', sim_nao: 'Sim ou não' };
export const TIPO_REGRA = { valor_base: 'Valor base', por_quantidade: 'Valor por quantidade', por_opcao: 'Valor por opção', se_sim: 'Adicional se "sim"',
  minimo: 'Valor mínimo' };
export const TIPO_COMPONENTE = { material: 'Material', mao_de_obra: 'Mão de obra', deslocamento: 'Deslocamento', outro: 'Outro' };
export const ESTADO_SOLICITACAO = { nova: 'Nova', em_analise: 'Em análise', orcamento_enviado: 'Orçamento enviado', revisao_pedida: 'Revisão pedida',
  aceita: 'Aceita (ordem de serviço criada)', recusada: 'Recusada', cancelada: 'Cancelada', vencido: 'Orçamento vencido' };
export const ESTADO_SOLICITACAO_CLIENTE = { nova: 'Enviada', em_analise: 'Em análise', orcamento_enviado: 'Orçamento disponível', revisao_pedida: 'Revisão pedida',
  aceita: 'Aceita', recusada: 'Recusada', cancelada: 'Cancelada', vencido: 'Orçamento vencido' };
export const ESTADO_VERSAO = { rascunho: 'Rascunho', aguardando_aprovacao: 'Aguardando aprovação', enviada: 'Enviada', substituida: 'Substituída',
  aceita: 'Aceita', recusada: 'Recusada', cancelada: 'Cancelada', vencida: 'Vencida' };
export const TURNO = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', qualquer: 'Qualquer horário' };
export const MOTIVO_RECUSA = { preco: 'Preço', prazo: 'Prazo', desisti: 'Desisti do serviço', outra_empresa: 'Escolhi outra empresa', outro: 'Outro motivo' };
export const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

// --- Exceções da agenda (E04): feriados, fechamentos e horários especiais por data ----------------
export const excecoesAgenda = (empresaId, de, ate) => neon.rpc('excecoes_agenda', { p_empresa_id: empresaId, p_de: de, p_ate: ate });
export const salvarExcecaoAgenda = (empresaId, data, tipo, intervalos, motivo, chave) =>
  neon.rpc('salvar_excecao_agenda', { p_empresa_id: empresaId, p_data: data, p_tipo: tipo, p_intervalos: intervalos, p_motivo: motivo, p_operation_key: chave });
export const removerExcecaoAgenda = (excecaoId, chave) => neon.rpc('remover_excecao_agenda', { p_excecao_id: excecaoId, p_operation_key: chave });

// --- Compromissos internos (E04): compromisso ou bloqueio de horário, com avisos de conflito ------------------
export const compromissosAgenda = (empresaId, de, ate) => neon.rpc('compromissos_agenda', { p_empresa_id: empresaId, p_de: de, p_ate: ate });
export const salvarCompromissoAgenda = (empresaId, compromissoId, dados, aceitarAvisos, versao, chave) => neon.rpc('salvar_compromisso_agenda',
  { p_empresa_id: empresaId, p_compromisso_id: compromissoId, p_dados: dados, p_aceitar_avisos: aceitarAvisos, p_expected_version: versao, p_operation_key: chave });
export const cancelarCompromissoAgenda = (compromissoId, versao, chave) =>
  neon.rpc('cancelar_compromisso_agenda', { p_compromisso_id: compromissoId, p_expected_version: versao, p_operation_key: chave });
