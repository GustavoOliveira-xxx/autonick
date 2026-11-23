/**
 * Montagem dos documentos em PDF (M13, D13-08 = B): os 5 relatórios financeiros da tela e os comprovantes internos de
 * orçamento aceito, resumo da OS e pedido ou venda. Usa só os dados que a tela já recebeu do banco (autorizados por ele);
 * nunca acrescenta e-mail, telefone, endereço, documento, custo nem nota interna. Funções puras, testadas na unidade.
 */
import { formatarCentavos } from '../domain/moeda.js';
import { formatarDataHora, formatarDataCivil } from '../domain/tempo.js';
import { NATUREZA, TIPO_CONTA, mesPorExtenso } from '../domain/financeiro.js';

export const NOTA_COMPROVANTE = 'Documento interno, sem valor fiscal.';
export const NOTA_RELATORIO = 'Relatório interno de gestão, sem valor fiscal. O AutoniCK registra; não movimenta dinheiro.';
export const RODAPE = 'AutoniCK, versão de desenvolvimento: use apenas dados de teste.';

const dinheiro = (c) => (Number.isSafeInteger(c) ? formatarCentavos(c) : '');
const dia = (d) => { try { return d ? formatarDataCivil(String(d).slice(0, 10)) : ''; } catch { return ''; } };
const quando = (i) => { try { return i ? formatarDataHora(i) : ''; } catch { return ''; } };
const soma = (linhas, campo) => linhas.reduce((t, x) => t + (Number.isSafeInteger(x[campo]) ? x[campo] : 0), 0);
const cabecalho = ({ empresa, usuario, agora }, extras = []) => [
  `Empresa: ${empresa}`, ...extras, `Gerado em ${quando(agora.toISOString())} por ${usuario}.`];
const arquivo = (...partes) => `${partes.join('-').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.pdf`;

export const TITULOS_RELATORIO = {
  categorias: 'Entradas e saídas por categoria',
  contas: 'Movimento por conta',
  vencimentos: 'Vencimentos em aberto',
  mensal: 'Mês a mês',
  conferencias: 'Conferências do caixa físico',
};

/** Relatório financeiro (mesmas colunas da tela; totais onde a soma faz sentido). */
export function relatorioFinanceiro(r, ctx) {
  const L = r.linhas ?? [];
  let colunas;
  let linhas;
  let totais = [];
  if (r.tipo === 'categorias') {
    colunas = [{ rotulo: 'Categoria', peso: 3 }, { rotulo: 'Natureza', peso: 1.6 }, { rotulo: 'Entradas', peso: 1.6, direita: true },
      { rotulo: 'Saídas', peso: 1.6, direita: true }, { rotulo: 'Líquido', peso: 1.6, direita: true }, { rotulo: 'Lançamentos', peso: 1.2, direita: true }];
    linhas = L.map((x) => [x.categoria, NATUREZA[x.natureza] ?? x.natureza, dinheiro(x.entradas_centavos), dinheiro(x.saidas_centavos), dinheiro(x.liquido_centavos), String(x.lancamentos)]);
    if (L.length) totais = [['Total', '', dinheiro(soma(L, 'entradas_centavos')), dinheiro(soma(L, 'saidas_centavos')), dinheiro(soma(L, 'liquido_centavos')), String(soma(L, 'lancamentos'))]];
  } else if (r.tipo === 'contas') {
    colunas = [{ rotulo: 'Conta', peso: 2.6 }, { rotulo: 'Tipo', peso: 1.4 }, { rotulo: 'Saldo antes', peso: 1.6, direita: true }, { rotulo: 'Entradas', peso: 1.6, direita: true },
      { rotulo: 'Saídas', peso: 1.6, direita: true }, { rotulo: 'Saldo no fim', peso: 1.6, direita: true }];
    linhas = L.map((x) => [x.conta, TIPO_CONTA[x.tipo] ?? x.tipo, dinheiro(x.saldo_inicial_centavos), dinheiro(x.entradas_centavos), dinheiro(x.saidas_centavos), dinheiro(x.saldo_final_centavos)]);
    if (L.length) totais = [['Total', '', dinheiro(soma(L, 'saldo_inicial_centavos')), dinheiro(soma(L, 'entradas_centavos')), dinheiro(soma(L, 'saidas_centavos')), dinheiro(soma(L, 'saldo_final_centavos'))]];
  } else if (r.tipo === 'vencimentos') {
    colunas = [{ rotulo: 'Faixa', peso: 2.4 }, { rotulo: 'Tipo', peso: 1.4 }, { rotulo: 'Parcelas', peso: 1, direita: true }, { rotulo: 'Valor em aberto', peso: 1.8, direita: true }];
    linhas = L.map((x) => [x.faixa, x.tipo === 'pagar' ? 'A pagar' : 'A receber', String(x.parcelas), dinheiro(x.saldo_centavos)]);
    const de = (tipo) => L.filter((x) => x.tipo === tipo);
    if (L.length) totais = [['Total a receber', '', String(soma(de('receber'), 'parcelas')), dinheiro(soma(de('receber'), 'saldo_centavos'))],
      ['Total a pagar', '', String(soma(de('pagar'), 'parcelas')), dinheiro(soma(de('pagar'), 'saldo_centavos'))]];
  } else if (r.tipo === 'conferencias') {
    colunas = [{ rotulo: 'Mês', peso: 1.6 }, { rotulo: 'Caixa', peso: 1.4 }, { rotulo: 'Registrado', peso: 1.3, direita: true }, { rotulo: 'Contado', peso: 1.3, direita: true },
      { rotulo: 'Diferença', peso: 1.3, direita: true }, { rotulo: 'Motivo', peso: 1.8 }, { rotulo: 'Conferido por', peso: 1.5 }, { rotulo: 'Quando', peso: 1.4 }];
    linhas = L.map((x) => [mesPorExtenso(x.mes) + (x.estado_fechamento === 'reaberto' ? ' (fechamento reaberto)' : ''), x.conta, dinheiro(x.esperado_centavos),
      dinheiro(x.contado_centavos), x.diferenca_centavos ? dinheiro(x.diferenca_centavos) : 'sem diferença', x.motivo ?? '', x.conferido_por ?? '', quando(x.conferido_em)]);
  } else {
    colunas = [{ rotulo: 'Mês', peso: 2 }, { rotulo: 'Receitas recebidas', peso: 1.8, direita: true }, { rotulo: 'Despesas pagas', peso: 1.8, direita: true },
      { rotulo: 'Saldo no fim', peso: 1.8, direita: true }, { rotulo: 'Resultado estimado', peso: 1.9, direita: true }];
    linhas = L.map((x) => [mesPorExtenso(x.mes), dinheiro(x.resumo.fluxo.receitas_recebidas_centavos), dinheiro(x.resumo.fluxo.despesas_pagas_centavos),
      dinheiro(x.resumo.fluxo.saldo_final_centavos), x.resumo.resultado.disponivel ? dinheiro(x.resumo.resultado.resultado_estimado_centavos) : 'sem acesso a custos']);
    if (L.length) {
      totais = [['Total do período', dinheiro(L.reduce((t, x) => t + x.resumo.fluxo.receitas_recebidas_centavos, 0)),
        dinheiro(L.reduce((t, x) => t + x.resumo.fluxo.despesas_pagas_centavos, 0)), '', '']];
    }
  }
  const titulo = TITULOS_RELATORIO[r.tipo] ?? 'Relatório financeiro';
  return {
    titulo,
    linhas: cabecalho(ctx, [`Período: ${dia(r.periodo?.de)} a ${dia(r.periodo?.ate)}`]),
    nota: NOTA_RELATORIO,
    rodape: RODAPE,
    geradoEm: ctx.agora,
    blocos: [
      { tipo: 'tabela', titulo, colunas, linhas, totais, vazio: 'Nada no período escolhido.' },
      { tipo: 'texto', titulo: 'Como é calculado', paragrafos: [r.metodo, r.aviso].filter(Boolean) },
    ],
    arquivo: arquivo('relatorio', r.tipo, ctx.empresa, r.periodo?.de ?? '', r.periodo?.ate ?? ''),
  };
}

const ROTULO_COMPONENTE = { material: 'Material', mao_de_obra: 'Mão de obra', deslocamento: 'Deslocamento', outro: 'Outro' };
const tabelaComponentes = (v) => ({
  tipo: 'tabela', titulo: 'Itens do orçamento',
  colunas: [{ rotulo: 'Tipo', peso: 1.3 }, { rotulo: 'Descrição', peso: 3 }, { rotulo: 'Qtd.', peso: 0.8, direita: true },
    { rotulo: 'Valor unitário', peso: 1.5, direita: true }, { rotulo: 'Desconto', peso: 1.3, direita: true }, { rotulo: 'Total', peso: 1.5, direita: true }],
  linhas: (v.componentes ?? []).map((c) => [ROTULO_COMPONENTE[c.tipo] ?? c.tipo ?? '', c.descricao, c.quantidade === undefined || c.quantidade === null ? '' : String(c.quantidade),
    dinheiro(c.valor_unitario_centavos), dinheiro(c.desconto_centavos), dinheiro(c.total_centavos)]),
  totais: [['Subtotal', '', '', '', '', dinheiro(v.subtotal_centavos)],
    ['Descontos', '', '', '', '', dinheiro((v.desconto_itens_centavos ?? 0) + (v.desconto_geral_centavos ?? 0))],
    ['Total', '', '', '', '', dinheiro(v.total_centavos)]].filter((l) => l[5] !== ''),
  vazio: 'Sem itens.',
});

/** Comprovante do orçamento aceito (equipe com orcamentos.visualizar). */
export function comprovanteOrcamento(s, v, ctx) {
  const aceite = v.aceite ?? s.aceite ?? {};
  return {
    titulo: `Comprovante de orçamento aceito: solicitação nº ${s.numero}, versão ${v.numero}`,
    linhas: cabecalho(ctx),
    nota: NOTA_COMPROVANTE,
    rodape: RODAPE,
    geradoEm: ctx.agora,
    blocos: [
      { tipo: 'pares', titulo: 'Dados do atendimento', pares: [['Serviço', s.servico ?? ''], ['Cliente', s.cliente_nome ?? ''],
        ['Origem', s.origem === 'plataforma' ? 'Pedido pela plataforma' : 'Registrado pela empresa'],
        ['Orçamento', `Versão ${v.numero} (${v.tipo === 'automatico' ? 'gerado pelas regras da empresa' : 'feito pela empresa'})`],
        ['Aceito em', quando(aceite.aceito_em)], ['Válido até', dia(v.valido_ate)], ['Prazo de execução', v.prazo_execucao ?? '']]
        .filter(([, valor]) => valor) },
      tabelaComponentes(v),
      ...(v.condicoes ? [{ tipo: 'texto', titulo: 'Condições', paragrafos: [v.condicoes] }] : []),
    ],
    arquivo: arquivo('orcamento', ctx.empresa, `solicitacao-${s.numero}`, `versao-${v.numero}`),
  };
}

const ESTADO_OS = { aguardando_inicio: 'Aguardando início', em_execucao: 'Em execução', pausada: 'Pausada', concluida: 'Concluída',
  encerrada: 'Encerrada', cancelada: 'Cancelada' };
const SITUACAO = { sem_cobranca: 'Sem cobrança registrada', pendente: 'Pendente', parcial: 'Parcialmente pago', pago: 'Pago', a_devolver: 'Valor a devolver' };

/** Resumo da OS (equipe com servicos.visualizar). Só atualizações públicas; notas internas nunca entram. */
export function resumoOs(o, ctx) {
  const valores = o.valores ?? {};
  const atualizacoes = (o.eventos ?? []).filter((e) => !e.interno && e.tipo === 'atualizacao' && e.texto);
  return {
    titulo: `Resumo da ordem de serviço nº ${o.numero}`,
    linhas: cabecalho(ctx),
    nota: NOTA_COMPROVANTE,
    rodape: RODAPE,
    geradoEm: ctx.agora,
    blocos: [
      { tipo: 'pares', titulo: 'Dados da OS', pares: [['Serviço', o.servico ?? ''], ['Cliente', o.cliente_nome ?? ''],
        ['Solicitação', o.solicitacao_numero ? `nº ${o.solicitacao_numero}` : ''], ['Situação', ESTADO_OS[o.estado] ?? o.estado ?? ''],
        ['Aceita em', quando(o.aceita_em)], ['Iniciada em', quando(o.iniciada_em)], ['Concluída em', quando(o.concluida_em)],
        ['Encerrada em', quando(o.encerrada_em)], ['Cancelada em', quando(o.cancelada_em)],
        ['Garantia', o.garantia?.dias ? `${o.garantia.dias} dias${o.garantia.ate ? `, até ${dia(o.garantia.ate)}` : ''}` : '']]
        .filter(([, valor]) => valor) },
      ...(o.versao_aceita ? [{ ...tabelaComponentes(o.versao_aceita), titulo: `Orçamento aceito (versão ${o.versao_aceita.numero})` }] : []),
      { tipo: 'pares', titulo: 'Valores registrados', pares: [['Contratado', dinheiro(valores.contratado_centavos)], ['Recebido', dinheiro(valores.recebido_centavos)],
        ['Saldo pendente', dinheiro(valores.saldo_pendente_centavos)], ['A devolver', dinheiro(valores.a_devolver_centavos)],
        ['Situação', SITUACAO[valores.situacao] ?? valores.situacao ?? '']].filter(([, valor]) => valor) },
      ...(atualizacoes.length ? [{ tipo: 'tabela', titulo: 'Atualizações enviadas ao cliente', colunas: [{ rotulo: 'Quando', peso: 1.2 }, { rotulo: 'Atualização', peso: 4 }],
        linhas: atualizacoes.map((e) => [quando(e.criado_em), e.texto]) }] : []),
      ...(o.garantia?.condicoes ? [{ tipo: 'texto', titulo: 'Condições da garantia', paragrafos: [o.garantia.condicoes] }] : []),
    ],
    arquivo: arquivo('os', ctx.empresa, `numero-${o.numero}`),
  };
}

const ESTADO_VENDA = { confirmada: 'Confirmada', cancelada: 'Cancelada' };
const PAGAMENTO = { aberto: 'A receber', parcial: 'Recebido em parte', liquidado: 'Recebido', cancelado: 'Cancelado' };

/** Comprovante de pedido ou venda (equipe com vendas.visualizar). Sem custo dos itens. */
export function comprovanteVenda(v, ctx) {
  const itens = v.itens ?? [];
  return {
    titulo: `Comprovante ${v.origem === 'pedido' ? 'de pedido' : 'de venda'}: venda nº ${v.numero}`,
    linhas: cabecalho(ctx),
    nota: NOTA_COMPROVANTE,
    rodape: RODAPE,
    geradoEm: ctx.agora,
    blocos: [
      { tipo: 'pares', titulo: 'Dados', pares: [['Origem', v.origem === 'pedido' ? 'Pedido externo' : 'Balcão'], ['Cliente', v.cliente ?? 'Não informado'],
        ['Situação', ESTADO_VENDA[v.estado] ?? v.estado ?? ''], ['Confirmada em', quando(v.confirmada_em)],
        ['Cancelada em', quando(v.cancelada_em)], ['Pagamento', PAGAMENTO[v.pagamento?.estado] ?? ''],
        ['Recebido', dinheiro(v.pagamento?.recebido_centavos)], ['Em aberto', dinheiro(v.pagamento?.saldo_centavos)]]
        .filter(([, valor]) => valor) },
      { tipo: 'tabela', titulo: 'Itens', colunas: [{ rotulo: 'Produto', peso: 3 }, { rotulo: 'Qtd.', peso: 0.8, direita: true },
        { rotulo: 'Preço', peso: 1.4, direita: true }, { rotulo: 'Desconto', peso: 1.3, direita: true }, { rotulo: 'Valor', peso: 1.5, direita: true }],
        linhas: itens.map((i) => [`${i.produto}${i.variacao ? ` (${i.variacao})` : ''}`, String(i.quantidade), dinheiro(i.preco_centavos), dinheiro(i.desconto_centavos), dinheiro(i.valor_centavos)]),
        totais: [['Subtotal', '', '', '', dinheiro(v.subtotal_centavos)],
          ['Descontos', '', '', '', dinheiro((v.desconto_itens_centavos ?? 0) + (v.desconto_geral_centavos ?? 0))],
          ['Total', '', '', '', dinheiro(v.total_centavos)]].filter((l) => l[4] !== ''),
        vazio: 'Sem itens.' },
      ...((v.parcelas ?? []).length ? [{ tipo: 'tabela', titulo: 'Parcelas', colunas: [{ rotulo: 'Parcela', peso: 1 }, { rotulo: 'Vencimento', peso: 1.4 },
        { rotulo: 'Valor', peso: 1.4, direita: true }, { rotulo: 'Em aberto', peso: 1.4, direita: true }],
        linhas: v.parcelas.map((p) => [String(p.sequencia), dia(p.vencimento), dinheiro(p.valor_centavos), dinheiro(p.saldo_centavos)]) }] : []),
      ...(v.observacao ? [{ tipo: 'texto', titulo: 'Observação', paragrafos: [v.observacao] }] : []),
    ],
    arquivo: arquivo(v.origem === 'pedido' ? 'pedido' : 'venda', ctx.empresa, `numero-${v.numero}`),
  };
}
