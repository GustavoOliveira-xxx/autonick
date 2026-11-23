/**
 * Relatórios financeiros (M07, RF-137; D7-01): na tela, por período, com o método de cada um; exportação CSV para
 * planilha (o banco entrega só as linhas autorizadas e registra a exportação). PDF no navegador (M13, D13-07, D13-08), com
 * as mesmas permissões do CSV e registro do formato na auditoria (D13-10).
 */
import { iniciarLayout } from '../../ui/layout.js';
import { el } from '../../ui/dom.js';
import { aviso, mostrarCarregando, concluirCarregamento, tratarErro } from '../../ui/estados.js';
import { campoTexto, campoSelecao, valores, erroNoCampo, limparErros, ocupado } from '../../ui/formulario.js';
import { relatorio as lerRelatorio, exportar } from '../../data/financeiro.js';
import { NATUREZA, TIPO_CONTA, inicioDoMes, mesPorExtenso, montarCsv } from '../../domain/financeiro.js';
import { carregarFinanceiro, criarAnunciador, dinheiro, dataDeHoje, formatarData, avisoRegistro, erroDeCarga } from './comum.js';
import { formatarDataHora } from '../empresa/comum.js';
import { botaoPdf, nomeDeQuemGera } from '../../pdf/baixar.js';
import { registrarExportacaoPdf } from '../../data/exportacao.js';
import { relatorioFinanceiro } from '../../pdf/documentos.js';

iniciarLayout();
const area = document.getElementById('conteudo-pagina');
const nav = document.getElementById('navegacao');
const anunciar = criarAnunciador(document.getElementById('avisos'));
let ctx = null;
const tipoInicial = new URLSearchParams(location.search).get('tipo');
let escolha = { tipo: tipoInicial === 'conferencias' ? 'conferencias' : 'categorias', de: inicioDoMes(dataDeHoje()), ate: dataDeHoje() };
if (escolha.tipo === 'conferencias') escolha.de = `${Number(dataDeHoje().slice(0, 4)) - 1}${dataDeHoje().slice(4, 8)}01`;

const TIPOS = [['categorias', 'Entradas e saídas por categoria'], ['contas', 'Movimento por conta'], ['vencimentos', 'Vencimentos em aberto'],
  ['mensal', 'Mês a mês (até 12 meses)'], ['conferencias', 'Conferências do caixa físico']];
const EXPORTACOES = [['lancamentos', 'Lançamentos do livro-caixa'], ['titulos', 'Contas a pagar e a receber'], ['categorias', 'Resumo por categoria'],
  ['contas', 'Resumo por conta'], ['conferencias', 'Conferências do caixa físico']];

const tabela = (id, legenda, colunas, linhas) => el('div', { class: 'tabela-container' }, el('table', { class: 'tabela', id },
  el('caption', { class: 'visualmente-oculto' }, legenda),
  el('thead', {}, el('tr', {}, ...colunas.map((c) => el('th', { scope: 'col' }, c)))),
  el('tbody', {}, ...linhas.map((cels) => el('tr', {}, ...cels.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, c)
    : el('td', { 'data-rotulo': colunas[i], class: typeof c === 'string' && c.startsWith('R$') ? 'numero' : null }, c))))))));

function corpo(r) {
  if (!r.linhas.length) return el('p', { id: 'tabela-relatorio' }, 'Nada no período escolhido.');
  if (r.tipo === 'categorias') {
    return tabela('tabela-relatorio', 'Entradas e saídas por categoria no período', ['Categoria', 'Natureza', 'Entradas', 'Saídas', 'Líquido', 'Lançamentos'],
      r.linhas.map((x) => [x.categoria, NATUREZA[x.natureza] ?? x.natureza, dinheiro(x.entradas_centavos), dinheiro(x.saidas_centavos), dinheiro(x.liquido_centavos), String(x.lancamentos)]));
  }
  if (r.tipo === 'contas') {
    return tabela('tabela-relatorio', 'Movimento de cada conta no período', ['Conta', 'Tipo', 'Saldo antes', 'Entradas', 'Saídas', 'Saldo no fim'],
      r.linhas.map((x) => [x.conta, TIPO_CONTA[x.tipo] ?? x.tipo, dinheiro(x.saldo_inicial_centavos), dinheiro(x.entradas_centavos), dinheiro(x.saidas_centavos), dinheiro(x.saldo_final_centavos)]));
  }
  if (r.tipo === 'conferencias') {
    return tabela('tabela-relatorio', 'Conferências do caixa físico nos fechamentos do período', ['Mês', 'Caixa', 'Registrado', 'Contado', 'Diferença', 'Motivo', 'Conferido por', 'Quando'],
      r.linhas.map((x) => [mesPorExtenso(x.mes) + (x.estado_fechamento === 'reaberto' ? ' (fechamento reaberto)' : ''), x.conta, dinheiro(x.esperado_centavos),
        dinheiro(x.contado_centavos), x.diferenca_centavos ? dinheiro(x.diferenca_centavos) : 'sem diferença', x.motivo ?? '', x.conferido_por ?? '', formatarDataHora(x.conferido_em)]));
  }
  if (r.tipo === 'vencimentos') {
    return tabela('tabela-relatorio', 'Parcelas em aberto por faixa de vencimento', ['Faixa', 'Tipo', 'Parcelas', 'Valor em aberto'],
      r.linhas.map((x) => [x.faixa, x.tipo === 'pagar' ? 'A pagar' : 'A receber', String(x.parcelas), dinheiro(x.saldo_centavos)]));
  }
  return tabela('tabela-relatorio', 'Fluxo de caixa e resultado estimado de cada mês', ['Mês', 'Receitas recebidas', 'Despesas pagas', 'Saldo no fim', 'Resultado estimado'],
    r.linhas.map((x) => [mesPorExtenso(x.mes), dinheiro(x.resumo.fluxo.receitas_recebidas_centavos), dinheiro(x.resumo.fluxo.despesas_pagas_centavos),
      dinheiro(x.resumo.fluxo.saldo_final_centavos), x.resumo.resultado.disponivel ? dinheiro(x.resumo.resultado.resultado_estimado_centavos) : 'sem acesso a custos']));
}

function baixarArquivo(nome, conteudo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: nome, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function secaoExportar() {
  if (!ctx.pode('financeiro.exportar')) return el('p', { id: 'sem-exportacao' }, 'Seu perfil não inclui exportar o financeiro.');
  return el('section', { class: 'pilha', 'aria-labelledby': 'titulo-exportar' }, el('h2', { id: 'titulo-exportar' }, 'Exportar para planilha (CSV)'),
    el('p', { class: 'campo__ajuda' }, `Período: ${formatarData(escolha.de)} a ${formatarData(escolha.ate)}. O arquivo usa ";" e vírgula nos centavos, para abrir direto no Excel ou no LibreOffice. Guarde-o com cuidado: tem dados da empresa.`),
    el('ul', { class: 'opcoes', id: 'botoes-exportar' }, ...EXPORTACOES.map(([tipo, rotulo]) => {
      const b = el('button', { type: 'button', class: 'botao botao--secundario', 'data-exportar': tipo }, rotulo);
      b.addEventListener('click', () => ocupado(b, async () => {
        try {
          const r = await exportar(ctx.id, tipo, escolha.de, escolha.ate);
          baixarArquivo(`autonick-financeiro-${tipo}-${r.periodo.de}-a-${r.periodo.ate}.csv`, montarCsv(r.colunas, r.linhas));
          anunciar('sucesso', `Arquivo de ${rotulo.toLowerCase()} gerado com ${r.linhas.length} linha(s).`,
            r.limite_atingido ? el('p', {}, 'O limite de 5.000 linhas foi atingido: escolha um período menor para o restante.') : null);
        } catch (erro) {
          anunciar('erro', erro.message);
        }
      }));
      return el('li', {}, b);
    })));
}

function formEscolha() {
  const form = el('form', { id: 'form-relatorio', class: 'pilha' },
    el('div', { class: 'grade-filtros' },
      campoSelecao({ nome: 'tipo', rotulo: 'Relatório', opcoes: TIPOS, valor: escolha.tipo, vazio: null, id: 'relatorio-tipo' }),
      campoTexto({ nome: 'de', rotulo: 'De', tipo: 'date', valor: escolha.de, id: 'relatorio-de' }),
      campoTexto({ nome: 'ate', rotulo: 'Até', tipo: 'date', valor: escolha.ate, id: 'relatorio-ate' })),
    el('div', { class: 'grupo-botoes' }, el('button', { type: 'submit', class: 'botao' }, 'Ver relatório')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    limparErros(form);
    const d = valores(form);
    if (!d.de || !d.ate) return erroNoCampo(form, d.de ? 'ate' : 'de', 'Informe as duas datas.');
    if (d.de > d.ate) return erroNoCampo(form, 'de', 'O início precisa ser antes do fim.');
    escolha = d;
    return carregar();
  });
  return form;
}

async function carregar() {
  mostrarCarregando(area, 'Carregando o relatório');
  try {
    ctx = await carregarFinanceiro(area, nav, 'relatorios');
    if (!ctx) return;
    const r = await lerRelatorio(ctx.id, escolha.tipo, escolha.de, escolha.ate);
    concluirCarregamento(area);
    area.append(avisoRegistro(), formEscolha(),
      el('section', { class: 'pilha', 'aria-labelledby': 'titulo-relatorio' },
        el('h2', { id: 'titulo-relatorio' }, TIPOS.find(([t]) => t === r.tipo)?.[1] ?? 'Relatório'),
        el('p', {}, `De ${formatarData(r.periodo.de)} até ${formatarData(r.periodo.ate)}.`),
        corpo(r),
        el('p', { class: 'campo__ajuda' }, el('strong', {}, 'Como é calculado: '), r.metodo),
        el('div', { role: 'note' }, aviso('info', r.aviso)),
        ctx.pode('financeiro.exportar') ? botaoPdf({ rotulo: 'Baixar este relatório em PDF', id: 'baixar-pdf-relatorio', anunciar,
          montar: async () => relatorioFinanceiro(r, { empresa: ctx.empresa?.nome_publico ?? 'Empresa', usuario: await nomeDeQuemGera(), agora: new Date() }),
          registrar: (chave) => registrarExportacaoPdf(ctx.id, `relatorio_${r.tipo}`, null, r.periodo.de, r.periodo.ate, chave) }) : null),
      secaoExportar());
  } catch (erro) {
    erroDeCarga(area, erro, tratarErro, carregar);
  }
}

carregar();
