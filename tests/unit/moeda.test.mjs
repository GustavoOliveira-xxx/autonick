import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerValorEmReais, formatarCentavos, somarCentavos, MAXIMO_CENTAVOS } from '../../public/js/domain/moeda.js';

test('aceita os formatos do UX-001 §3', () => {
  assert.deepEqual(lerValorEmReais('100'), { ok: true, centavos: 10000 });
  assert.deepEqual(lerValorEmReais('100,00'), { ok: true, centavos: 10000 });
  assert.deepEqual(lerValorEmReais('R$ 100,00'), { ok: true, centavos: 10000 });
  assert.deepEqual(lerValorEmReais('R$ 1.234,56'), { ok: true, centavos: 123456 });
  assert.deepEqual(lerValorEmReais('0,5'), { ok: true, centavos: 50 });
  assert.deepEqual(lerValorEmReais('1.234'), { ok: true, centavos: 123400 });
});

test('rejeita valores negativos, ambíguos e com mais de duas casas (FIN-001 §7)', () => {
  assert.equal(lerValorEmReais('-10').ok, false);
  assert.match(lerValorEmReais('100.50').erro, /vírgula/);
  assert.match(lerValorEmReais('10,999').erro, /duas casas/);
  assert.equal(lerValorEmReais('abc').ok, false);
  assert.equal(lerValorEmReais('').ok, false);
  assert.equal(lerValorEmReais('1.23,45').ok, false);
  assert.equal(lerValorEmReais(undefined).ok, false);
});

test('respeita o limite de numeric(14,2)', () => {
  assert.deepEqual(lerValorEmReais('999.999.999.999,99'), { ok: true, centavos: MAXIMO_CENTAVOS });
  assert.equal(lerValorEmReais('1.000.000.000.000,00').ok, false);
});

test('formata centavos em reais sem ponto flutuante como autoridade', () => {
  assert.equal(formatarCentavos(123456), 'R$ 1.234,56');
  assert.equal(formatarCentavos(0), 'R$ 0,00');
  assert.throws(() => formatarCentavos(10.5), TypeError);
});

test('exemplo 1 do FIN-001: 2 × 35,00 + 20,00 − 10,00 = 80,00; saldo após 30,00 = 50,00', () => {
  const total = somarCentavos([2 * 3500, 2000, -1000]);
  assert.equal(total, 8000);
  assert.equal(total - 3000, 5000);
  assert.throws(() => somarCentavos([1, 0.1]), TypeError);
});
