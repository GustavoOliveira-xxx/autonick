/**
 * Testes de banco da correção do M07 (migration 202611120002, ADR-G07: I7-01 = A reforçada, I7-02 = C).
 * - Conferência de caixa: diferença como ajuste identificado (nem receita nem despesa), com valor, motivo, quem
 *   conferiu, data e hora, auditoria própria; fluxo separa diferenças de saldos iniciais; relatório e exportação de
 *   conferências; indicação de divergências recorrentes no painel.
 * - Compras: revenda (CMV na venda) e insumos de uso interno (despesa gerencial no mês da compra) separados;
 *   compra mista dividida pelos itens; nenhum custo entra duas vezes; cancelamento compensa no mês; rollback.
 * PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const MIGRATIONS = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`)
  .concat(['202611020001_categorias_produto', '202611020002_clientes_vendas', '202611120001_financeiro', '202611120002_correcao_financeiro']);

const ID = (n) => `e7c00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-corr@teste.example', nome: 'Dona Odete' },
  F: { id: ID(2), email: 'fin-corr@teste.example', nome: 'Financeiro Fábio' },
  L: { id: ID(3), email: 'leitura-corr@teste.example', nome: 'Leitura Lu' },
  X: { id: ID(4), email: 'outra-corr@teste.example', nome: 'Xênia Outra' },
};
let chave = 0;
const k = () => `corr-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args) => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args) {
  const r = rpc(p, nome, args);
  assert.ok(r.ok, `${nome}: ${r.erro}`);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}

let A; let B; let hoje; let mesAtual; let mes1; let mes2; let mes3;
const dia = (mes, d) => `${mes.slice(0, 8)}${String(d).padStart(2, '0')}`;
const M = {};

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of MIGRATIONS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  for (const p of Object.values(P)) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
  }
  for (const p of [P.O, P.X]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`);
  const cat = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'").saida;
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'comercio', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'privado@teste.example' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('[TESTE] Ateliê A')}'::jsonb, 'corr-setup-01')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('[TESTE] Loja B')}'::jsonb, 'corr-setup-02')::text`).saida).id;
  const perfil = (nome, perms) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.criar_perfil_permissao(${q(A)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())})::text`).saida);
  const fin = perfil('Financeiro', ['financeiro.visualizar', 'financeiro.criar', 'financeiro.aprovar', 'financeiro.cancelar', 'financeiro.fechar', 'financeiro.exportar']);
  const leitura = perfil('Leitura', ['financeiro.visualizar']);
  for (const [p, perfilId] of [[P.F, fin.id], [P.L, leitura.id]]) {
    const c = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.convidar_funcionario(${q(A)}, ${q(p.email)}, ${q(perfilId)}, ${q(k())})::text`).saida);
    comoPapel(banco.url, { sub: p.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`);
  }
  hoje = adm('SELECT app_private.hoje_sp()::text');
  mesAtual = adm("SELECT date_trunc('month', app_private.hoje_sp())::date::text");
  mes1 = adm(`SELECT (${q(mesAtual)}::date - interval '1 month')::date::text`);
  mes2 = adm(`SELECT (${q(mesAtual)}::date - interval '2 months')::date::text`);
  mes3 = adm(`SELECT (${q(mesAtual)}::date - interval '3 months')::date::text`);
  // Caixa físico com saldo inicial de R$ 1.000,00 três meses atrás (é o primeiro registro: o próximo mês a fechar é mes3).
  M.caixa = ok(P.O, 'criar_conta', `${q(A)}, ${j({ nome: 'Gaveta', tipo: 'caixa', saldo_inicial_centavos: 100000, data_saldo_inicial: dia(mes3, 1) })}, ${q(k())}`).id;
  M.banco = ok(P.O, 'criar_conta', `${q(A)}, ${j({ nome: 'Banco fictício', tipo: 'banco', saldo_inicial_centavos: 500000, data_saldo_inicial: dia(mes3, 1) })}, ${q(k())}`).id;
  M.cat = Object.fromEntries(ok(P.L, 'categorias_financeiras_da_empresa', q(A)).map((c) => [c.nome, c.id]));
});
after(() => banco?.encerrar());

test('categorias do sistema: Vendas, Compras para revenda e Insumos de uso interno; insumos não são renomeados nem desativados', opcoes, () => {
  const cats = ok(P.L, 'categorias_financeiras_da_empresa', q(A));
  assert.equal(cats.length, 13);
  assert.deepEqual(cats.filter((c) => c.sistema).map((c) => c.nome).sort(), ['Compras para revenda', 'Insumos e materiais de uso interno', 'Vendas']);
  falha(rpc(P.F, 'alterar_categoria_financeira', `${q(M.cat['Insumos e materiais de uso interno'])}, ${j({ nome: 'Material' })}, 1, ${q(k())}`), 'sistema');
  falha(rpc(P.F, 'definir_categoria_ativa', `${q(M.cat['Insumos e materiais de uso interno'])}, false, 1, ${q(k())}`), 'sistema');
  assert.equal(adm(`SELECT reconhecimento_insumos FROM app_private.controle_financeiro WHERE empresa_id = ${q(A)}`) || 'compra', 'compra');
  falha(sql(banco.url, `UPDATE app_private.controle_financeiro SET reconhecimento_insumos = 'consumo' WHERE empresa_id = ${q(A)}`), 'check');
});

test('fechamento com conferência: quem conferiu, quando, auditoria por diferença; diferença fora do resultado e visível no fluxo', opcoes, () => {
  const s = ok(P.L, 'situacao_fechamento', q(A));
  assert.equal(s.proximo_mes, mes3);
  const esperado = s.caixas.find((c) => c.conta_id === M.caixa).esperado_centavos;
  assert.equal(esperado, 100000);
  const antes = adm('SELECT now()::text');
  const f = ok(P.O, 'fechar_periodo', `${q(A)}, ${q(mes3)}, ${j([{ conta_id: M.caixa, contado_centavos: 99500, motivo: 'Falta de troco, nota de R$ 5 sumida' }])}, ${q(k())}`);
  const c = f.conferencias[0];
  assert.equal(c.diferenca_centavos, -500);
  assert.equal(c.motivo, 'Falta de troco, nota de R$ 5 sumida');
  assert.equal(c.conferido_por, 'Dona Odete');
  assert.ok(c.conferido_em >= antes.slice(0, 10), c.conferido_em);
  assert.ok(c.lancamento_id);
  assert.equal(adm(`SELECT tipo || '/' || natureza || '/' || sentido || '/' || (valor * 100)::bigint || '/' || (autor = ${q(P.O.id)}) FROM public.lancamentos_financeiros WHERE id = ${q(c.lancamento_id)}`),
    'ajuste_conferencia/ajuste/saida/500/true');
  assert.equal(adm(`SELECT (dados_minimizados->>'diferenca_centavos') || '|' || (dados_minimizados->>'motivo') FROM app_private.eventos_auditoria
    WHERE tipo_acao = 'financeiro.diferenca_caixa' AND recurso_id = ${q(c.lancamento_id)}`), '-500|Falta de troco, nota de R$ 5 sumida');
  // Fluxo de caixa do mês: diferença separada do saldo inicial; resultado não muda.
  const p = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mes3)}, ${q(adm(`SELECT ((${q(mes3)}::date + interval '1 month - 1 day')::date)::text`))}`);
  assert.equal(p.fluxo.diferencas_caixa_centavos, -500);
  assert.equal(p.fluxo.saldos_iniciais_centavos, 600000);
  assert.equal(p.resultado.despesas_centavos, 0);
  assert.equal(p.divergencias_caixa.recorrente, false);
  assert.equal(p.divergencias_caixa.faltas_centavos, 500);
});

test('divergências recorrentes: 2 meses com diferença entre os últimos 6 acendem o alerta; mês sem diferença também é registrado', opcoes, () => {
  ok(P.F, 'fechar_periodo', `${q(A)}, ${q(mes2)}, ${j([{ conta_id: M.caixa, contado_centavos: 99500 }])}, ${q(k())}`);
  let d = ok(P.L, 'divergencias_caixa', q(A));
  assert.equal(d.resumo.recorrente, false);
  assert.equal(d.conferencias.length, 2);
  assert.deepEqual(d.conferencias.map((x) => x.divergente), [false, true]);
  assert.equal(d.conferencias[0].conferido_por, 'Financeiro Fábio');
  // Diferença só o proprietário registra.
  falha(rpc(P.F, 'fechar_periodo', `${q(A)}, ${q(mes1)}, ${j([{ conta_id: M.caixa, contado_centavos: 99700, motivo: 'Sobra de troco na gaveta' }])}, ${q(k())}`), 'Só o proprietário');
  ok(P.O, 'fechar_periodo', `${q(A)}, ${q(mes1)}, ${j([{ conta_id: M.caixa, contado_centavos: 99700, motivo: 'Sobra de troco na gaveta' }])}, ${q(k())}`);
  d = ok(P.L, 'divergencias_caixa', q(A));
  assert.equal(d.resumo.recorrente, true);
  assert.match(d.resumo.alerta, /2 ou mais dos últimos 6 meses/);
  assert.equal(d.resumo.caixas[0].meses_com_diferenca_ultimos_6, 2);
  assert.equal(d.resumo.faltas_centavos, 500);
  assert.equal(d.resumo.sobras_centavos, 200);
  assert.equal(ok(P.L, 'painel_financeiro', q(A)).divergencias_caixa.recorrente, true);
  falha(rpc(P.X, 'divergencias_caixa', q(A)), 'TENANT_FORBIDDEN');
});

test('relatórios: categorias separam diferenças de caixa e saldos iniciais; relatório e CSV de conferências (exportação auditada)', opcoes, () => {
  const cat = ok(P.L, 'relatorio_financeiro', `${q(A)}, 'categorias', ${q(mes3)}, ${q(hoje)}`);
  const nomes = cat.linhas.map((l) => l.categoria);
  assert.ok(nomes.includes('Diferenças de conferência de caixa'), nomes.join(','));
  assert.ok(nomes.includes('Saldos iniciais de contas'));
  assert.equal(cat.linhas.find((l) => l.categoria === 'Diferenças de conferência de caixa').liquido_centavos, -300);
  const conf = ok(P.L, 'relatorio_financeiro', `${q(A)}, 'conferencias', ${q(mes3)}, ${q(hoje)}`);
  assert.equal(conf.linhas.length, 3);
  assert.match(conf.metodo, /nunca é apagada/);
  falha(rpc(P.L, 'exportar_financeiro', `${q(A)}, 'conferencias', ${q(mes3)}, ${q(hoje)}`), 'FORBIDDEN_ACTION');
  const csv = ok(P.F, 'exportar_financeiro', `${q(A)}, 'conferencias', ${q(mes3)}, ${q(hoje)}`);
  assert.equal(csv.colunas[4], 'Diferença (R$)');
  assert.equal(csv.linhas.length, 3);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'financeiro.exportacao' AND dados_minimizados->>'tipo' = 'conferencias'"), '1');
});

test('compras (I7-02 = C): revenda, insumos e mista classificadas pelos itens; categoria imposta; nenhum custo contado duas vezes', opcoes, () => {
  const prod = (nome, finalidade, custo) => ok(P.O, 'criar_produto', `${q(A)}, ${j({ nome, finalidade, preco_centavos: 5000, quantidade_inicial: 10,
    custo_centavos: custo })}, NULL, ${q(k())}`).variacoes[0].id;
  M.tecido = prod('Tecido para revenda', 'comercializavel', 3000);
  M.linha = prod('Linha de costura', 'uso_interno', 1000);
  const forn = ok(P.O, 'criar_fornecedor', `${q(A)}, ${j({ nome: 'Armarinho Fictício' })}, ${q(k())}`).id;
  const compra = (itens) => {
    const total = itens.reduce((s, [, qtd, custo]) => s + qtd * custo, 0);
    const id = adm(`INSERT INTO public.compras_fornecedor (empresa_id, fornecedor_id, data_compra, estado, custo_total, autor)
      VALUES (${q(A)}, ${q(forn)}, ${q(dia(mesAtual, 1))}, 'registrada', ${total / 100}, ${q(P.O.id)}) RETURNING id`).split('\n')[0];
    for (const [v, qtd, custo] of itens) {
      adm(`INSERT INTO public.compra_itens (compra_id, empresa_id, variacao_id, quantidade, custo_unitario) VALUES (${q(id)}, ${q(A)}, ${q(v)}, ${qtd}, ${custo / 100})`);
    }
    return id;
  };
  const revenda = compra([[M.tecido, 20, 3000]]);          // R$ 600,00
  const insumos = compra([[M.linha, 20, 1000]]);           // R$ 200,00
  const mista = compra([[M.tecido, 10, 3000], [M.linha, 20, 1000]]);   // R$ 300,00 + R$ 200,00
  const lista = Object.fromEntries(ok(P.F, 'compras_para_conta_pagar', q(A)).map((c) => [c.id, c]));
  assert.deepEqual([lista[revenda].classificacao, lista[insumos].classificacao, lista[mista].classificacao], ['revenda', 'insumos', 'misto']);
  assert.deepEqual([lista[mista].revenda_centavos, lista[mista].insumos_centavos], [30000, 20000]);
  // Outra categoria contaria o custo duas vezes: recusada.
  falha(rpc(P.F, 'gerar_titulo_compra', `${q(revenda)}, ${j({ categoria_id: M.cat.Aluguel })}, ${q(k())}`), 'duas vezes');
  falha(rpc(P.F, 'gerar_titulo_compra', `${q(revenda)}, ${j({ categoria_id: M.cat['Insumos e materiais de uso interno'] })}, ${q(k())}`), 'duas vezes');
  const tR = ok(P.F, 'gerar_titulo_compra', `${q(revenda)}, '{}'::jsonb, ${q(k())}`);
  const tI = ok(P.F, 'gerar_titulo_compra', `${q(insumos)}, ${j({ categoria_id: M.cat['Insumos e materiais de uso interno'] })}, ${q(k())}`);
  const tM = ok(P.F, 'gerar_titulo_compra', `${q(mista)}, '{}'::jsonb, ${q(k())}`);
  assert.deepEqual([tR.categoria, tI.categoria, tM.categoria], ['Compras para revenda', 'Insumos e materiais de uso interno', 'Compras para revenda']);
  assert.equal(adm(`SELECT dados_minimizados->>'classificacao' FROM app_private.eventos_auditoria WHERE tipo_acao = 'financeiro.titulo_de_compra' AND recurso_id = ${q(tM.id)}`), 'misto');
  M.tituloMista = tM.id;
  // Resultado do mês: insumos R$ 400 (200 + 200 da mista) como despesa; revenda R$ 900 fora das despesas.
  let r = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).resultado;
  assert.equal(r.despesas_centavos, 40000);
  assert.equal(r.insumos_centavos, 40000);
  assert.equal(r.compras_revenda_centavos, 90000);
  assert.equal(r.compras_mercadorias_centavos, 90000);
  assert.equal(r.reconhecimento_insumos, 'compra');
  assert.match(r.metodo, /insumos de uso interno são despesa gerencial no mês da compra/);
  assert.match(r.aviso, /não é contabilidade oficial/i);
  // Venda de 2 tecidos (custo R$ 30,00 cada): CMV R$ 60,00; os insumos não viram CMV (não são vendidos).
  ok(P.O, 'registrar_venda_direta', `${q(A)}, '{}'::jsonb, ${j([{ variacao_id: M.tecido, quantidade: 2 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  r = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).resultado;
  assert.equal(r.custo_mercadorias_vendidas_centavos, 6000);
  assert.equal(r.resultado_estimado_centavos, 10000 - 6000 - 40000);
  // Pagar a conta de insumos: saída no caixa, mas a despesa continua contada uma vez só.
  const parc = adm(`SELECT id FROM public.parcelas_financeiras WHERE titulo_id = ${q(tI.id)}`);
  ok(P.F, 'registrar_pagamento', `${q(parc)}, 20000, ${q(M.banco)}, 'pix', ${q(hoje)}, ${q(k())}`);
  r = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).resultado;
  assert.equal(r.despesas_centavos, 40000);
  // Despesa avulsa de insumos e conta manual de insumos somam; conta manual de revenda não.
  ok(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.banco, valor_centavos: 1500, categoria_id: M.cat['Insumos e materiais de uso interno'], descricao: 'Agulhas', data: hoje })}, ${q(k())}`);
  ok(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Revenda sem nota no sistema', categoria_id: M.cat['Compras para revenda'], competencia: hoje, valor_centavos: 7000, vencimento: hoje })}, ${q(k())}`);
  r = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).resultado;
  assert.equal(r.despesas_centavos, 41500);
  assert.equal(r.insumos_centavos, 41500);
  assert.equal(r.compras_revenda_centavos, 97000);
});

test('cancelar a conta de uma compra mista compensa as duas partes no mês do cancelamento; histórico de estoque intacto', opcoes, () => {
  const estoque = adm(`SELECT count(*) || '/' || coalesce(sum(quantidade), 0) FROM public.movimentacoes_estoque WHERE empresa_id = ${q(A)}`);
  const v = Number(adm(`SELECT versao FROM public.titulos_financeiros WHERE id = ${q(M.tituloMista)}`));
  ok(P.F, 'cancelar_titulo', `${q(M.tituloMista)}, 'Compra lançada em duplicidade no teste', ${v}, ${q(k())}`);
  const r = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).resultado;
  assert.equal(r.despesas_centavos, 21500);     // sai a parte de insumos da mista (R$ 200)
  assert.equal(r.insumos_centavos, 21500);
  assert.equal(r.compras_revenda_centavos, 67000);   // sai a parte de revenda da mista (R$ 300)
  assert.equal(adm(`SELECT count(*) || '/' || coalesce(sum(quantidade), 0) FROM public.movimentacoes_estoque WHERE empresa_id = ${q(A)}`), estoque);
  const rec = JSON.parse(adm(`SELECT app_private.reconciliacao(${q(A)})::text`));
  assert.deepEqual(rec.contas_divergentes, []);
  assert.deepEqual(rec.titulos_divergentes, []);
});

test('privilégios: funções novas internas fora da Data API; leitura pública só com financeiro.visualizar', opcoes, () => {
  for (const f of ['valor_insumos_compra(uuid)', 'classe_compra(uuid)', 'conferencias_caixa(uuid,date,date)', 'divergencias_resumo(uuid)']) {
    assert.equal(adm(`SELECT has_function_privilege('authenticated', 'app_private.${f}', 'EXECUTE')`), 'f', f);
    assert.equal(adm(`SELECT has_function_privilege('anonymous', 'app_private.${f}', 'EXECUTE')`), 'f', f);
  }
  assert.equal(adm("SELECT has_function_privilege('anonymous', 'public.divergencias_caixa(uuid,date,date)', 'EXECUTE')"), 'f');
  assert.equal(adm("SELECT prosecdef AND 'search_path=\"\"' = ANY(proconfig) FROM pg_proc WHERE oid = 'public.divergencias_caixa(uuid,date,date)'::regprocedure"), 't');
  falha(rpc(P.X, 'painel_financeiro', q(A)), 'TENANT_FORBIDDEN');
  assert.equal(ok(P.X, 'divergencias_caixa', q(B)).conferencias.length, 0);
});

test('rollback da 202611120002: recusado com a categoria de insumos em uso (nada muda)', opcoes, () => {
  assert.throws(() => aplicarArquivo(banco.url, 'db/migrations_propostas/202611120002_correcao_financeiro.down.sql'), /já está em uso/);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120002'"), '1');
});
