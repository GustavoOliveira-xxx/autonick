/**
 * Painel financeiro (M07, UI-042; RF-133, RF-134; D7-08, D7-14, D7-15): saldos por conta, a receber e a pagar,
 * fluxo de caixa e resultado gerencial estimado, cada número com período, fonte e método. Ao abrir, gera as contas
 * recorrentes do mês que ainda não existem (sem processamento automático contínuo).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, valores, erroNoCampo, limparErros } from '../../ui/formulario.js';
import { painel as lerPainel, gerarRecorrencias } from '../../data/financeiro.js';
import { TIPO_CONTA, inicioDoMes, mesPorExtenso } from '../../domain/financeiro.js';
import { carregarFinanceiro, criarAnunciador, dinheiro, dataDeHoje, formatarData, avisoRegistro, erroDeCarga, dados } from './comum.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
let periodo = { de: inicioDoMes(dataDeHoje()), ate: dataDeHoje() };
let geradoNestaVisita = false;

function formPeriodo() {
  const form = el('form', { id: 'form-periodo', class: 'pilha', 'aria-label': 'Período dos indicadores' },
    el('div', { class: 'grade-filtros' },
      campoTexto({ nome: 'de', rotulo: 'De', tipo: 'date', valor: periodo.de, id: 'periodo-de' }),
      campoTexto({ nome: 'ate', rotulo: 'Até', tipo: 'date', valor: periodo.ate, id: 'periodo-ate' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao botao--secundario' }, 'Atualizar período')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const v = valores(form);
    if (!v.de || !v.ate) return erroNoCampo(form, v.de ? 'ate' : 'de', 'Informe as duas datas.');
    if (v.de > v.ate) return erroNoCampo(form, 'de', 'O início precisa ser antes do fim.');
    periodo = { de: v.de, ate: v.ate };
    return carregar();
  });
  return form;
}

const fonte = (texto) => el('p', { class: 'campo__ajuda' }, el('strong', {}, 'De onde vem: '), texto);

function secaoSaldos(p) {
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-saldos' },
    el('h2', { id: 'titulo-saldos' }, 'Saldos agora'),
    el('p', { class: 'numero-grande', id: 'consolidado' }, `Total da empresa: ${dinheiro(p.consolidado_centavos)}`),
    p.contas.length ? el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id: 'tabela-saldos' },
      el('caption', { class: 'visualmente-oculto' }, 'Saldo de cada conta ativa'),
      el('thead', {}, el('tr', {}, ...['Conta', 'Tipo', 'Saldo'].map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, ...p.contas.map((c) => el('tr', {},
        el('th', { scope: 'row' }, c.nome, c.padrao ? el('span', { class: 'chip chip--info chip--pequeno' }, 'padrão') : null),
        el('td', { 'data-rotulo': 'Tipo' }, TIPO_CONTA[c.tipo] ?? c.tipo),
        el('td', { class: 'numero', 'data-rotulo': 'Saldo' }, dinheiro(c.saldo_centavos))))))) : el('p', {}, 'Nenhuma conta ativa.'),
    fonte(p.fontes.contas));
}

function secaoAbertos(p) {
  const r = p.a_receber;
  const g = p.a_pagar;
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-abertos' },
    el('h2', { id: 'titulo-abertos' }, 'A receber e a pagar'),
    el('div', { class: 'grade-2' },
      el('div', { class: 'cartao pilha', id: 'cartao-receber' }, el('h3', {}, 'A receber'),
        dados([['Em aberto', dinheiro(r.aberto_centavos)], ['Vencido', `${dinheiro(r.vencido_centavos)} (${r.parcelas_vencidas} parcela${r.parcelas_vencidas === 1 ? '' : 's'})`]])),
      el('div', { class: 'cartao pilha', id: 'cartao-pagar' }, el('h3', {}, 'A pagar'),
        dados([['Em aberto', dinheiro(g.aberto_centavos)], ['Vencido', `${dinheiro(g.vencido_centavos)} (${g.parcelas_vencidas} parcela${g.parcelas_vencidas === 1 ? '' : 's'})`],
          ['Vence nos próximos 7 dias', dinheiro(g.vence_em_7_dias_centavos)], ['Previsto (recorrências dos próximos 3 meses)', dinheiro(p.previsto_a_pagar_centavos)]]))),
    p.devolucoes_a_fazer_centavos > 0 ? el('div', { role: 'status' }, aviso('alerta', `Valores a devolver a clientes de vendas canceladas: ${dinheiro(p.devolucoes_a_fazer_centavos)}.`)) : null,
    fonte(p.fontes.a_receber_a_pagar), fonte(p.fontes.previsto),
    el('p', {}, el('a', { href: `/business/financeiro-contas.html?id=${encodeURIComponent(ctx.id)}` }, 'Ver contas a pagar e a receber')));
}

function secaoFluxo(p) {
  const f = p.fluxo;
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-fluxo', id: 'secao-fluxo' },
    el('h2', { id: 'titulo-fluxo' }, 'Fluxo de caixa'),
    el('p', {}, `De ${formatarData(p.periodo.de)} até ${formatarData(p.periodo.ate)}.`),
    dados([
      ['Saldo no início', dinheiro(f.saldo_inicial_centavos)],
      ['Receitas recebidas', dinheiro(f.receitas_recebidas_centavos)],
      ['Devoluções e estornos de receitas', `− ${dinheiro(f.devolucoes_e_estornos_de_receita_centavos)}`],
      ['Despesas pagas', `− ${dinheiro(f.despesas_pagas_centavos)}`],
      f.estornos_de_despesa_centavos ? ['Estornos de despesas', dinheiro(f.estornos_de_despesa_centavos)] : null,
      ['Resultado das operações no caixa', dinheiro(f.variacao_operacional_centavos)],
      ['Aportes do proprietário (não é receita)', dinheiro(f.aportes_centavos)],
      ['Retiradas do proprietário (não é despesa)', `− ${dinheiro(f.retiradas_centavos)}`],
      (f.saldos_iniciais_centavos ?? f.ajustes_centavos) ? ['Saldos iniciais de contas', dinheiro(f.saldos_iniciais_centavos ?? f.ajustes_centavos)] : null,
      f.diferencas_caixa_centavos ? ['Diferenças de conferência de caixa (ajuste, não é receita nem despesa)', dinheiro(f.diferencas_caixa_centavos)] : null,
      ['Transferido entre contas (não muda o total)', dinheiro(f.transferido_entre_contas_centavos)],
      ['Saldo no fim', dinheiro(f.saldo_final_centavos)],
    ], { id: 'dados-fluxo' }),
    el('p', { class: 'campo__ajuda' }, el('strong', {}, 'Como é calculado: '), f.metodo));
}

function secaoResultado(p) {
  const r = p.resultado;
  const corpo = r.disponivel
    ? dados([
      ['Vendas confirmadas', dinheiro(r.receita_vendas_centavos)],
      r.vendas_canceladas_centavos ? ['Vendas canceladas no período', `− ${dinheiro(r.vendas_canceladas_centavos)}`] : null,
      ['Outras receitas', dinheiro(r.outras_receitas_centavos)],
      ['Custo das mercadorias vendidas', `− ${dinheiro(r.custo_mercadorias_vendidas_centavos)}`],
      ['Margem bruta das vendas', dinheiro(r.margem_bruta_centavos)],
      ['Despesas do período', `− ${dinheiro(r.despesas_centavos)}`],
      [r.parcial ? 'Resultado estimado (parcial)' : 'Resultado estimado', el('strong', { id: 'resultado-estimado' }, dinheiro(r.resultado_estimado_centavos))],
    ], { id: 'dados-resultado' })
    : el('div', { role: 'status' }, aviso('info', r.motivo, dados([['Vendas confirmadas', dinheiro(r.receita_vendas_centavos)],
      ['Outras receitas', dinheiro(r.outras_receitas_centavos)], ['Despesas do período', dinheiro(r.despesas_centavos)]])));
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-resultado', id: 'secao-resultado' },
    el('h2', { id: 'titulo-resultado' }, 'Resultado gerencial estimado'),
    el('div', { role: 'note' }, aviso('alerta', r.aviso)),
    corpo,
    r.disponivel && r.cobertura_custo_percentual !== null && r.parcial
      ? el('p', { id: 'cobertura' }, `Custo conhecido em ${String(r.cobertura_custo_percentual).replace('.', ',')}% do valor vendido. Os itens sem custo informado deixam o resultado parcial.`) : null,
    r.insumos_centavos ? el('p', { class: 'campo__ajuda', id: 'nota-insumos' },
      `Insumos e materiais de uso interno no período: ${dinheiro(r.insumos_centavos)}. Já estão nas despesas, no mês da compra (reconhecimento gerencial na compra).`) : null,
    (r.compras_revenda_centavos ?? r.compras_mercadorias_centavos) ? el('p', { class: 'campo__ajuda', id: 'nota-revenda' },
      `Compras para revenda no período: ${dinheiro(r.compras_revenda_centavos ?? r.compras_mercadorias_centavos)}. Não entram como despesa aqui: viram custo quando o produto é vendido. O mesmo custo nunca é contado duas vezes.`) : null,
    el('p', { class: 'campo__ajuda' }, el('strong', {}, 'Como é calculado: '), r.metodo));
}

/** I7-01: diferenças de caixa ficam visíveis mesmo sem afetar o resultado; alerta quando se repetem. */
function secaoDivergencias(d) {
  if (!d || (!d.meses_com_diferenca && !d.caixas?.length)) return null;
  return el('section', { class: 'cartao pilha', 'aria-labelledby': 'titulo-divergencias', id: 'secao-divergencias' },
    el('h2', { id: 'titulo-divergencias' }, 'Conferências do caixa físico (últimos 12 meses)'),
    d.recorrente ? el('div', { role: 'status', id: 'alerta-divergencias' }, aviso('alerta', d.alerta)) : null,
    dados([
      ['Meses com diferença', String(d.meses_com_diferenca)],
      ['Faltas somadas', dinheiro(d.faltas_centavos)],
      ['Sobras somadas', dinheiro(d.sobras_centavos)],
      ...d.caixas.map((c) => [c.conta, `${c.meses_com_diferenca_ultimos_6} mês(es) com diferença entre os últimos 6${c.recorrente ? ' (recorrente)' : ''}`]),
    ], { id: 'dados-divergencias' }),
    el('p', { class: 'campo__ajuda' }, 'Cada diferença vira um ajuste no livro-caixa, com valor, motivo, quem conferiu e quando. Não é receita nem despesa e nunca é apagada.'),
    el('p', {}, el('a', { href: `/business/financeiro-relatorios.html?id=${encodeURIComponent(ctx.id)}&tipo=conferencias` }, 'Ver todas as conferências')));
}

async function carregar() {
  mostrarCarregando(area, 'Carregando o financeiro');
  try {
    ctx = await carregarFinanceiro(area, nav, 'painel');
    if (!ctx) return;
    document.getElementById('titulo-pagina').textContent = `Financeiro de ${ctx.empresa?.nome_publico ?? 'empresa'}`;
    // D7-08: as contas recorrentes do mês são geradas ao abrir o financeiro (idempotente; nunca duplica).
    if (!geradoNestaVisita) {
      geradoNestaVisita = true;
      const g = await gerarRecorrencias(ctx.id).catch(() => null);
      if (g?.gerados) {
        anunciar('info', `${g.gerados} conta${g.gerados === 1 ? '' : 's'} recorrente${g.gerados === 1 ? ' foi gerada' : 's foram geradas'} agora.`, el('p', {}, g.aviso));
      } else if (g?.nao_gerados_mes_fechado) {
        anunciar('alerta', `${g.nao_gerados_mes_fechado} conta(s) recorrente(s) de meses já fechados não foram geradas.`, el('p', {}, 'Lance-as no mês aberto, se forem devidas.'));
      }
    }
    const p = await lerPainel(ctx.id, periodo.de, periodo.ate);
    concluirCarregamento(area);
    area.append(...[
      avisoRegistro(),
      el('p', { class: 'campo__ajuda', id: 'aviso-recorrencias' },
        'As despesas recorrentes do mês são geradas quando alguém abre o financeiro. Não há processamento automático contínuo.'),
      p.fechado_ate ? el('p', { id: 'fechado-ate' }, `Fechado até ${mesPorExtenso(p.fechado_ate)}: registros com data nesse período não mudam mais.`) : null,
      formPeriodo(),
      secaoSaldos(p),
      secaoAbertos(p),
      el('div', { class: 'grade-2' }, secaoFluxo(p), secaoResultado(p)),
      secaoDivergencias(p.divergencias_caixa)].filter(Boolean)
    );
  } catch (erro) {
    erroDeCarga(area, erro, tratarErro, carregar);
  }
}

carregar();
