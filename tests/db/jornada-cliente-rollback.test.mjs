/**
 * Rollback da 202611140001 (M11): em banco limpo com todas as migrations anteriores, aplica, desfaz sem resíduo (mesma
 * impressão digital do esquema e dos privilégios, inclusive do papel `anonymous`) e reaplica. A migration não cria tabelas
 * nem registros além do histórico, então o rollback não apaga dados. Só testado localmente: no Neon NÃO foi validado.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ANTES = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) < '202611140001').sort();
const SOBE = 'db/migrations_propostas/202611140001_jornada_cliente.sql';
const DESCE = 'db/migrations_propostas/202611140001_jornada_cliente.down.sql';
const IMPRESSAO = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const impressao = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${IMPRESSAO}) x`)
  + adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'execute')`);
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica a 202611140001 sem resíduo; o anônimo segue com as 3 funções do M10', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ANTES) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  const antes = impressao();
  assert.match(antes, /buscar_vitrine,filtros_vitrine,vitrine_publica$/);
  aplicarArquivo(banco.url, SOBE);
  const depois = impressao();
  assert.notEqual(depois, antes);
  assert.match(depois, /buscar_vitrine,filtros_vitrine,vitrine_publica$/, 'nenhuma função nova para o anônimo');
  aplicarArquivo(banco.url, DESCE);
  assert.equal(impressao(), antes, 'o esquema depois do rollback precisa ser idêntico ao anterior');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611140001'"), '0');
  aplicarArquivo(banco.url, SOBE);
  assert.equal(impressao(), depois, 'reaplicada, volta ao mesmo esquema');
});
