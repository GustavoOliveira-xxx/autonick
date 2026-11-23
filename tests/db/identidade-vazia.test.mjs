/**
 * Migration 202611010004 (correção D-07): identidade vazia em requisição
 * autenticada vira erro explícito em vez de lista vazia. PostgreSQL LOCAL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const A = 'a0000000-0000-4000-8000-0000000000aa';
const M = ['202611010001_fundacao_identidade', '202611010002_correcao_identidade_sessao', '202611010003_empresas_ck', '202611010004_identidade_vazia_explicita'];

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  comoPapel(banco.url, { sub: A }, "SELECT public.garantir_perfil('business', 'Pessoa A')");
  const categoria = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'outros'").saida;
  const dados = JSON.stringify({ nome_publico: 'Empresa A', modalidade: 'servicos', categoria_id: categoria, cidade: 'Campinas', uf: 'SP', email_contato: 'a@teste.example' });
  const r = comoPapel(banco.url, { sub: A }, `SELECT public.criar_empresa('${dados}'::jsonb, 'chave-vazia-0001')`);
  if (!r.ok) throw new Error(r.erro);
});
after(() => banco?.encerrar());

test('leitura autenticada com identidade vazia gera AUTH_REQUIRED em vez de lista vazia (D-07)', opcoes, () => {
  // Tabelas com linhas: sem a correção, a RLS devolveria zero linhas sem erro.
  for (const consulta of ['SELECT count(*) FROM public.perfis_identidade', 'SELECT count(*) FROM public.empresas', 'SELECT count(*) FROM public.membros_empresa', 'SELECT count(*) FROM public.eventos_publicacao']) {
    const r = comoPapel(banco.url, { sub: null }, consulta);
    assert.equal(r.ok, false, consulta);
    assert.match(r.erro, /Sessão ausente ou expirada/);
    assert.match(r.erro, /AUTH_REQUIRED/);
  }
});

test('com identidade presente nada muda', opcoes, () => {
  assert.equal(comoPapel(banco.url, { sub: A }, 'SELECT count(*) FROM public.perfis_identidade').saida, '1');
  const d = JSON.parse(comoPapel(banco.url, { sub: A }, 'SELECT public.diagnostico_sessao()::text').saida);
  assert.deepEqual(d, { papel: 'authenticated', identidade_presente: true });
  const vazia = JSON.parse(comoPapel(banco.url, { sub: null }, 'SELECT public.diagnostico_sessao()::text').saida);
  assert.deepEqual(vazia, { papel: 'authenticated', identidade_presente: false });
});

test('anônimo continua sem acesso, sem mudança de comportamento', opcoes, () => {
  const r = comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT count(*) FROM public.perfis_identidade');
  assert.equal(r.ok, false);
  assert.match(r.erro, /permission denied/);
  assert.equal(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT public.diagnostico_sessao()').ok, false);
});

test('rollback da 202611010004 volta ao comportamento anterior e a reaplicação funciona', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010004_identidade_vazia_explicita.down.sql');
  assert.equal(comoPapel(banco.url, { sub: null }, 'SELECT count(*) FROM public.perfis_identidade').saida, '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010004_identidade_vazia_explicita.sql');
  assert.equal(comoPapel(banco.url, { sub: null }, 'SELECT count(*) FROM public.perfis_identidade').ok, false);
  assert.equal(sql(banco.url, "SELECT string_agg(id, ',' ORDER BY id) FROM app_private.historico_migracoes").saida,
    '202611010001,202611010002,202611010003,202611010004');
});
