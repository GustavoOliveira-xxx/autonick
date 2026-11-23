/** Retorno interno após login (M10, D10-13): só caminhos da área do Cliente. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoSeguro, entrarEVoltar } from '../../public/js/domain/retorno.js';

test('aceita caminho interno da área do Cliente com consulta', () => {
  assert.equal(destinoSeguro('/cliente/servicos.html?empresa=a1&servico=b2', 'cliente'), '/cliente/servicos.html?empresa=a1&servico=b2');
  assert.equal(destinoSeguro('/cliente/pedidos.html?empresa=a1', 'cliente'), '/cliente/pedidos.html?empresa=a1');
});

test('recusa endereço externo, protocolo relativo, outra área, subida de pasta e barra invertida', () => {
  for (const v of ['https://exemplo.com', '//exemplo.com/cliente/', '/business/conta.html', '/cliente/../business/conta.html',
    '/cliente/a\\b', 'javascript:alert(1)', '/cliente/<script>', '', null, undefined]) assert.equal(destinoSeguro(v, 'cliente'), null, String(v));
});

test('na entrada Business o retorno é sempre ignorado', () => {
  assert.equal(destinoSeguro('/cliente/servicos.html', 'business'), null);
});

test('monta a entrada com o retorno codificado', () => {
  assert.equal(entrarEVoltar('/cliente/servicos.html?empresa=1&servico=2'), '/cliente/entrar.html?volta=%2Fcliente%2Fservicos.html%3Fempresa%3D1%26servico%3D2');
});
