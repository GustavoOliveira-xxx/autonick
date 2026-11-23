import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularDisponivel, previaReserva, resumirProduto } from '../../public/js/domain/estoque.js';

test('disponível = físico − reservado, sem reduzir o físico (RN-012)', () => {
  assert.equal(calcularDisponivel({ fisico: 10, reservado: 4 }), 6);
  assert.equal(calcularDisponivel({ fisico: 8, reservado: 3 }), 5);
});

test('exemplo 2 do FIN-001: reservar 6 de 6 cabe; mais 1 não cabe', () => {
  const disponivel = calcularDisponivel({ fisico: 10, reservado: 4 });
  assert.equal(previaReserva(disponivel, 6).cabe, true);
  const depois = calcularDisponivel({ fisico: 10, reservado: 10 });
  assert.equal(depois, 0);
  const segunda = previaReserva(depois, 1);
  assert.equal(segunda.cabe, false);
  assert.match(segunda.motivo, /Não há unidades disponíveis suficientes/);
});

test('produto sob encomenda aceita prévia sem saldo (RN-013)', () => {
  assert.equal(previaReserva(0, 2, { sobEncomenda: true }).cabe, true);
});

test('rejeita quantidades inválidas e reserva maior que o físico', () => {
  assert.throws(() => calcularDisponivel({ fisico: -1, reservado: 0 }), RangeError);
  assert.throws(() => calcularDisponivel({ fisico: 1.5, reservado: 0 }), RangeError);
  assert.throws(() => calcularDisponivel({ fisico: 2, reservado: 3 }), RangeError);
  assert.equal(previaReserva(5, 0).cabe, false);
  assert.equal(previaReserva(5, 1.5).cabe, false);
});

test('mínimo é avaliado por produto (P156, resolução C-07)', () => {
  const produto = { estoqueMinimo: 10, variacoes: [{ fisico: 10, reservado: 4 }, { fisico: 3, reservado: 0 }] };
  assert.deepEqual(resumirProduto(produto), { fisico: 13, reservado: 4, disponivel: 9, abaixoDoMinimo: true });
  assert.equal(resumirProduto({ estoqueMinimo: null, variacoes: [{ fisico: 0, reservado: 0 }] }).abaixoDoMinimo, false);
});
