/**
 * Testes de banco da 202611010007: catálogo oficial de 17 categorias de negócio.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['202611010001_fundacao_identidade', '202611010002_correcao_identidade_sessao', '202611010003_empresas_ck',
  '202611010004_identidade_vazia_explicita', '202611010005_marcacao_dados_de_teste', '202611010006_equipe_permissoes',
  '202611010007_categorias_oficiais'];
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const SUB = 'e7000000-0000-4000-8000-000000000001';

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
});
after(() => banco?.encerrar());

test('17 categorias oficiais de negócio, todas com descrição; Outros por último', opcoes, () => {
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'negocio' AND ativo AND descricao IS NOT NULL"), '17');
  for (const slug of ['servicos-profissionais', 'tecnologia-informatica', 'animais-estimacao', 'transporte-entregas', 'artesanato-presentes']) {
    assert.equal(adm(`SELECT count(*) FROM public.categorias_plataforma WHERE slug = '${slug}'`), '1', slug);
  }
  assert.equal(adm("SELECT slug FROM public.categorias_plataforma WHERE tipo = 'negocio' ORDER BY ordem DESC LIMIT 1"), 'outros');
});

test('orientação regulatória é informativa e legível; categoria continua separada da modalidade', opcoes, () => {
  assert.match(adm("SELECT orientacao_regulatoria FROM public.categorias_plataforma WHERE slug = 'saude-bem-estar'"), /conselho profissional/);
  assert.equal(adm("SELECT count(*) FROM information_schema.columns WHERE table_name = 'categorias_plataforma' AND column_name = 'modalidade'"), '0');
  const r = comoPapel(banco.url, { sub: SUB }, "SELECT nome || '|' || coalesce(orientacao_regulatoria, '') FROM public.categorias_plataforma WHERE slug = 'animais-estimacao'");
  assert.ok(r.ok, r.erro);
  assert.match(r.saida, /^Animais de estimação\|.*veterinário/);
});

test('usuário do app não altera o catálogo', opcoes, () => {
  const r = comoPapel(banco.url, { sub: SUB }, "UPDATE public.categorias_plataforma SET nome = 'X' WHERE slug = 'outros'");
  assert.equal(r.ok, false);
  assert.match(r.erro, /permission denied/);
});

test('rollback e reaplicação da 202611010007', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010007_categorias_oficiais.down.sql');
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'negocio'"), '12');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010007_categorias_oficiais.sql');
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'negocio'"), '17');
});
