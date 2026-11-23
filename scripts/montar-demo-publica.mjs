/**
 * Montagem do FRONTEND da demonstração pública com a API Java (só arquivos estáticos).
 *
 * Copia `public/` para a pasta de saída, grava `js/config/public-config.js` com o backend `java-online` (caminhos /api
 * na mesma origem, demonstração pública ativa) e gera um `vercel.json` (formato de configuração de uma das hospedagens
 * estáticas possíveis; a hospedagem ainda não foi escolhida) com a mesma política de segurança do servidor
 * local e a reescrita `/api/*` para a API Java publicada (o navegador só fala com a própria origem: sem CORS e com o
 * cookie da demonstração restrito ao site).
 *
 * Falha fechada: a URL da API precisa ser https, sem usuário, senha, caminho ou parâmetros, e nunca do Neon.
 *
 * Uso: node scripts/montar-demo-publica.mjs --api=https://api.exemplo.com.br [--saida=.demo-publica]
 */
import { writeFile, mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarCsp, CABECALHOS_FIXOS } from './politica-seguranca.mjs';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const argumento = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');

export function validarApi(endereco) {
  if (!endereco) throw new Error('Informe --api=https://... (endereço da API Java publicada).');
  const u = new URL(endereco);
  if (u.protocol !== 'https:') throw new Error('A API precisa ser https.');
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) {
    throw new Error('A URL da API deve ser só esquema e host (sem usuário, senha, caminho ou parâmetros).');
  }
  if (u.hostname.endsWith('.neon.tech')) throw new Error('A URL da API não pode ser do Neon: o navegador fala só com a API Java.');
  return u.origin;
}

export const conteudoConfig = () => '/**\n * Configuração PÚBLICA gerada para a demonstração pública: API Java na mesma origem (/api).\n */\n'
  + `export const CONFIG_PUBLICA = Object.freeze(${JSON.stringify({
    ambiente: 'java-online', backend: 'java-online', apiJava: '/api', neonAuthUrl: '/api/auth', neonDataApiUrl: '/api/dados',
    demonstracao: { ativa: true, publica: true },
  })});\n`;

export function vercelJson(api) {
  const cabecalhos = { 'Content-Security-Policy': montarCsp([]), ...CABECALHOS_FIXOS, 'Cache-Control': 'no-cache' };
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    rewrites: [{ source: '/api/:caminho*', destination: `${api}/api/:caminho*` }],
    headers: [{ source: '/(.*)', headers: Object.entries(cabecalhos).map(([key, value]) => ({ key, value })) }],
  };
}

async function montar() {
  const api = validarApi(argumento('api'));
  const saida = path.resolve(RAIZ, argumento('saida') ?? '.demo-publica');
  if (!saida.startsWith(RAIZ) || saida === path.resolve(RAIZ)) throw new Error('A saída precisa ser uma pasta dentro do repositório.');
  await rm(saida, { recursive: true, force: true });
  await mkdir(saida, { recursive: true });
  await cp(path.join(RAIZ, 'public'), saida, { recursive: true });
  await writeFile(path.join(saida, 'js/config/public-config.js'), conteudoConfig());
  await writeFile(path.join(saida, 'vercel.json'), `${JSON.stringify(vercelJson(api), null, 2)}\n`);
  console.log(`Frontend da demonstração pública montado em ${path.relative(RAIZ, saida)} (API: ${api}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  montar().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}
