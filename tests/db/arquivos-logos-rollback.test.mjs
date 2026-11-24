/**
 * Rollback das migrations do E03 (202611250001 arquivos e logos, 202611250002 favoritos, 202611250003 vitrine e privilégios):
 * em banco limpo com as anteriores, aplica as três, desfaz na ordem inversa sem resíduo (mesma impressão digital do esquema e
 * dos privilégios, inclusive do papel anonymous, e os mesmos limites da plataforma) e reaplica.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ANTES = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) < '202611250001').sort();
const E03 = ['202611250001_arquivos_logos', '202611250002_favoritos', '202611250003_vitrine_imagens'];
const IMPRESSAO = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const impressao = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${IMPRESSAO}) x`)
  + adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'execute')`)
  + adm("SELECT string_agg(chave || '=' || valor, ',' ORDER BY chave) FROM app_private.limites_plataforma");
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica as migrations do E03 sem resíduo; o anônimo fica só com as leituras da vitrine', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ANTES) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  const antes = impressao();
  for (const m of E03) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  const depois = impressao();
  assert.notEqual(depois, antes);
  assert.match(depois, /buscar_vitrine,filtros_vitrine,imagens_publicas_de_produtos,logos_publicos,vitrine_publica/);
  for (const m of [...E03].reverse()) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.down.sql`);
  assert.equal(impressao(), antes, 'o esquema depois do rollback precisa ser idêntico ao anterior');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id LIKE '20261125%'"), '0');
  for (const m of E03) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  assert.equal(impressao(), depois, 'reaplicadas, voltam ao mesmo esquema');
});
