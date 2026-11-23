// J11: materiais e estoque da OS pela API Java, só na demonstração local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adicionarMaterialJava, reservarMaterialJava, registrarUsoJava, decidirUsoJava, devolverMaterialJava, MENSAGEM_FALHA_MATERIAL_JAVA }
  from '../../public/js/data/detalhe-os-java.js';

const config = { ambiente: 'demo-java-local', demoApiJava: '/api-java' };
const os = 'eb0a0100-0000-4000-8000-000000000011';
const mat = 'eb0a0100-0000-4000-8000-0000000000c1';
const uso = 'eb0a0100-0000-4000-8000-0000000000d1';
const variacao = 'eb0a0100-0000-4000-8000-0000000000e1';
const base = `/api-java/business/ordens-servico/${os}`;

test('J11: as cinco rotas fixas, com o id do material ou do uso na rota e corpos estritos', async () => {
  const pedidos = [];
  const opcoes = { config, token: 'tk', buscar: async (url, op) => { pedidos.push({ url, op }); return Response.json([]); } };
  await adicionarMaterialJava(os, 'j11-adi-0001', variacao, 3, opcoes);
  await reservarMaterialJava(os, mat, 'j11-res-0001', true, opcoes);
  await registrarUsoJava(os, 'j11-uso-0001', variacao, 2, '', opcoes);
  await decidirUsoJava(os, uso, 1, 'j11-dec-0001', true, 'ignorado', opcoes);
  await decidirUsoJava(os, uso, 1, 'j11-dec-0002', false, 'Não foi usado.', opcoes);
  await devolverMaterialJava(os, mat, 'j11-dev-0001', 1, 'Sobrou na obra.', opcoes);
  assert.deepEqual(pedidos.map((p) => [p.url, p.op.method, JSON.parse(p.op.body)]), [
    [`${base}/materiais`, 'POST', { chave: 'j11-adi-0001', variacao_id: variacao, quantidade: 3 }],
    [`${base}/materiais/${mat}/reserva`, 'POST', { chave: 'j11-res-0001', reservar: true }],
    [`${base}/usos-material`, 'POST', { chave: 'j11-uso-0001', variacao_id: variacao, quantidade: 2, motivo: null }],
    [`${base}/usos-material/${uso}/decisao`, 'POST', { versao: 1, chave: 'j11-dec-0001', aprovar: true, motivo: null }],
    [`${base}/usos-material/${uso}/decisao`, 'POST', { versao: 1, chave: 'j11-dec-0002', aprovar: false, motivo: 'Não foi usado.' }],
    [`${base}/materiais/${mat}/devolucao`, 'POST', { chave: 'j11-dev-0001', quantidade: 1, motivo: 'Sobrou na obra.' }],
  ]);
  for (const p of pedidos) {
    assert.equal(p.op.headers.Authorization, 'Bearer tk');
    assert.equal(p.op.credentials, 'omit');
  }
});

test('J11: estoque insuficiente, estado e versão chegam com o código e a mensagem do banco', async () => {
  const msg = 'Estoque insuficiente: há 0 disponíveis de Resistência (Padrão).';
  await assert.rejects(reservarMaterialJava(os, mat, 'j11-insu-001', true, { config, token: 't', buscar: async () => Response.json({ codigo: 'INSUFFICIENT_STOCK', mensagem: msg }, { status: 409 }) }),
    { codigo: 'INSUFFICIENT_STOCK', message: msg });
  for (const codigo of ['STATE_CONFLICT', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT']) {
    await assert.rejects(decidirUsoJava(os, uso, 1, `j11-${codigo}`, true, null, { config, token: 't', buscar: async () => Response.json({ codigo, mensagem: `m ${codigo}` }, { status: 409 }) }),
      { codigo, message: `m ${codigo}` });
  }
});

test('J11: resultado incerto reenvia o pedido original; quantidade trocada com a mesma chave não é enviada', async () => {
  const corpos = [];
  const buscar = async (url, op) => { corpos.push(op.body); return corpos.length === 1 ? new Response('', { status: 502 }) : Response.json({ uso_id: uso, estado: 'confirmado', materiais: [] }); };
  await assert.rejects(registrarUsoJava(os, 'j11-incerto-1', variacao, 2, null, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_MATERIAL_JAVA });
  await assert.rejects(registrarUsoJava(os, 'j11-incerto-1', variacao, 3, null, { config, token: 't', buscar }), { codigo: 'NETWORK_UNKNOWN' });
  assert.equal(corpos.length, 1);
  assert.deepEqual(await registrarUsoJava(os, 'j11-incerto-1', variacao, 2, null, { config, token: 't', buscar }), { uso_id: uso, estado: 'confirmado', materiais: [] });
  assert.equal(corpos[1], corpos[0]);
});

test('J11: fora da demonstração, as cinco continuam no Neon com os argumentos de antes e sem fetch', async () => {
  const { neon } = await import('../../public/js/data/sessao.js');
  const ordens = await import('../../public/js/data/ordens.js');
  const chamadas = [];
  const rpcOriginal = neon.rpc;
  const fetchOriginal = globalThis.fetch;
  neon.rpc = async (fn, args) => { chamadas.push([fn, args]); return {}; };
  globalThis.fetch = async () => { throw new Error('não deveria chamar fetch'); };
  try {
    await ordens.adicionarMaterial('o1', variacao, 3, 'chave-0001');
    await ordens.reservarMaterial(mat, true, 'chave-0002', 'o1');
    await ordens.registrarUso('o1', variacao, 2, '', 'chave-0003');
    await ordens.decidirUso(uso, false, 'Não foi usado.', 1, 'chave-0004', 'o1');
    await ordens.devolverMaterial(mat, 1, 'Sobrou.', 'chave-0005', 'o1');
  } finally {
    neon.rpc = rpcOriginal;
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(chamadas, [
    ['adicionar_material_os', { p_os_id: 'o1', p_variacao_id: variacao, p_quantidade: 3, p_operation_key: 'chave-0001' }],
    ['reservar_material_os', { p_material_id: mat, p_reservar: true, p_operation_key: 'chave-0002' }],
    ['registrar_uso_material', { p_os_id: 'o1', p_variacao_id: variacao, p_quantidade: 2, p_motivo: null, p_operation_key: 'chave-0003' }],
    ['decidir_uso_material', { p_uso_id: uso, p_aprovar: false, p_motivo: 'Não foi usado.', p_expected_version: 1, p_operation_key: 'chave-0004' }],
    ['devolver_material_os', { p_material_id: mat, p_quantidade: 1, p_motivo: 'Sobrou.', p_operation_key: 'chave-0005' }],
  ]);
});
