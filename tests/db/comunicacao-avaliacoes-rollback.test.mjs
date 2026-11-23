/**
 * Rollback da 202611170001 (M12): em banco limpo com todas as migrations anteriores, aplica, desfaz sem resíduo (mesma
 * impressão digital do esquema e dos privilégios, inclusive do papel `anonymous`) e reaplica. Com dados do M12 gravados,
 * o rollback remove as tabelas novas e mantém intactas as mensagens do M08 e as atualizações da OS (nunca copiadas).
 * Só testado localmente: no Neon NÃO foi validado.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ANTES = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) < '202611170001').sort();
const SOBE = 'db/migrations_propostas/202611170001_comunicacao_avaliacoes.sql';
const DESCE = 'db/migrations_propostas/202611170001_comunicacao_avaliacoes.down.sql';
const IMPRESSAO = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const impressao = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${IMPRESSAO}) x`)
  + adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'execute')`);
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica a 202611170001 sem resíduo; o anônimo segue com as 3 funções do M10', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ANTES) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  const antes = impressao();
  const limitesAntes = adm('SELECT string_agg(chave, \',\' ORDER BY chave) FROM app_private.limites_plataforma');
  assert.match(antes, /buscar_vitrine,filtros_vitrine,vitrine_publica$/);
  aplicarArquivo(banco.url, SOBE);
  const depois = impressao();
  assert.notEqual(depois, antes);
  assert.match(depois, /buscar_vitrine,filtros_vitrine,vitrine_publica$/, 'nenhuma função nova para o anônimo');
  aplicarArquivo(banco.url, DESCE);
  assert.equal(impressao(), antes, 'o esquema depois do rollback precisa ser idêntico ao anterior');
  assert.equal(adm('SELECT string_agg(chave, \',\' ORDER BY chave) FROM app_private.limites_plataforma'), limitesAntes);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611170001'"), '0');
  aplicarArquivo(banco.url, SOBE);
  assert.equal(impressao(), depois, 'reaplicada, volta ao mesmo esquema');
});
