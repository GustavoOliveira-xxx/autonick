/**
 * Ambiente PostgreSQL descartável para testes de RLS (QA-001, BDD-001 §13).
 *
 * - Com AUTONICK_DB_URL definida (CI com serviço postgres:18), usa esse banco.
 * - Sem ela, cria um cluster temporário com initdb/pg_ctl encontrados em
 *   PG_BIN ou /usr/lib/postgresql/<versão>/bin, em diretório temporário.
 * Nunca aponta para o Neon: testes de banco são sempre locais.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

function binariosPostgres() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = '/usr/lib/postgresql';
  if (!existsSync(base)) return null;
  const versoes = readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
  return versoes.length ? join(base, versoes[0], 'bin') : null;
}

export function iniciarBanco() {
  if (process.env.AUTONICK_DB_URL) {
    return { url: process.env.AUTONICK_DB_URL, encerrar: () => {}, origem: 'AUTONICK_DB_URL' };
  }
  const bin = binariosPostgres();
  if (!bin) return null;
  const dir = mkdtempSync(join(tmpdir(), 'autonick-pg-'));
  const dados = join(dir, 'dados');
  const porta = 55432 + Math.floor(Math.random() * 1000);
  // initdb e pg_ctl recusam rodar como root: nesse caso usa o usuário `postgres`.
  const comoRoot = process.getuid?.() === 0;
  if (comoRoot) execFileSync('chown', ['postgres:postgres', dir]);
  const executar = (programa, argumentos, opcoes = {}) => (comoRoot
    ? execFileSync('runuser', ['-u', 'postgres', '--', join(bin, programa), ...argumentos], opcoes)
    : execFileSync(join(bin, programa), argumentos, opcoes));
  executar('initdb', ['-D', dados, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale'], { stdio: 'ignore' });
  executar('pg_ctl', ['-D', dados, '-o', `-p ${porta} -k ${dir} -c listen_addresses=''`, '-w', 'start', '-l', join(dir, 'log.txt')], { stdio: 'ignore' });
  const url = `postgresql://postgres@/postgres?host=${encodeURIComponent(dir)}&port=${porta}`;
  return {
    url,
    origem: `cluster temporário (${bin})`,
    encerrar: () => {
      try {
        executar('pg_ctl', ['-D', dados, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
      } catch {
        // servidor já encerrado
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Executa SQL com psql e devolve { ok, saida, erro }. */
export function sql(url, comando) {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', url, '-c', comando], { encoding: 'utf8' });
  return { ok: r.status === 0, saida: r.stdout.trim(), erro: r.stderr.trim() };
}

export function aplicarArquivo(url, caminhoRelativo) {
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', url, '-f', join(RAIZ, caminhoRelativo)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Falha ao aplicar ${caminhoRelativo}: ${r.stderr}`);
}

/**
 * Executa SQL como um papel da Data API, com claims de JWT simulados,
 * dentro de uma transação (como a Data API faz a cada requisição).
 */
export function comoPapel(url, { papel = 'authenticated', sub = null }, comando) {
  const claims = sub ? JSON.stringify({ sub, role: papel }) : '';
  // Sem ';' final, o COMMIT seguinte seria lido como parte do comando.
  const instrucao = comando.trim().endsWith(';') ? comando.trim() : `${comando.trim()};`;
  const bloco = `BEGIN; SET LOCAL ROLE ${papel}; SELECT set_config('request.jwt.claims', '${claims}', true) \\gset
${instrucao}
COMMIT;`;
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', url], { input: bloco, encoding: 'utf8' });
  return { ok: r.status === 0, saida: r.stdout.trim(), erro: r.stderr.trim() };
}
