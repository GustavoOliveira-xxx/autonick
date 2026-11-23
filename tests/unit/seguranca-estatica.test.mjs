/**
 * Varredura de segredos e verificações estáticas (SEC-T06, RNF-005,
 * ADR-002: nunca DATABASE_URL, senhas ou credenciais no repositório).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const IGNORAR = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);
const TEXTO = new Set(['.js', '.mjs', '.html', '.css', '.md', '.json', '.webmanifest', '.yml', '.yaml', '.txt', '.py', '.toml', '']);

async function* arquivos(dir) {
  for (const nome of await readdir(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    const info = await stat(caminho);
    if (info.isDirectory()) yield* arquivos(caminho);
    else if (TEXTO.has(extname(nome))) yield caminho;
  }
}

const PADROES = [
  ['string de conexão PostgreSQL com senha', /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@]+@/i],
  ['senha de papel Neon', /\bnpg_[A-Za-z0-9]{10,}/],
  ['DATABASE_URL preenchida', /DATABASE_URL\s*=\s*(?!REPLACE_IN_SECURE_STORE)\S+/],
  ['chave de acesso AWS/S3', /\bAKIA[0-9A-Z]{16}\b/],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['token de API genérico', /\bsk-[A-Za-z0-9]{24,}/],
  ['chave de API do Neon', /\bnapi_[A-Za-z0-9]{20,}/],
];

test('nenhum segredo ou credencial no repositório', async () => {
  const achados = [];
  for await (const arquivo of arquivos(RAIZ)) {
    const conteudo = await readFile(arquivo, 'utf8');
    for (const [nome, padrao] of PADROES) {
      if (padrao.test(conteudo)) achados.push(`${arquivo.replace(RAIZ, '')}: ${nome}`);
    }
  }
  assert.deepEqual(achados, []);
});

test('páginas não usam scripts ou estilos inline (compatível com a CSP)', async () => {
  for await (const arquivo of arquivos(join(RAIZ, 'public'))) {
    if (!arquivo.endsWith('.html')) continue;
    const html = await readFile(arquivo, 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${arquivo}: script inline`);
    assert.doesNotMatch(html, /\sstyle=/i, `${arquivo}: atributo style`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${arquivo}: manipulador inline`);
  }
});

test('todos os arquivos guardados pelo service worker existem', async () => {
  const sw = await readFile(join(RAIZ, 'public/service-worker.js'), 'utf8');
  const lista = [...sw.matchAll(/^\s+'(\/[^']+)',$/gm)].map((m) => m[1]);
  assert.ok(lista.length > 5);
  for (const caminho of lista) await stat(join(RAIZ, 'public', caminho));
  // M13 (D13-04): só a página offline e a Ajuda são páginas guardadas; nada de API, autenticação ou dado.
  for (const caminho of lista) assert.doesNotMatch(caminho, /api|auth|\.html$(?<!offline\.html|ajuda\.html)/, caminho);
});

test('M13: páginas que abrem sem conexão têm todos os módulos que importam no cache do service worker', async () => {
  const sw = await readFile(join(RAIZ, 'public/service-worker.js'), 'utf8');
  const lista = new Set([...sw.matchAll(/^\s+'(\/[^']+)',$/gm)].map((m) => m[1]));
  const visitar = async (arquivo, vistos) => {
    if (vistos.has(arquivo)) return;
    vistos.add(arquivo);
    assert.ok(lista.has(arquivo), `${arquivo} precisa estar no cache para a página abrir sem conexão`);
    const codigo = await readFile(join(RAIZ, 'public', arquivo), 'utf8');
    for (const [, rel] of codigo.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) {
      await visitar(new URL(rel, `https://app.test${arquivo}`).pathname, vistos);
    }
  };
  for (const pagina of ['/offline.html', '/ajuda.html']) {
    assert.ok(lista.has(pagina), pagina);
    const html = await readFile(join(RAIZ, 'public', pagina), 'utf8');
    for (const [, src] of html.matchAll(/<(?:script[^>]*src|link[^>]*rel="stylesheet"[^>]*href)="([^"]+)"/g)) {
      if (src.endsWith('.js')) await visitar(src, new Set());
      else assert.ok(lista.has(src), `${pagina}: ${src} fora do cache`);
    }
  }
});

test('M13: versão do app igual à versão do cache do service worker', async () => {
  const sw = await readFile(join(RAIZ, 'public/service-worker.js'), 'utf8');
  const { VERSAO_APP } = await import('../../public/js/versao.js');
  assert.match(sw, new RegExp(`const VERSAO = 'autonick-estatico-v${VERSAO_APP.replaceAll('.', '\\.')}'`));
});

test('logos originais continuam idênticas ao pacote v4', async () => {
  const { createHash } = await import('node:crypto');
  const esperado = {
    'Logo_AutoniCK_geral_referencia.png': '1f270d6ebcccedb02892eb002f5b5f5647a07eabb28db924e91f2982666e35ca',
    'Logo_AutoniCK_Empresarial_referencia.png': '7a1f6aaf67bed92e199cf342e8e6ed3e99d46d6eeb9fc50e950b38d1329f5bcb',
  };
  for (const [nome, hash] of Object.entries(esperado)) {
    const dados = await readFile(join(RAIZ, 'referencias', nome));
    assert.equal(createHash('sha256').update(dados).digest('hex'), hash, nome);
  }
});
