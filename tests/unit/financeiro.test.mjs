/** Regras de apresentação do financeiro (M07): datas de vencimento (D7-09), parcelas sugeridas e CSV (D7-01). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vencimentoNoMes, somarMeses, sugerirParcelas, centavosParaCsv, campoCsv, montarCsv, inicioDoMes, mesPorExtenso, ESTADO_EXIBICAO, NATUREZA }
  from '../../public/js/domain/financeiro.js';

test('D7-09: dia inexistente vira o último dia do mês (fevereiro comum e bissexto, meses de 30 dias)', () => {
  assert.equal(vencimentoNoMes('2027-02', 31), '2027-02-28');
  assert.equal(vencimentoNoMes('2028-02', 30), '2028-02-29');
  assert.equal(vencimentoNoMes('2027-04', 31), '2027-04-30');
  assert.equal(vencimentoNoMes('2027-01', 31), '2027-01-31');
  assert.equal(vencimentoNoMes('2026-11', 5), '2026-11-05');
});

test('somar meses mantém o dia escolhido e volta a ele depois de um mês curto', () => {
  assert.equal(somarMeses('2027-01-31', 1), '2027-02-28');
  assert.equal(somarMeses('2027-01-31', 2), '2027-03-31');
  assert.equal(somarMeses('2026-11-30', 3), '2027-02-28');
  assert.equal(somarMeses('2026-12-15', 1), '2027-01-15');
});

test('parcelas sugeridas: soma exata em centavos, diferença na primeira, vencimentos mensais', () => {
  const p = sugerirParcelas(10000, 3, '2027-01-31');
  assert.deepEqual(p.map((x) => x.valor_centavos), [3334, 3333, 3333]);
  assert.equal(p.reduce((t, x) => t + x.valor_centavos, 0), 10000);
  assert.deepEqual(p.map((x) => x.vencimento), ['2027-01-31', '2027-02-28', '2027-03-31']);
  assert.deepEqual(sugerirParcelas(8000, 1, '2026-11-20'), [{ valor_centavos: 8000, vencimento: '2026-11-20' }]);
  assert.throws(() => sugerirParcelas(0, 1, '2026-11-20'), /Total inválido/);
  assert.throws(() => sugerirParcelas(100, 25, '2026-11-20'), /1 a 24/);
  assert.throws(() => sugerirParcelas(2, 3, '2026-11-20'), /R\$ 0,01/);
  assert.throws(() => sugerirParcelas(10.5, 1, '2026-11-20'), /Total inválido/);
});

test('CSV: centavos em reais com vírgula, sem ponto flutuante', () => {
  assert.equal(centavosParaCsv(123456), '1234,56');
  assert.equal(centavosParaCsv(5), '0,05');
  assert.equal(centavosParaCsv(-1050), '-10,50');
  assert.equal(centavosParaCsv(null), '');
  assert.throws(() => centavosParaCsv(1.5), /centavos inteiros/);
});

test('CSV: escape de separador, aspas e quebra de linha; proteção contra fórmula', () => {
  assert.equal(campoCsv('Aluguel; loja'), '"Aluguel; loja"');
  assert.equal(campoCsv('Disse "oi"'), '"Disse ""oi"""');
  assert.equal(campoCsv('linha1\nlinha2'), '"linha1\nlinha2"');
  assert.equal(campoCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(campoCsv('+55 19'), "'+55 19");
  assert.equal(campoCsv('-10,50'), '-10,50');
  assert.equal(campoCsv(null), '');
  assert.equal(campoCsv(0), '0');
});

test('CSV completo: BOM, ";" e CRLF; colunas "(R$)" convertidas de centavos', () => {
  const csv = montarCsv(['Data', 'Descrição', 'Entrada (R$)', 'Saída (R$)'], [['2026-11-02', 'Venda; balcão', 12500, null], ['2026-11-03', 'Frete', null, 1200]]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.slice(1), 'Data;Descrição;Entrada (R$);Saída (R$)\r\n2026-11-02;"Venda; balcão";125,00;\r\n2026-11-03;Frete;;12,00\r\n');
});

test('textos: estados D7-10 e naturezas sem chamar transferência ou dinheiro do dono de receita', () => {
  assert.deepEqual(Object.keys(ESTADO_EXIBICAO), ['previsto', 'pendente', 'vencido', 'parcial', 'liquidado', 'cancelado']);
  assert.doesNotMatch(NATUREZA.interna, /receita/i);
  assert.doesNotMatch(NATUREZA.proprietario, /receita|despesa/i);
  assert.equal(inicioDoMes('2026-11-12'), '2026-11-01');
  assert.match(mesPorExtenso('2026-10-01'), /outubro de 2026/);
});
