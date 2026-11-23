/**
 * Ordens de serviço, materiais, cancelamento com custos e contestação, agenda operacional e reagendamento (M09)
 * sobre a Neon Data API.
 *
 * Quem decide é o banco (migration 202611130001): a OS nasce no aceite (D9-01), estados e versão da OS, permissões por
 * combinação (D9-27), estoque pelo motor do M05, títulos pelo M07 sem recebimento implícito (D9-10), custos só com aceite
 * ou acordo (D9-13, D9-14), horário só por acordo (D9-18, D9-19) e limites da CK (D9-28). O navegador nunca envia o valor
 * contratado nem totais: só quantidades e valores dos itens de custo, que o banco soma e limita. Dinheiro em CENTAVOS.
 * As chamadas passam pela fila de no máximo 2 requisições simultâneas (D6-12).
 */
import { neon } from './sessao.js';
import { detalheViaJavaAtivo, detalheJava, minhasOrdensJava, ordensDaEmpresaJava, iniciarOsJava, pausarOsJava, retomarOsJava, concluirOsJava,
  reabrirOsJava, encerrarOsJava, publicarAtualizacaoJava, atualizarDadosJava, registrarGarantiaJava, confirmarRecebimentoJava,
  adicionarMaterialJava, reservarMaterialJava, registrarUsoJava, decidirUsoJava, devolverMaterialJava, pedirRevisaoJava } from './detalhe-os-java.js';

// --- Leitura -------------------------------------------------------------------
// J03 (detalhe) e J04 (listas): na demonstração local (e só nela), as consultas de OS vêm da API Java; fora dela, nada muda.
export const ordensDaEmpresa = (empresaId, filtros = {}, limite = 50, deslocamento = 0) => (detalheViaJavaAtivo()
  ? ordensDaEmpresaJava(empresaId, filtros, limite, deslocamento)
  : neon.rpc('ordens_da_empresa', { p_empresa_id: empresaId, p_filtros: filtros, p_limite: limite, p_deslocamento: deslocamento }));
export const ordem = (id) => (detalheViaJavaAtivo() ? detalheJava('business', id) : neon.rpc('os_detalhe', { p_os_id: id }));
export const minhasOrdens = () => (detalheViaJavaAtivo() ? minhasOrdensJava() : neon.rpc('minhas_os', {}));
export const minhaOrdem = (id) => (detalheViaJavaAtivo() ? detalheJava('cliente', id) : neon.rpc('minha_os', { p_os_id: id }));

// --- Execução ------------------------------------------------------------------
// J05 a J07 e J09: na demonstração local, "iniciar", "pausar", "retomar", "concluir", "reabrir" e "encerrar" gravam pela
// API Java (rotas fixas; retomar, concluir e encerrar sem texto); as outras ações seguem o caminho de sempre, que o
// simulador da demonstração recusa. Fora dela, nada muda.
const ESCRITAS_JAVA = {
  iniciar: (id, motivo, versao, chave) => iniciarOsJava(id, versao, chave),
  pausar: (id, motivo, versao, chave) => pausarOsJava(id, versao, chave, motivo),
  retomar: (id, motivo, versao, chave) => retomarOsJava(id, versao, chave),
  concluir: (id, motivo, versao, chave) => concluirOsJava(id, versao, chave),
  reabrir: (id, motivo, versao, chave) => reabrirOsJava(id, versao, chave, motivo),
  encerrar: (id, motivo, versao, chave) => encerrarOsJava(id, versao, chave),
};
export const mudarEstado = (id, acao, motivo, versao, chave) => (detalheViaJavaAtivo() && Object.hasOwn(ESCRITAS_JAVA, acao)
  ? ESCRITAS_JAVA[acao](id, motivo, versao, chave)
  : neon.rpc('mudar_estado_os', { p_os_id: id, p_acao: acao, p_motivo: motivo || null, p_expected_version: versao, p_operation_key: chave }));
// J10: na demonstração local, atualização, dados e garantia gravam pela API Java; a garantia leva a versão da tela, que a
// API confere. Fora dela, nada muda: as funções SQL de sempre, e a garantia sem versão (a função não recebe).
export const atualizarDados = (id, dados, versao, chave) => (detalheViaJavaAtivo()
  ? atualizarDadosJava(id, versao, chave, dados)
  : neon.rpc('atualizar_dados_os', { p_os_id: id, p_dados: dados, p_expected_version: versao, p_operation_key: chave }));
export const publicarAtualizacao = (id, texto, publica, chave) => (detalheViaJavaAtivo()
  ? publicarAtualizacaoJava(id, chave, texto, publica)
  : neon.rpc('publicar_atualizacao_os', { p_os_id: id, p_texto: texto, p_publica: publica, p_operation_key: chave }));
export const registrarGarantia = (id, dias, condicoes, chave, versao) => (detalheViaJavaAtivo()
  ? registrarGarantiaJava(id, versao, chave, dias, condicoes || null)
  : neon.rpc('registrar_garantia_os', { p_os_id: id, p_dias: dias, p_condicoes: condicoes || null, p_operation_key: chave }));
// J08: na demonstração local, as duas respostas do Cliente gravam pela API Java, que também confere a versão que a tela
// mostrava. Fora dela, nada muda: as funções SQL não recebem versão e `versao` não é enviada.
export const confirmarRecebimento = (id, chave, versao) => (detalheViaJavaAtivo()
  ? confirmarRecebimentoJava(id, versao, chave)
  : neon.rpc('confirmar_recebimento_servico', { p_os_id: id, p_operation_key: chave }));
export const pedirRevisaoOs = (id, texto, chave, versao) => (detalheViaJavaAtivo()
  ? pedirRevisaoJava(id, versao, chave, texto)
  : neon.rpc('pedir_revisao_os', { p_os_id: id, p_texto: texto, p_operation_key: chave }));
export const gerarProxima = (id, chave) => neon.rpc('gerar_proxima_os', { p_os_id: id, p_operation_key: chave });

// --- Materiais -----------------------------------------------------------------
// J11: na demonstração local, as cinco operações de material gravam pela API Java; as que agem sobre um material ou um
// registro de uso recebem também o id da OS (`osId`, último argumento), que a API confere. Fora dela, nada muda.
export const adicionarMaterial = (id, variacaoId, quantidade, chave) => (detalheViaJavaAtivo()
  ? adicionarMaterialJava(id, chave, variacaoId, quantidade)
  : neon.rpc('adicionar_material_os', { p_os_id: id, p_variacao_id: variacaoId, p_quantidade: quantidade, p_operation_key: chave }));
export const reservarMaterial = (materialId, reservar, chave, osId) => (detalheViaJavaAtivo()
  ? reservarMaterialJava(osId, materialId, chave, reservar)
  : neon.rpc('reservar_material_os', { p_material_id: materialId, p_reservar: reservar, p_operation_key: chave }));
export const registrarUso = (id, variacaoId, quantidade, motivo, chave) => (detalheViaJavaAtivo()
  ? registrarUsoJava(id, chave, variacaoId, quantidade, motivo)
  : neon.rpc('registrar_uso_material', { p_os_id: id, p_variacao_id: variacaoId, p_quantidade: quantidade, p_motivo: motivo || null, p_operation_key: chave }));
export const decidirUso = (usoId, aprovar, motivo, versao, chave, osId) => (detalheViaJavaAtivo()
  ? decidirUsoJava(osId, usoId, versao, chave, aprovar, motivo)
  : neon.rpc('decidir_uso_material', { p_uso_id: usoId, p_aprovar: aprovar, p_motivo: motivo || null, p_expected_version: versao, p_operation_key: chave }));
export const devolverMaterial = (materialId, quantidade, motivo, chave, osId) => (detalheViaJavaAtivo()
  ? devolverMaterialJava(osId, materialId, chave, quantidade, motivo)
  : neon.rpc('devolver_material_os', { p_material_id: materialId, p_quantidade: quantidade, p_motivo: motivo, p_operation_key: chave }));

// --- Financeiro ----------------------------------------------------------------
export const gerarSinal = (id, valorCentavos, vencimento, chave) =>
  neon.rpc('gerar_antecipacao_os', { p_os_id: id, p_valor_centavos: valorCentavos, p_vencimento: vencimento || null, p_operation_key: chave });
export const reparcelar = (id, parcelas, chave) => neon.rpc('reparcelar_titulo_os', { p_os_id: id, p_parcelas: parcelas, p_operation_key: chave });

// --- Cancelamento e custos -----------------------------------------------------
export const politicaCancelamento = (empresaId) => neon.rpc('politica_cancelamento', { p_empresa_id: empresaId });
export const salvarPolitica = (empresaId, texto, chave) => neon.rpc('salvar_politica_cancelamento', { p_empresa_id: empresaId, p_texto: texto, p_operation_key: chave });
export const cancelarOs = (id, motivo, aPedidoDoCliente, chave) =>
  neon.rpc('cancelar_os', { p_os_id: id, p_motivo: motivo || null, p_a_pedido_do_cliente: Boolean(aPedidoDoCliente), p_operation_key: chave });
export const proporCustos = (id, itens, justificativa, chave) =>
  neon.rpc('propor_custos_cancelamento', { p_os_id: id, p_itens: itens, p_justificativa: justificativa, p_operation_key: chave });
export const responderCustos = (propostaId, aceitar, contestacao, versao, chave) =>
  neon.rpc('responder_custos', { p_proposta_id: propostaId, p_aceitar: aceitar, p_contestacao: contestacao || null, p_expected_version: versao, p_operation_key: chave });
export const revisarCustos = (propostaId, itens, justificativa, versao, chave) =>
  neon.rpc('revisar_custos', { p_proposta_id: propostaId, p_itens: itens, p_justificativa: justificativa, p_expected_version: versao, p_operation_key: chave });
export const retirarCustos = (propostaId, motivo, versao, chave) =>
  neon.rpc('retirar_custos', { p_proposta_id: propostaId, p_motivo: motivo, p_expected_version: versao, p_operation_key: chave });
export const registrarAcordo = (propostaId, valorCentavos, texto, concordancia, versao, chave) =>
  neon.rpc('registrar_acordo_custos', { p_proposta_id: propostaId, p_valor_centavos: valorCentavos, p_texto: texto, p_concordancia_informada: Boolean(concordancia),
    p_expected_version: versao, p_operation_key: chave });
export const gerarTituloCustos = (propostaId, vencimento, chave) =>
  neon.rpc('gerar_titulo_custos', { p_proposta_id: propostaId, p_vencimento: vencimento || null, p_operation_key: chave });

// --- Agenda --------------------------------------------------------------------
export const agendaOperacional = (empresaId, de = null, ate = null, responsavel = null) =>
  neon.rpc('agenda_operacional', { p_empresa_id: empresaId, p_de: de, p_ate: ate, p_responsavel: responsavel || null });
export const proporHorario = (id, inicio, duracaoMin, motivo, aceitarAvisos, justificativa, concordancia, chave) =>
  neon.rpc('propor_horario_os', { p_os_id: id, p_inicio: inicio, p_duracao_min: duracaoMin, p_motivo: motivo || null, p_aceitar_avisos: aceitarAvisos,
    p_justificativa: justificativa || null, p_concordancia_informada: Boolean(concordancia), p_operation_key: chave });
export const pedirReagendamento = (id, inicio, duracaoMin, motivo, excepcional, chave) =>
  neon.rpc('pedir_reagendamento_os', { p_os_id: id, p_inicio: inicio, p_duracao_min: duracaoMin || null, p_motivo: motivo,
    p_justificativa_excepcional: excepcional || null, p_operation_key: chave });
export const responderReagendamento = (reagId, aceitar, motivo, aceitarAvisos, justificativa, chave) =>
  neon.rpc('responder_reagendamento', { p_reagendamento_id: reagId, p_aceitar: aceitar, p_motivo: motivo || null, p_aceitar_avisos: Boolean(aceitarAvisos),
    p_justificativa: justificativa || null, p_operation_key: chave });
export const retirarReagendamento = (reagId, chave) => neon.rpc('retirar_reagendamento', { p_reagendamento_id: reagId, p_operation_key: chave });
export const cancelarHorario = (id, motivo, chave) => neon.rpc('cancelar_horario_os', { p_os_id: id, p_motivo: motivo, p_operation_key: chave });

// --- Pacotes e conferência -----------------------------------------------------
export const salvarItensPacote = (servicoId, itens, versao, chave) =>
  neon.rpc('salvar_itens_pacote', { p_servico_id: servicoId, p_itens: itens, p_expected_version: versao, p_operation_key: chave });
export const reconciliarOrdens = (empresaId) => neon.rpc('reconciliar_os', { p_empresa_id: empresaId });

// --- Rótulos -------------------------------------------------------------------
export const ESTADO_OS = { aguardando_inicio: 'Aguardando início', em_execucao: 'Em execução', pausada: 'Pausada', concluida: 'Concluída',
  encerrada: 'Encerrada', cancelada: 'Cancelada' };
export const ACAO_OS = { iniciar: 'Iniciar', pausar: 'Pausar', retomar: 'Retomar', concluir: 'Informar conclusão', reabrir: 'Reabrir para revisão', encerrar: 'Encerrar' };
export const ACOES_POR_ESTADO = { aguardando_inicio: ['iniciar'], em_execucao: ['pausar', 'concluir'], pausada: ['retomar'], concluida: ['reabrir', 'encerrar'] };
export const SITUACAO_PAGAMENTO = { sem_cobranca: 'Sem cobrança registrada', pendente: 'Pendente', parcial: 'Parcialmente pago', pago: 'Pago' };
export const TIPO_CUSTO = { material_usado: 'Material usado', deslocamento: 'Deslocamento', mao_de_obra: 'Mão de obra executada', outro: 'Outro' };
export const ESTADO_CUSTO = { pendente: 'Aguardando resposta do cliente', aceita: 'Aceita pelo cliente', contestada: 'Contestada', revisada: 'Revisada (substituída)',
  retirada: 'Retirada pela empresa', acordo_proposto: 'Acordo aguardando o cliente', acordo: 'Acordo registrado' };
export const ESTADO_REAGENDAMENTO = { pendente: 'Aguardando resposta', aceito: 'Aceito', recusado: 'Recusado', retirado: 'Retirado', substituido: 'Substituído' };
export const RECORRENCIA = { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' };
export const ESTADOS_ATIVOS = ['aguardando_inicio', 'em_execucao', 'pausada'];
