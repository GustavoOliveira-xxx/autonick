/**
 * Utilidades das telas do M09 (ordens de serviço), da empresa e do cliente. A tela só orienta e esconde o que a pessoa
 * não pode fazer; quem decide é o banco. Textos de valores sempre lembram que o registro é da empresa (D9-25).
 */
import { el } from '../../ui/dom.js';
import { textoHorario } from '../../domain/servicos.js';
import { formatarDataHora } from '../empresa/comum.js';
import { ESTADO_OS, SITUACAO_PAGAMENTO, TIPO_CUSTO, ESTADO_CUSTO, ESTADO_REAGENDAMENTO } from '../../data/ordens.js';
import { dinheiro, formatarData } from './comum.js';

const chip = (classe, icone, texto) => el('span', { class: `chip ${classe}` }, el('span', { 'aria-hidden': 'true' }, icone), texto);
const CLASSE = { aguardando_inicio: 'chip--info', em_execucao: 'chip--alerta', pausada: 'chip--neutro', concluida: 'chip--sucesso', encerrada: 'chip--neutro',
  cancelada: 'chip--erro' };
export const chipOs = (e) => chip(CLASSE[e] ?? 'chip--neutro', e === 'concluida' || e === 'encerrada' ? '✓' : e === 'cancelada' ? '×' : '•', ESTADO_OS[e] ?? e);

/** Valor contratado e situação do pagamento registrada pela empresa (D9-25). */
export function blocoValores(v, interno = false) {
  return el('div', { class: 'cartao pilha', id: 'valores' },
    el('dl', { class: 'dados' },
      el('dt', {}, 'Valor contratado'), el('dd', {}, el('strong', { 'data-contratado': '' }, dinheiro(v.contratado_centavos))),
      el('dt', {}, 'Pagamento'), el('dd', { 'data-situacao': v.situacao }, SITUACAO_PAGAMENTO[v.situacao] ?? v.situacao),
      el('dt', {}, 'Recebido'), el('dd', {}, dinheiro(v.recebido_centavos)),
      el('dt', {}, 'Saldo pendente'), el('dd', {}, dinheiro(v.saldo_pendente_centavos)),
      v.a_devolver_centavos ? el('dt', {}, 'A devolver') : null, v.a_devolver_centavos ? el('dd', { 'data-a-devolver': '' }, dinheiro(v.a_devolver_centavos)) : null,
      interno ? el('dt', {}, 'Sinal') : null, interno ? el('dd', {}, dinheiro(v.antecipado_centavos)) : null,
      interno ? el('dt', {}, 'Ainda sem conta a receber') : null, interno ? el('dd', {}, dinheiro(v.a_titular_centavos)) : null),
    el('p', { class: 'campo__ajuda' }, v.aviso));
}

const TIPO_EVENTO = { criada: 'Ordem de serviço criada', iniciar: 'Serviço iniciado', pausar: 'Serviço pausado', pausa_publica: 'Serviço pausado',
  retomar: 'Serviço retomado', concluir: 'Conclusão informada pela empresa', reabrir: 'Reaberto para revisão', encerrar: 'Encerrado pela empresa',
  recebimento_confirmado: 'Recebimento confirmado pelo cliente', revisao_pedida: 'Revisão pedida pelo cliente', atualizacao: 'Atualização',
  nota_interna: 'Nota interna', dados_atualizados: 'Dados da OS alterados', previsao: 'Previsão de conclusão', garantia: 'Garantia registrada',
  material_previsto: 'Material previsto', material_reservado: 'Material reservado', reserva_liberada: 'Reserva desfeita', material_usado: 'Material baixado',
  uso_proposto: 'Uso de material registrado (aguarda confirmação)', uso_confirmado: 'Uso de material confirmado', uso_recusado: 'Uso de material recusado',
  material_devolvido: 'Material devolvido ao estoque', sinal_registrado: 'Sinal registrado', cancelada: 'Ordem de serviço cancelada',
  custos_propostos: 'Custos de cancelamento propostos', custos_aceita: 'Custos aceitos pelo cliente', custos_contestada: 'Custos contestados',
  custos_revisados: 'Proposta de custos revisada', custos_retirados: 'Proposta de custos retirada', custos_acordo_proposto: 'Acordo proposto',
  custos_acordo: 'Acordo registrado', custos_titulados: 'Conta a receber dos custos criada', horario_proposto: 'Horário proposto pela empresa',
  horario_definido: 'Horário definido', aviso_horario_aceito: 'Aviso de horário confirmado', reagendamento_pedido: 'Outro horário pedido pelo cliente',
  reagendamento_aceito: 'Novo horário aceito', reagendamento_recusado: 'Horário recusado', reagendamento_retirado: 'Proposta de horário retirada',
  horario_cancelado: 'Horário cancelado (a OS continua)', proxima_gerada: 'Próxima execução gerada' };

export function linhaDoTempoOs(eventos) {
  return el('ol', { class: 'pilha', id: 'linha-do-tempo' }, ...eventos.map((e) => el('li', { class: `cartao${e.interno ? ' cartao--interno' : ''}`, 'data-evento': e.tipo },
    el('p', {}, el('strong', {}, TIPO_EVENTO[e.tipo] ?? e.tipo), ` · ${e.autor} · ${formatarDataHora(e.criado_em)}`, e.interno ? ' · só a equipe vê' : ''),
    e.texto ? el('p', {}, e.texto) : null,
    e.dados?.inicio && e.dados?.fim ? el('p', {}, textoHorario(e.dados.inicio, e.dados.fim)) : null)));
}

/** Horário confirmado (o atual vale até um novo ser aceito: D9-19). */
export function blocoHorarioOs(h) {
  if (!h) return el('p', { id: 'horario' }, 'Sem horário confirmado.');
  return el('div', { class: 'cartao pilha', id: 'horario' }, el('p', {}, el('strong', {}, 'Horário combinado: '), textoHorario(h.inicio, h.fim)),
    h.menos_de_24h ? el('p', { class: 'campo__ajuda', 'data-menos-24h': '' }, 'Atenção: faltam menos de 24 horas.') : null,
    el('p', { class: 'campo__ajuda' }, h.aviso));
}

export function itemReagendamento(g, acoes = []) {
  return el('li', { class: 'cartao pilha', 'data-reagendamento': g.estado },
    el('p', {}, el('strong', {}, `${g.proposto_por === 'empresa' ? 'Proposta da empresa' : 'Pedido do cliente'}: `), textoHorario(g.inicio, g.fim),
      ` · ${ESTADO_REAGENDAMENTO[g.estado] ?? g.estado}`),
    g.motivo ? el('p', {}, `Motivo: ${g.motivo}`) : null,
    g.resposta_motivo ? el('p', {}, `Resposta: ${g.resposta_motivo}`) : null,
    g.menos_de_24h && g.estado === 'pendente' ? el('p', { class: 'campo__ajuda' }, 'Faltam menos de 24 horas para este horário.') : null,
    g.avisos?.length ? el('p', { class: 'campo__ajuda' }, `Avisos: ${g.avisos.map((a) => a.mensagem).join(' ')}`) : null,
    acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
}

export function cartaoCustos(p, acoes = []) {
  return el('section', { class: 'cartao pilha', 'data-proposta': p.numero, 'aria-labelledby': `proposta-${p.numero}` },
    el('h3', { id: `proposta-${p.numero}` }, `Proposta de custos ${p.numero}: ${ESTADO_CUSTO[p.estado] ?? p.estado}`),
    el('div', { class: 'tabela-container' }, el('table', { class: 'tabela' },
      el('caption', { class: 'visualmente-oculto' }, `Itens da proposta ${p.numero}`),
      el('thead', {}, el('tr', {}, ...['Item', 'Tipo', 'Justificativa', 'Valor'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...p.itens.map((i) => el('tr', {}, el('th', { scope: 'row' }, i.descricao), el('td', { 'data-rotulo': 'Tipo' }, TIPO_CUSTO[i.tipo] ?? i.tipo),
        el('td', { 'data-rotulo': 'Justificativa' }, i.justificativa), el('td', { 'data-rotulo': 'Valor', class: 'numero' }, dinheiro(i.valor_centavos))))))),
    el('dl', { class: 'dados' }, el('dt', {}, 'Total proposto'), el('dd', {}, el('strong', {}, dinheiro(p.total_centavos))),
      el('dt', {}, 'Justificativa'), el('dd', {}, p.justificativa),
      p.contestacao ? el('dt', {}, 'Contestação do cliente') : null, p.contestacao ? el('dd', {}, p.contestacao) : null,
      p.acordo_texto ? el('dt', {}, 'Acordo') : null, p.acordo_texto ? el('dd', {}, `${dinheiro(p.acordo_valor_centavos)}: ${p.acordo_texto}`) : null,
      p.motivo_retirada ? el('dt', {}, 'Motivo da retirada') : null, p.motivo_retirada ? el('dd', {}, p.motivo_retirada) : null),
    el('p', { class: 'campo__ajuda' }, p.aviso),
    acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
}

export function blocoCancelamento(c) {
  if (!c) return null;
  return el('div', { class: 'cartao pilha', id: 'cancelamento' },
    el('p', {}, el('strong', {}, 'Cancelada '), `${c.solicitado_por === 'cliente' ? 'a pedido do cliente' : 'pela empresa'} em ${formatarDataHora(c.criado_em)}.`),
    c.motivo ? el('p', {}, `Motivo: ${c.motivo}`) : null,
    c.aviso_arrependimento ? el('p', { class: 'campo__ajuda', 'data-arrependimento': '' }, c.aviso_arrependimento) : null,
    !c.tinha_condicoes ? el('p', { class: 'campo__ajuda' }, 'O orçamento aceito não trazia condições de cancelamento: não há custos a cobrar.') : null);
}

export function blocoGarantia(g) {
  if (!g) return null;
  return el('div', { class: 'cartao pilha', id: 'garantia' }, el('p', {}, el('strong', {}, 'Garantia: '), `${g.dias} dias, até ${formatarData(g.ate)}.`),
    g.condicoes ? el('p', {}, g.condicoes) : null, el('p', { class: 'campo__ajuda' }, g.aviso));
}

export function blocoCondicoes(cc) {
  if (!cc?.politica && !cc?.condicoes) return el('p', { id: 'condicoes-cancelamento' }, 'O orçamento aceito não tinha condições de cancelamento.');
  return el('div', { class: 'cartao pilha', id: 'condicoes-cancelamento' },
    cc.politica ? el('p', {}, el('strong', {}, `Política de cancelamento (versão ${cc.politica.versao}): `), cc.politica.texto) : null,
    cc.condicoes ? el('p', {}, el('strong', {}, 'Condições do orçamento: '), cc.condicoes) : null,
    el('p', { class: 'campo__ajuda' }, 'Condições aceitas no orçamento. Elas não prevalecem sobre direitos previstos em lei.'));
}
