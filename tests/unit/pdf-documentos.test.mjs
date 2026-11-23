/**
 * M13 (D13-08): montagem dos documentos. Confere títulos, totais, a nota "Documento interno, sem valor fiscal." e que nada
 * privado entra: e-mail, telefone, custo dos itens e notas internas ficam de fora, mesmo quando vêm nos dados.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { gerarPdf } from '../../public/js/pdf/gerador.js';
import { relatorioFinanceiro, comprovanteOrcamento, resumoOs, comprovanteVenda, NOTA_COMPROVANTE } from '../../public/js/pdf/documentos.js';

const ctx = { empresa: 'Costura da Olga', usuario: 'Olga Teste', agora: new Date('2026-11-17T15:00:00Z') };
async function texto(desc) {
  const doc = await getDocument({ data: new Uint8Array(await gerarPdf(PDFLib, desc)), isEvalSupported: false }).promise;
  let t = '';
  for (let i = 1; i <= doc.numPages; i += 1) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  return t.replace(/\s+/g, ' ');
}
const PRIVADO = ['cida@autonick-teste.example', '(19) 99999-0000', 'Nota interna: cliente difícil', 'R$ 3,00 de custo'];

test('relatório por categoria: colunas da tela, totais somados e período', async () => {
  const r = { tipo: 'categorias', periodo: { de: '2026-11-01', ate: '2026-11-17' }, metodo: 'Regime de caixa.', aviso: 'O sistema registra; não movimenta dinheiro.',
    linhas: [{ categoria: 'Vendas', natureza: 'receita', entradas_centavos: 150000, saidas_centavos: 0, liquido_centavos: 150000, lancamentos: 3 },
      { categoria: 'Aluguel', natureza: 'despesa', entradas_centavos: 0, saidas_centavos: 80000, liquido_centavos: -80000, lancamentos: 1 }] };
  const d = relatorioFinanceiro(r, ctx);
  assert.equal(d.titulo, 'Entradas e saídas por categoria');
  assert.equal(d.arquivo, 'relatorio-categorias-costura-da-olga-2026-11-01-2026-11-17.pdf');
  const t = await texto(d);
  for (const e of ['Empresa: Costura da Olga', 'Período: 01/11/2026 a 17/11/2026', 'Olga Teste', 'Vendas', 'Aluguel', 'Total', 'R$ 1.500,00', 'R$ 800,00', 'R$ 700,00', 'sem valor fiscal']) {
    assert.ok(t.includes(e), `faltou "${e}"`);
  }
});

test('os cinco relatórios montam sem erro, inclusive vazios', async () => {
  for (const tipo of ['categorias', 'contas', 'vencimentos', 'mensal', 'conferencias']) {
    const d = relatorioFinanceiro({ tipo, periodo: { de: '2026-11-01', ate: '2026-11-17' }, linhas: [], metodo: 'Método.', aviso: 'Aviso.' }, ctx);
    assert.ok((await texto(d)).includes('Nada no período escolhido.'), tipo);
  }
  const mensal = relatorioFinanceiro({ tipo: 'mensal', periodo: { de: '2026-10-01', ate: '2026-11-17' }, metodo: 'M', aviso: 'A', linhas: [
    { mes: '2026-10-01', resumo: { fluxo: { receitas_recebidas_centavos: 1000, despesas_pagas_centavos: 400, saldo_final_centavos: 600 }, resultado: { disponivel: false } } },
    { mes: '2026-11-01', resumo: { fluxo: { receitas_recebidas_centavos: 2000, despesas_pagas_centavos: 100, saldo_final_centavos: 2500 }, resultado: { disponivel: true, resultado_estimado_centavos: 1900 } } }] }, ctx);
  const t = await texto(mensal);
  assert.ok(t.includes('R$ 30,00') && t.includes('R$ 5,00') && t.includes('sem acesso a custos'));
});

test('comprovante de orçamento aceito: itens, total, nota de documento interno e nada privado', async () => {
  const s = { numero: 12, servico: 'Barra de calça', cliente_nome: 'Cida', origem: 'plataforma', telefone: PRIVADO[1], email: PRIVADO[0] };
  const v = { numero: 2, tipo: 'manual', estado: 'aceita', valido_ate: '2026-11-30', prazo_execucao: '3 dias', condicoes: 'Pagamento na entrega.',
    subtotal_centavos: 6000, desconto_itens_centavos: 500, desconto_geral_centavos: 500, total_centavos: 5000, aceite: { aceito_em: '2026-11-16T13:00:00Z' },
    componentes: [{ tipo: 'mao_de_obra', descricao: 'Barra', quantidade: 2, valor_unitario_centavos: 3000, desconto_centavos: 500, total_centavos: 5500, custo: PRIVADO[3], produto: 'Linha', uso_interno: true }] };
  const d = comprovanteOrcamento(s, v, ctx);
  assert.equal(d.nota, NOTA_COMPROVANTE);
  assert.equal(NOTA_COMPROVANTE, 'Documento interno, sem valor fiscal.');
  const t = await texto(d);
  for (const e of ['Comprovante de orçamento aceito: solicitação nº 12, versão 2', 'Barra de calça', 'Cida', 'Mão de obra', 'R$ 60,00', 'R$ 10,00', 'R$ 50,00',
    'Pagamento na entrega.', 'Documento interno, sem valor fiscal.', '30/11/2026']) assert.ok(t.includes(e), `faltou "${e}"`);
  for (const p of PRIVADO) assert.ok(!t.includes(p), `vazou "${p}"`);
});

test('resumo da OS: só atualizações enviadas ao cliente, nunca notas internas', async () => {
  const o = { numero: 7, servico: 'Barra', cliente_nome: 'Cida', solicitacao_numero: 12, estado: 'encerrada', aceita_em: '2026-11-10T12:00:00Z', concluida_em: '2026-11-12T12:00:00Z',
    encerrada_em: '2026-11-13T12:00:00Z', garantia: { dias: 30, ate: '2026-12-12', condicoes: 'Ajuste gratuito.' },
    valores: { contratado_centavos: 5000, recebido_centavos: 5000, saldo_pendente_centavos: 0, a_devolver_centavos: 0, situacao: 'pago' },
    versao_aceita: { numero: 2, subtotal_centavos: 5000, total_centavos: 5000, componentes: [{ tipo: 'mao_de_obra', descricao: 'Barra', quantidade: 1, total_centavos: 5000 }] },
    eventos: [{ tipo: 'atualizacao', interno: false, texto: 'Barra medida.', criado_em: '2026-11-11T12:00:00Z' },
      { tipo: 'nota_interna', interno: true, texto: PRIVADO[2], criado_em: '2026-11-11T13:00:00Z' },
      { tipo: 'atualizacao', interno: true, texto: PRIVADO[2], criado_em: '2026-11-11T14:00:00Z' }] };
  const t = await texto(resumoOs(o, ctx));
  for (const e of ['Resumo da ordem de serviço nº 7', 'Encerrada', 'Barra medida.', '30 dias, até 12/12/2026', 'Pago', 'Ajuste gratuito.']) assert.ok(t.includes(e), `faltou "${e}"`);
  assert.ok(!t.includes(PRIVADO[2]));
});

test('comprovante de pedido ou venda: sem custo dos itens; identifica pedido externo', async () => {
  const v = { numero: 31, origem: 'pedido', cliente: 'Cida', estado: 'confirmada', confirmada_em: '2026-11-15T12:00:00Z',
    pagamento: { estado: 'parcial', recebido_centavos: 1000, saldo_centavos: 1000 }, subtotal_centavos: 2000, desconto_itens_centavos: 0, desconto_geral_centavos: 0, total_centavos: 2000,
    itens: [{ produto: 'Linha', variacao: 'Azul', quantidade: 2, preco_centavos: 1000, desconto_centavos: 0, valor_centavos: 2000, custo_centavos: 300 }],
    parcelas: [{ sequencia: 1, vencimento: '2026-11-20', valor_centavos: 2000, saldo_centavos: 1000 }] };
  const d = comprovanteVenda(v, ctx);
  assert.equal(d.arquivo, 'pedido-costura-da-olga-numero-31.pdf');
  const t = await texto(d);
  for (const e of ['Comprovante de pedido: venda nº 31', 'Pedido externo', 'Linha (Azul)', 'Recebido em parte', 'R$ 20,00', '20/11/2026', 'Documento interno, sem valor fiscal.']) {
    assert.ok(t.includes(e), `faltou "${e}"`);
  }
  assert.ok(!t.includes('R$ 3,00'), 'custo do item não entra');
});
