/**
 * Testes de banco da 202611020001: taxonomia inicial de 13 categorias de produto (decisão de 02/11/2026).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`)
  .concat(['202611020001_categorias_produto']);
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const DONA = { id: 'e8000000-0000-4000-8000-000000000001', email: 'dona-cat@teste.example' };
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
let A;
const k = (() => { let n = 0; return () => `cat-produto-${String(++n).padStart(4, '0')}`; })();
const rpc = (expr) => comoPapel(banco.url, { sub: DONA.id }, `SELECT (${expr})::text`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(DONA.id)}, ${q(DONA.email)}, 'Dona', true)`);
  comoPapel(banco.url, { sub: DONA.id }, "SELECT public.garantir_perfil('business', 'Dona')");
  const cat = adm("SELECT id FROM public.categorias_plataforma WHERE tipo = 'negocio' AND slug = 'comercio-varejo'");
  A = JSON.parse(rpc(`public.criar_empresa('${JSON.stringify({ nome_publico: 'Loja Cat', modalidade: 'comercio', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'p@teste.example' })}'::jsonb, ${q(k())})`).saida).id;
});
after(() => banco?.encerrar());

test('13 categorias de produto, separadas das 17 de negócio; as duas adições aprovadas existem', opcoes, () => {
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'produto' AND ativo AND descricao IS NOT NULL"), '13');
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'negocio'"), '17');
  assert.equal(adm("SELECT string_agg(nome, '|' ORDER BY ordem) FROM public.categorias_plataforma WHERE tipo = 'produto' AND slug IN ('infantil-bebes','esporte-lazer')"), 'Infantil e bebês|Esporte e lazer');
  assert.equal(adm("SELECT slug FROM public.categorias_plataforma WHERE tipo = 'produto' ORDER BY ordem DESC LIMIT 1"), 'outros-produtos');
});

test('categoria opcional; só aceita categoria de produto; finalidade continua separada', opcoes, () => {
  const semCat = rpc(`public.criar_produto(${q(A)}, '{"nome":"Sem categoria","finalidade":"comercializavel","preco_centavos":100}'::jsonb, NULL, ${q(k())})`);
  assert.ok(semCat.ok, semCat.erro);
  const neg = adm("SELECT id FROM public.categorias_plataforma WHERE tipo = 'negocio' AND slug = 'alimentacao'");
  const errado = rpc(`public.criar_produto(${q(A)}, '{"nome":"Errado","finalidade":"comercializavel","preco_centavos":100,"categoria_id":"${neg}"}'::jsonb, NULL, ${q(k())})`);
  assert.equal(errado.ok, false);
  assert.match(errado.erro, /Categoria de produto inválida/);
  const pet = adm("SELECT id FROM public.categorias_plataforma WHERE tipo = 'produto' AND slug = 'pet'");
  const insumo = rpc(`public.criar_produto(${q(A)}, '{"nome":"Ração a granel","finalidade":"uso_interno","preco_centavos":100,"categoria_id":"${pet}"}'::jsonb, NULL, ${q(k())})`);
  assert.ok(insumo.ok, insumo.erro);
  assert.equal(adm("SELECT finalidade FROM public.produtos WHERE nome = 'Ração a granel'"), 'uso_interno');
});

test('subcategorias futuras: mesmo tipo e no máximo dois níveis', opcoes, () => {
  const pet = adm("SELECT id FROM public.categorias_plataforma WHERE tipo = 'produto' AND slug = 'pet'");
  assert.equal(sql(banco.url, `INSERT INTO public.categorias_plataforma (tipo, slug, nome, parent_id) VALUES ('produto', 'pet-racao', 'Ração', ${q(pet)})`).ok, true);
  const sub = adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'pet-racao'");
  const tresNiveis = sql(banco.url, `INSERT INTO public.categorias_plataforma (tipo, slug, nome, parent_id) VALUES ('produto', 'pet-racao-gatos', 'Gatos', ${q(sub)})`);
  assert.equal(tresNiveis.ok, false);
  assert.match(tresNiveis.erro, /dois níveis/);
  const outroTipo = sql(banco.url, `INSERT INTO public.categorias_plataforma (tipo, slug, nome, parent_id) VALUES ('negocio', 'pet-negocio', 'X', ${q(pet)})`);
  assert.equal(outroTipo.ok, false);
  assert.match(outroTipo.erro, /mesmo tipo/);
  adm("DELETE FROM public.categorias_plataforma WHERE slug = 'pet-racao'");
});

test('integridade: categoria em uso não é apagada; desativada continua no produto, mas não é escolhida de novo', opcoes, () => {
  const pet = adm("SELECT id FROM public.categorias_plataforma WHERE tipo = 'produto' AND slug = 'pet'");
  assert.equal(sql(banco.url, `DELETE FROM public.categorias_plataforma WHERE id = ${q(pet)}`).ok, false);
  adm(`UPDATE public.categorias_plataforma SET ativo = false WHERE id = ${q(pet)}`);
  assert.equal(adm("SELECT categoria_id IS NOT NULL FROM public.produtos WHERE nome = 'Ração a granel'"), 't');
  const nova = rpc(`public.criar_produto(${q(A)}, '{"nome":"Coleira","finalidade":"comercializavel","preco_centavos":100,"categoria_id":"${pet}"}'::jsonb, NULL, ${q(k())})`);
  assert.equal(nova.ok, false);
  adm(`UPDATE public.categorias_plataforma SET ativo = true WHERE id = ${q(pet)}`);
});

test('usuário do app lê, mas não altera o catálogo', opcoes, () => {
  const ler = comoPapel(banco.url, { sub: DONA.id }, "SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'produto'");
  assert.equal(ler.saida, '13');
  assert.equal(comoPapel(banco.url, { sub: DONA.id }, "UPDATE public.categorias_plataforma SET nome = 'X' WHERE slug = 'pet'").ok, false);
});

test('rollback recusado com produto usando categoria; reaplicação idêntica', opcoes, () => {
  const r = sql(banco.url, readFileSync('db/migrations_propostas/202611020001_categorias_produto.down.sql', 'utf8'));
  assert.equal(r.ok, false);
  assert.match(r.erro, /Há produtos usando categorias de produto/);
  adm("UPDATE public.produtos SET categoria_id = NULL");
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611020001_categorias_produto.down.sql');
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'produto'"), '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611020001_categorias_produto.sql');
  assert.equal(adm("SELECT count(*) FROM public.categorias_plataforma WHERE tipo = 'produto'"), '13');
});

