/**
 * Rollback da 202611020002 (M06) em banco limpo: aplica, desfaz e reaplica sem resíduos.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`)
  .concat(['202611020001_categorias_produto']);
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica a 202611020002 sem resíduos', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611020002_clientes_vendas.sql');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '51');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611020002_clientes_vendas.down.sql');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '50');
  assert.equal(adm("SELECT count(*) FROM pg_tables WHERE tablename IN ('vendas','pedidos','clientes_empresa','recebimentos','titulos_financeiros','contadores_empresa')"), '0');
  assert.equal(adm("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname IN ('confirmar_venda_nucleo','criar_pedido','eh_meu_pedido','receber_parcela')"), '0');
  assert.equal(adm("SELECT count(*) FROM information_schema.columns WHERE table_name = 'perfis_permissao' AND column_name = 'desconto_maximo_percentual'"), '0');
  assert.match(adm("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'movimentacoes_estoque_origem_tipo_check'"), /'reserva'::text\]\)\)\)$/);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611020002'"), '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611020002_clientes_vendas.sql');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '51');
});
