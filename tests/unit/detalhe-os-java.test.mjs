// J03: o detalhe da OS só vai para a API Java na demonstração local, ativada explicitamente; fora dela, nada muda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detalheViaJavaAtivo, detalheJava, MENSAGEM_FALHA_JAVA } from '../../public/js/data/detalhe-os-java.js';
import { CONFIG_PUBLICA } from '../../public/js/config/public-config.js';
import { conteudoConfig } from '../../scripts/montar-demo-publica.mjs';

const DEMO = { ambiente: 'demo-java-local', neonAuthUrl: '/demo-auth', neonDataApiUrl: '/demo-dados', demoApiJava: '/api-java' };

test('ativo só com a configuração da demonstração e em host local', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(detalheViaJavaAtivo(DEMO, host), true, host);
  for (const host of ['exemplo.vercel.app', 'example.com', '192.168.0.10', '', undefined]) assert.equal(detalheViaJavaAtivo(DEMO, host), false, String(host));
});

test('inativo com a configuração do repositório, da prévia ou com caminho de API inválido', () => {
  assert.equal(detalheViaJavaAtivo(CONFIG_PUBLICA, '127.0.0.1'), false);
  assert.equal(CONFIG_PUBLICA.demoApiJava, undefined);
  assert.equal(detalheViaJavaAtivo({ ...DEMO, ambiente: 'demonstracao' }, '127.0.0.1'), false);
  for (const api of ['https://api.exemplo.com', '//api', '/api/../x', '', null]) assert.equal(detalheViaJavaAtivo({ ...DEMO, demoApiJava: api }, '127.0.0.1'), false, String(api));
});

test('a configuração gerada para a demonstração pública nunca liga a demonstração antiga do J03', () => {
  const texto = conteudoConfig();
  assert.doesNotMatch(texto, /demoApiJava|demo-java-local/);
});

test('o arquivo de configuração do repositório não traz a demonstração', () => {
  assert.doesNotMatch(readFileSync(new URL('../../public/js/config/public-config.js', import.meta.url), 'utf8'), /demoApiJava|demo-java-local/);
});

function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => (corpo === undefined ? Promise.reject(new Error('sem corpo')) : corpo) };
}

test('chama a rota da área com o token, sem cookies e sem cache', async () => {
  let chamada;
  const r = await detalheJava('cliente', 'a b', { config: DEMO, token: 'tk', buscar: async (url, op) => { chamada = { url, op }; return resposta(200, { id: 'x' }); } });
  assert.deepEqual(r, { id: 'x' });
  assert.equal(chamada.url, '/api-java/cliente/ordens-servico/a%20b');
  assert.equal(chamada.op.headers.Authorization, 'Bearer tk');
  assert.equal(chamada.op.credentials, 'omit');
  assert.equal(chamada.op.cache, 'no-store');
});

test('404 vira NOT_FOUND com a mensagem uniforme; 401 vira AUTH_REQUIRED', async () => {
  await assert.rejects(detalheJava('business', '1', { config: DEMO, token: 't', buscar: async () => resposta(404, { codigo: 'NOT_FOUND', mensagem: 'Ordem de serviço não encontrada.' }) }),
    { codigo: 'NOT_FOUND', message: 'Ordem de serviço não encontrada.' });
  await assert.rejects(detalheJava('business', '1', { config: DEMO, token: 't', buscar: async () => resposta(401) }), { codigo: 'AUTH_REQUIRED' });
});

test('Java desligado ou com erro: falha explícita, sem outra fonte', async () => {
  let chamadas = 0;
  const caiu = async () => { chamadas += 1; throw new TypeError('Failed to fetch'); };
  await assert.rejects(detalheJava('cliente', '1', { config: DEMO, token: 't', buscar: caiu }), { codigo: 'API_JAVA_INDISPONIVEL', message: MENSAGEM_FALHA_JAVA });
  assert.equal(chamadas, 1);
  for (const status of [500, 502, 503]) {
    await assert.rejects(detalheJava('cliente', '1', { config: DEMO, token: 't', buscar: async () => resposta(status, {}) }), { codigo: 'API_JAVA_INDISPONIVEL' });
  }
});

// ------------------------------------------------------------------------------------------------ J04: listas
import { minhasOrdensJava, ordensDaEmpresaJava, MENSAGEM_FALHA_LISTA_JAVA } from '../../public/js/data/detalhe-os-java.js';

test('J04: lista do Cliente vai para a rota Java do J01, com o token e sem cookies', async () => {
  let chamada;
  const r = await minhasOrdensJava({ config: DEMO, token: 'tk', buscar: async (url, op) => { chamada = { url, op }; return resposta(200, [{ id: 'a' }]); } });
  assert.deepEqual(r, [{ id: 'a' }]);
  assert.equal(chamada.url, '/api-java/cliente/ordens-servico');
  assert.equal(chamada.op.headers.Authorization, 'Bearer tk');
  assert.equal(chamada.op.credentials, 'omit');
});

test('J04: lista da empresa leva os mesmos filtros, limite e deslocamento; filtro vazio não vai', async () => {
  const urls = [];
  const buscar = async (url) => { urls.push(url); return resposta(200, { itens: [] }); };
  await ordensDaEmpresaJava('e 1', { estado: 'ativas', responsavel: 'u-1', busca: 'Chuveiro 1&x' }, 50, 0, { config: DEMO, token: 't', buscar });
  await ordensDaEmpresaJava('e1', { estado: '', busca: undefined }, 10, 20, { config: DEMO, token: 't', buscar });
  await ordensDaEmpresaJava('e1', undefined, undefined, undefined, { config: DEMO, token: 't', buscar });
  assert.equal(urls[0], '/api-java/empresas/e%201/ordens-servico?estado=ativas&responsavel=u-1&busca=Chuveiro+1%26x&limite=50&deslocamento=0');
  assert.equal(urls[1], '/api-java/empresas/e1/ordens-servico?limite=10&deslocamento=20');
  assert.equal(urls[2], '/api-java/empresas/e1/ordens-servico?limite=50&deslocamento=0');
});

test('J04: erros de regra da API Java chegam com o código e a mensagem da função; o resto é falha da API', async () => {
  const com = (status, corpo) => ordensDaEmpresaJava('e1', {}, 50, 0, { config: DEMO, token: 't', buscar: async () => resposta(status, corpo) });
  await assert.rejects(com(403, { codigo: 'TENANT_FORBIDDEN', mensagem: 'Sem acesso a esta empresa.' }), { codigo: 'TENANT_FORBIDDEN', message: 'Sem acesso a esta empresa.' });
  await assert.rejects(com(400, { codigo: 'VALIDATION_ERROR', mensagem: 'Paginação inválida.' }), { codigo: 'VALIDATION_ERROR', message: 'Paginação inválida.' });
  await assert.rejects(com(403, { codigo: 'OUTRO', mensagem: 'x' }), { codigo: 'API_JAVA_INDISPONIVEL', message: MENSAGEM_FALHA_LISTA_JAVA });
  await assert.rejects(com(502, {}), { codigo: 'API_JAVA_INDISPONIVEL', message: MENSAGEM_FALHA_LISTA_JAVA });
  let chamadas = 0;
  await assert.rejects(minhasOrdensJava({ config: DEMO, token: 't', buscar: async () => { chamadas += 1; throw new TypeError('Failed to fetch'); } }),
    { codigo: 'API_JAVA_INDISPONIVEL', message: MENSAGEM_FALHA_LISTA_JAVA });
  assert.equal(chamadas, 1);
});

test('J04: fora da demonstração, as listas e o detalhe continuam chamando o Neon (nenhum fetch à API Java)', async () => {
  const { neon } = await import('../../public/js/data/sessao.js');
  const ordens = await import('../../public/js/data/ordens.js');
  const chamadas = [];
  const rpcOriginal = neon.rpc;
  const fetchOriginal = globalThis.fetch;
  neon.rpc = async (fn, args) => { chamadas.push([fn, args]); return fn === 'minhas_os' ? [] : {}; };
  globalThis.fetch = async () => { throw new Error('não deveria chamar fetch'); };
  try {
    await ordens.minhasOrdens();
    await ordens.ordensDaEmpresa('e1', { estado: 'ativas' }, 50, 0);
    await ordens.minhaOrdem('o1');
    await ordens.ordem('o2');
    await ordens.mudarEstado('o3', 'iniciar', null, 1, 'chave-0001');
    await ordens.mudarEstado('o4', 'pausar', 'Aguardando peça.', 2, 'chave-0002');
    await ordens.mudarEstado('o5', 'retomar', null, 3, 'chave-0003');
    await ordens.mudarEstado('o6', 'concluir', null, 4, 'chave-0004');
  } finally {
    neon.rpc = rpcOriginal;
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(chamadas, [
    ['minhas_os', {}],
    ['ordens_da_empresa', { p_empresa_id: 'e1', p_filtros: { estado: 'ativas' }, p_limite: 50, p_deslocamento: 0 }],
    ['minha_os', { p_os_id: 'o1' }],
    ['os_detalhe', { p_os_id: 'o2' }],
    ['mudar_estado_os', { p_os_id: 'o3', p_acao: 'iniciar', p_motivo: null, p_expected_version: 1, p_operation_key: 'chave-0001' }],
    ['mudar_estado_os', { p_os_id: 'o4', p_acao: 'pausar', p_motivo: 'Aguardando peça.', p_expected_version: 2, p_operation_key: 'chave-0002' }],
    ['mudar_estado_os', { p_os_id: 'o5', p_acao: 'retomar', p_motivo: null, p_expected_version: 3, p_operation_key: 'chave-0003' }],
    ['mudar_estado_os', { p_os_id: 'o6', p_acao: 'concluir', p_motivo: null, p_expected_version: 4, p_operation_key: 'chave-0004' }],
  ]);
});

// ------------------------------------------------------------------------------------------------ J05: iniciar
import { iniciarOsJava, MENSAGEM_FALHA_INICIAR_JAVA } from '../../public/js/data/detalhe-os-java.js';

test('J05: iniciar faz POST na rota fixa, com corpo só de versao e chave, token e sem cookies', async () => {
  let chamada;
  const r = await iniciarOsJava('os 1', 3, 'k-12345678', { config: DEMO, token: 'tk', buscar: async (url, op) => { chamada = { url, op }; return resposta(200, { estado: 'em_execucao' }); } });
  assert.deepEqual(r, { estado: 'em_execucao' });
  assert.equal(chamada.url, '/api-java/business/ordens-servico/os%201/iniciar');
  assert.equal(chamada.op.method, 'POST');
  assert.deepEqual(JSON.parse(chamada.op.body), { versao: 3, chave: 'k-12345678' });
  assert.equal(chamada.op.headers['Content-Type'], 'application/json');
  assert.equal(chamada.op.headers.Authorization, 'Bearer tk');
  assert.equal(chamada.op.credentials, 'omit');
});

test('J05: conflitos de versão, estado e chave chegam com o código e a mensagem da função (a tela recarrega)', async () => {
  for (const codigo of ['VERSION_CONFLICT', 'STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT']) {
    await assert.rejects(iniciarOsJava('o', 1, 'k-12345678', { config: DEMO, token: 't', buscar: async () => resposta(409, { codigo, mensagem: `m ${codigo}` }) }),
      { codigo, message: `m ${codigo}` });
  }
  await assert.rejects(iniciarOsJava('o', 1, 'k-12345678', { config: DEMO, token: 't', buscar: async () => resposta(403, { codigo: 'FORBIDDEN_ACTION', mensagem: 'sem acesso' }) }),
    { codigo: 'FORBIDDEN_ACTION' });
  await assert.rejects(iniciarOsJava('o', 1, 'k-12345678', { config: DEMO, token: 't', buscar: async () => resposta(404, { codigo: 'NOT_FOUND', mensagem: 'Ordem de serviço não encontrada.' }) }),
    { codigo: 'NOT_FOUND' });
});

test('J05: API Java fora do ar ao iniciar vira NETWORK_UNKNOWN (a tela mantém a chave e não diz que mudou), uma única tentativa', async () => {
  let chamadas = 0;
  await assert.rejects(iniciarOsJava('o', 1, 'k-12345678', { config: DEMO, token: 't', buscar: async () => { chamadas += 1; throw new TypeError('Failed to fetch'); } }),
    { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_INICIAR_JAVA });
  assert.equal(chamadas, 1);
  for (const status of [500, 502, 503]) {
    await assert.rejects(iniciarOsJava('o', 1, 'k-12345678', { config: DEMO, token: 't', buscar: async () => resposta(status, {}) }), { codigo: 'NETWORK_UNKNOWN' });
  }
});

// ------------------------------------------------------------------------------------------------ J06: pausar e retomar
import { pausarOsJava, retomarOsJava, MENSAGEM_FALHA_PAUSAR_JAVA, MENSAGEM_FALHA_RETOMAR_JAVA } from '../../public/js/data/detalhe-os-java.js';

test('J06: pausar faz POST na rota fixa com versao, chave e motivo; retomar só com versao e chave', async () => {
  const chamadas = [];
  const buscar = async (url, op) => { chamadas.push({ url, op }); return resposta(200, { estado: 'x' }); };
  await pausarOsJava('o1', 2, 'k-12345678', 'Aguardando peça.', { config: DEMO, token: 't', buscar });
  await retomarOsJava('o1', 3, 'k-87654321', { config: DEMO, token: 't', buscar });
  assert.equal(chamadas[0].url, '/api-java/business/ordens-servico/o1/pausar');
  assert.equal(chamadas[0].op.method, 'POST');
  assert.deepEqual(JSON.parse(chamadas[0].op.body), { versao: 2, chave: 'k-12345678', motivo: 'Aguardando peça.' });
  assert.equal(chamadas[1].url, '/api-java/business/ordens-servico/o1/retomar');
  assert.deepEqual(JSON.parse(chamadas[1].op.body), { versao: 3, chave: 'k-87654321' });
});

test('J06: sem resposta da API, pausar e retomar viram NETWORK_UNKNOWN (a tela mantém a chave e não diz que mudou)', async () => {
  const caiu = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(pausarOsJava('o', 2, 'k-12345678', 'Motivo.', { config: DEMO, token: 't', buscar: caiu }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_PAUSAR_JAVA });
  await assert.rejects(retomarOsJava('o', 3, 'k-12345678', { config: DEMO, token: 't', buscar: async () => resposta(502, {}) }), { codigo: 'NETWORK_UNKNOWN', message: MENSAGEM_FALHA_RETOMAR_JAVA });
  await assert.rejects(retomarOsJava('o', 3, 'k-12345678', { config: DEMO, token: 't', buscar: async () => resposta(409, { codigo: 'STATE_CONFLICT', mensagem: 'Não é possível retomar.' }) }),
    { codigo: 'STATE_CONFLICT' });
});
