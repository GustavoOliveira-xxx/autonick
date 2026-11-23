import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarDataHora, formatarDataCivil, formatarData } from '../../public/js/domain/tempo.js';

test('converte UTC para o fuso de São Paulo (virada de dia)', () => {
  assert.equal(formatarDataHora('2026-11-01T02:30:00Z'), '31/10/2026, 23:30');
  assert.equal(formatarData('2026-11-01T02:30:00Z'), '31/10/2026');
});

test('datas civis não sofrem conversão de fuso e rejeitam dias inexistentes (FIN-001 §7)', () => {
  assert.equal(formatarDataCivil('2028-02-29'), '29/02/2028');
  assert.throws(() => formatarDataCivil('2027-02-29'), RangeError);
  assert.throws(() => formatarDataCivil('01/02/2027'), RangeError);
  assert.throws(() => formatarDataHora('ontem'), RangeError);
});
