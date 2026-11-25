/**
 * Testes de banco do E05 (migrations 202611270001 a 202611270003): busca global, ficha do cliente e central de atividades.
 * - Encontra por nome sem acento e sem maiúsculas, por número ("nº 2") e por SKU.
 * - Cada grupo só aparece com a permissão da área; outra empresa e anônimo negados; caracteres de LIKE são literais.
 * - Rollback sem resíduo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const ID = (n) => `ea050000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-e05@teste.example', nome: 'Dona Olga', tipo: 'business' },
  OUT: { id: ID(2), email: 'outra-e05@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  EST: { id: ID(3), email: 'estoque-e05@teste.example', nome: 'Edu Estoque', tipo: 'business' },
};
let chave = 0;
const k = () => `e05-teste-${String(++chave).padStart(4, '0')}`;
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
const buscar = (p, texto, emp = E.a) => ok(p, 'busca_global', `${q(emp)}, ${q(texto)}`).grupos;

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', uf: 'SP', email_contato: 'privado-e05@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Olga');
  E.b = nova(P.OUT, 'Outra Costura');
  ok(P.O, 'criar_cliente', `${q(E.a)}, ${j({ nome: 'José Antônio Pereira', telefone: '19999990000' })}, ${q(k())}`);
  ok(P.O, 'criar_cliente', `${q(E.a)}, ${j({ nome: 'Cliente 100% fiel' })}, ${q(k())}`);
  ok(P.OUT, 'criar_cliente', `${q(E.b)}, ${j({ nome: 'José da Outra Empresa' })}, ${q(k())}`);
  ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Linha de Algodão', finalidade: 'comercializavel', preco_centavos: 900, sku: 'LIN-ALG-01' })}, NULL, ${q(k())}`);
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, 'Só estoque', NULL, ARRAY['produtos.visualizar','estoque.visualizar']::text[], ${q(k())}`).id;
  const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P.EST.email)}, ${q(perfil)}, ${q(k())}`);
  assert.ok(comoPapel(banco.url, { sub: P.EST.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
});
after(() => banco?.encerrar());

test('encontra sem acento e sem maiúsculas, por telefone e por SKU; só na própria empresa', opcoes, () => {
  const g = buscar(P.O, 'jose antonio');
  assert.deepEqual(g.clientes.map((c) => c.titulo), ['José Antônio Pereira']);
  assert.equal(buscar(P.O, '99999-0000').clientes.length, 1, 'telefone com máscara');
  assert.deepEqual(buscar(P.O, 'ALGODAO').produtos.map((p) => p.titulo), ['Linha de Algodão']);
  assert.equal(buscar(P.O, 'lin-alg').produtos.length, 1, 'SKU');
  assert.ok(!JSON.stringify(buscar(P.O, 'jose')).includes('Outra Empresa'), 'nada de outra empresa');
  assert.ok(Object.keys(buscar(P.O, 'xx')).includes('vendas'), 'o proprietário vê todos os grupos');
});

test('caracteres de LIKE são literais e o texto tem limites', opcoes, () => {
  assert.deepEqual(buscar(P.O, '100%').clientes.map((c) => c.titulo), ['Cliente 100% fiel']);
  assert.equal(buscar(P.O, '%%').clientes.length, 0, '"%" não vira curinga');
  assert.equal(buscar(P.O, '__').clientes.length, 0, '"_" não vira curinga');
  falha(rpc(P.O, 'busca_global', `${q(E.a)}, 'a'`), '2 a 80');
  falha(rpc(P.O, 'busca_global', `${q(E.a)}, ${q('x'.repeat(81))}`), '2 a 80');
  assert.ok('grupos' in ok(P.O, 'busca_global', `${q(E.a)}, '7'`), 'um número de um dígito busca (ex.: OS nº 7)');
});

test('cada grupo só com a permissão da área; outra empresa e anônimo negados', opcoes, () => {
  const g = buscar(P.EST, 'jose');
  assert.deepEqual(Object.keys(g).sort(), ['produtos'], 'perfil só de estoque não vê clientes, vendas, OS...');
  assert.equal(buscar(P.EST, 'algodao').produtos.length, 1);
  falha(rpc(P.OUT, 'busca_global', `${q(E.a)}, 'jose'`), 'TENANT_FORBIDDEN|acesso');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.busca_global(${q(E.a)}, 'jose')`), 'permission denied');
});

test('ficha do cliente: seções conforme a permissão; outra empresa não vê', opcoes, () => {
  const cli = adm(`SELECT id FROM public.clientes_empresa WHERE empresa_id = ${q(E.a)} AND nome = 'José Antônio Pereira'`);
  const f = ok(P.O, 'ficha_cliente', q(cli));
  assert.equal(f.cliente.nome, 'José Antônio Pereira');
  for (const s of ['resumo', 'vendas', 'pedidos', 'solicitacoes', 'ordens']) assert.ok(s in f, `proprietário vê ${s}`);
  assert.equal(f.resumo.vendas, 0);
  falha(rpc(P.EST, 'ficha_cliente', q(cli)), 'FORBIDDEN_ACTION|permite');
  falha(rpc(P.OUT, 'ficha_cliente', q(cli)), 'NOT_FOUND|não encontrado');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.ficha_cliente(${q(cli)})`), 'permission denied');
  // Perfil que vê clientes e vendas, mas não orçamentos nem OS: essas seções não vêm.
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, 'Vendas', NULL, ARRAY['clientes.visualizar','vendas.visualizar']::text[], ${q(k())}`).id;
  adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES ('ea050000-0000-4000-8000-000000000009', 'vendas-e05@teste.example', 'Vera Vendas', true)`);
  const V = { id: 'ea050000-0000-4000-8000-000000000009' };
  assert.ok(comoPapel(banco.url, { sub: V.id }, "SELECT public.garantir_perfil('business', 'Vera Vendas')").ok);
  const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, 'vendas-e05@teste.example', ${q(perfil)}, ${q(k())}`);
  assert.ok(comoPapel(banco.url, { sub: V.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
  assert.deepEqual(Object.keys(ok(V, 'ficha_cliente', q(cli))).sort(), ['cliente', 'resumo', 'vendas']);
});

test('atividades: o que aconteceu na empresa, filtrado pela área; paginação; outra empresa negada', opcoes, () => {
  const todas = ok(P.O, 'atividades_da_empresa', `${q(E.a)}`);
  assert.ok(todas.itens.length >= 1);
  assert.ok(todas.itens.every((a) => a.ator && a.criado_em));
  assert.ok(todas.itens.some((a) => a.tipo.startsWith('produto.') || a.tipo.startsWith('estoque.') || a.tipo.startsWith('empresa.')));
  const est = ok(P.EST, 'atividades_da_empresa', `${q(E.a)}`).itens;
  assert.ok(est.every((a) => /^(produto|estoque)\./.test(a.tipo)), `perfil de estoque só vê produto/estoque: ${est.map((a) => a.tipo)}`);
  const um = ok(P.O, 'atividades_da_empresa', `${q(E.a)}, NULL, 1`);
  assert.equal(um.itens.length, 1);
  assert.equal(um.mais, true);
  const depois = ok(P.O, 'atividades_da_empresa', `${q(E.a)}, ${q(um.itens[0].criado_em)}, 100`);
  assert.ok(depois.itens.every((a) => a.criado_em < um.itens[0].criado_em || Date.parse(a.criado_em) < Date.parse(um.itens[0].criado_em)));
  falha(rpc(P.OUT, 'atividades_da_empresa', `${q(E.a)}`), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.O, 'atividades_da_empresa', `${q(E.a)}, NULL, 500`), '1 a 100');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.atividades_da_empresa(${q(E.a)})`), 'permission denied');
});

test('rollback da 202611270001 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611270001_busca_global.down.sql');
  assert.notEqual(foto(), depois);
  assert.equal(adm("SELECT to_regprocedure('public.busca_global(uuid,text)') IS NULL"), 't');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611270001_busca_global.sql');
  assert.equal(foto(), depois);
});
