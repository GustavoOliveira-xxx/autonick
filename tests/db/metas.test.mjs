/**
 * Testes de banco do E06 (migration 202611280001): metas mensais.
 * - O realizado vem das vendas confirmadas e das OS concluídas do mês (nada digitado); "atingida" só quando alcança o alvo.
 * - Definir: proprietário (ou empresa.alterar); funcionário sem a permissão é recusado; outra empresa negada; validações.
 * - Ver: cada meta só com a permissão da área (vendas ou OS). Rollback sem resíduo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const ID = (n) => `ea060000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-e06@teste.example', nome: 'Dona Olga', tipo: 'business' },
  OUT: { id: ID(2), email: 'outra-e06@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  EST: { id: ID(3), email: 'estoque-e06@teste.example', nome: 'Edu Estoque', tipo: 'business' },
};
let chave = 0;
const k = () => `e06-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args = '') => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args = '') {
  const r = rpc(p, nome, args);
  assert.ok(r.ok, `${nome}: ${r.erro}`);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}
const E = {};
let mes;
const meta = (p, tipo, alvo, m = mes) => rpc(p, 'definir_meta', `${q(E.a)}, ${q(tipo)}, ${q(m)}, ${alvo ?? 'NULL'}, ${q(k())}`);
const metas = (p) => ok(p, 'metas_da_empresa', q(E.a));

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', uf: 'SP', email_contato: 'privado-e06@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Olga');
  E.b = nova(P.OUT, 'Outra Costura');
  mes = adm("SELECT date_trunc('month', app_private.hoje_sp())::date::text");
  E.prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Linha', finalidade: 'comercializavel', preco_centavos: 1000, quantidade_inicial: 20 })}, NULL, ${q(k())}`).id;
  E.var = adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(E.prod)} ORDER BY padrao DESC LIMIT 1`);
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, 'Só estoque', NULL, ARRAY['estoque.visualizar']::text[], ${q(k())}`).id;
  const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P.EST.email)}, ${q(perfil)}, ${q(k())}`);
  assert.ok(comoPapel(banco.url, { sub: P.EST.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
});
after(() => banco?.encerrar());

test('realizado vem das vendas confirmadas do mês; atingida só ao alcançar o alvo', opcoes, () => {
  assert.equal(ok(P.O, 'definir_meta', `${q(E.a)}, 'receita_vendas', ${q(mes)}, 3000, ${q(k())}`).alvo, 3000);
  assert.ok(meta(P.O, 'vendas_qtd', 2).ok);
  let m = metas(P.O);
  assert.equal(m.pode_definir, true);
  const receita = () => metas(P.O).metas.find((x) => x.tipo === 'receita_vendas');
  assert.deepEqual([receita().realizado, receita().atingida, receita().percentual], [0, false, 0]);
  ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 2 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  assert.deepEqual([receita().realizado, receita().atingida, receita().percentual], [2000, false, 66]);
  ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  m = metas(P.O).metas;
  assert.deepEqual([m.find((x) => x.tipo === 'receita_vendas').atingida, m.find((x) => x.tipo === 'vendas_qtd').atingida], [true, true]);
  assert.equal(m.find((x) => x.tipo === 'receita_vendas').percentual, 100);
  // Rascunho não conta.
  ok(P.O, 'criar_venda', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: E.var, quantidade: 5 }])}, ${q(k())}`);
  assert.equal(receita().realizado, 3000);
});

test('definir: só proprietário ou empresa.alterar; validações; remover com alvo vazio', opcoes, () => {
  falha(meta(P.EST, 'receita_vendas', 100), 'FORBIDDEN_ACTION|proprietário');
  falha(rpc(P.OUT, 'definir_meta', `${q(E.a)}, 'receita_vendas', ${q(mes)}, 100, ${q(k())}`), 'TENANT_FORBIDDEN|acesso');
  falha(meta(P.O, 'lucro', 100), 'desconhecido');
  falha(meta(P.O, 'receita_vendas', 0), 'maior que zero');
  falha(meta(P.O, 'receita_vendas', 100, '2020-01-01'), 'mês atual');
  assert.ok(meta(P.O, 'os_concluidas', 5).ok);
  assert.ok(metas(P.O).metas.some((x) => x.tipo === 'os_concluidas'));
  assert.equal(JSON.parse(meta(P.O, 'os_concluidas', null).saida).removida, true);
  assert.ok(!metas(P.O).metas.some((x) => x.tipo === 'os_concluidas'));
});

test('ver: cada meta só com a permissão da área; outra empresa e anônimo negados', opcoes, () => {
  const est = metas(P.EST);
  assert.deepEqual(est.metas, [], 'perfil só de estoque não vê metas de vendas');
  assert.deepEqual(est.tipos_visiveis, []);
  assert.equal(est.pode_definir, false);
  falha(rpc(P.OUT, 'metas_da_empresa', q(E.a)), 'TENANT_FORBIDDEN|acesso');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.metas_da_empresa(${q(E.a)})`), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.O.id }, 'SELECT count(*) FROM public.metas_empresa'), 'permission denied');
});

test('rollback da 202611280001 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  adm('DELETE FROM public.metas_empresa');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611280001_metas.down.sql');
  assert.equal(adm("SELECT to_regclass('public.metas_empresa') IS NULL"), 't');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611280001_metas.sql');
  assert.equal(foto(), depois);
});
