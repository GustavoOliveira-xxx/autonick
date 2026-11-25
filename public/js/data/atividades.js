/** Atividades da empresa (E05): leitura do registro de auditoria filtrada pelo banco, e textos em linguagem simples. */
import { neon } from './sessao.js';

export const atividadesDaEmpresa = (empresaId, antes = null, limite = 30) =>
  neon.rpc('atividades_da_empresa', { p_empresa_id: empresaId, p_antes: antes, p_limite: limite });

const TEXTOS = {
  'venda.confirmada': 'confirmou uma venda', 'venda.cancelada': 'cancelou uma venda', 'venda.recebimento': 'registrou um recebimento de venda',
  'venda.recebimento_estornado': 'estornou um recebimento de venda', 'venda.valor_devolvido': 'devolveu um valor ao cliente',
  'pedido.aceito': 'aceitou um pedido', 'pedido.recusado': 'recusou um pedido', 'pedido.concluido': 'concluiu um pedido',
  'orcamentos.enviado': 'enviou um orçamento', 'orcamentos.aceito': 'registrou o aceite de um orçamento', 'orcamentos.recusado': 'registrou a recusa de um orçamento',
  'orcamentos.solicitacao_interna': 'registrou um pedido de orçamento de balcão', 'orcamentos.solicitacao_cancelada': 'cancelou uma solicitação de orçamento',
  'servicos.os_criada': 'abriu uma ordem de serviço', 'servicos.os_cancelada': 'cancelou uma ordem de serviço', 'servicos.garantia_registrada': 'registrou a garantia de uma OS',
  'servicos.criado': 'cadastrou um serviço', 'servicos.alterado': 'alterou um serviço', 'servicos.material_devolvido': 'devolveu material de uma OS ao estoque',
  'financeiro.lancamento': 'fez um lançamento no financeiro', 'financeiro.lancamento_estornado': 'estornou um lançamento', 'financeiro.pagamento': 'registrou um pagamento',
  'financeiro.pagamento_estornado': 'estornou um pagamento', 'financeiro.titulo_criado': 'criou uma conta a pagar ou receber', 'financeiro.transferencia': 'fez uma transferência entre contas',
  'financeiro.periodo_fechado': 'fechou um período do financeiro', 'financeiro.periodo_reaberto': 'reabriu um período do financeiro', 'financeiro.exportacao': 'exportou dados do financeiro',
  'estoque.movimentacao_aplicada': 'aplicou uma movimentação de estoque', 'produto.preco_alterado': 'alterou o preço de um produto', 'produto.custo_corrigido': 'corrigiu o custo de um produto',
  'produto.imagem_definida': 'trocou a imagem de um produto', 'agenda.horarios_salvos': 'salvou os horários de atendimento', 'agenda.horario_confirmado': 'confirmou um horário',
  'agenda.excecao_salva': 'registrou um feriado ou exceção na agenda', 'agenda.excecao_removida': 'removeu uma exceção da agenda',
  'agenda.compromisso_criado': 'criou um compromisso na agenda', 'agenda.compromisso_alterado': 'alterou um compromisso da agenda', 'agenda.compromisso_cancelado': 'cancelou um compromisso',
  'empresa.criada': 'cadastrou a empresa', 'empresa.alterada': 'alterou os dados da empresa', 'empresa.logo_definida': 'trocou a logo da empresa',
  'arquivo.enviado': 'enviou um arquivo',
  'empresa.meta_definida': 'definiu uma meta do mês', 'empresa.meta_removida': 'removeu uma meta do mês',
  'servicos.os_iniciar': 'iniciou uma ordem de serviço', 'servicos.os_pausar': 'pausou uma ordem de serviço', 'servicos.os_retomar': 'retomou uma ordem de serviço',
  'servicos.os_concluir': 'concluiu uma ordem de serviço', 'servicos.os_reabrir': 'reabriu uma ordem de serviço', 'servicos.os_encerrar': 'encerrou uma ordem de serviço',
  'servicos.os_encerrada_pelo_cliente': 'registrou o encerramento de uma OS pelo cliente', 'servicos.proxima_execucao': 'marcou a próxima execução de um serviço',
  'servicos.custos_propostos': 'propôs custos de cancelamento', 'servicos.custos_revisados': 'revisou custos de cancelamento', 'servicos.custos_retirados': 'retirou custos de cancelamento',
  'servicos.formulario_salvo': 'salvou o formulário de um serviço', 'servicos.regras_salvas': 'salvou as regras de preço de um serviço', 'servicos.pacote_salvo': 'salvou um pacote de serviço',
  'financeiro.titulo_de_servico': 'gerou uma conta a receber de serviço', 'financeiro.titulo_de_compra': 'gerou uma conta a pagar de compra',
  'financeiro.titulo_de_custos': 'gerou uma conta de custos de cancelamento', 'financeiro.titulo_cancelado': 'cancelou uma conta a pagar ou receber',
  'financeiro.titulo_reparcelado': 'reparcelou uma conta', 'financeiro.transferencia_estornada': 'estornou uma transferência',
  'financeiro.categoria_criada': 'criou uma categoria do financeiro', 'financeiro.categoria_alterada': 'alterou uma categoria do financeiro',
  'financeiro.conta_criada': 'cadastrou uma conta (caixa ou banco)', 'financeiro.conta_alterada': 'alterou uma conta (caixa ou banco)',
  'financeiro.conta_desativada': 'desativou uma conta (caixa ou banco)', 'financeiro.conta_reativada': 'reativou uma conta (caixa ou banco)', 'financeiro.conta_padrao': 'mudou a conta padrão',
  'financeiro.recorrencia_criada': 'criou uma despesa recorrente', 'financeiro.recorrencia_alterada': 'alterou uma despesa recorrente',
  'financeiro.recorrencia_pausada': 'pausou uma despesa recorrente', 'financeiro.recorrencia_retomada': 'retomou uma despesa recorrente',
  'financeiro.recorrencias_geradas': 'gerou as contas recorrentes do mês', 'financeiro.diferenca_caixa': 'registrou uma diferença de caixa', 'arquivo.removido': 'removeu um arquivo', 'perfil.limite_desconto': 'mudou o limite de desconto de um perfil',
};

export function textoAtividade(a) {
  if (TEXTOS[a.tipo]) return TEXTOS[a.tipo];
  const [area, acao = ''] = a.tipo.split('.');
  return `registrou "${acao.replaceAll('_', ' ') || area}" em ${area.replaceAll('_', ' ')}`;
}

export function linkAtividade(empresaId, a) {
  const id = encodeURIComponent(empresaId);
  const r = a.recurso_id ? encodeURIComponent(a.recurso_id) : null;
  if (!r && a.recurso_tipo !== 'empresas') return null;
  switch (a.recurso_tipo) {
    case 'vendas': return `/business/venda.html?id=${id}&venda=${r}`;
    case 'ordens_servico': return `/business/ordem.html?id=${id}&os=${r}`;
    case 'solicitacoes_servico': return `/business/solicitacao.html?id=${id}&solicitacao=${r}`;
    case 'produtos': return `/business/produto.html?id=${id}&produto=${r}`;
    case 'servicos': return `/business/servico.html?id=${id}&servico=${r}`;
    case 'compromissos_agenda': case 'excecoes_agenda': case 'agendamentos': return `/business/agenda.html?id=${id}`;
    case 'empresas': return `/business/empresa.html?id=${id}`;
    default: return null;
  }
}
