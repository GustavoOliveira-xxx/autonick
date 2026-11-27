/**
 * Pacote 27/11, item 1.1: gerador de parcelas por DDL (dias corridos a partir da data-base), mensal e prazos individuais.
 * Exemplos do pedido: R$ 120 em 2x com data-base 27/11/2026 (30/60 DDL e mensal), R$ 100 em 3x, fim de mês e bissexto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarParcelas, dividirCentavos, somarMeses, lerPrazos, conferirParcelas, diaCivil, somarDiasCivis } from '../../public/js/domain/parcelas.js';

const datas = (r) => r.parcelas.map((p) => p.vencimento);
const valores = (r) => r.parcelas.map((p) => p.valor_centavos);

test('R$ 120 em 2x, data-base 27/11/2026, 30/60 DDL: 27/12/2026 e 26/01/2027, R$ 60 cada', () => {
  const r = gerarParcelas({ total: 12000, dataBase: '2026-11-27', quantidade: 2, modo: 'intervalo', primeiraDias: 30, intervaloDias: 30 });
  assert.equal(r.ok, true);
  assert.deepEqual(datas(r), ['2026-12-27', '2027-01-26']);
  assert.deepEqual(valores(r), [6000, 6000]);
  assert.deepEqual(r.parcelas.map((p) => p.ddl), [30, 60]);
  const p = gerarParcelas({ total: 12000, dataBase: '2026-11-27', modo: 'prazos', prazos: [30, 60] });
  assert.deepEqual(datas(p), ['2026-12-27', '2027-01-26']);
});

test('mesma venda em modo mensal: 27/12/2026 e 27/01/2027 (mensal não é 30 dias)', () => {
  const r = gerarParcelas({ total: 12000, dataBase: '2026-11-27', quantidade: 2, modo: 'mensal' });
  assert.deepEqual(datas(r), ['2026-12-27', '2027-01-27']);
  assert.deepEqual(r.parcelas.map((p) => p.ddl), [30, 61]);
});

test('R$ 100 em 3x: 33,33 + 33,33 + 33,34 (sobra na última); soma exata', () => {
  assert.deepEqual(dividirCentavos(10000, 3), [3333, 3333, 3334]);
  const r = gerarParcelas({ total: 10000, dataBase: '2026-11-27', quantidade: 3, modo: 'intervalo', primeiraDias: 0, intervaloDias: 30 });
  assert.deepEqual(valores(r), [3333, 3333, 3334]);
  assert.equal(valores(r).reduce((a, b) => a + b, 0), 10000);
  assert.deepEqual(dividirCentavos(1, 1), [1]);
  assert.deepEqual(dividirCentavos(5, 3), [1, 1, 3]);
});

test('0 DDL: primeira na própria data-base; intervalo personalizado positivo', () => {
  const r = gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 3, primeiraDias: 0, intervaloDias: 10 });
  assert.deepEqual(datas(r), ['2026-11-27', '2026-12-07', '2026-12-17']);
  for (const i of [7, 15, 45, 60]) assert.equal(gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 2, primeiraDias: 0, intervaloDias: i }).parcelas[1].ddl, i);
  assert.equal(gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 2, intervaloDias: 0 }).ok, false);
  assert.equal(gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 2, intervaloDias: -7 }).ok, false);
  assert.equal(gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 2, primeiraDias: -1 }).ok, false);
});

test('primeira data manual: intervalo conta a partir dela; mensal usa o dia dela como referência', () => {
  const r = gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 3, primeiraData: '2026-12-10', intervaloDias: 15 });
  assert.deepEqual(datas(r), ['2026-12-10', '2026-12-25', '2027-01-09']);
  assert.equal(r.parcelas[0].ddl, 13);
  const m = gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 3, modo: 'mensal', primeiraData: '2026-12-31' });
  assert.deepEqual(datas(m), ['2026-12-31', '2027-01-31', '2027-02-28']);
  assert.equal(gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 2, primeiraData: '2026-11-26' }).ok, false, 'antes da data-base');
  assert.equal(gerarParcelas({ total: 9000, dataBase: '2026-11-27', quantidade: 2, primeiraData: '2026-02-30' }).ok, false, 'data inexistente');
});

test('fim de mês: último dia válido no mês curto e volta ao dia de referência (sem deriva); fevereiro bissexto', () => {
  const r = gerarParcelas({ total: 40000, dataBase: '2027-01-31', quantidade: 4, modo: 'mensal' });
  assert.deepEqual(datas(r), ['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  const b = gerarParcelas({ total: 30000, dataBase: '2028-01-31', quantidade: 3, modo: 'mensal' });
  assert.deepEqual(datas(b), ['2028-02-29', '2028-03-31', '2028-04-30'], '2028 é bissexto');
  const d30 = gerarParcelas({ total: 30000, dataBase: '2028-01-30', quantidade: 2, modo: 'mensal' });
  assert.deepEqual(datas(d30), ['2028-02-29', '2028-03-30']);
  assert.equal(somarMeses('2026-12-31', 2), '2027-02-28');
  assert.equal(somarMeses('2027-11-30', 3, 31), '2028-02-29');
  assert.equal(somarDiasCivis('2028-02-28', 1), '2028-02-29');
  assert.equal(somarDiasCivis('2027-02-28', 1), '2027-03-01');
  const hoje0 = gerarParcelas({ total: 20000, dataBase: '2026-11-27', quantidade: 2, modo: 'mensal', primeiraMeses: 0 });
  assert.deepEqual(datas(hoje0), ['2026-11-27', '2026-12-27']);
});

test('prazos individuais: crescentes, sem negativos; texto 30/60/90', () => {
  assert.deepEqual(lerPrazos('30/60/90').dias, [30, 60, 90]);
  assert.deepEqual(lerPrazos(' 0, 30 ; 60 ').dias, [0, 30, 60]);
  assert.equal(lerPrazos('30/-60').ok, false);
  assert.equal(lerPrazos('trinta').ok, false);
  const r = gerarParcelas({ total: 10000, dataBase: '2026-11-27', modo: 'prazos', prazos: [30, 60, 90] });
  assert.deepEqual(datas(r), ['2026-12-27', '2027-01-26', '2027-02-25']);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', modo: 'prazos', prazos: [60, 30] }).ok, false);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', modo: 'prazos', prazos: [30, 30] }).ok, false);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', modo: 'prazos', prazos: [30] }).ok, false);
});

test('limites reais: 2 a 24 parcelas, centavo mínimo por parcela, até 10 anos, não antes de hoje', () => {
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', quantidade: 1 }).ok, false);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', quantidade: 25 }).ok, false);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', quantidade: 24 }).ok, true);
  assert.equal(gerarParcelas({ total: 3, dataBase: '2026-11-27', quantidade: 4 }).ok, false);
  assert.equal(gerarParcelas({ total: 0, dataBase: '2026-11-27', quantidade: 2 }).ok, false);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-27', quantidade: 2, intervaloDias: 3000, primeiraDias: 1000 }).ok, false);
  assert.equal(gerarParcelas({ total: 10000, dataBase: '2026-11-20', quantidade: 2, primeiraDias: 0, hoje: '2026-11-27' }).ok, false);
});

test('conferir parcelas editadas: soma, diferença, valores e ordem', () => {
  const ok = conferirParcelas([{ valor_centavos: 5000, vencimento: '2026-12-27' }, { valor_centavos: 7000, vencimento: '2027-01-26' }], 12000);
  assert.equal(ok.ok, true);
  const dif = conferirParcelas([{ valor_centavos: 5000, vencimento: '2026-12-27' }, { valor_centavos: 6000, vencimento: '2027-01-26' }], 12000);
  assert.deepEqual([dif.ok, dif.diferenca], [false, 1000]);
  assert.equal(conferirParcelas([{ valor_centavos: 0, vencimento: '2026-12-27' }, { valor_centavos: 12000, vencimento: '2027-01-26' }], 12000).ok, false);
  assert.equal(conferirParcelas([{ valor_centavos: 6000, vencimento: '2027-01-26' }, { valor_centavos: 6000, vencimento: '2026-12-27' }], 12000).ok, false);
  assert.equal(diaCivil('2026-13-01'), null);
});
