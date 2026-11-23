// Seleção explícita do backend (Neon ou API Java) e montagem da demonstração pública.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecosDoBackend } from '../../public/js/data/sessao.js';
import { detalheViaJavaAtivo } from '../../public/js/data/detalhe-os-java.js';
import { validarApi, vercelJson, conteudoConfig } from '../../scripts/montar-demo-publica.mjs';

test('backend neon usa só as URLs públicas do Neon', () => {
  assert.deepEqual(enderecosDoBackend({ backend: 'neon', neonAuthUrl: 'https://a.neon.tech/auth', neonDataApiUrl: 'https://b.neon.tech/rest' }),
    { backend: 'neon', authUrl: 'https://a.neon.tech/auth', dataApiUrl: 'https://b.neon.tech/rest' });
  assert.deepEqual(enderecosDoBackend({ neonAuthUrl: null, neonDataApiUrl: null }), { backend: 'neon', authUrl: null, dataApiUrl: null });
});

test('backend java usa /api na mesma origem, sem volta para o Neon', () => {
  for (const backend of ['java-local', 'java-online']) {
    const e = enderecosDoBackend({ backend, apiJava: '/api', neonAuthUrl: 'https://a.neon.tech/auth', neonDataApiUrl: 'https://b.neon.tech/rest' });
    assert.deepEqual(e, { backend, authUrl: '/api/auth', dataApiUrl: '/api/dados' });
  }
});

test('backend desconhecido deixa o acesso desligado', () => {
  assert.deepEqual(enderecosDoBackend({ backend: 'outro', neonAuthUrl: 'https://a.neon.tech/auth' }), { backend: 'outro', authUrl: null, dataApiUrl: null });
});

test('OS pelas rotas Java quando o backend é Java, em qualquer host', () => {
  assert.equal(detalheViaJavaAtivo({ backend: 'java-online', apiJava: '/api' }, 'autonick-demo.vercel.app'), true);
  assert.equal(detalheViaJavaAtivo({ backend: 'java-local', apiJava: '/api' }, '127.0.0.1'), true);
  assert.equal(detalheViaJavaAtivo({ backend: 'neon' }, '127.0.0.1'), false);
});

test('montagem pública: API só https sem credenciais e nunca o Neon', () => {
  assert.equal(validarApi('https://autonick-api.vercel.app'), 'https://autonick-api.vercel.app');
  for (const ruim of ['http://x.vercel.app', 'https://u:s@x.vercel.app', 'https://x.vercel.app/api', 'https://x.vercel.app?a=1', 'https://ep-a.neon.tech']) {
    assert.throws(() => validarApi(ruim), ruim);
  }
  const v = vercelJson('https://autonick-api.vercel.app');
  assert.deepEqual(v.rewrites, [{ source: '/api/:caminho*', destination: 'https://autonick-api.vercel.app/api/:caminho*' }]);
  const csp = v.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(conteudoConfig(), /"backend":"java-online"/);
  assert.match(conteudoConfig(), /"publica":true/);
});
