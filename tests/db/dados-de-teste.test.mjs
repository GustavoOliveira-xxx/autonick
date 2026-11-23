/**
 * Migration 202611010005: marcação de empresas fictícias (decisão de projeto
 * de manter as empresas [TESTE]). PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const G = 'a0000000-0000-4000-8000-0000000000d1';
const CK = 'a0000000-0000-4000-8000-0000000000d2';
const M = ['202611010001_fundacao_identidade', '202611010002_correcao_identidade_sessao', '202611010003_empresas_ck', '202611010004_identidade_vazia_explicita', '202611010005_marcacao_dados_de_teste'];
let empresa;

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  sql(banco.url, `INSERT INTO neon_auth."user" (id, email, "emailVerified") VALUES ('${G}', 'g@teste.example', true), ('${CK}', 'ck@teste.example', true)`);
  comoPapel(banco.url, { sub: G }, "SELECT public.garantir_perfil('business', 'Gestor')");
  sql(banco.url, `SELECT app_private.conceder_ck_admin('${CK}', 'teste')`);
  const categoria = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'outros'").saida;
  const dados = JSON.stringify({ nome_publico: '[TESTE] Empresa', modalidade: 'servicos', categoria_id: categoria, cidade: 'Campinas', uf: 'SP', email_contato: 'g@teste.example' });
  empresa = JSON.parse(comoPapel(banco.url, { sub: G }, `SELECT public.criar_empresa('${dados}'::jsonb, 'chave-teste-0001')::text`).saida);
  comoPapel(banco.url, { sub: G }, `SELECT public.enviar_vitrine_para_analise('${empresa.id}', 1, 'chave-teste-0002')`);
  const sol = sql(banco.url, `SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = '${empresa.id}'`).saida;
  comoPapel(banco.url, { sub: CK }, `SELECT public.ck_decidir_solicitacao('${sol}', 'aprovar', NULL, NULL, 'chave-teste-0003')`);
});
after(() => banco?.encerrar());

test('empresa nasce sem marcação; a marcação operacional chega à projeção e à auditoria', opcoes, () => {
  assert.equal(sql(banco.url, `SELECT dado_de_teste FROM public.public_empresa_cards WHERE empresa_id = '${empresa.id}'`).saida, 'f');
  assert.ok(sql(banco.url, `SELECT app_private.marcar_empresa_de_teste('${empresa.id}', 'teste automatizado')`).ok);
  assert.equal(sql(banco.url, `SELECT dado_de_teste FROM public.public_empresa_cards WHERE empresa_id = '${empresa.id}'`).saida, 't');
  assert.equal(sql(banco.url, "SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'empresa.marcada_como_teste'").saida, '1');
});

test('a marcação sobrevive a mudança de nome e a republicação da projeção', opcoes, () => {
  const versao = sql(banco.url, `SELECT versao FROM public.empresas WHERE id = '${empresa.id}'`).saida;
  assert.ok(comoPapel(banco.url, { sub: G }, `SELECT public.atualizar_empresa('${empresa.id}', '{"descricao_publica":"Sem prefixo agora"}'::jsonb, ${versao}, 'chave-teste-0004')`).ok);
  assert.equal(sql(banco.url, `SELECT dado_de_teste FROM public.public_empresa_cards WHERE empresa_id = '${empresa.id}'`).saida, 't');
});

test('ninguém da API marca ou desmarca dado de teste', opcoes, () => {
  for (const sub of [G, CK]) {
    assert.equal(comoPapel(banco.url, { sub }, `UPDATE public.empresas SET dado_de_teste = false WHERE id = '${empresa.id}'`).ok, false);
    assert.equal(comoPapel(banco.url, { sub }, `SELECT app_private.marcar_empresa_de_teste('${empresa.id}', 'x')`).ok, false);
  }
  const versao = sql(banco.url, `SELECT versao FROM public.empresas WHERE id = '${empresa.id}'`).saida;
  const r = comoPapel(banco.url, { sub: G }, `SELECT public.atualizar_empresa('${empresa.id}', '{"dado_de_teste":false}'::jsonb, ${versao}, 'chave-teste-0005')`);
  assert.equal(r.ok, false);
  assert.match(r.erro, /Campo não permitido/);
  assert.equal(sql(banco.url, `SELECT dado_de_teste FROM public.empresas WHERE id = '${empresa.id}'`).saida, 't');
});

test('rollback e reaplicação da 202611010005', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010005_marcacao_dados_de_teste.down.sql');
  assert.equal(sql(banco.url, "SELECT count(*) FROM information_schema.columns WHERE column_name = 'dado_de_teste'").saida, '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010005_marcacao_dados_de_teste.sql');
  assert.equal(sql(banco.url, "SELECT count(*) FROM information_schema.columns WHERE column_name = 'dado_de_teste'").saida, '2');
});
