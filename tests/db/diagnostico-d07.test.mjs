/**
 * Testes locais da proposta 202611120005 (diagnóstico do D-07 por conexão): só leitura, nada pessoal, rollback limpo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const MIGRATIONS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) <= '202611120005').sort();
const ID = 'e9000000-0000-4000-8000-000000000001';

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of MIGRATIONS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
});
after(() => banco?.encerrar());

test('diagnóstico por conexão: papel, identidade, conexão e idade; nenhum dado pessoal', opcoes, () => {
  const r = comoPapel(banco.url, { sub: ID }, 'SELECT public.diagnostico_conexao()::text');
  assert.ok(r.ok, r.erro);
  const d = JSON.parse(r.saida);
  assert.equal(d.papel, 'authenticated');
  assert.equal(d.identidade_presente, true);
  assert.equal(d.declaracoes_guc, true);
  assert.ok(Number.isInteger(d.conexao));
  assert.ok(d.conexao_idade_ms >= 0);
  assert.equal(JSON.stringify(d).includes(ID), false);
  const vazio = JSON.parse(comoPapel(banco.url, { sub: null }, 'SELECT public.diagnostico_conexao()::text').saida);
  assert.equal(vazio.identidade_presente, false);   // não lança: é diagnóstico, não autorização
});

test('diagnóstico: anônimo não executa; rollback remove só a função', opcoes, () => {
  assert.equal(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT public.diagnostico_conexao()').ok, false);
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120005_diagnostico_d07.down.sql');
  assert.equal(sql(banco.url, "SELECT to_regprocedure('public.diagnostico_conexao()') IS NULL").saida, 't');
  assert.equal(sql(banco.url, "SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120005'").saida, '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120005_diagnostico_d07.sql');
});
