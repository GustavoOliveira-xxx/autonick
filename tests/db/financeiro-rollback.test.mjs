/**
 * Rollback da 202611120001 (M07): em banco limpo aplica, desfaz e reaplica sem resíduos;
 * com dado próprio do M07, o rollback é recusado e nada muda.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`)
  .concat(['202611020001_categorias_produto', '202611020002_clientes_vendas']);
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const funcoes = (nomes) => adm(`SELECT count(*) FROM pg_proc WHERE proname IN (${nomes.map((n) => `'${n}'`).join(',')})`);
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica a 202611120001; recusa o rollback quando já há dado do M07', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  const assinaturaM06 = adm(`SELECT md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.proname)) FROM pg_proc p
    WHERE p.proname IN ('receber_parcela', 'confirmar_venda_nucleo', 'registrar_recebimento', 'registrar_devolucao_valor')`);
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120001_financeiro.sql');
  assert.equal(funcoes(['lancar', 'fechar_periodo', 'painel_financeiro']), '3');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120001_financeiro.down.sql');
  assert.equal(adm("SELECT count(*) FROM pg_tables WHERE tablename IN ('lancamentos_financeiros','pagamentos','transferencias_financeiras','despesas_recorrentes','fechamentos_financeiros','categorias_financeiras','controle_financeiro')"), '0');
  assert.equal(funcoes(['lancar', 'fechar_periodo', 'painel_financeiro', 'menor_saldo_desde', 'resumo_periodo']), '0');
  assert.equal(adm("SELECT count(*) FROM information_schema.columns WHERE table_name IN ('contas_financeiras', 'titulos_financeiros') AND column_name IN ('saldo','permite_negativo','competencia','categoria_id')"), '0');
  assert.match(adm("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'titulos_financeiros_tipo_check'"), /= 'receber'::text\)\)$/);
  assert.equal(adm(`SELECT md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.proname)) FROM pg_proc p
    WHERE p.proname IN ('receber_parcela', 'confirmar_venda_nucleo', 'registrar_recebimento', 'registrar_devolucao_valor')`), assinaturaM06);
  assert.equal(adm("SELECT count(*) FROM pg_policies WHERE tablename = 'titulos_financeiros' AND qual LIKE '%origem_tipo%'"), '0');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120001'"), '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120001_financeiro.sql');
  // Com uma conta criada pelo M07, o rollback é recusado.
  const dona = 'e7100000-0000-4000-8000-000000000001';
  adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES ('${dona}', 'dona-rb@teste.example', 'Dona RB', true)`);
  comoPapel(banco.url, { sub: dona }, "SELECT public.garantir_perfil('business', 'Dona RB')");
  const cat = adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'");
  const empresa = JSON.parse(comoPapel(banco.url, { sub: dona }, `SELECT public.criar_empresa('${JSON.stringify({ nome_publico: '[TESTE] RB', modalidade: 'comercio', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'rb@teste.example' })}'::jsonb, 'rb-setup-0001')::text`).saida).id;
  const r = comoPapel(banco.url, { sub: dona }, `SELECT public.criar_conta('${empresa}', '{"nome":"Banco","tipo":"banco"}'::jsonb, 'rb-conta-0001')`);
  assert.ok(r.ok, r.erro);
  assert.throws(() => aplicarArquivo(banco.url, 'db/migrations_propostas/202611120001_financeiro.down.sql'), /Rollback recusado/);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120001'"), '1');
  assert.equal(adm("SELECT count(*) FROM public.contas_financeiras WHERE tipo = 'banco'"), '1');
});

test('aplica, desfaz e reaplica a 202611120002 (correção do M07): funções do M07 voltam idênticas, categorias e coluna restauradas', opcoes, () => {
  const nomes = ['garantir_categorias', 'alterar_categoria_financeira', 'definir_categoria_ativa', 'compras_para_conta_pagar', 'gerar_titulo_compra',
    'fechar_periodo', 'resumo_periodo', 'painel_financeiro', 'relatorio_financeiro', 'exportar_financeiro'];
  const assinatura = () => adm(`SELECT md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.proname)) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'app_private') AND p.proname IN (${nomes.map((n) => `'${n}'`).join(',')})`);
  const antes = assinatura();
  const nomesCategorias = () => adm("SELECT string_agg(DISTINCT nome, '|' ORDER BY nome) FROM public.categorias_financeiras WHERE codigo_sistema IS NOT NULL");
  adm('SELECT count(app_private.garantir_categorias(id)) FROM public.empresas');   // categorias com o nome antigo
  const categoriasAntes = nomesCategorias();
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120002_correcao_financeiro.sql');
  assert.notEqual(assinatura(), antes);
  assert.match(nomesCategorias(), /Compras para revenda\|Insumos e materiais de uso interno\|Vendas/);
  assert.equal(funcoes(['valor_insumos_compra', 'classe_compra', 'conferencias_caixa', 'divergencias_resumo', 'divergencias_caixa']), '5');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120002_correcao_financeiro.down.sql');
  assert.equal(assinatura(), antes);
  assert.equal(nomesCategorias(), categoriasAntes);
  assert.equal(funcoes(['valor_insumos_compra', 'classe_compra', 'conferencias_caixa', 'divergencias_resumo', 'divergencias_caixa']), '0');
  assert.equal(adm("SELECT count(*) FROM information_schema.columns WHERE column_name = 'reconhecimento_insumos'"), '0');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120002'"), '0');
  assert.equal(adm("SELECT count(*) FROM public.contas_financeiras WHERE tipo = 'banco'"), '1');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120002_correcao_financeiro.sql');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120002'"), '1');
});
