/** Pacote 27/11, item 5: CPF e CNPJ (numérico e alfanumérico) no navegador, com as mesmas regras do banco. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDocumento, cpfValido, cnpjValido, digitosCnpj, conferirDocumento, mascararDocumento, documentoParaLista, mascararCep, normalizarCep, cepValido, tipoDocumento } from '../../public/js/domain/documentos.js';

test('CNPJ alfanumérico: exemplo oficial 12.ABC.345/01DE-35 e DV calculado', () => {
  assert.equal(digitosCnpj('12ABC34501DE'), '35');
  assert.equal(cnpjValido('12ABC34501DE35'), true);
  assert.equal(cnpjValido('12ABC34501DE36'), false);
  assert.equal(cnpjValido('11222333000181'), true, 'numérico legado');
  assert.equal(cnpjValido('00000000000000'), false);
  assert.equal(cnpjValido('12abc34501de35'), false, 'só a forma normalizada');
});

test('normalização: maiúsculas, sem pontuação, zeros à esquerda preservados; não remove letras', () => {
  assert.equal(normalizarDocumento(' 12.abc.345/01de-35 '), '12ABC34501DE35');
  assert.equal(normalizarDocumento('012.345.678-90'), '01234567890');
  assert.equal(normalizarDocumento(''), null);
  assert.equal(tipoDocumento('12.ABC.345/01DE-35'), 'cnpj');
});

test('CPF e conferência por tipo de pessoa', () => {
  assert.equal(cpfValido('12345678909'), true);
  assert.equal(cpfValido('11111111111'), false);
  assert.deepEqual(conferirDocumento('', 'pf'), { ok: true, valor: null });
  assert.equal(conferirDocumento('123.456.789-09', 'pf').valor, '12345678909');
  assert.equal(conferirDocumento('12ABC34501DE35', 'pf').ok, false, 'PF não aceita CNPJ');
  assert.equal(conferirDocumento('12.abc.345/01de-35', 'pj').valor, '12ABC34501DE35');
  assert.equal(conferirDocumento('12ABC34501DE3#', 'pj').ok, false);
});

test('máscaras e privacidade na lista', () => {
  assert.equal(mascararDocumento('12abc34501de35'), '12.ABC.345/01DE-35');
  assert.equal(mascararDocumento('12345678909', 'pf'), '123.456.789-09');
  assert.equal(mascararDocumento('123456', 'pf'), '123.456');
  assert.equal(documentoParaLista('12345678909'), '***.456.789-**');
  assert.equal(documentoParaLista('12ABC34501DE35'), '12.ABC.345/01DE-35');
  assert.equal(mascararCep('01001000'), '01001-000');
  assert.equal(normalizarCep('01001-000'), '01001000');
  assert.equal(cepValido('0100100'), false);
});
