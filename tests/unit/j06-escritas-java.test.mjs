import test from 'node:test';
import assert from 'node:assert/strict';
import { pausarOsJava, retomarOsJava } from '../../public/js/data/detalhe-os-java.js';

const config = { demoApiJava: '/api-java' };
const id = 'eb0a0100-0000-4000-8000-000000000001';

test('J06: pausa envia motivo e retomada não envia motivo nem ação no corpo', async () => {
  const pedidos = [];
  const opcoes = { config, token: 'token-ficticio', buscar: async (url, init) => {
    pedidos.push([url, init.method, JSON.parse(init.body)]);
    return Response.json({});
  } };
  await pausarOsJava(id, 2, 'j06-pausar-chv', 'Motivo interno fictício', opcoes);
  await retomarOsJava(id, 3, 'j06-retomar-chv', opcoes);
  assert.deepEqual(pedidos, [
    [`/api-java/business/ordens-servico/${id}/pausar`, 'POST', { versao: 2, chave: 'j06-pausar-chv', motivo: 'Motivo interno fictício' }],
    [`/api-java/business/ordens-servico/${id}/retomar`, 'POST', { versao: 3, chave: 'j06-retomar-chv' }],
  ]);
});

test('J06: resposta ilegível preserva conteúdo, versão e chave; motivo trocado não é reenviado', async () => {
  const pedidos = [];
  const opcoes = { config, token: 'token-ficticio', buscar: async (url, init) => {
    pedidos.push(init.body);
    return pedidos.length === 1 ? new Response('{', { status: 200 }) : Response.json({ estado: 'pausada' });
  } };
  const chave = 'j06-pausa-incerta', motivo = 'Motivo original fictício';
  await assert.rejects(pausarOsJava(id, 2, chave, motivo, opcoes), { codigo: 'NETWORK_UNKNOWN' });
  await assert.rejects(pausarOsJava(id, 3, chave, 'Um motivo diferente', opcoes), { codigo: 'NETWORK_UNKNOWN' });
  assert.equal(pedidos.length, 1);
  assert.deepEqual(await pausarOsJava(id, 3, chave, motivo, opcoes), { estado: 'pausada' });
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0], pedidos[1]);
});
