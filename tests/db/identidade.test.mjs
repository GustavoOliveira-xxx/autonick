/**
 * Testes de RLS e integridade da migration proposta 202611010001 (M02).
 * Cenários derivados de BDD-001 §13 (DBT), SEC-001 (SEC-T01, T05, T20) e
 * ADR-001 (B). Executados em PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'b0000000-0000-4000-8000-00000000000b';

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010001_fundacao_identidade.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010002_correcao_identidade_sessao.sql');
});
after(() => banco?.encerrar());

const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };

test('ambiente de banco', opcoes, () => {
  const versao = sql(banco.url, 'SHOW server_version');
  assert.ok(versao.ok, versao.erro);
  console.log(`# PostgreSQL ${versao.saida} via ${banco.origem}`);
});

test('A cria perfil Cliente e a repetição devolve o mesmo perfil (idempotência)', opcoes, () => {
  const primeira = comoPapel(banco.url, { sub: A }, "SELECT id FROM public.garantir_perfil('cliente', 'Pessoa A')");
  assert.ok(primeira.ok, primeira.erro);
  const segunda = comoPapel(banco.url, { sub: A }, "SELECT id FROM public.garantir_perfil('cliente', 'Outro nome')");
  assert.ok(segunda.ok, segunda.erro);
  assert.equal(segunda.saida, primeira.saida);
  const total = sql(banco.url, `SELECT count(*) FROM public.perfis_identidade WHERE auth_user_id = '${A}'`);
  assert.equal(total.saida, '1');
});

test('a mesma identidade pode ter perfil Cliente e perfil Business (ADR-001 = B)', opcoes, () => {
  const r = comoPapel(banco.url, { sub: A }, "SELECT tipo_conta FROM public.garantir_perfil('business', 'Pessoa A Gestora')");
  assert.ok(r.ok, r.erro);
  const perfis = comoPapel(banco.url, { sub: A }, 'SELECT string_agg(tipo_conta, \',\' ORDER BY tipo_conta) FROM public.perfis_identidade');
  assert.equal(perfis.saida, 'business,cliente');
});

test('B não vê os perfis de A (SEC-T01, DBT-025)', opcoes, () => {
  comoPapel(banco.url, { sub: B }, "SELECT public.garantir_perfil('cliente', 'Pessoa B')");
  const r = comoPapel(banco.url, { sub: B }, 'SELECT count(*) FROM public.perfis_identidade');
  assert.equal(r.saida, '1');
  const alvo = comoPapel(banco.url, { sub: B }, `SELECT count(*) FROM public.perfis_identidade WHERE auth_user_id = '${A}'`);
  assert.equal(alvo.saida, '0');
});

test('ninguém cria perfil em nome de outra identidade (DBT-006)', opcoes, () => {
  const r = comoPapel(banco.url, { sub: B }, `INSERT INTO public.perfis_identidade (auth_user_id, tipo_conta, nome) VALUES ('${A}', 'business', 'Invasor')`);
  assert.equal(r.ok, false);
  assert.match(r.erro, /permission denied/);
});

test('não é possível alterar identidade ou tipo do perfil; só o nome (SEC-T05)', opcoes, () => {
  const troca = comoPapel(banco.url, { sub: A }, `UPDATE public.perfis_identidade SET tipo_conta = 'business' WHERE tipo_conta = 'cliente'`);
  assert.equal(troca.ok, false);
  assert.match(troca.erro, /permission denied/);
  const dono = comoPapel(banco.url, { sub: A }, `UPDATE public.perfis_identidade SET auth_user_id = '${B}'`);
  assert.equal(dono.ok, false);
  const nome = comoPapel(banco.url, { sub: A }, `UPDATE public.perfis_identidade SET nome = 'Pessoa A Atualizada' WHERE tipo_conta = 'cliente' RETURNING nome`);
  assert.ok(nome.ok, nome.erro);
  assert.equal(nome.saida, 'Pessoa A Atualizada');
});

test('B não altera o nome do perfil de A (0 linhas afetadas)', opcoes, () => {
  const r = comoPapel(banco.url, { sub: B }, `UPDATE public.perfis_identidade SET nome = 'Invadido' WHERE auth_user_id = '${A}' RETURNING id`);
  assert.ok(r.ok, r.erro);
  assert.equal(r.saida, '');
  const conferir = sql(banco.url, `SELECT count(*) FROM public.perfis_identidade WHERE nome = 'Invadido'`);
  assert.equal(conferir.saida, '0');
});

test('exclusão de perfil é negada (RF-008 é pedido, não exclusão direta)', opcoes, () => {
  const r = comoPapel(banco.url, { sub: A }, 'DELETE FROM public.perfis_identidade');
  assert.equal(r.ok, false);
  assert.match(r.erro, /permission denied/);
});

test('tipo de conta inválido e nome vazio são rejeitados', opcoes, () => {
  const tipo = comoPapel(banco.url, { sub: B }, "SELECT public.garantir_perfil('ck_admin', 'Tentativa')");
  assert.equal(tipo.ok, false);
  assert.match(tipo.erro, /check constraint/);
  const nome = comoPapel(banco.url, { sub: B }, "SELECT public.garantir_perfil('business', ' ')");
  assert.equal(nome.ok, false);
});

test('papel anonymous não lê perfis nem chama a função (RNF-002)', opcoes, () => {
  const leitura = comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT count(*) FROM public.perfis_identidade');
  assert.equal(leitura.ok, false);
  assert.match(leitura.erro, /permission denied/);
  const funcao = comoPapel(banco.url, { papel: 'anonymous' }, "SELECT public.garantir_perfil('cliente', 'Anônimo')");
  assert.equal(funcao.ok, false);
});

test('sessão sem identificação não cria perfil (AUTH_REQUIRED)', opcoes, () => {
  const r = comoPapel(banco.url, { sub: null }, "SELECT public.garantir_perfil('cliente', 'Sem sessão')");
  assert.equal(r.ok, false);
  assert.match(r.erro, /Sessão ausente/);
});

test('criação de perfil gera auditoria inacessível e imutável pelos papéis da API (RNF-010, DBT-021)', opcoes, () => {
  const eventos = sql(banco.url, "SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'perfil.criado'");
  assert.equal(eventos.saida, '3');
  const leitura = comoPapel(banco.url, { sub: A }, 'SELECT count(*) FROM app_private.eventos_auditoria');
  assert.equal(leitura.ok, false);
  assert.match(leitura.erro, /permission denied/);
  const alterar = sql(banco.url, "UPDATE app_private.eventos_auditoria SET tipo_acao = 'x'");
  assert.equal(alterar.ok, false);
  assert.match(alterar.erro, /não podem ser alterados/);
});

test('auxiliar authz.tem_perfil reflete apenas a identidade da sessão', opcoes, () => {
  const a = comoPapel(banco.url, { sub: A }, "SELECT authz.tem_perfil('business')");
  const b = comoPapel(banco.url, { sub: B }, "SELECT authz.tem_perfil('business')");
  assert.equal(a.saida, 't');
  assert.equal(b.saida, 'f');
});

test('authenticated não tem USAGE no schema auth (fiel ao Neon) e mesmo assim cria perfil', opcoes, () => {
  const direto = comoPapel(banco.url, { sub: B }, 'SELECT auth.user_id()');
  assert.equal(direto.ok, false);
  assert.match(direto.erro, /permission denied for schema auth/);
  const viaAuthz = comoPapel(banco.url, { sub: B }, 'SELECT authz.usuario_atual()');
  assert.equal(viaAuthz.saida, B);
});

test('migrations registradas no histórico', opcoes, () => {
  const r = sql(banco.url, "SELECT string_agg(id, ',' ORDER BY id) FROM app_private.historico_migracoes");
  assert.equal(r.saida, '202611010001,202611010002');
});

test('rollback da migration remove os objetos criados', opcoes, () => {
  const r = sql(banco.url, "SELECT to_regclass('public.perfis_identidade') IS NOT NULL");
  assert.equal(r.saida, 't');
  // O rollback é testado em banco separado para não interferir nos demais testes.
  const nome = `rollback_${Date.now()}`;
  assert.ok(sql(banco.url, `CREATE DATABASE ${nome}`).ok);
  const urlTeste = banco.url.replace(/\/postgres(\?|$)/, `/${nome}$1`);
  const { aplicarArquivo: aplicar } = { aplicarArquivo };
  aplicar(urlTeste, 'db/tests/emulacao-neon.sql');
  aplicar(urlTeste, 'db/migrations_propostas/202611010001_fundacao_identidade.sql');
  aplicar(urlTeste, 'db/migrations_propostas/202611010002_correcao_identidade_sessao.sql');
  aplicar(urlTeste, 'db/migrations_propostas/202611010002_correcao_identidade_sessao.down.sql');
  aplicar(urlTeste, 'db/migrations_propostas/202611010001_fundacao_identidade.down.sql');
  const depois = sql(urlTeste, "SELECT to_regclass('public.perfis_identidade') IS NULL AND to_regnamespace('app_private') IS NULL");
  assert.equal(depois.saida, 't');
  sql(banco.url, `DROP DATABASE ${nome}`);
});
