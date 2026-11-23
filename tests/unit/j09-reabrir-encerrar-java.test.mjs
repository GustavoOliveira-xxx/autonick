// J09: "Reabrir para revisão" e "Encerrar" da empresa pela API Java, só na demonstração local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reabrirOsJava, encerrarOsJava, MENSAGEM_FALHA_REABRIR_JAVA, MENSAGEM_FALHA_ENCERRAR_JAVA } from '../../public/js/data/detalhe-os-java.js';

const config = { ambiente: 'demo-java-local', demoApiJava: '/api-java' };
const id = 'eb0a0100-0000-4000-8000-000000000009';
const MOTIVO = 'Vamos colocar o espelho da tomada da sala.';

test('J09: reabrir envia versao, chave e motivo; encerrar só versao e chave; rotas fixas, token e sem cookies', async () => {
  const pedidos = [];
  const opcoes = { config, token: 'tk', buscar: async (url, op) => { pedidos.push({ url, op }); return Response.json({ estado: 'ok' }); } };
  await reabrirOsJava(id, 4, 'j09-reabrir-01', MOTIVO, opcoes);
  await encerrarOsJava(id, 6, 'j09-encerrar-01', opcoes);
  assert.deepEqual(pedidos.map((p) => [p.url, p.op.method, JSON.parse(p.op.body)]), [
    [`/api-java/business/ordens-servico/${id}/reabrir`, 'POST', { versao: 4, chave: 'j09-reabrir-01', motivo: MOTIVO }],
    [`/api-java/business/ordens-servico/${id}/encerrar`, 'POST', { versao: 6, chave: 'j09-encerrar-01' }],
  ]);
  for (const p of pedidos) {
    assert.equal(p.op.headers.Authorization, 'Bearer tk');
    assert.equal(p.op.credentials, 'omit');
  }
});

test('J09: prazo, revisão pendente, versão e chave chegam como conflito com a mensagem da função; sem permissão, 403', async () => {
  const prazo = 'Aguardando a confirmação do cliente ou o prazo de 7 dias depois da conclusão.';
  await assert.rejects(encerrarOsJava(id, 3, 'j09-prazo-0001', { config, token: 't', buscar: async () => Response.json({ codigo: 'STATE_CONFLICT', mensagem: prazo }, { status: 409 }) }),
    { codigo: 'STATE_CONFLICT', message: prazo });
  for (const codigo of ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT']) {
    await assert.rejects(reabrirOsJava(id, 3, `j09-${codigo}`, MOTIVO, { config, token: 't', buscar: async () => Response.json({ codigo, mensagem: `m ${codigo}` }, { status: 409 }) }),
      { codigo, message: `m ${codigo}` });
  }
  await assert.rejects(encerrarOsJava(id, 3, 'j09-403-chave', { config, token: 't', buscar: async () => Response.json({ codigo: 'FORBIDDEN_ACTION', mensagem: 'Sem permissão.' }, { status: 403 }) }),
    { codigo: 'FORBIDDEN_ACTION', message: 'Sem permissão.' });
});

test('J09: resultado incerto mantém a chave e reenvia o pedido original; motivo trocado não é reenviado', async () => {
  const corpos = [];
  const buscar = async (url, op) => { corpos.push(op.body); return corpos.length === 1 ? new Response('', { status: 502 }) : Response.json({ estado: 'em_execucao' }); };
  await assert.rejects(reabrirOsJava(id, 4, 'j09-incerto-01', MOTIVO, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_REABRIR_JAVA });
  await assert.rejects(reabrirOsJava(id, 4, 'j09-incerto-01', `${MOTIVO} Outro.`, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  assert.equal(corpos.length, 1);
  assert.deepEqual(await reabrirOsJava(id, 5, 'j09-incerto-01', MOTIVO, { config, token: 't', buscar }), { estado: 'em_execucao' });
  assert.equal(corpos[1], corpos[0]);

  const encerramentos = [];
  const falhaDeRede = async (url, op) => { encerramentos.push(op.body); if (encerramentos.length === 1) throw new TypeError('Failed to fetch'); return Response.json({ estado: 'encerrada' }); };
  await assert.rejects(encerrarOsJava(id, 6, 'j09-incerto-02', { config, token: 't', buscar: falhaDeRede }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_ENCERRAR_JAVA });
  assert.deepEqual(await encerrarOsJava(id, 7, 'j09-incerto-02', { config, token: 't', buscar: falhaDeRede }), { estado: 'encerrada' });
  assert.equal(encerramentos[1], encerramentos[0]);
});

test('J09: fora da demonstração, reabrir e encerrar continuam no Neon (mudar_estado_os), sem fetch à API Java', async () => {
  const { neon } = await import('../../public/js/data/sessao.js');
  const ordens = await import('../../public/js/data/ordens.js');
  const chamadas = [];
  const rpcOriginal = neon.rpc;
  const fetchOriginal = globalThis.fetch;
  neon.rpc = async (fn, args) => { chamadas.push([fn, args]); return {}; };
  globalThis.fetch = async () => { throw new Error('não deveria chamar fetch'); };
  try {
    await ordens.mudarEstado('o1', 'reabrir', MOTIVO, 4, 'chave-0001');
    await ordens.mudarEstado('o2', 'encerrar', null, 6, 'chave-0002');
  } finally {
    neon.rpc = rpcOriginal;
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(chamadas, [
    ['mudar_estado_os', { p_os_id: 'o1', p_acao: 'reabrir', p_motivo: MOTIVO, p_expected_version: 4, p_operation_key: 'chave-0001' }],
    ['mudar_estado_os', { p_os_id: 'o2', p_acao: 'encerrar', p_motivo: null, p_expected_version: 6, p_operation_key: 'chave-0002' }],
  ]);
});
