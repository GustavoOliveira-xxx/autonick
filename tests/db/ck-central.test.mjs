/**
 * Testes de banco do E09 (migration 202611300001): central administrativa da CK.
 * - ck_limites devolve categoria, nome, unidade e padrão; restaurar o padrão passa por ck_definir_limite com motivo.
 * - ck_saude e ck_auditoria só para a CK; gestor e anônimo negados. Rollback sem resíduo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const P = {
  CK: { id: 'ea090000-0000-4000-8000-000000000001', email: 'ck-e09@teste.example', nome: 'Admin CK' },
  O: { id: 'ea090000-0000-4000-8000-000000000002', email: 'dona-e09@teste.example', nome: 'Dona Olga' },
};
let chave = 0;
const k = () => `e09-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args = '') => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args = '') { const r = rpc(p, nome, args); assert.ok(r.ok, `${nome}: ${r.erro}`); return JSON.parse(r.saida); }
function falha(r, padrao) { assert.equal(r.ok, false, `deveria falhar com ${padrao}`); assert.match(r.erro, new RegExp(padrao), r.erro); }

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
  assert.ok(comoPapel(banco.url, { sub: P.O.id }, "SELECT public.garantir_perfil('business', 'Dona Olga')").ok);
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste E09')`);
});
after(() => banco?.encerrar());

test('parâmetros: categoria, nome e padrão; restaurar o padrão com motivo fica na auditoria', opcoes, () => {
  const lim = ok(P.CK, 'ck_limites');
  const cota = lim.find((l) => l.chave === 'arquivos_cota_empresa_mb');
  assert.deepEqual([cota.categoria, cota.unidade, cota.valor_padrao], ['Arquivos', 'MB', 200]);
  assert.ok(lim.every((l) => l.nome && l.categoria && Number.isInteger(l.valor_padrao)));
  ok(P.CK, 'ck_definir_limite', `'arquivos_cota_empresa_mb', 300, 'Teste de aumento temporário', ${q(k())}`);
  ok(P.CK, 'ck_definir_limite', `'arquivos_cota_empresa_mb', 200, 'Restaurado ao valor padrão', ${q(k())}`);
  assert.equal(ok(P.CK, 'ck_limites').find((l) => l.chave === 'arquivos_cota_empresa_mb').valor, 200);
  const aud = ok(P.CK, 'ck_auditoria');
  assert.ok(aud.itens.filter((a) => a.tipo === 'ck.limite_alterado').length >= 2);
  assert.ok(aud.itens.some((a) => a.tipo === 'ck_admin.concedido'));
  assert.equal(aud.itens[0].ator, 'Admin CK');
});

test('saúde: banco, migrations, arquivos e filas; só a CK', opcoes, () => {
  const s = ok(P.CK, 'ck_saude');
  assert.match(s.banco.versao, /^18/);
  assert.equal(s.migracoes.total, Number(adm('SELECT count(*) FROM app_private.historico_migracoes')));
  assert.ok(s.migracoes.total >= TODAS.length - 2, '202611250001 e 202611250002 não se registram no histórico (o AutoniCK local controla pela própria tabela)');
  assert.equal(s.migracoes.ultimas[0].id, TODAS.at(-1).slice(0, 12), 'a mais recente aplicada aparece primeiro');
  for (const c of ['ativos', 'bytes_ativos']) assert.ok(c in s.arquivos);
  for (const c of ['publicacao', 'contestacoes', 'moderacoes']) assert.ok(Number.isInteger(s.filas[c]));
  falha(rpc(P.O, 'ck_saude'), 'FORBIDDEN_ACTION|administração');
  falha(rpc(P.O, 'ck_auditoria'), 'FORBIDDEN_ACTION|administração');
  falha(rpc(P.CK, 'ck_auditoria', 'NULL, 500'), '1 a 100');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT public.ck_saude()'), 'permission denied');
});

test('rollback da 202611300001 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611300001_ck_central.down.sql');
  assert.equal(adm("SELECT to_regprocedure('public.ck_saude()') IS NULL"), 't');
  assert.ok(!('categoria' in ok(P.CK, 'ck_limites')[0]), 'ck_limites volta ao formato anterior');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611300001_ck_central.sql');
  assert.equal(foto(), depois);
});
