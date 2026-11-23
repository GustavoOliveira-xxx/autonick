/**
 * Utilidades das telas do M08 (serviços, orçamentos e agenda básica), da empresa e do cliente.
 * A tela só orienta e esconde o que a pessoa não pode fazer; quem decide é o banco.
 */
import { el } from '../../ui/dom.js';
import { campoTexto, campoSelecao, grupoOpcoes } from '../../ui/formulario.js';
import { formatarCentavos } from '../../domain/moeda.js';
import { textoEstimativa, textoResposta, textoValidade, textoHorario, ajudaEstimativaCliente } from '../../domain/servicos.js';
import { ESTADO_SOLICITACAO, ESTADO_SOLICITACAO_CLIENTE, ESTADO_VERSAO, TIPO_COMPONENTE, TURNO, DIAS } from '../../data/servicos.js';
import { formatarDataHora } from '../empresa/comum.js';

export { carregarContexto, navegacaoEmpresa, criarAnunciador, criarExecutor, novaChave } from '../estoque/comum.js';
export { dataDeHoje, somarDias, formatarData, dialogoFormulario } from '../vendas/comum.js';

export const dinheiro = (c) => (Number.isSafeInteger(c) ? formatarCentavos(c) : '');
const chip = (classe, icone, texto) => el('span', { class: `chip ${classe}` }, el('span', { 'aria-hidden': 'true' }, icone), texto);
const CLASSE = { nova: 'chip--alerta', em_analise: 'chip--info', orcamento_enviado: 'chip--info', revisao_pedida: 'chip--alerta', aceita: 'chip--sucesso',
  recusada: 'chip--erro', cancelada: 'chip--neutro', vencido: 'chip--erro', rascunho: 'chip--neutro', aguardando_aprovacao: 'chip--alerta',
  enviada: 'chip--info', substituida: 'chip--neutro', vencida: 'chip--erro' };
export const chipSolicitacao = (e, cliente = false) => chip(CLASSE[e] ?? 'chip--neutro', e === 'aceita' ? '✓' : '•',
  (cliente ? ESTADO_SOLICITACAO_CLIENTE : ESTADO_SOLICITACAO)[e] ?? e);
export const chipVersao = (e) => chip(CLASSE[e] ?? 'chip--neutro', e === 'aceita' ? '✓' : '•', ESTADO_VERSAO[e] ?? e);

/** Campos do formulário do serviço (D8-06), acessíveis, com nome `p-<id>`. */
export function camposDoFormulario(perguntas, prefixo = 'f') {
  return perguntas.map((p) => {
    const nome = `p-${p.id}`;
    const id = `${prefixo}-${p.id}`;
    const ajuda = [p.ajuda, p.tipo === 'numero' && p.configuracao?.unidade ? `Em ${p.configuracao.unidade}.` : null,
      p.tipo === 'numero' && (p.configuracao?.minimo !== undefined || p.configuracao?.maximo !== undefined)
        ? `De ${p.configuracao.minimo ?? 0} a ${p.configuracao.maximo ?? 'sem limite'}.` : null].filter(Boolean).join(' ') || null;
    if (p.tipo === 'escolha_unica') return campoSelecao({ nome, rotulo: p.texto, opcoes: p.configuracao.opcoes.map((o) => [o, o]), obrigatorio: p.obrigatoria, ajuda, id });
    if (p.tipo === 'escolha_multipla') {
      const g = grupoOpcoes({ nome, legenda: `${p.texto}${p.obrigatoria ? ' (obrigatório)' : ''}`, tipo: 'checkbox', opcoes: p.configuracao.opcoes.map((o) => [o, o]), ajuda });
      return g;
    }
    if (p.tipo === 'sim_nao') return grupoOpcoes({ nome, legenda: `${p.texto}${p.obrigatoria ? ' (obrigatório)' : ''}`, opcoes: [['sim', 'Sim'], ['nao', 'Não']], ajuda });
    const c = campoTexto({ nome, rotulo: p.texto, obrigatorio: p.obrigatoria, ajuda, id, linhas: p.tipo === 'texto_longo' ? 3 : 0,
      max: p.tipo === 'texto_curto' ? 120 : p.tipo === 'texto_longo' ? 1000 : null, tipo: p.tipo === 'numero' ? 'text' : 'text' });
    if (p.tipo === 'numero') c.querySelector('input').setAttribute('inputmode', 'decimal');
    return c;
  });
}

/** Estimativa com rótulo fixo de não definitiva (RF-095) e a base do cálculo. */
// Na área da empresa o texto continua o do banco; na do Cliente segue `ajudaEstimativaCliente` (P-M11-02).
export function blocoEstimativa(e, id = 'estimativa', { cliente = false, orcamentoDisponivel = false } = {}) {
  if (!e) return el('div', { id });
  const ajuda = cliente ? ajudaEstimativaCliente(e, { orcamentoDisponivel }) : (e.rotulo ?? 'Estimativa, não é o valor final.');
  return el('div', { class: 'cartao pilha', id, role: 'status' },
    el('p', {}, el('strong', {}, 'Estimativa: '), textoEstimativa(e)),
    ajuda ? el('p', { class: 'campo__ajuda', 'data-ajuda-estimativa': '' }, ajuda) : null,
    e.base?.length ? el('details', {}, el('summary', {}, 'Como foi calculada'),
      el('ul', {}, ...e.base.map((b) => el('li', {}, `${b.rotulo}: ${dinheiro(b.valor_centavos)}`)))) : null,
    e.faltando?.length ? el('p', { class: 'campo__ajuda' }, `Faltam: ${e.faltando.map((f) => f.texto).join(', ')}.`) : null);
}

export function blocoRespostas(s) {
  return el('dl', { class: 'dados', id: 'respostas' },
    ...s.respostas.flatMap((r) => [el('dt', {}, r.texto), el('dd', {}, textoResposta(r))]),
    el('dt', {}, 'Relato'), el('dd', {}, s.relato),
    s.cidade || s.bairro ? el('dt', {}, 'Região') : null, s.cidade || s.bairro ? el('dd', {}, [s.bairro, s.cidade].filter(Boolean).join(', ')) : null,
    s.preferencia ? el('dt', {}, 'Preferência de horário') : null,
    s.preferencia ? el('dd', {}, [s.preferencia.datas?.map((d) => d.split('-').reverse().join('/')).join(', '), TURNO[s.preferencia.turno],
      s.preferencia.observacao].filter(Boolean).join(' · '), ' (não é reserva)') : null);
}

/** Cartão de uma versão do orçamento (para o cliente, sem dados internos: o banco já não os envia). */
export function cartaoVersao(v, hoje, acoes = []) {
  return el('section', { class: 'cartao pilha', 'data-versao': v.numero, 'aria-labelledby': `versao-${v.numero}` },
    el('h3', { id: `versao-${v.numero}` }, `Versão ${v.numero}${v.tipo === 'automatico' ? ' (gerada pelas regras da empresa)' : ''} `, chipVersao(v.estado_exibicao ?? v.estado)),
    el('div', { class: 'tabela-container' }, el('table', { class: 'tabela' },
      el('caption', { class: 'visualmente-oculto' }, `Itens da versão ${v.numero}`),
      el('thead', {}, el('tr', {}, ...['Item', 'Tipo', 'Quantidade', 'Valor unitário', 'Desconto', 'Total'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...v.componentes.map((c) => el('tr', {}, el('th', { scope: 'row' }, c.descricao, c.produto ? el('span', { class: 'campo__ajuda' }, ` (catálogo: ${c.produto}${c.uso_interno ? ', uso interno' : ''})`) : null),
        el('td', { 'data-rotulo': 'Tipo' }, TIPO_COMPONENTE[c.tipo] ?? c.tipo), el('td', { 'data-rotulo': 'Quantidade' }, String(c.quantidade).replace('.', ',')),
        el('td', { 'data-rotulo': 'Valor unitário', class: 'numero' }, dinheiro(c.valor_unitario_centavos)),
        el('td', { 'data-rotulo': 'Desconto', class: 'numero' }, c.desconto_centavos ? dinheiro(c.desconto_centavos) : ''),
        el('td', { 'data-rotulo': 'Total', class: 'numero' }, dinheiro(c.total_centavos))))))),
    el('dl', { class: 'dados' },
      v.desconto_geral_centavos ? el('dt', {}, 'Desconto geral') : null, v.desconto_geral_centavos ? el('dd', {}, dinheiro(v.desconto_geral_centavos)) : null,
      el('dt', {}, 'Total'), el('dd', {}, el('strong', { 'data-total': v.numero }, dinheiro(v.total_centavos))),
      el('dt', {}, 'Validade'), el('dd', {}, textoValidade(v.valido_ate, hoje)),
      v.prazo_execucao ? el('dt', {}, 'Prazo de execução') : null, v.prazo_execucao ? el('dd', {}, v.prazo_execucao) : null,
      v.condicoes ? el('dt', {}, 'Condições') : null, v.condicoes ? el('dd', {}, v.condicoes) : null,
      v.criada_por ? el('dt', {}, 'Preparada por') : null, v.criada_por ? el('dd', {}, v.criada_por, v.aprovada_por && v.aprovada_por !== v.criada_por ? `; aprovada por ${v.aprovada_por}` : '') : null,
      Number.isFinite(v.desconto_percentual) && v.desconto_percentual > 0 ? el('dt', {}, 'Desconto total') : null,
      Number.isFinite(v.desconto_percentual) && v.desconto_percentual > 0 ? el('dd', {}, `${String(v.desconto_percentual).replace('.', ',')}%`) : null),
    acoes.length ? el('div', { class: 'grupo-botoes' }, ...acoes) : null);
}

const TIPO_EVENTO = { criada: 'Solicitação enviada', em_analise: 'Empresa começou a analisar', orcamento_automatico: 'Orçamento gerado pelas regras',
  versao_enviada: 'Orçamento enviado', aguardando_aprovacao: 'Versão aguardando aprovação interna', mensagem: 'Mensagem', nota_interna: 'Nota interna',
  revisao_pedida: 'Revisão pedida', horario_confirmado: 'Horário definido pela empresa', horario_alterado: 'Horário alterado pela empresa',
  aviso_horario_aceito: 'Aviso de horário confirmado', aceita: 'Orçamento aceito', recusada: 'Orçamento recusado', cancelada: 'Solicitação cancelada' };

export function linhaDoTempo(eventos) {
  return el('ol', { class: 'pilha', id: 'linha-do-tempo' }, ...eventos.map((e) => el('li', { class: `cartao${e.interno ? ' cartao--interno' : ''}`, 'data-evento': e.tipo },
    el('p', {}, el('strong', {}, TIPO_EVENTO[e.tipo] ?? e.tipo), ` · ${e.autor} · ${formatarDataHora(e.criado_em)}`, e.interno ? ' · só a equipe vê' : ''),
    e.texto ? el('p', {}, e.texto) : null,
    e.dados?.inicio ? el('p', {}, textoHorario(e.dados.inicio, e.dados.fim)) : null,
    e.dados?.total_centavos ? el('p', {}, `Versão ${e.dados.versao}: ${dinheiro(e.dados.total_centavos)}`) : null)));
}

export function blocoHorario(h) {
  if (!h) return el('p', { id: 'horario' }, 'Ainda sem horário definido. A empresa confirma depois; nada é reservado no envio.');
  return el('div', { class: 'cartao pilha', id: 'horario' }, el('p', {}, el('strong', {}, 'Horário: '), textoHorario(h.inicio, h.fim)),
    el('p', { class: 'campo__ajuda' }, h.aviso ?? 'Horário definido pela empresa.'));
}

export function gradeTexto(grade) {
  return el('dl', { class: 'dados', id: 'horarios-gerais' }, ...grade.flatMap((d) => [el('dt', {}, DIAS[d.dia_semana]),
    el('dd', {}, d.intervalos.length ? d.intervalos.map((i) => `${i.abre} às ${i.fecha}`).join(' e ') : 'Fechado')]));
}
