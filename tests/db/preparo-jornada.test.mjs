/**
 * Auxiliares de preparo dos roteiros reais (scripts/preparo-jornada.mjs) contra o banco LOCAL, com o papel do gestor:
 * a versão de serviços e produtos é lida pelas funções do app (`servicos_da_empresa`, `produtos_da_empresa`), nunca pelas
 * tabelas, que não são expostas ao gestor. Publicar e retirar da vitrine funcionam; sem permissão continua negado.
 * Achado da rodada real do M11 (14/11/2026): o roteiro lia `servicos` direto e a publicação falhava.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';
import { publicarProduto, publicarServico } from '../../scripts/preparo-jornada.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const O = { id: 'ec000000-0000-4000-8000-000000000001', email: 'dona-preparo@teste.example' };
const X = { id: 'ec000000-0000-4000-8000-000000000002', email: 'outra-preparo@teste.example' };
let n = 0;
const k = () => `preparo-${++n}`;
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
// Mesmo formato de resposta do `rpc` dos roteiros: { status, dados }.
const rpc = async (conta, nome, corpo = {}) => {
  const args = Object.entries(corpo).map(([c, v]) => `${c} => ${v === null || v === undefined ? 'NULL' : typeof v === 'object' ? `${q(JSON.stringify(v))}::jsonb` : typeof v === 'string' ? q(v) : v}`);
  const r = comoPapel(banco.url, { sub: conta.id }, `SELECT public.${nome}(${args.join(', ')})::text`);
  return r.ok ? { status: 200, dados: JSON.parse(r.saida) } : { status: 400, dados: { message: r.erro } };
};
const naVitrine = (tabela, id) => sql(banco.url, `SELECT exibir_na_vitrine FROM public.${tabela} WHERE id = ${q(id)}`).saida;
let A;
let servico;
let produto;

before(async () => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of [O, X]) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, 'Teste', true)`);
    comoPapel(banco.url, { sub: p.id }, "SELECT public.garantir_perfil('business', 'Teste')");
  }
  const cat = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'").saida;
  A = (await rpc(O, 'criar_empresa', { p_dados: { nome_publico: 'Preparo', modalidade: 'ambos', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'p@teste.example' }, p_operation_key: k() })).dados.id;
  servico = (await rpc(O, 'criar_servico', { p_empresa_id: A, p_dados: { nome: 'Barra', politica_preco: 'fixo', preco_centavos: 3000 }, p_operation_key: k() })).dados;
  produto = (await rpc(O, 'criar_produto', { p_empresa_id: A, p_dados: { nome: 'Linha', finalidade: 'comercializavel', preco_centavos: 800, quantidade_inicial: 3 }, p_variacoes: null, p_operation_key: k() })).dados;
});
after(() => banco?.encerrar());

test('publicar e retirar serviço e produto lendo a versão pelas funções do app', opcoes, async () => {
  assert.ok(await publicarServico({ rpc, dono: O, empresaId: A, servicoId: servico.id, k }));
  assert.equal(naVitrine('servicos', servico.id), 't');
  assert.ok(await publicarProduto({ rpc, dono: O, empresaId: A, produtoId: produto.id, k }));
  assert.equal(naVitrine('produtos', produto.id), 't');
  // Retirar depois de outra mudança de versão: a versão é lida de novo, sem conflito.
  assert.ok(await publicarServico({ rpc, dono: O, empresaId: A, servicoId: servico.id, exibir: false, k }));
  assert.ok(await publicarProduto({ rpc, dono: O, empresaId: A, produtoId: produto.id, exibir: false, k }));
  assert.equal(naVitrine('servicos', servico.id), 'f');
  assert.equal(naVitrine('produtos', produto.id), 'f');
});

test('sem vínculo com a empresa continua negado (nenhuma permissão ampliada)', opcoes, async () => {
  assert.equal(await publicarServico({ rpc, dono: X, empresaId: A, servicoId: servico.id, k }), false);
  assert.equal(await publicarProduto({ rpc, dono: X, empresaId: A, produtoId: produto.id, k }), false);
  assert.equal(naVitrine('servicos', servico.id), 'f');
});
