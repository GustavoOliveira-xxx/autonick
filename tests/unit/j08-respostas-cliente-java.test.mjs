// J08: "Confirmar que recebi" e "Pedir revisão" do Cliente pela API Java, só na demonstração local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmarRecebimentoJava, pedirRevisaoJava, MENSAGEM_FALHA_CONFIRMAR_JAVA, MENSAGEM_FALHA_REVISAO_JAVA } from '../../public/js/data/detalhe-os-java.js';

const config = { ambiente: 'demo-java-local', demoApiJava: '/api-java' };
const id = 'eb0a0100-0000-4000-8000-000000000008';
const TEXTO = 'A tomada da sala ficou sem o espelho.';

test('J08: confirmar e pedir revisão fazem POST nas rotas do Cliente, com versao e chave (e texto), token e sem cookies', async () => {
  const pedidos = [];
  const opcoes = { config, token: 'tk', buscar: async (url, op) => { pedidos.push({ url, op }); return Response.json({ estado: 'concluida' }); } };
  await confirmarRecebimentoJava(id, 3, 'j08-confirmar-01', opcoes);
  await pedirRevisaoJava(id, 3, 'j08-revisao-01', TEXTO, opcoes);
  assert.deepEqual(pedidos.map((p) => [p.url, p.op.method, JSON.parse(p.op.body)]), [
    [`/api-java/cliente/ordens-servico/${id}/confirmar-recebimento`, 'POST', { versao: 3, chave: 'j08-confirmar-01' }],
    [`/api-java/cliente/ordens-servico/${id}/pedir-revisao`, 'POST', { versao: 3, chave: 'j08-revisao-01', texto: TEXTO }],
  ]);
  for (const p of pedidos) {
    assert.equal(p.op.headers.Authorization, 'Bearer tk');
    assert.equal(p.op.credentials, 'omit');
  }
});

test('J08: versão desatualizada, estado, chave com outros dados, 404 e texto inválido chegam com o código da API', async () => {
  for (const codigo of ['VERSION_CONFLICT', 'STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT']) {
    await assert.rejects(confirmarRecebimentoJava(id, 3, `j08-${codigo}`, { config, token: 't', buscar: async () => Response.json({ codigo, mensagem: `m ${codigo}` }, { status: 409 }) }),
      { codigo, message: `m ${codigo}` });
  }
  await assert.rejects(pedirRevisaoJava(id, 3, 'j08-404-chave', TEXTO, { config, token: 't', buscar: async () => Response.json({ codigo: 'NOT_FOUND', mensagem: 'Ordem de serviço não encontrada.' }, { status: 404 }) }),
    { codigo: 'NOT_FOUND', message: 'Ordem de serviço não encontrada.' });
  await assert.rejects(pedirRevisaoJava(id, 3, 'j08-400-chave', 'Me liga 11 98765-4321', { config, token: 't', buscar: async () => Response.json({ codigo: 'VALIDATION_ERROR', mensagem: 'Sem contato.' }, { status: 400 }) }),
    { codigo: 'VALIDATION_ERROR', message: 'Sem contato.' });
});

test('J08: resultado incerto mantém a chave e reenvia o mesmo pedido (versão original); texto trocado não é reenviado', async () => {
  const corpos = [];
  const buscar = async (url, op) => { corpos.push(op.body); return corpos.length === 1 ? new Response('', { status: 502 }) : Response.json({ estado: 'concluida', revisao_pendente: true }); };
  await assert.rejects(pedirRevisaoJava(id, 3, 'j08-incerto-01', TEXTO, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_REVISAO_JAVA });
  await assert.rejects(pedirRevisaoJava(id, 3, 'j08-incerto-01', `${TEXTO} Outro.`, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  assert.equal(corpos.length, 1);
  assert.deepEqual(await pedirRevisaoJava(id, 4, 'j08-incerto-01', TEXTO, { config, token: 't', buscar }), { estado: 'concluida', revisao_pendente: true });
  assert.equal(corpos.length, 2);
  assert.equal(corpos[1], corpos[0]);

  const confirmacoes = [];
  const falhaDeRede = async (url, op) => { confirmacoes.push(op.body); if (confirmacoes.length === 1) throw new TypeError('Failed to fetch'); return Response.json({ estado: 'encerrada' }); };
  await assert.rejects(confirmarRecebimentoJava(id, 3, 'j08-incerto-02', { config, token: 't', buscar: falhaDeRede }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_CONFIRMAR_JAVA });
  assert.deepEqual(await confirmarRecebimentoJava(id, 4, 'j08-incerto-02', { config, token: 't', buscar: falhaDeRede }), { estado: 'encerrada' });
  assert.equal(confirmacoes[1], confirmacoes[0]);
});

test('J08: a mesma chave em ações diferentes não mistura os pedidos pendentes', async () => {
  const corpos = [];
  const buscar = async (url, op) => { corpos.push([url, op.body]); return new Response('', { status: 502 }); };
  await assert.rejects(confirmarRecebimentoJava(id, 3, 'j08-mesma-chave', { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  await assert.rejects(pedirRevisaoJava(id, 3, 'j08-mesma-chave', TEXTO, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  assert.equal(corpos.length, 2);
  assert.deepEqual(JSON.parse(corpos[1][1]), { versao: 3, chave: 'j08-mesma-chave', texto: TEXTO });
});

test('J08: fora da demonstração, as duas respostas do Cliente continuam no Neon, sem versão e sem fetch à API Java', async () => {
  const { neon } = await import('../../public/js/data/sessao.js');
  const ordens = await import('../../public/js/data/ordens.js');
  const chamadas = [];
  const rpcOriginal = neon.rpc;
  const fetchOriginal = globalThis.fetch;
  neon.rpc = async (fn, args) => { chamadas.push([fn, args]); return {}; };
  globalThis.fetch = async () => { throw new Error('não deveria chamar fetch'); };
  try {
    await ordens.confirmarRecebimento('o1', 'chave-0001', 3);
    await ordens.pedirRevisaoOs('o2', TEXTO, 'chave-0002', 3);
  } finally {
    neon.rpc = rpcOriginal;
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(chamadas, [
    ['confirmar_recebimento_servico', { p_os_id: 'o1', p_operation_key: 'chave-0001' }],
    ['pedir_revisao_os', { p_os_id: 'o2', p_texto: TEXTO, p_operation_key: 'chave-0002' }],
  ]);
});
