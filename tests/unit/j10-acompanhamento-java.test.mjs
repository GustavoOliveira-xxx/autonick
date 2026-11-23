// J10: atualização, dados e garantia pela API Java, só na demonstração local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicarAtualizacaoJava, atualizarDadosJava, registrarGarantiaJava, MENSAGEM_FALHA_ATUALIZACAO_JAVA, MENSAGEM_FALHA_GARANTIA_JAVA }
  from '../../public/js/data/detalhe-os-java.js';

const config = { ambiente: 'demo-java-local', demoApiJava: '/api-java' };
const id = 'eb0a0100-0000-4000-8000-000000000010';
const base = `/api-java/business/ordens-servico/${id}`;

test('J10: rotas fixas e corpos: atualização sem versão e com publica booleano; dados com objeto; garantia com versão', async () => {
  const pedidos = [];
  const opcoes = { config, token: 'tk', buscar: async (url, op) => { pedidos.push({ url, op }); return Response.json({}); } };
  await publicarAtualizacaoJava(id, 'j10-pub-0001', 'Chegamos às 14h.', true, opcoes);
  await publicarAtualizacaoJava(id, 'j10-int-0001', 'Nota só da equipe.', undefined, opcoes);
  await atualizarDadosJava(id, 3, 'j10-dad-0001', { responsavel_auth_id: 'u1', previsao_conclusao: null }, opcoes);
  await registrarGarantiaJava(id, 4, 'j10-gar-0001', 90, undefined, opcoes);
  assert.deepEqual(pedidos.map((p) => [p.url, p.op.method, JSON.parse(p.op.body)]), [
    [`${base}/publicar-atualizacao`, 'POST', { chave: 'j10-pub-0001', texto: 'Chegamos às 14h.', publica: true }],
    [`${base}/publicar-atualizacao`, 'POST', { chave: 'j10-int-0001', texto: 'Nota só da equipe.', publica: false }],
    [`${base}/atualizar-dados`, 'POST', { versao: 3, chave: 'j10-dad-0001', dados: { responsavel_auth_id: 'u1', previsao_conclusao: null } }],
    [`${base}/registrar-garantia`, 'POST', { versao: 4, chave: 'j10-gar-0001', dias: 90, condicoes: null }],
  ]);
  for (const p of pedidos) {
    assert.equal(p.op.headers.Authorization, 'Bearer tk');
    assert.equal(p.op.credentials, 'omit');
  }
});

test('J10: conflitos e validação chegam com o código e a mensagem da função', async () => {
  const msg = 'A garantia é registrada na OS concluída, antes do encerramento.';
  await assert.rejects(registrarGarantiaJava(id, 4, 'j10-estado-01', 90, null, { config, token: 't', buscar: async () => Response.json({ codigo: 'STATE_CONFLICT', mensagem: msg }, { status: 409 }) }),
    { codigo: 'STATE_CONFLICT', message: msg });
  await assert.rejects(atualizarDadosJava(id, 3, 'j10-versao-01', {}, { config, token: 't', buscar: async () => Response.json({ codigo: 'VERSION_CONFLICT', mensagem: 'mudou' }, { status: 409 }) }),
    { codigo: 'VERSION_CONFLICT', message: 'mudou' });
  await assert.rejects(publicarAtualizacaoJava(id, 'j10-valid-01', 'Ligue 11 98765-4321', true, { config, token: 't', buscar: async () => Response.json({ codigo: 'VALIDATION_ERROR', mensagem: 'Sem contato.' }, { status: 400 }) }),
    { codigo: 'VALIDATION_ERROR', message: 'Sem contato.' });
});

test('J10: resultado incerto reenvia o pedido original; trocar texto, visibilidade ou dados com a mesma chave não é enviado', async () => {
  const corpos = [];
  const buscar = async (url, op) => { corpos.push(op.body); return corpos.length === 1 ? new Response('', { status: 502 }) : Response.json({ ok: true }); };
  await assert.rejects(publicarAtualizacaoJava(id, 'j10-incerto-1', 'Nota só da equipe.', false, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_ATUALIZACAO_JAVA });
  // a mesma chave, agora marcada como pública: não sai do navegador (a nota não vira pública por um reenvio)
  await assert.rejects(publicarAtualizacaoJava(id, 'j10-incerto-1', 'Nota só da equipe.', true, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  await assert.rejects(publicarAtualizacaoJava(id, 'j10-incerto-1', 'Outro texto.', false, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  assert.equal(corpos.length, 1);
  assert.deepEqual(await publicarAtualizacaoJava(id, 'j10-incerto-1', 'Nota só da equipe.', false, { config, token: 't', buscar }), { ok: true });
  assert.equal(corpos[1], corpos[0]);

  const garantias = [];
  const falhaDeRede = async (url, op) => { garantias.push(op.body); if (garantias.length === 1) throw new TypeError('Failed to fetch'); return Response.json({ versao: 5 }); };
  await assert.rejects(registrarGarantiaJava(id, 4, 'j10-incerto-2', 90, 'Condições', { config, token: 't', buscar: falhaDeRede }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_GARANTIA_JAVA });
  await assert.rejects(registrarGarantiaJava(id, 4, 'j10-incerto-2', 120, 'Condições', { config, token: 't', buscar: falhaDeRede }), { codigo: 'NETWORK_UNKNOWN' });
  // a tela recarregou (versão 5), mas o reenvio da mesma chave usa o pedido original (versão 4)
  assert.deepEqual(await registrarGarantiaJava(id, 5, 'j10-incerto-2', 90, 'Condições', { config, token: 't', buscar: falhaDeRede }), { versao: 5 });
  assert.equal(garantias[1], garantias[0]);
  assert.equal(JSON.parse(garantias[1]).versao, 4);
});

test('J10: fora da demonstração, as três continuam no Neon, com os mesmos argumentos de antes e sem fetch', async () => {
  const { neon } = await import('../../public/js/data/sessao.js');
  const ordens = await import('../../public/js/data/ordens.js');
  const chamadas = [];
  const rpcOriginal = neon.rpc;
  const fetchOriginal = globalThis.fetch;
  neon.rpc = async (fn, args) => { chamadas.push([fn, args]); return {}; };
  globalThis.fetch = async () => { throw new Error('não deveria chamar fetch'); };
  try {
    await ordens.publicarAtualizacao('o1', 'Nota.', false, 'chave-0001');
    await ordens.atualizarDados('o2', { recorrencia: 'mensal' }, 3, 'chave-0002');
    await ordens.registrarGarantia('o3', 90, '', 'chave-0003', 4);
  } finally {
    neon.rpc = rpcOriginal;
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(chamadas, [
    ['publicar_atualizacao_os', { p_os_id: 'o1', p_texto: 'Nota.', p_publica: false, p_operation_key: 'chave-0001' }],
    ['atualizar_dados_os', { p_os_id: 'o2', p_dados: { recorrencia: 'mensal' }, p_expected_version: 3, p_operation_key: 'chave-0002' }],
    ['registrar_garantia_os', { p_os_id: 'o3', p_dias: 90, p_condicoes: null, p_operation_key: 'chave-0003' }],
  ]);
});
