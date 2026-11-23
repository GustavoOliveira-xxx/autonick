/**
 * Testes de banco do M07 (migration 202611120001): carga idempotente do M06 (D7-16), contas e caixas (D7-02, D7-03),
 * categorias (D7-04), a receber e a pagar com parcelas e baixas parciais (exemplo 1 do FIN-001), lançamentos avulsos,
 * transferências (exemplo 3 do FIN-001), aporte e retirada só do proprietário (D7-05, D7-06), recorrências (D7-08, D7-09),
 * conta a pagar de compra (D7-07), fechamento e reabertura (D7-11 a D7-13), indicadores com método e cobertura de custo
 * (D7-14, D7-15), relatórios e exportação (D7-01), permissões (D7-17), datas (D7-18), concorrência real, isolamento,
 * identidade vazia (D-07), histórico imutável e privilégios. PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const CORRECAO = Boolean(process.env.AUTONICK_COM_CORRECAO_M07);
const COMPRAS = CORRECAO ? 'Compras para revenda' : 'Compras de mercadorias e insumos';
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ATE_M06 = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`)
  .concat(['202611020001_categorias_produto', '202611020002_clientes_vendas']);

const ID = (n) => `e7000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m07@teste.example', nome: 'Dona Olga' },
  G: { id: ID(2), email: 'gerente-m07@teste.example', nome: 'Gerente Gil' },
  F: { id: ID(3), email: 'financeiro-m07@teste.example', nome: 'Financeiro Flora' },
  C: { id: ID(4), email: 'caixa-m07@teste.example', nome: 'Caixa Caio' },
  L: { id: ID(5), email: 'leitura-m07@teste.example', nome: 'Leitura Lia' },
  V: { id: ID(6), email: 'vendas-m07@teste.example', nome: 'Vendas Vera' },
  X: { id: ID(7), email: 'outra-m07@teste.example', nome: 'Xavier Outra' },
};

let chave = 0;
const k = () => `fin-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const como = (p, c) => comoPapel(banco.url, { sub: p.id }, c);
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args) => como(p, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args) {
  const r = rpc(p, nome, args);
  assert.ok(r.ok, `${nome}: ${r.erro}`);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}
const saldoConta = (id) => Number(adm(`SELECT (saldo * 100)::bigint FROM public.contas_financeiras WHERE id = ${q(id)}`));
const somaConta = (id) => Number(adm(`SELECT coalesce(sum(CASE sentido WHEN 'entrada' THEN valor ELSE -valor END) * 100, 0)::bigint
  FROM public.lancamentos_financeiros WHERE conta_id = ${q(id)}`));
const versao = (tabela, id) => Number(adm(`SELECT versao FROM public.${tabela} WHERE id = ${q(id)}`));
function reconciliacaoOk(empresa) {
  const r = JSON.parse(adm(`SELECT app_private.reconciliacao(${q(empresa)})::text`));
  assert.deepEqual(r, { contas_divergentes: [], titulos_divergentes: [], parcelas_divergentes: 0, recebimentos_sem_lancamento: 0,
    pagamentos_sem_lancamento: 0, transferencias_incompletas: 0, lancamentos_sem_origem: 0 }, JSON.stringify(r));
}

/** Sessão real (conexão própria) com a identidade da pessoa e espera antes do COMMIT, para provocar disputa. */
const sessao = (p, comando, espera = 0, antes = 0) => new Promise((resolver) => {
  const bloco = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${p.id}","role":"authenticated"}', true) \\gset
SELECT pg_sleep(${antes});
${comando};
SELECT pg_sleep(${espera});
COMMIT;`;
  const ps = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', banco.url]);
  let saida = '';
  let erro = '';
  ps.stdout.on('data', (d) => { saida += d; });
  ps.stderr.on('data', (d) => { erro += d; });
  ps.on('close', (codigo) => resolver({ ok: codigo === 0, saida: saida.trim(), erro }));
  ps.stdin.end(bloco);
});

let A; let B;
let hoje; let mesAtual; let mes1; let mes2; let mes3;   // mes1 = mês passado, mes2 = retrasado, mes3 = três meses atrás
const dia = (mes, d) => `${mes.slice(0, 8)}${String(d).padStart(2, '0')}`;
const fimMes = (mes) => adm(`SELECT ((${q(mes)}::date + interval '1 month - 1 day')::date)::text`);
const M = {};

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ATE_M06) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  for (const p of Object.values(P)) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
  }
  for (const p of [P.O, P.X]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`);
  const cat = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'").saida;
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'comercio', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'privado@teste.example' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('[TESTE] Mercearia A')}'::jsonb, 'fin-setup-01')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('[TESTE] Loja B')}'::jsonb, 'fin-setup-02')::text`).saida).id;
  const perfil = (nome, perms) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.criar_perfil_permissao(${q(A)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())})::text`).saida);
  M.perfis = {
    gerente: perfil('Gerente', ['financeiro.visualizar', 'financeiro.criar', 'financeiro.aprovar', 'financeiro.cancelar', 'financeiro.exportar',
      'vendas.visualizar', 'vendas.criar', 'vendas.aprovar', 'vendas.cancelar', 'vendas.registrar_recebimento', 'produtos.visualizar']),
    financeiro: perfil('Financeiro', ['financeiro.visualizar', 'financeiro.criar', 'financeiro.aprovar', 'financeiro.cancelar', 'financeiro.fechar',
      'financeiro.exportar']),
    caixa: perfil('Caixa', ['vendas.visualizar', 'vendas.registrar_recebimento']),
    leitura: perfil('Leitura', ['financeiro.visualizar']),
    vendas: perfil('Vendas', ['vendas.visualizar', 'vendas.criar']),
  };
  for (const [p, perfilId] of [[P.G, M.perfis.gerente.id], [P.F, M.perfis.financeiro.id], [P.C, M.perfis.caixa.id], [P.L, M.perfis.leitura.id],
    [P.V, M.perfis.vendas.id]]) {
    const c = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.convidar_funcionario(${q(A)}, ${q(p.email)}, ${q(perfilId)}, ${q(k())})::text`).saida);
    comoPapel(banco.url, { sub: p.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`);
  }
  // Dados do M06 ANTES do M07: venda paga em parte, venda cancelada com devolução e estorno de recebimento.
  const prod = (nome, preco, custo) => JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_produto(${q(A)}, ${j({ nome,
    finalidade: 'comercializavel', preco_centavos: preco, quantidade_inicial: 50, ...(custo === null ? {} : { custo_centavos: custo }) })}, NULL, ${q(k())})::text`).saida);
  M.queijo = prod('Queijo', 4000, 2500).variacoes[0].id;
  M.doce = prod('Doce caseiro', 1000, null).variacoes[0].id;
  const direta = (itens, pagamento) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.registrar_venda_direta(${q(A)}, '{}'::jsonb, ${j(itens)}, ${j(pagamento)}, NULL, ${q(k())})::text`).saida);
  M.v1 = direta([{ variacao_id: M.queijo, quantidade: 2 }], { recebimento_inicial: { valor_centavos: 5000, forma: 'dinheiro' } });
  M.v2 = direta([{ variacao_id: M.doce, quantidade: 3 }], { recebimento_inicial: { valor_centavos: 3000, forma: 'pix' } });
  const r2 = sql(banco.url, `SELECT id FROM public.recebimentos WHERE titulo_id = ${q(M.v2.titulo_id)}`).saida;
  comoPapel(banco.url, { sub: P.O.id }, `SELECT public.estornar_recebimento(${q(r2)}, 'Pix devolvido pelo banco no teste', ${q(k())})`);
  M.v3 = direta([{ variacao_id: M.queijo, quantidade: 1 }], { recebimento_inicial: { valor_centavos: 4000, forma: 'dinheiro' } });
  const ver = sql(banco.url, `SELECT versao FROM public.vendas WHERE id = ${q(M.v3.id)}`).saida;
  comoPapel(banco.url, { sub: P.O.id }, `SELECT public.cancelar_venda(${q(M.v3.id)}, 'Cliente desistiu da compra', ${j({ [M.queijo]: 'voltou' })}, ${ver}, ${q(k())})`);
  comoPapel(banco.url, { sub: P.O.id }, `SELECT public.registrar_devolucao_valor(${q(M.v3.titulo_id)}, 1500, 'dinheiro', 'Parte devolvida', ${q(k())})`);
  M.recebimentosM06 = Number(sql(banco.url, 'SELECT count(*) FROM public.recebimentos').saida);
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120001_financeiro.sql');
  // Com AUTONICK_COM_CORRECAO_M07, a suíte roda sobre a correção 202611120002 (regressão do M07).
  if (CORRECAO) aplicarArquivo(banco.url, 'db/migrations_propostas/202611120002_correcao_financeiro.sql');
  hoje = adm('SELECT app_private.hoje_sp()::text');
  mesAtual = adm("SELECT date_trunc('month', app_private.hoje_sp())::date::text");
  mes1 = adm(`SELECT (${q(mesAtual)}::date - interval '1 month')::date::text`);
  mes2 = adm(`SELECT (${q(mesAtual)}::date - interval '2 months')::date::text`);
  mes3 = adm(`SELECT (${q(mesAtual)}::date - interval '3 months')::date::text`);
  M.caixa = adm(`SELECT id FROM public.contas_financeiras WHERE empresa_id = ${q(A)} AND padrao`);
});
after(() => banco?.encerrar());

test('carga do M06 (D7-16): um lançamento por recebimento, saldo correto, repetir não duplica, auditada', opcoes, () => {
  assert.equal(M.recebimentosM06, 5);   // 3 recebimentos, 1 estorno, 1 devolução
  assert.equal(adm('SELECT count(*) FROM public.lancamentos_financeiros WHERE carga_m06'), '5');
  assert.equal(adm("SELECT string_agg(tipo, ',' ORDER BY criado_em) FROM public.lancamentos_financeiros WHERE carga_m06"),
    'recebimento,recebimento,estorno,recebimento,devolucao_cliente');
  // 50 + 30 − 30 + 40 − 15 = 75
  assert.equal(saldoConta(M.caixa), 7500);
  assert.equal(somaConta(M.caixa), 7500);
  assert.equal(adm("SELECT count(DISTINCT categoria_id) FROM public.lancamentos_financeiros WHERE carga_m06"), '1');
  assert.equal(JSON.parse(adm('SELECT app_private.carregar_lancamentos_m06()::text')).lancamentos_criados, 0);
  assert.equal(adm('SELECT count(*) FROM public.lancamentos_financeiros WHERE carga_m06'), '5');
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'financeiro.carga_m06'"), '1');
  assert.equal(adm("SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo = 'venda' AND (categoria_id IS NULL OR competencia IS NULL)"), '0');
  assert.equal(adm("SELECT tipo || '/' || saldo FROM public.contas_financeiras WHERE padrao"), 'caixa/75.00');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '51');
  reconciliacaoOk(A);
});

test('categorias iniciais (D7-04): 12, Vendas e Compras do sistema, ampliáveis e renomeáveis; transferência não é categoria', opcoes, () => {
  const cats = ok(P.L, 'categorias_financeiras_da_empresa', q(A));
  assert.equal(cats.length, CORRECAO ? 13 : 12);
  assert.deepEqual(cats.filter((c) => c.sistema).map((c) => c.nome).sort(),
    CORRECAO ? [COMPRAS, 'Insumos e materiais de uso interno', 'Vendas'] : [COMPRAS, 'Vendas']);
  assert.equal(cats.some((c) => /transfer|retirada|aporte/i.test(c.nome)), false);
  M.cat = Object.fromEntries(cats.map((c) => [c.nome, c.id]));
  falha(rpc(P.L, 'criar_categoria_financeira', `${q(A)}, ${j({ tipo: 'despesa', nome: 'Contador' })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'criar_categoria_financeira', `${q(A)}, ${j({ tipo: 'despesa', nome: 'aluguel' })}, ${q(k())}`), 'Já existe');
  falha(rpc(P.F, 'criar_categoria_financeira', `${q(A)}, ${j({ tipo: 'lucro', nome: 'X' })}, ${q(k())}`), 'receita ou de despesa');
  const nova = ok(P.F, 'criar_categoria_financeira', `${q(A)}, ${j({ tipo: 'despesa', nome: 'Contador' })}, ${q(k())}`);
  M.cat.Contador = nova.id;
  falha(rpc(P.F, 'alterar_categoria_financeira', `${q(M.cat.Vendas)}, ${j({ nome: 'Faturamento' })}, 1, ${q(k())}`), 'sistema');
  falha(rpc(P.F, 'definir_categoria_ativa', `${q(M.cat[COMPRAS])}, false, ${versao('categorias_financeiras', M.cat[COMPRAS])}, ${q(k())}`), 'sistema');
  assert.equal(ok(P.F, 'alterar_categoria_financeira', `${q(nova.id)}, ${j({ nome: 'Contabilidade' })}, 1, ${q(k())}`).nome, 'Contabilidade');
  const div = ok(P.F, 'criar_categoria_financeira', `${q(A)}, ${j({ tipo: 'despesa', nome: 'Brindes' })}, ${q(k())}`);
  assert.equal(ok(P.F, 'definir_categoria_ativa', `${q(div.id)}, false, 1, ${q(k())}`).ativa, false);
  falha(rpc(P.X, 'categorias_financeiras_da_empresa', q(A)), 'TENANT_FORBIDDEN');
});

test('contas (D7-02, D7-03): tipos, só o nome, saldo inicial como lançamento, caixa nunca negativo, desativação com saldo zero', opcoes, () => {
  falha(rpc(P.L, 'criar_conta', `${q(A)}, ${j({ nome: 'Banco', tipo: 'banco' })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Banco', tipo: 'banco', agencia: '0001' })}, ${q(k())}`), 'não permitido: agencia');
  falha(rpc(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Gaveta', tipo: 'caixa', permite_negativo: true })}, ${q(k())}`), 'nunca fica negativo');
  falha(rpc(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'caixa da empresa', tipo: 'caixa' })}, ${q(k())}`), 'Já existe uma conta');
  falha(rpc(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Poupança', tipo: 'investimento' })}, ${q(k())}`), 'Escolha o tipo');
  const ch = k();
  const banco1 = ok(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Banco do bairro', tipo: 'banco', saldo_inicial_centavos: 50000, data_saldo_inicial: dia(mes2, 5) })}, ${q(ch)}`);
  assert.equal(ok(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Banco do bairro', tipo: 'banco', saldo_inicial_centavos: 50000, data_saldo_inicial: dia(mes2, 5) })}, ${q(ch)}`).id, banco1.id);
  assert.equal(banco1.saldo_centavos, 50000);
  assert.equal(adm(`SELECT tipo || '/' || natureza || '/' || data FROM public.lancamentos_financeiros WHERE conta_id = ${q(banco1.id)}`), `saldo_inicial/ajuste/${dia(mes2, 5)}`);
  M.banco = banco1.id;
  M.carteira = ok(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Maquininha', tipo: 'carteira_digital', saldo_inicial_centavos: 20000, data_saldo_inicial: dia(mes2, 5) })}, ${q(k())}`).id;
  M.cheque = ok(P.O, 'criar_conta', `${q(A)}, ${j({ nome: 'Conta com limite', tipo: 'banco', permite_negativo: true })}, ${q(k())}`).id;
  falha(rpc(P.F, 'definir_conta_ativa', `${q(M.banco)}, false, ${versao('contas_financeiras', M.banco)}, ${q(k())}`), 'saldo zero');
  falha(rpc(P.F, 'definir_conta_ativa', `${q(M.caixa)}, false, ${versao('contas_financeiras', M.caixa)}, ${q(k())}`), 'conta padrão');
  falha(rpc(P.F, 'alterar_conta', `${q(M.caixa)}, ${j({ permite_negativo: true })}, ${versao('contas_financeiras', M.caixa)}, ${q(k())}`), 'nunca fica negativo');
  falha(rpc(P.F, 'alterar_conta', `${q(M.banco)}, ${j({ nome: 'X' })}, 1, ${q(k())}`), 'VERSION_CONFLICT');
  const vazia = ok(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Conta antiga', tipo: 'outro' })}, ${q(k())}`);
  assert.equal(ok(P.F, 'definir_conta_ativa', `${q(vazia.id)}, false, ${vazia.versao}, ${q(k())}`).ativa, false);
  M.inativa = vazia.id;
  falha(rpc(P.X, 'criar_conta', `${q(A)}, ${j({ nome: 'Invasão', tipo: 'banco' })}, ${q(k())}`), 'TENANT_FORBIDDEN');
  // Quem só registra recebimentos vê as contas ativas, sem saldo; outra empresa não vê nada.
  const vistas = ok(P.C, 'contas_da_empresa', q(A));
  assert.equal(vistas.some((c) => 'saldo_centavos' in c), false);
  assert.equal(vistas.some((c) => c.id === M.inativa), false);
  falha(como(P.C, 'SELECT saldo FROM public.contas_financeiras'), 'permission denied');
  assert.equal(ok(P.L, 'contas_da_empresa', q(A)).find((c) => c.id === M.banco).saldo_centavos, 50000);
  falha(rpc(P.V, 'contas_da_empresa', q(A)), 'FORBIDDEN_ACTION');
  falha(como(P.F, `UPDATE public.contas_financeiras SET saldo = 999 WHERE id = ${q(M.banco)}`), 'permission denied');
  falha(como(P.F, `DELETE FROM public.contas_financeiras WHERE id = ${q(M.inativa)}`), 'permission denied');
  reconciliacaoOk(A);
});

test('exemplo 1 do FIN-001: a receber de R$ 80, baixa parcial de R$ 30, R$ 60 recusado, repetição não duplica', opcoes, () => {
  falha(rpc(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'receber', descricao: 'Encomenda de festa', categoria_id: M.cat['Aluguel'], valor_centavos: 8000, vencimento: hoje })}, ${q(k())}`),
    'categoria de receita');
  falha(rpc(P.L, 'criar_titulo', `${q(A)}, ${j({ tipo: 'receber', descricao: 'Encomenda de festa', categoria_id: M.cat['Outras receitas'], valor_centavos: 8000, vencimento: hoje })}, ${q(k())}`),
    'FORBIDDEN_ACTION');
  const t = ok(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'receber', descricao: 'Encomenda de festa', categoria_id: M.cat['Outras receitas'],
    contraparte_tipo: 'texto', contraparte_texto: 'Buffet da Rua 3', valor_centavos: 8000, vencimento: hoje })}, ${q(k())}`);
  assert.equal(t.total_centavos, 8000);
  assert.equal(t.estado_exibicao, 'pendente');
  assert.equal(t.contraparte, 'Buffet da Rua 3');
  const parcela = t.parcelas[0].id;
  // O caixa do balcão recebe vendas, não contas a receber manuais.
  falha(rpc(P.C, 'registrar_recebimento', `${q(parcela)}, 3000, 'dinheiro', NULL, ${q(k())}`), 'FORBIDDEN_ACTION');
  const antes = saldoConta(M.caixa);
  const ch = k();
  const r = ok(P.F, 'registrar_recebimento', `${q(parcela)}, 3000, 'dinheiro', NULL, ${q(ch)}`);
  assert.equal(r.saldo_parcela_centavos, 5000);
  assert.equal(ok(P.F, 'registrar_recebimento', `${q(parcela)}, 3000, 'dinheiro', NULL, ${q(ch)}`).recebimento_id, r.recebimento_id);
  falha(rpc(P.F, 'registrar_recebimento', `${q(parcela)}, 3100, 'dinheiro', NULL, ${q(ch)}`), 'IDEMPOTENCY_CONFLICT');
  falha(rpc(P.F, 'registrar_recebimento', `${q(parcela)}, 6000, 'dinheiro', NULL, ${q(k())}`), 'PAYMENT_EXCEEDS_BALANCE');
  assert.equal(saldoConta(M.caixa), antes + 3000);
  assert.equal(adm(`SELECT count(*) FROM public.lancamentos_financeiros WHERE origem_tipo = 'recebimento' AND origem_id = ${q(r.recebimento_id)}`), '1');
  const det = ok(P.L, 'titulo_detalhe', q(t.id));
  assert.equal(det.estado_exibicao, 'parcial');
  assert.equal(det.saldo_centavos, 5000);
  assert.equal(det.baixas.length, 1);
  // O restante vai para o banco (conta escolhida).
  ok(P.F, 'registrar_recebimento', `${q(parcela)}, 5000, 'pix', NULL, ${q(k())}, ${q(M.banco)}`);
  assert.equal(ok(P.L, 'titulo_detalhe', q(t.id)).estado, 'liquidado');
  falha(rpc(P.F, 'registrar_recebimento', `${q(parcela)}, 100, 'pix', NULL, ${q(k())}, ${q(M.inativa)}`), 'desativada|PAYMENT_EXCEEDS_BALANCE');
  falha(rpc(P.F, 'registrar_recebimento', `${q(parcela)}, 1, 'pix', ${q('2999-01-01')}, ${q(k())}`), 'futuro');
  M.tituloReceber = t.id;
  reconciliacaoOk(A);
});

test('a pagar parcelado: soma das parcelas, pagamento parcial, saldo insuficiente no caixa, estorno e cancelamento', opcoes, () => {
  falha(rpc(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Forno novo', categoria_id: M.cat['Manutenção'],
    parcelas: [{ valor_centavos: 30000, vencimento: dia(mesAtual, 20) }, { valor_centavos: 30000, vencimento: dia(mesAtual, 10) }] })}, ${q(k())}`), 'em ordem');
  falha(rpc(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Forno novo', categoria_id: M.cat['Manutenção'], parcelas: [] })}, ${q(k())}`), '1 a 24');
  const t = ok(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Forno novo', categoria_id: M.cat['Manutenção'], competencia: hoje,
    parcelas: [{ valor_centavos: 30000, vencimento: dia(mes1, 10) }, { valor_centavos: 30000, vencimento: dia(mesAtual, 28) }, { valor_centavos: 30000, vencimento: '2027-01-28' }] })}, ${q(k())}`);
  assert.equal(t.total_centavos, 90000);
  assert.equal(t.parcelas.length, 3);
  assert.equal(t.parcelas[0].estado_exibicao, 'vencido');   // calculado na leitura (D7-10)
  assert.equal(t.estado_exibicao, 'vencido');
  const p1 = t.parcelas[0].id;
  falha(rpc(P.C, 'registrar_pagamento', `${q(p1)}, 1000, ${q(M.caixa)}, 'dinheiro', NULL, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'registrar_recebimento', `${q(p1)}, 1000, 'dinheiro', NULL, ${q(k())}`), 'conta a pagar');
  falha(rpc(P.F, 'registrar_pagamento', `${q(M.parcelaReceber ?? p1)}, 1000, ${q(M.caixa)}, 'cheque', NULL, ${q(k())}`), 'forma');
  const caixaAntes = saldoConta(M.caixa);
  falha(rpc(P.F, 'registrar_pagamento', `${q(p1)}, ${caixaAntes + 1}, ${q(M.caixa)}, 'dinheiro', NULL, ${q(k())}`), 'INSUFFICIENT_FUNDS');
  assert.equal(saldoConta(M.caixa), caixaAntes);
  falha(rpc(P.F, 'registrar_pagamento', `${q(p1)}, 30001, ${q(M.banco)}, 'pix', NULL, ${q(k())}`), 'PAYMENT_EXCEEDS_BALANCE');
  const pg = ok(P.F, 'registrar_pagamento', `${q(p1)}, 10000, ${q(M.banco)}, 'pix', NULL, ${q(k())}`);
  assert.equal(pg.saldo_parcela_centavos, 20000);
  assert.equal(adm(`SELECT tipo || '/' || natureza || '/' || sentido FROM public.lancamentos_financeiros WHERE origem_id = ${q(pg.pagamento_id)}`), 'pagamento/despesa/saida');
  falha(rpc(P.F, 'cancelar_titulo', `${q(t.id)}, 'Comprei de outro fornecedor', ${versao('titulos_financeiros', t.id)}, ${q(k())}`), 'Estorne');
  falha(rpc(P.F, 'estornar_pagamento', `${q(pg.pagamento_id)}, 'curto', ${q(k())}`), '10 a 300');
  falha(rpc(P.L, 'estornar_pagamento', `${q(pg.pagamento_id)}, 'Pagamento lançado em duplicidade', ${q(k())}`), 'FORBIDDEN_ACTION');
  const bancoAntes = saldoConta(M.banco);
  ok(P.F, 'estornar_pagamento', `${q(pg.pagamento_id)}, 'Pagamento lançado em duplicidade', ${q(k())}`);
  assert.equal(saldoConta(M.banco), bancoAntes + 10000);
  falha(rpc(P.F, 'estornar_pagamento', `${q(pg.pagamento_id)}, 'Pagamento lançado em duplicidade', ${q(k())}`), 'já foi estornado');
  const c = ok(P.F, 'cancelar_titulo', `${q(t.id)}, 'Comprei de outro fornecedor', ${versao('titulos_financeiros', t.id)}, ${q(k())}`);
  assert.equal(c.estado, 'cancelado');
  assert.equal(c.saldo_centavos, 0);
  falha(rpc(P.F, 'registrar_pagamento', `${q(p1)}, 100, ${q(M.banco)}, 'pix', NULL, ${q(k())}`), 'cancelada');
  falha(rpc(P.F, 'cancelar_titulo', `${q(M.v1.titulo_id)}, 'Tentativa indevida aqui', ${versao('titulos_financeiros', M.v1.titulo_id)}, ${q(k())}`), 'própria venda');
  // Conta a pagar que fica aberta para os testes seguintes.
  M.aluguel = ok(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Aluguel da loja', categoria_id: M.cat['Aluguel'], competencia: dia(mes1, 1),
    contraparte_tipo: 'texto', contraparte_texto: 'Imobiliária Fictícia', valor_centavos: 120000, vencimento: dia(mesAtual, 5) })}, ${q(k())}`);
  reconciliacaoOk(A);
});

test('lançamentos avulsos e datas (D7-18): categoria do tipo certo, descrição, sem data futura, estorno único', opcoes, () => {
  falha(rpc(P.L, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.caixa, valor_centavos: 500, categoria_id: M.cat['Transporte'], descricao: 'Táxi' })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.caixa, valor_centavos: 500, categoria_id: M.cat['Vendas'], descricao: 'Táxi' })}, ${q(k())}`), 'categoria de despesa');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.caixa, valor_centavos: 500, categoria_id: M.cat['Transporte'] })}, ${q(k())}`), 'Descreva');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.caixa, valor_centavos: 500, categoria_id: M.cat['Transporte'], descricao: 'Táxi', data: '2999-01-01' })}, ${q(k())}`), 'futuro');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'transferencia_saida', conta_id: M.caixa, valor_centavos: 500, descricao: 'x' })}, ${q(k())}`), 'entrada \\(receita\\) ou uma saída');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'receita_avulsa', conta_id: M.caixa, valor_centavos: 10.5, categoria_id: M.cat['Outras receitas'], descricao: 'x' })}, ${q(k())}`), 'Valor inválido');
  // Saída retroativa só usa o dinheiro que já existia naquela data: o caixa recebeu tudo neste mês (D7-03).
  assert.ok(saldoConta(M.caixa) > 1200);
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.caixa, valor_centavos: 1200, categoria_id: M.cat['Transporte'],
    descricao: 'Frete da entrega', data: dia(mes2, 15) })}, ${q(k())}`), 'disponível a partir de');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.banco, valor_centavos: 50001, categoria_id: M.cat['Transporte'],
    descricao: 'Frete da entrega', data: dia(mes2, 15) })}, ${q(k())}`), 'INSUFFICIENT_FUNDS');
  const d = ok(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.banco, valor_centavos: 1200, categoria_id: M.cat['Transporte'],
    descricao: 'Frete da entrega', data: dia(mes2, 15) })}, ${q(k())}`);
  assert.equal(d.natureza, 'despesa');
  assert.equal(d.data, dia(mes2, 15));
  const r = ok(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'receita_avulsa', conta_id: M.carteira, valor_centavos: 2500, categoria_id: M.cat['Outras receitas'],
    descricao: 'Aluguel de mesas para evento', data: dia(mes2, 20) })}, ${q(k())}`);
  falha(rpc(P.F, 'estornar_lancamento', `${q(r.id)}, 'curto', ${q(k())}`), '10 a 300');
  const e = ok(P.F, 'estornar_lancamento', `${q(r.id)}, 'Evento foi cancelado e devolvemos', ${q(k())}`);
  assert.equal(e.tipo, 'estorno');
  assert.equal(e.sentido, 'saida');
  assert.equal(e.data, hoje);
  falha(rpc(P.F, 'estornar_lancamento', `${q(r.id)}, 'Evento foi cancelado e devolvemos', ${q(k())}`), 'já foi estornado');
  falha(rpc(P.F, 'estornar_lancamento', `${q(e.id)}, 'Estorno do estorno não pode', ${q(k())}`), 'não pode ser estornado');
  const doM06 = adm("SELECT id FROM public.lancamentos_financeiros WHERE tipo = 'recebimento' AND carga_m06 LIMIT 1");
  falha(rpc(P.F, 'estornar_lancamento', `${q(doM06)}, 'Tentar estornar pela via errada', ${q(k())}`), 'estorne o recebimento');
  M.despesaAvulsa = d.id;
  reconciliacaoOk(A);
});

test('exemplo 3 do FIN-001: transferência de R$ 125 entre contas não cria receita; outra empresa e mesma conta recusadas', opcoes, () => {
  // Monta A = 500 e B = 200 em contas novas.
  const a = ok(P.O, 'criar_conta', `${q(A)}, ${j({ nome: 'Conta A', tipo: 'banco', saldo_inicial_centavos: 50000 })}, ${q(k())}`).id;
  const b = ok(P.O, 'criar_conta', `${q(A)}, ${j({ nome: 'Conta B', tipo: 'outro', saldo_inicial_centavos: 20000 })}, ${q(k())}`).id;
  const resultadoAntes = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).resultado;
  const consolidadoAntes = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`).consolidado_centavos;
  falha(rpc(P.F, 'transferir', `${q(A)}, ${j({ conta_origem_id: a, conta_destino_id: a, valor_centavos: 100 })}, ${q(k())}`), 'contas diferentes');
  const outra = ok(P.X, 'criar_conta', `${q(B)}, ${j({ nome: 'Caixa B', tipo: 'banco', saldo_inicial_centavos: 1000 })}, ${q(k())}`).id;
  falha(rpc(P.F, 'transferir', `${q(A)}, ${j({ conta_origem_id: a, conta_destino_id: outra, valor_centavos: 100 })}, ${q(k())}`), 'conta desta empresa');
  falha(rpc(P.X, 'transferir', `${q(B)}, ${j({ conta_origem_id: outra, conta_destino_id: a, valor_centavos: 100 })}, ${q(k())}`), 'conta desta empresa');
  falha(rpc(P.F, 'transferir', `${q(A)}, ${j({ conta_origem_id: b, conta_destino_id: a, valor_centavos: 20001 })}, ${q(k())}`), 'INSUFFICIENT_FUNDS');
  falha(rpc(P.L, 'transferir', `${q(A)}, ${j({ conta_origem_id: a, conta_destino_id: b, valor_centavos: 12500 })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const t = ok(P.F, 'transferir', `${q(A)}, ${j({ conta_origem_id: a, conta_destino_id: b, valor_centavos: 12500, descricao: 'Reforço de caixa' })}, ${q(k())}`);
  assert.equal(t.saldo_origem_centavos, 37500);
  assert.equal(t.saldo_destino_centavos, 32500);
  assert.equal(adm(`SELECT string_agg(tipo || ':' || natureza, ',' ORDER BY sentido) FROM public.lancamentos_financeiros WHERE origem_tipo = 'transferencia' AND origem_id = ${q(t.id)}`),
    'transferencia_entrada:interna,transferencia_saida:interna');
  const depois = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`);
  assert.equal(depois.consolidado_centavos, consolidadoAntes);
  assert.deepEqual(depois.resultado, resultadoAntes);
  assert.equal(depois.fluxo.transferido_entre_contas_centavos >= 12500, true);
  falha(rpc(P.L, 'estornar_transferencia', `${q(t.id)}, 'Transferência feita por engano', ${q(k())}`), 'FORBIDDEN_ACTION');
  const e = ok(P.F, 'estornar_transferencia', `${q(t.id)}, 'Transferência feita por engano', ${q(k())}`);
  assert.equal(e.estorno_de, t.id);
  assert.equal(saldoConta(a), 50000);
  assert.equal(saldoConta(b), 20000);
  falha(rpc(P.F, 'estornar_transferencia', `${q(t.id)}, 'Transferência feita por engano', ${q(k())}`), 'já foi estornada');
  falha(rpc(P.F, 'estornar_transferencia', `${q(e.id)}, 'Estornar o estorno não vale', ${q(k())}`), 'já é um estorno');
  const lanc = adm(`SELECT id FROM public.lancamentos_financeiros WHERE origem_tipo = 'transferencia' AND origem_id = ${q(t.id)} LIMIT 1`);
  falha(rpc(P.F, 'estornar_lancamento', `${q(lanc)}, 'Pela via errada de novo', ${q(k())}`), 'estorne a transferência');
  M.contaA = a;
  M.contaB = b;
  reconciliacaoOk(A);
  reconciliacaoOk(B);
});

test('aporte e retirada (D7-05, D7-06): só o proprietário; aparecem no fluxo e nunca no resultado', opcoes, () => {
  const ant = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`);
  falha(rpc(P.G, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'retirada', conta_id: M.caixa, valor_centavos: 1000 })}, ${q(k())}`), 'Só o proprietário');
  falha(rpc(P.F, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'aporte', conta_id: M.caixa, valor_centavos: 1000 })}, ${q(k())}`), 'Só o proprietário');
  falha(rpc(P.X, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'aporte', conta_id: M.caixa, valor_centavos: 1000 })}, ${q(k())}`), 'TENANT_FORBIDDEN');
  falha(rpc(P.O, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'emprestimo', conta_id: M.caixa, valor_centavos: 1000 })}, ${q(k())}`), 'retirada ou aporte');
  const ap = ok(P.O, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'aporte', conta_id: M.caixa, valor_centavos: 30000, descricao: 'Dinheiro pessoal para capital de giro' })}, ${q(k())}`);
  assert.equal(ap.natureza, 'proprietario');
  assert.equal(ap.categoria_id, null);
  const re = ok(P.O, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'retirada', conta_id: M.caixa, valor_centavos: 10000 })}, ${q(k())}`);
  assert.equal(re.descricao, 'Retirada do proprietário');
  falha(rpc(P.O, 'registrar_movimento_proprietario', `${q(A)}, ${j({ tipo: 'retirada', conta_id: M.caixa, valor_centavos: saldoConta(M.caixa) + 1 })}, ${q(k())}`), 'INSUFFICIENT_FUNDS');
  const dep = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`);
  assert.deepEqual(dep.resultado, ant.resultado);
  assert.equal(dep.fluxo.aportes_centavos - ant.fluxo.aportes_centavos, 30000);
  assert.equal(dep.fluxo.retiradas_centavos - ant.fluxo.retiradas_centavos, 10000);
  assert.equal(dep.fluxo.variacao_operacional_centavos, ant.fluxo.variacao_operacional_centavos);
  falha(rpc(P.F, 'estornar_lancamento', `${q(re.id)}, 'Retirada registrada por engano', ${q(k())}`), 'Só o proprietário');
  ok(P.O, 'estornar_lancamento', `${q(re.id)}, 'Retirada registrada por engano', ${q(k())}`);
  const est = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mesAtual)}, ${q(hoje)}`);
  assert.deepEqual(est.resultado, ant.resultado);
  assert.equal(est.fluxo.retiradas_centavos - dep.fluxo.retiradas_centavos, -10000);
  reconciliacaoOk(A);
});

test('recorrências (D7-08, D7-09): mensal e anual, último dia do mês, geração idempotente, pausa e previstos', opcoes, () => {
  assert.equal(adm("SELECT app_private.vencimento_no_mes('2027-02-01', 31)::text"), '2027-02-28');
  assert.equal(adm("SELECT app_private.vencimento_no_mes('2028-02-01', 30)::text"), '2028-02-29');
  assert.equal(adm("SELECT app_private.vencimento_no_mes('2027-04-01', 31)::text"), '2027-04-30');
  falha(rpc(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Internet', valor_centavos: 9900, categoria_id: M.cat['Energia, água e internet'], periodicidade: 'semanal', dia_vencimento: 10 })}, ${q(k())}`), 'mensal ou anual');
  falha(rpc(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Internet', valor_centavos: 9900, categoria_id: M.cat['Vendas'], periodicidade: 'mensal', dia_vencimento: 10 })}, ${q(k())}`), 'categoria de despesa');
  falha(rpc(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Internet', valor_centavos: 9900, categoria_id: M.cat['Energia, água e internet'], periodicidade: 'mensal', dia_vencimento: 32 })}, ${q(k())}`), '1 a 31');
  falha(rpc(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Internet', valor_centavos: 9900, categoria_id: M.cat['Energia, água e internet'], periodicidade: 'mensal', dia_vencimento: 10, inicio: '2020-01-01' })}, ${q(k())}`), '12 meses atrás');
  const r = ok(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Internet da loja', valor_centavos: 9900, categoria_id: M.cat['Energia, água e internet'],
    periodicidade: 'mensal', dia_vencimento: 31, inicio: mes2 })}, ${q(k())}`);
  assert.equal(r.previstos.length, 3);
  const anual = ok(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Licença anual', valor_centavos: 50000, categoria_id: M.cat['Impostos e taxas'],
    periodicidade: 'anual', dia_vencimento: 15, inicio: mes1 })}, ${q(k())}`);
  const g1 = ok(P.L, 'gerar_recorrencias', q(A));
  assert.equal(g1.gerados, 4);   // internet: mês retrasado, passado e atual; licença: mês passado
  assert.match(g1.aviso, /não há processamento automático contínuo/);
  assert.equal(ok(P.L, 'gerar_recorrencias', q(A)).gerados, 0);
  const venc = adm(`SELECT string_agg(pa.vencimento::text, ',' ORDER BY t.competencia) FROM public.titulos_financeiros t
    JOIN public.parcelas_financeiras pa ON pa.titulo_id = t.id WHERE t.origem_id = ${q(r.id)}`).split(',');
  assert.deepEqual(venc, [fimMes(mes2), fimMes(mes1), fimMes(mesAtual)]);
  falha(rpc(P.F, 'alterar_recorrencia', `${q(r.id)}, ${j({ periodicidade: 'anual' })}, ${r.versao}, ${q(k())}`), 'não mudam');
  const alt = ok(P.F, 'alterar_recorrencia', `${q(r.id)}, ${j({ valor_centavos: 11900 })}, ${r.versao}, ${q(k())}`);
  assert.equal(alt.previstos[0].valor_centavos, 11900);
  assert.equal(Number(adm(`SELECT max(total) FROM public.titulos_financeiros WHERE origem_id = ${q(r.id)}`)), 99);   // gerados não mudam
  ok(P.F, 'definir_recorrencia_ativa', `${q(anual.id)}, false, ${anual.versao}, ${q(k())}`);
  assert.deepEqual(ok(P.L, 'recorrencias_da_empresa', q(A)).find((x) => x.id === anual.id).previstos, []);
  falha(rpc(P.F, 'definir_categoria_ativa', `${q(M.cat['Energia, água e internet'])}, false, ${versao('categorias_financeiras', M.cat['Energia, água e internet'])}, ${q(k())}`), 'recorrente ativa');
  falha(rpc(P.V, 'gerar_recorrencias', q(A)), 'FORBIDDEN_ACTION');
  M.recorrencia = r.id;
});

test('conta a pagar de compra (D7-07): opcional, uma por compra, soma igual ao custo, categoria Compras', opcoes, () => {
  const forn = ok(P.O, 'criar_fornecedor', `${q(A)}, ${j({ nome: 'Laticínios Fictícios' })}, ${q(k())}`).id;
  const compra = adm(`INSERT INTO public.compras_fornecedor (empresa_id, fornecedor_id, data_compra, numero_documento, estado, custo_total, autor)
    VALUES (${q(A)}, ${q(forn)}, ${q(dia(mes1, 8))}, 'NF-123', 'registrada', 600.00, ${q(P.O.id)}) RETURNING id`).split('\n')[0];
  const rascunho = adm(`INSERT INTO public.compras_fornecedor (empresa_id, data_compra, estado, custo_total, autor)
    VALUES (${q(A)}, ${q(hoje)}, 'rascunho', 50.00, ${q(P.O.id)}) RETURNING id`).split('\n')[0];
  const lista = ok(P.F, 'compras_para_conta_pagar', q(A));
  assert.deepEqual(lista.map((c) => c.id), [compra]);
  falha(rpc(P.L, 'compras_para_conta_pagar', q(A)), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'gerar_titulo_compra', `${q(rascunho)}, '{}'::jsonb, ${q(k())}`), 'registradas');
  falha(rpc(P.F, 'gerar_titulo_compra', `${q(compra)}, ${j({ parcelas: [{ valor_centavos: 30000, vencimento: dia(mesAtual, 20) }] })}, ${q(k())}`), 'igual ao custo');
  const t = ok(P.F, 'gerar_titulo_compra', `${q(compra)}, ${j({ parcelas: [{ valor_centavos: 30000, vencimento: dia(mesAtual, 20) }, { valor_centavos: 30000, vencimento: '2027-01-20' }] })}, ${q(k())}`);
  assert.equal(t.total_centavos, 60000);
  assert.equal(t.categoria, COMPRAS);
  assert.equal(t.contraparte, 'Laticínios Fictícios');
  assert.equal(t.competencia, dia(mes1, 8));
  falha(rpc(P.F, 'gerar_titulo_compra', `${q(compra)}, '{}'::jsonb, ${q(k())}`), 'já tem uma conta a pagar');
  assert.deepEqual(ok(P.F, 'compras_para_conta_pagar', q(A)), []);
  M.tituloCompra = t.id;
});

test('integração M06 (D7-16): recebimento com conta escolhida, estorno e devolução no livro-caixa; caixa sem dinheiro recusa', opcoes, () => {
  const v = JSON.parse(rpc(P.G, 'registrar_venda_direta', `${q(A)}, '{}'::jsonb, ${j([{ variacao_id: M.queijo, quantidade: 1 }])},
    ${j({ recebimento_inicial: { valor_centavos: 4000, forma: 'pix', conta_id: M.carteira } })}, NULL, ${q(k())}`).saida);
  const rec = adm(`SELECT id FROM public.recebimentos WHERE titulo_id = ${q(v.titulo_id)}`);
  assert.equal(adm(`SELECT conta_id FROM public.lancamentos_financeiros WHERE origem_tipo = 'recebimento' AND origem_id = ${q(rec)}`), M.carteira);
  falha(rpc(P.G, 'registrar_venda_direta', `${q(A)}, '{}'::jsonb, ${j([{ variacao_id: M.queijo, quantidade: 1 }])},
    ${j({ recebimento_inicial: { valor_centavos: 4000, forma: 'pix', conta_id: 'nao-e-uuid' } })}, NULL, ${q(k())}`), 'Identificador inválido');
  // Caixa do balcão registra recebimento de venda na conta padrão; data dentro de mês aberto.
  const v2 = JSON.parse(rpc(P.G, 'registrar_venda_direta', `${q(A)}, '{}'::jsonb, ${j([{ variacao_id: M.doce, quantidade: 2 }])}, '{}'::jsonb, NULL, ${q(k())}`).saida);
  const parcela = adm(`SELECT id FROM public.parcelas_financeiras WHERE titulo_id = ${q(v2.titulo_id)}`);
  const r = ok(P.C, 'registrar_recebimento', `${q(parcela)}, 2000, 'dinheiro', NULL, ${q(k())}`);
  assert.equal(r.conta_id, M.caixa);
  const est = ok(P.F, 'estornar_recebimento', `${q(r.recebimento_id)}, 'Nota de dinheiro falsa recusada', ${q(k())}`);
  assert.equal(adm(`SELECT tipo || '/' || sentido || '/' || (estorno_de IS NOT NULL) FROM public.lancamentos_financeiros WHERE origem_tipo = 'recebimento' AND origem_id = ${q(est.id)}`),
    'estorno/saida/true');
  // Venda cancelada: devolução pela conta escolhida; caixa sem saldo suficiente recusa (D7-03).
  const ver = versao('vendas', v.id);
  ok(P.G, 'cancelar_venda', `${q(v.id)}, 'Produto com defeito de fábrica', ${j({ [M.queijo]: 'danificado' })}, ${ver}, ${q(k())}`);
  const caixaAgora = saldoConta(M.caixa);
  if (caixaAgora < 4000) {
    falha(rpc(P.G, 'registrar_devolucao_valor', `${q(v.titulo_id)}, 4000, 'dinheiro', 'Devolução', ${q(k())}`), 'INSUFFICIENT_FUNDS');
  }
  const dv = ok(P.G, 'registrar_devolucao_valor', `${q(v.titulo_id)}, 4000, 'pix', 'Devolução pelo mesmo meio', ${q(k())}, ${q(M.carteira)}`);
  assert.equal(dv.a_devolver_centavos, 0);
  assert.equal(adm(`SELECT tipo || '/' || natureza FROM public.lancamentos_financeiros WHERE origem_tipo = 'recebimento'
    AND origem_id = (SELECT id FROM public.recebimentos WHERE titulo_id = ${q(v.titulo_id)} AND tipo = 'devolucao')`), 'devolucao_cliente/receita');
  // Quem só vê vendas não vê contas a pagar nem a receber manuais (RLS).
  assert.equal(como(P.V, "SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo <> 'venda'").saida, '0');
  assert.ok(Number(como(P.V, "SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo = 'venda'").saida) > 0);
  assert.equal(como(P.V, `SELECT count(*) FROM public.parcelas_financeiras WHERE titulo_id = ${q(M.aluguel.id)}`).saida, '0');
  assert.equal(como(P.V, `SELECT count(*) FROM public.recebimentos WHERE titulo_id = ${q(M.tituloReceber)}`).saida, '0');
  assert.equal(como(P.V, 'SELECT count(*) FROM public.lancamentos_financeiros').saida, '0');
  reconciliacaoOk(A);
});

test('indicadores (D7-14, D7-15): fluxo e resultado com método, aviso de estimativa e cobertura de custo parcial', opcoes, () => {
  const p = ok(P.O, 'painel_financeiro', `${q(A)}, ${q(mes3)}, ${q(hoje)}`);
  assert.match(p.fluxo.metodo, /Regime de caixa/);
  assert.match(p.resultado.metodo, /Competência simplificada/);
  assert.match(p.resultado.aviso, /Não é contabilidade oficial/);
  assert.match(p.aviso_registro, /Nenhum dinheiro é movimentado/);
  assert.equal(p.resultado.disponivel, true);
  // Doce caseiro não tem custo: a cobertura fica abaixo de 100% e o resultado é parcial.
  assert.equal(p.resultado.parcial, true);
  assert.ok(p.resultado.cobertura_custo_percentual > 0 && p.resultado.cobertura_custo_percentual < 100);
  // Saldo final do fluxo = consolidado (todo lançamento tem data até hoje).
  assert.equal(p.fluxo.saldo_final_centavos, p.consolidado_centavos);
  assert.equal(p.consolidado_centavos, Number(adm(`SELECT (sum(saldo) * 100)::bigint FROM public.contas_financeiras WHERE empresa_id = ${q(A)}`)));
  // Compras de mercadorias não viram despesa (viram custo na venda).
  assert.equal(p.resultado.compras_mercadorias_centavos, 60000);
  const g = ok(P.G, 'painel_financeiro', `${q(A)}, ${q(mes3)}, ${q(hoje)}`);
  assert.equal(g.resultado.disponivel, false);
  assert.equal('custo_mercadorias_vendidas_centavos' in g.resultado, false);
  assert.equal(g.ve_custo, false);
  assert.ok(p.a_pagar.aberto_centavos >= 120000);
  assert.ok(p.a_pagar.vencido_centavos > 0);   // recorrências de meses passados
  falha(rpc(P.O, 'painel_financeiro', `${q(A)}, ${q(hoje)}, ${q(mes3)}`), 'antes do fim');
  falha(rpc(P.V, 'painel_financeiro', `${q(A)}, NULL, NULL`), 'FORBIDDEN_ACTION');
  falha(rpc(P.X, 'painel_financeiro', `${q(A)}, NULL, NULL`), 'TENANT_FORBIDDEN');
});

test('relatórios e exportação (D7-01): na tela com método; CSV exige financeiro.exportar e é auditado', opcoes, () => {
  for (const tipo of ['categorias', 'contas', 'vencimentos', 'mensal']) {
    const r = ok(P.L, 'relatorio_financeiro', `${q(A)}, ${q(tipo)}, ${q(mes3)}, ${q(hoje)}`);
    assert.ok(r.metodo.length > 10, tipo);
    assert.ok(Array.isArray(r.linhas), tipo);
  }
  const venc = ok(P.L, 'relatorio_financeiro', `${q(A)}, 'vencimentos', NULL, NULL`);
  assert.equal(venc.linhas.length, 8);
  const cats = ok(P.L, 'relatorio_financeiro', `${q(A)}, 'categorias', ${q(mes3)}, ${q(hoje)}`).linhas;
  assert.ok(cats.some((c) => c.categoria === 'Transferências entre contas' && c.liquido_centavos === 0));
  falha(rpc(P.L, 'relatorio_financeiro', `${q(A)}, 'dre_oficial', NULL, NULL`), 'desconhecido');
  falha(rpc(P.L, 'exportar_financeiro', `${q(A)}, 'lancamentos', NULL, NULL`), 'FORBIDDEN_ACTION');
  const antes = Number(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'financeiro.exportacao'"));
  const e = ok(P.F, 'exportar_financeiro', `${q(A)}, 'lancamentos', ${q(mes3)}, ${q(hoje)}`);
  assert.equal(e.colunas.length, 11);
  assert.ok(e.linhas.length > 10);
  assert.equal(e.valores_em_centavos, true);
  for (const tipo of ['titulos', 'categorias', 'contas']) assert.ok(ok(P.F, 'exportar_financeiro', `${q(A)}, ${q(tipo)}, ${q(mes3)}, ${q(hoje)}`).colunas.length > 3);
  assert.equal(Number(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'financeiro.exportacao'")), antes + 4);
  const hist = ok(P.L, 'lancamentos_da_empresa', `${q(A)}, ${j({ texto: 'frete' })}, 50, 0`);
  assert.equal(hist.total, 1);
  assert.equal(hist.itens[0].autor, 'Financeiro Flora');
  assert.equal(ok(P.L, 'lancamentos_da_empresa', `${q(A)}, ${j({ natureza: 'proprietario' })}, 50, 0`).total, 3);
  falha(rpc(P.L, 'lancamentos_da_empresa', `${q(A)}, ${j({ cpf: '1' })}, 50, 0`), 'não permitido');
  const abertos = ok(P.L, 'titulos_da_empresa', `${q(A)}, ${j({ tipo: 'pagar', situacao: 'vencidos' })}, 50, 0`);
  assert.ok(abertos.itens.every((t) => t.estado_exibicao === 'vencido'));
});

test('fechamento (D7-11 a D7-13): em ordem, conferência de caixa, mês fechado congelado, correção no mês aberto', opcoes, () => {
  const s = ok(P.L, 'situacao_fechamento', q(A));
  // O primeiro registro financeiro (carga do M06) é deste mês ou anterior; o fluxo de teste começa no mês retrasado.
  assert.equal(s.proximo_mes <= mes2, true);
  // Fecha em ordem até chegar ao mês retrasado (meses vazios também são fechados).
  falha(rpc(P.L, 'fechar_periodo', `${q(A)}, ${q(s.proximo_mes)}, '[]'::jsonb, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'fechar_periodo', `${q(A)}, ${q(s.proximo_mes)}, '[]'::jsonb, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'fechar_periodo', `${q(A)}, ${q(mesAtual)}, '[]'::jsonb, ${q(k())}`), 'em ordem|depois que ele termina');
  let atual = s.proximo_mes;
  while (atual < mes2) {
    ok(P.F, 'fechar_periodo', `${q(A)}, ${q(atual)}, '[]'::jsonb, ${q(k())}`);
    atual = ok(P.L, 'situacao_fechamento', q(A)).proximo_mes;
  }
  assert.equal(atual, mes2);
  falha(rpc(P.F, 'fechar_periodo', `${q(A)}, ${q(mes1)}, '[]'::jsonb, ${q(k())}`), `próximo a fechar é ${mes2.slice(5, 7)}/${mes2.slice(0, 4)}`);
  // Conferência do caixa: diferença só pelo proprietário e com motivo.
  const s2 = ok(P.L, 'situacao_fechamento', q(A));
  const esperado = s2.caixas.find((c) => c.conta_id === M.caixa).esperado_centavos;
  falha(rpc(P.F, 'fechar_periodo', `${q(A)}, ${q(mes2)}, ${j([{ conta_id: M.caixa, contado_centavos: esperado + 300 }])}, ${q(k())}`), 'Só o proprietário');
  falha(rpc(P.O, 'fechar_periodo', `${q(A)}, ${q(mes2)}, ${j([{ conta_id: M.caixa, contado_centavos: esperado + 300 }])}, ${q(k())}`), 'Explique a diferença');
  falha(rpc(P.O, 'fechar_periodo', `${q(A)}, ${q(mes2)}, ${j([{ conta_id: M.banco, contado_centavos: 1 }])}, ${q(k())}`), 'não é caixa físico');
  const f = ok(P.O, 'fechar_periodo', `${q(A)}, ${q(mes2)}, ${j([{ conta_id: M.caixa, contado_centavos: esperado + 300, motivo: 'Sobra de troco encontrada na gaveta' }])}, ${q(k())}`);
  assert.equal(f.conferencias[0].diferenca_centavos, 300);
  assert.equal(adm(`SELECT tipo || '/' || data FROM public.lancamentos_financeiros WHERE origem_tipo = 'fechamento' AND origem_id = ${q(f.id)}`), `ajuste_conferencia/${fimMes(mes2)}`);
  assert.equal(f.saldos.find((x) => x.conta_id === M.caixa).saldo_centavos, esperado + 300);
  // Mês fechado congelado (D7-13): lançamento, recebimento, pagamento, transferência, título e saldo inicial com data nele.
  const dentro = dia(mes2, 20);
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.banco, valor_centavos: 100, categoria_id: M.cat['Transporte'], descricao: 'Esquecido', data: dentro })}, ${q(k())}`), 'PERIOD_LOCKED');
  falha(rpc(P.F, 'transferir', `${q(A)}, ${j({ conta_origem_id: M.banco, conta_destino_id: M.caixa, valor_centavos: 100, data: dentro })}, ${q(k())}`), 'PERIOD_LOCKED');
  falha(rpc(P.F, 'registrar_pagamento', `${q(M.aluguel.parcelas[0].id)}, 100, ${q(M.banco)}, 'pix', ${q(dentro)}, ${q(k())}`), 'PERIOD_LOCKED');
  falha(rpc(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Conta antiga', categoria_id: M.cat['Aluguel'], competencia: dentro, valor_centavos: 100, vencimento: hoje })}, ${q(k())}`), 'PERIOD_LOCKED');
  falha(rpc(P.F, 'criar_conta', `${q(A)}, ${j({ nome: 'Retroativa', tipo: 'banco', saldo_inicial_centavos: 100, data_saldo_inicial: dentro })}, ${q(k())}`), 'PERIOD_LOCKED');
  const vPend = JSON.parse(rpc(P.G, 'registrar_venda_direta', `${q(A)}, '{}'::jsonb, ${j([{ variacao_id: M.doce, quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`).saida);
  const parc = adm(`SELECT id FROM public.parcelas_financeiras WHERE titulo_id = ${q(vPend.titulo_id)}`);
  falha(rpc(P.G, 'registrar_recebimento', `${q(parc)}, 500, 'dinheiro', ${q(dentro)}, ${q(k())}`), 'PERIOD_LOCKED');
  // Correção de algo do mês fechado entra hoje, no mês aberto (estorno), e o fechamento não muda.
  const est = ok(P.F, 'estornar_lancamento', `${q(M.despesaAvulsa)}, 'Frete foi pago pelo cliente, não pela loja', ${q(k())}`);
  assert.equal(est.data, hoje);
  assert.equal(adm(`SELECT count(*) FROM public.lancamentos_financeiros WHERE empresa_id = ${q(A)} AND data <= ${q(fimMes(mes2))}
    AND origem_tipo <> 'fechamento' AND criado_em > (SELECT fechado_em FROM public.fechamentos_financeiros WHERE id = ${q(f.id)})`), '0');
  // Recorrência de mês fechado não é gerada (o título dela já existia antes de fechar).
  assert.equal(ok(P.L, 'gerar_recorrencias', q(A)).gerados, 0);
  // Fechamento não se altera nem se apaga.
  falha(sql(banco.url, `UPDATE public.fechamentos_financeiros SET saldos = '[]' WHERE id = ${q(f.id)}`), 'só reaberto');
  falha(sql(banco.url, `DELETE FROM public.fechamentos_financeiros WHERE id = ${q(f.id)}`), 'só reaberto');
  // Reabertura (D7-12): só o proprietário, só o último, com justificativa; o fechamento anterior fica no histórico.
  falha(rpc(P.F, 'reabrir_periodo', `${q(A)}, 'Preciso lançar uma nota esquecida', ${q(k())}`), 'Só o proprietário');
  falha(rpc(P.O, 'reabrir_periodo', `${q(A)}, 'curto', ${q(k())}`), '10 a 300');
  const ra = ok(P.O, 'reabrir_periodo', `${q(A)}, 'Preciso lançar uma nota esquecida', ${q(k())}`);
  assert.equal(ra.mes, mes2);
  ok(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.banco, valor_centavos: 100, categoria_id: M.cat['Transporte'], descricao: 'Nota esquecida', data: dentro })}, ${q(k())}`);
  const f2 = ok(P.F, 'fechar_periodo', `${q(A)}, ${q(mes2)}, '[]'::jsonb, ${q(k())}`);
  assert.notEqual(f2.id, f.id);
  const lista = ok(P.L, 'situacao_fechamento', q(A)).fechamentos.filter((x) => x.mes === mes2);
  assert.deepEqual(lista.map((x) => x.estado), ['fechado', 'reaberto']);
  assert.equal(lista[1].motivo_reabertura, 'Preciso lançar uma nota esquecida');
  // Quem não vê custo não recebe o custo dentro do resumo guardado.
  const semCusto = ok(P.L, 'situacao_fechamento', q(A)).fechamentos[0].resumo.resultado;
  assert.equal('custo_mercadorias_vendidas_centavos' in semCusto, false);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'financeiro.periodo_reaberto'"), '1');
  reconciliacaoOk(A);
});

test('concorrência real: baixas na mesma parcela, saídas do caixa, transferências opostas, fechamento × lançamento, recorrências', opcoes, async () => {
  // 1. Duas baixas simultâneas de R$ 70 numa parcela de R$ 100: só uma passa (FIN-I03).
  const t = ok(P.F, 'criar_titulo', `${q(A)}, ${j({ tipo: 'pagar', descricao: 'Disputa', categoria_id: M.cat['Outras despesas'], valor_centavos: 10000, vencimento: hoje })}, ${q(k())}`);
  const pid = t.parcelas[0].id;
  const pg = (ch) => `SELECT public.registrar_pagamento(${q(pid)}, 7000, ${q(M.banco)}, 'pix', NULL, ${q(ch)})`;
  const [a1, a2] = await Promise.all([sessao(P.F, pg(k()), 0.8), sessao(P.G, pg(k()), 0, 0.2)]);
  assert.equal([a1, a2].filter((r) => r.ok).length, 1, `${a1.erro} | ${a2.erro}`);
  assert.match([a1, a2].find((r) => !r.ok).erro, /PAYMENT_EXCEEDS_BALANCE/);
  assert.equal(adm(`SELECT saldo FROM public.parcelas_financeiras WHERE id = ${q(pid)}`), '30.00');
  // 2. Duas saídas simultâneas que juntas passam do saldo do caixa: o caixa nunca fica negativo (D7-03).
  const caixa = saldoConta(M.caixa);
  const metade = Math.floor(caixa / 2) + 100;
  const saida = (ch) => `SELECT public.registrar_lancamento(${q(A)}, ${j({ tipo: 'despesa_avulsa', conta_id: M.caixa, valor_centavos: metade, categoria_id: M.cat['Outras despesas'], descricao: 'Disputa de caixa' })}, ${q(ch)})`;
  const [b1, b2] = await Promise.all([sessao(P.F, saida(k()), 0.8), sessao(P.G, saida(k()), 0, 0.2)]);
  assert.equal([b1, b2].filter((r) => r.ok).length, 1, `${b1.erro} | ${b2.erro}`);
  assert.match([b1, b2].find((r) => !r.ok).erro, /INSUFFICIENT_FUNDS/);
  assert.equal(saldoConta(M.caixa), caixa - metade);
  // 3. Transferências opostas ao mesmo tempo: nenhum impasse, nenhum centavo perdido.
  const total = saldoConta(M.contaA) + saldoConta(M.contaB);
  const tr = (o, d, ch) => `SELECT public.transferir(${q(A)}, ${j({ conta_origem_id: o, conta_destino_id: d, valor_centavos: 1000 })}, ${q(ch)})`;
  const rodada = await Promise.all(Array.from({ length: 6 }, (_, i) => sessao(i % 2 ? P.F : P.G,
    i % 2 ? tr(M.contaA, M.contaB, k()) : tr(M.contaB, M.contaA, k()), 0.3, i * 0.05)));
  assert.equal(rodada.filter((r) => r.ok).length, 6, rodada.map((r) => r.erro).join(' | '));
  assert.equal(saldoConta(M.contaA) + saldoConta(M.contaB), total);
  // 4. Fechamento × lançamento: o fechamento espera o lançamento em andamento e o inclui; depois, o mês está congelado.
  const prox = ok(P.L, 'situacao_fechamento', q(A)).proximo_mes;
  assert.equal(prox, mes1);
  const lanc = `SELECT public.registrar_lancamento(${q(A)}, ${j({ tipo: 'receita_avulsa', conta_id: M.banco, valor_centavos: 777, categoria_id: M.cat['Outras receitas'], descricao: 'Chegou durante o fechamento', data: dia(mes1, 25) })}, ${q(k())})`;
  const fech = `SELECT public.fechar_periodo(${q(A)}, ${q(mes1)}, '[]'::jsonb, ${q(k())})`;
  const [c1, c2] = await Promise.all([sessao(P.F, lanc, 1.2), sessao(P.O, fech, 0, 0.3)]);
  assert.ok(c1.ok && c2.ok, `${c1.erro} | ${c2.erro}`);
  const banco1 = JSON.parse(adm(`SELECT saldos::text FROM public.fechamentos_financeiros WHERE empresa_id = ${q(A)} AND mes = ${q(mes1)} AND estado = 'fechado'`))
    .find((x) => x.conta_id === M.banco).saldo_centavos;
  assert.equal(banco1, Number(adm(`SELECT (app_private.saldo_em(${q(M.banco)}, ${q(fimMes(mes1))}) * 100)::bigint`)));
  assert.equal(adm(`SELECT count(*) FROM public.lancamentos_financeiros WHERE descricao = 'Chegou durante o fechamento'`), '1');
  falha(rpc(P.F, 'registrar_lancamento', `${q(A)}, ${j({ tipo: 'receita_avulsa', conta_id: M.banco, valor_centavos: 1, categoria_id: M.cat['Outras receitas'], descricao: 'Tarde demais', data: dia(mes1, 26) })}, ${q(k())}`), 'PERIOD_LOCKED');
  // Lançamento que chega DEPOIS de o fechamento começar é recusado, não perdido.
  ok(P.O, 'reabrir_periodo', `${q(A)}, 'Teste de disputa no fechamento', ${q(k())}`);
  const [d1, d2] = await Promise.all([sessao(P.O, fech.replace(/fin-teste-\d+/, k()), 1.0), sessao(P.F, lanc.replace(/fin-teste-\d+/, k()), 0, 0.3)]);
  assert.ok(d1.ok, d1.erro);
  assert.equal(d2.ok, false);
  assert.match(d2.erro, /PERIOD_LOCKED/);
  // 5. Geração simultânea de recorrências: nunca duplica.
  const nova = ok(P.F, 'criar_recorrencia', `${q(A)}, ${j({ descricao: 'Limpeza', valor_centavos: 15000, categoria_id: M.cat['Outras despesas'], periodicidade: 'mensal', dia_vencimento: 5, inicio: mesAtual })}, ${q(k())}`);
  const gerar = `SELECT public.gerar_recorrencias(${q(A)})`;
  const ger = await Promise.all([sessao(P.F, gerar, 0.5), sessao(P.L, gerar, 0, 0.1), sessao(P.G, gerar, 0, 0.2)]);
  assert.ok(ger.every((r) => r.ok), ger.map((r) => r.erro).join(' | '));
  assert.equal(adm(`SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo = 'recorrencia' AND origem_id = ${q(nova.id)}`), '1');
  reconciliacaoOk(A);
});

test('isolamento, revogação com a mesma identidade, identidade vazia (D-07) e histórico imutável', opcoes, () => {
  for (const tabela of ['lancamentos_financeiros', 'pagamentos', 'transferencias_financeiras', 'despesas_recorrentes', 'fechamentos_financeiros',
    'categorias_financeiras', 'titulos_financeiros', 'contas_financeiras']) {
    assert.equal(como(P.X, `SELECT count(*) FROM public.${tabela} WHERE empresa_id = ${q(A)}`).saida, '0', tabela);
  }
  falha(rpc(P.X, 'lancamentos_da_empresa', `${q(A)}, '{}'::jsonb, 50, 0`), 'TENANT_FORBIDDEN');
  falha(rpc(P.X, 'titulo_detalhe', q(M.aluguel.id)), 'TENANT_FORBIDDEN');
  falha(rpc(P.X, 'registrar_pagamento', `${q(M.aluguel.parcelas[0].id)}, 100, ${q(M.banco)}, 'pix', NULL, ${q(k())}`), 'TENANT_FORBIDDEN');
  // Revogação vale na chamada seguinte com a mesma identidade.
  assert.ok(ok(P.L, 'painel_financeiro', `${q(A)}, NULL, NULL`).contas.length > 0);
  ok(P.O, 'alterar_perfil_permissao', `${q(M.perfis.leitura.id)}, 'Leitura', NULL, ARRAY['vendas.visualizar']::text[], ${versao('perfis_permissao', M.perfis.leitura.id)}, ${q(k())}`);
  falha(rpc(P.L, 'painel_financeiro', `${q(A)}, NULL, NULL`), 'FORBIDDEN_ACTION');
  assert.equal(como(P.L, 'SELECT count(*) FROM public.lancamentos_financeiros').saida, '0');
  // Identidade vazia: AUTH_REQUIRED em todas as leituras e escritas novas, nunca lista vazia silenciosa.
  const vazio = (c) => comoPapel(banco.url, { sub: null }, c);
  for (const chamada of [`painel_financeiro(${q(A)}, NULL, NULL)`, `contas_da_empresa(${q(A)})`, `lancamentos_da_empresa(${q(A)}, '{}'::jsonb, 50, 0)`,
    `titulos_da_empresa(${q(A)}, '{}'::jsonb, 50, 0)`, `situacao_fechamento(${q(A)})`, `recorrencias_da_empresa(${q(A)})`,
    `categorias_financeiras_da_empresa(${q(A)})`, `relatorio_financeiro(${q(A)}, 'contas', NULL, NULL)`, `gerar_recorrencias(${q(A)})`,
    `transferir(${q(A)}, '{}'::jsonb, ${q(k())})`]) {
    falha(vazio(`SELECT public.${chamada}`), 'AUTH_REQUIRED|Sessão ausente');
  }
  // Histórico só de inclusão, mesmo para o dono do banco.
  for (const tabela of ['lancamentos_financeiros', 'pagamentos', 'transferencias_financeiras']) {
    falha(sql(banco.url, `UPDATE public.${tabela} SET criado_em = now() WHERE empresa_id = ${q(A)}`), 'não pode ser alterado');
    falha(sql(banco.url, `DELETE FROM public.${tabela} WHERE empresa_id = ${q(A)}`), 'não pode ser alterado');
  }
  falha(como(P.O, `INSERT INTO public.lancamentos_financeiros (empresa_id, conta_id, data, sentido, valor, tipo, natureza, origem_tipo, autor)
    VALUES (${q(A)}, ${q(M.caixa)}, now()::date, 'entrada', 1, 'receita_avulsa', 'receita', 'manual', 'eu')`), 'permission denied');
  // Restrições do banco: natureza coerente com o tipo, mesmo em gravação direta privilegiada.
  falha(sql(banco.url, `INSERT INTO public.lancamentos_financeiros (empresa_id, conta_id, data, sentido, valor, tipo, natureza, categoria_id, origem_tipo, autor)
    VALUES (${q(A)}, ${q(M.caixa)}, now()::date, 'entrada', 1, 'transferencia_entrada', 'receita', ${q(M.cat.Vendas)}, 'manual', 'eu')`), 'lancamentos_tipo_coerente');
  falha(sql(banco.url, `INSERT INTO public.lancamentos_financeiros (empresa_id, conta_id, data, sentido, valor, tipo, natureza, origem_tipo, autor)
    VALUES (${q(A)}, ${q(M.caixa)}, now()::date, 'saida', 1, 'retirada', 'proprietario', 'recebimento', 'eu')`), 'lancamentos_origem_coerente');
  falha(sql(banco.url, `UPDATE public.contas_financeiras SET saldo = -1 WHERE id = ${q(M.caixa)}`), 'contas_saldo_permitido');
});

test('privilégios: nada privado executável pela Data API; funções públicas do M07 com search_path vazio e SECURITY DEFINER', opcoes, () => {
  assert.equal(adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`), '0');
  assert.equal(adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'EXECUTE')
      AND p.proname IN ('painel_financeiro', 'transferir', 'fechar_periodo', 'registrar_pagamento')`), '0');
  const novas = ['criar_conta', 'transferir', 'registrar_pagamento', 'fechar_periodo', 'reabrir_periodo', 'painel_financeiro', 'exportar_financeiro',
    'registrar_movimento_proprietario', 'gerar_recorrencias', 'registrar_recebimento', 'registrar_devolucao_valor'];
  const r = adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN (${novas.map(q).join(',')}) AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']`);
  assert.equal(r, String(novas.length));
  for (const t of ['lancamentos_financeiros', 'pagamentos', 'transferencias_financeiras', 'despesas_recorrentes', 'fechamentos_financeiros', 'categorias_financeiras']) {
    assert.equal(adm(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass`), 't', t);
    assert.equal(adm(`SELECT has_table_privilege('authenticated', 'public.${t}', 'INSERT') OR has_table_privilege('authenticated', 'public.${t}', 'UPDATE')`), 'f', t);
  }
  assert.equal(adm("SELECT has_column_privilege('authenticated', 'public.lancamentos_financeiros', 'autor', 'SELECT')"), 'f');
  assert.equal(adm("SELECT has_column_privilege('authenticated', 'public.fechamentos_financeiros', 'resumo', 'SELECT')"), 'f');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120001'"), '1');
});
