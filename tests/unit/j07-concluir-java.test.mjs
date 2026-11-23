// J07: "Informar conclusão" pela API Java, só na demonstração local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { concluirOsJava, MENSAGEM_FALHA_CONCLUIR_JAVA } from '../../public/js/data/detalhe-os-java.js';

const config = { ambiente: 'demo-java-local', demoApiJava: '/api-java' };
const id = 'eb0a0100-0000-4000-8000-000000000007';

test('J07: concluir faz POST na rota fixa, só com versao e chave, com o token e sem cookies', async () => {
  let pedido;
  const r = await concluirOsJava(id, 4, 'j07-chave-0001', { config, token: 'tk', buscar: async (url, op) => { pedido = { url, op }; return Response.json({ estado: 'concluida' }); } });
  assert.deepEqual(r, { estado: 'concluida' });
  assert.equal(pedido.url, `/api-java/business/ordens-servico/${id}/concluir`);
  assert.equal(pedido.op.method, 'POST');
  assert.deepEqual(JSON.parse(pedido.op.body), { versao: 4, chave: 'j07-chave-0001' });
  assert.equal(pedido.op.headers.Authorization, 'Bearer tk');
  assert.equal(pedido.op.credentials, 'omit');
});

test('J07: mês fechado e conflitos chegam com o código e a mensagem da função', async () => {
  for (const codigo of ['PERIOD_LOCKED', 'VERSION_CONFLICT', 'STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT']) {
    await assert.rejects(concluirOsJava(id, 4, `j07-${codigo}`, { config, token: 't', buscar: async () => Response.json({ codigo, mensagem: `m ${codigo}` }, { status: 409 }) }),
      { codigo, message: `m ${codigo}` });
  }
});

test('J07: resultado incerto mantém a chave e reenvia exatamente o mesmo pedido; uma tentativa por clique', async () => {
  const corpos = [];
  const buscar = async (url, op) => { corpos.push(op.body); return corpos.length === 1 ? new Response('', { status: 502 }) : Response.json({ estado: 'concluida' }); };
  await assert.rejects(concluirOsJava(id, 4, 'j07-incerto-01', { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_CONCLUIR_JAVA });
  assert.equal(corpos.length, 1);
  // a tela recarregou a versão por fora (5), mas a repetição da mesma chave reaproveita o pedido original (versão 4)
  assert.deepEqual(await concluirOsJava(id, 5, 'j07-incerto-01', { config, token: 't', buscar }), { estado: 'concluida' });
  assert.equal(corpos.length, 2);
  assert.equal(corpos[1], corpos[0]);
});
