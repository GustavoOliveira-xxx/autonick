/**
 * Servidor estático local, sem dependências, para desenvolvimento e
 * testes do M01. Serve apenas a pasta public/ em 127.0.0.1.
 * Envia cabeçalhos de segurança semelhantes aos previstos para produção
 * (ARQ-001 §15.2), inclusive CSP sem scripts ou estilos inline.
 *
 * Uso: node scripts/servidor-local.mjs                         (demonstração, sem backend)
 *      node scripts/servidor-local.mjs --ambiente=desenvolvimento (usa o branch Neon de desenvolvimento)
 * PORTA=4173 por padrão.
 *
 * Com --ambiente, o arquivo /js/config/public-config.js é servido com as URLs
 * PÚBLICAS de config/ambientes.json e a CSP passa a permitir só essas origens.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarCsp, CABECALHOS_FIXOS, origensDoAmbiente } from './politica-seguranca.mjs';

const RAIZ = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const ARQUIVO_AMBIENTES = fileURLToPath(new URL('../config/ambientes.json', import.meta.url));
const NOME_AMBIENTE = process.argv.find((a) => a.startsWith('--ambiente='))?.split('=')[1] ?? null;
const AMBIENTE = NOME_AMBIENTE ? JSON.parse(await readFile(ARQUIVO_AMBIENTES, 'utf8'))[NOME_AMBIENTE] : null;
if (NOME_AMBIENTE && !AMBIENTE) {
  console.error(`Ambiente desconhecido: ${NOME_AMBIENTE}`);
  process.exit(1);
}
const ORIGENS_NEON = origensDoAmbiente(AMBIENTE);
const PORTA = Number(process.env.PORTA ?? 4173);
const HOST = '127.0.0.1';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};

// Mesma política da prévia protegida (scripts/politica-seguranca.mjs). Hosts extras só para testes: AUTONICK_CONNECT_SRC.
const CSP = montarCsp(ORIGENS_NEON, process.env.AUTONICK_CONNECT_SRC ?? '');

function cabecalhos(tipo) {
  return {
    'Content-Type': tipo,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP,
    ...CABECALHOS_FIXOS,
  };
}

async function resolverArquivo(caminhoUrl) {
  let caminho = decodeURIComponent(caminhoUrl.split('?')[0]);
  if (caminho.endsWith('/')) caminho += 'index.html';
  const absoluto = resolve(join(RAIZ, normalize(caminho)));
  if (absoluto !== RAIZ && !absoluto.startsWith(RAIZ + sep)) return null;
  try {
    const info = await stat(absoluto);
    if (info.isDirectory()) return resolverArquivo(`${caminho}/`);
    return absoluto;
  } catch {
    return null;
  }
}

const servidor = createServer(async (pedido, resposta) => {
  if (pedido.method !== 'GET' && pedido.method !== 'HEAD') {
    resposta.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    if (AMBIENTE && (pedido.url ?? '').split('?')[0] === '/js/config/public-config.js') {
      const config = { ambiente: NOME_AMBIENTE, neonAuthUrl: AMBIENTE.neonAuthUrl, neonDataApiUrl: AMBIENTE.neonDataApiUrl };
      resposta.writeHead(200, cabecalhos(TIPOS['.js']));
      resposta.end(`export const CONFIG_PUBLICA = Object.freeze(${JSON.stringify(config)});\n`);
      return;
    }
    const arquivo = await resolverArquivo(pedido.url ?? '/');
    if (!arquivo) {
      resposta.writeHead(404, cabecalhos(TIPOS['.txt'])).end('Página não encontrada.');
      return;
    }
    const conteudo = await readFile(arquivo);
    resposta.writeHead(200, cabecalhos(TIPOS[extname(arquivo)] ?? 'application/octet-stream'));
    resposta.end(pedido.method === 'HEAD' ? undefined : conteudo);
  } catch {
    resposta.writeHead(500, cabecalhos(TIPOS['.txt'])).end('Erro interno.');
  }
});

servidor.listen(PORTA, HOST, () => {
  const modo = AMBIENTE ? `ambiente ${NOME_AMBIENTE} (Neon: ${ORIGENS_NEON.join(', ')})` : 'demonstração, sem backend';
  console.log(`AutoniCK em http://${HOST}:${PORTA} | ${modo}`);
});
