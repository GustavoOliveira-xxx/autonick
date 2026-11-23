/**
 * Testes de banco do M06 (migration 202611020002): clientes da empresa, vendas de balcão (rascunho, confirmação,
 * venda direta), preço do catálogo (D6-05), limite de desconto (D6-04), pausa (D6-07), sob encomenda com entrega
 * pendente (D6-08), parcelas e recebimentos (D6-03, D6-13, D6-14, D6-17), cancelamento com destino por item (D6-09),
 * pedidos externos com reserva no aceite (D6-01, D6-06, D6-11), numeração (D6-15), concorrência real, isolamento,
 * identidade vazia (D-07) e histórico imutável. PostgreSQL LOCAL com emulação do Neon (MINI-ESPEC_M06 §10.2, FIN-001 §6).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`)
  .concat(['202611020001_categorias_produto', '202611020002_clientes_vendas'])
  // Regressão do M06 com o M07 aplicado por cima (como no Neon de desenvolvimento): AUTONICK_COM_M07=1.
  .concat(process.env.AUTONICK_COM_M07 ? ['202611120001_financeiro', '202611120002_correcao_financeiro'] : []);

const ID = (n) => `e6000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m06@teste.example', nome: 'Dona Odete' },
  G: { id: ID(2), email: 'gerente-m06@teste.example', nome: 'Gerente Guto' },
  V: { id: ID(3), email: 'vendedor-m06@teste.example', nome: 'Vendedor Vava' },
  C: { id: ID(4), email: 'caixa-m06@teste.example', nome: 'Caixa Cida' },
  F: { id: ID(5), email: 'financeiro-m06@teste.example', nome: 'Financeiro Fábio' },
  X: { id: ID(6), email: 'outra-m06@teste.example', nome: 'Xuxa Outra' },
  K1: { id: ID(7), email: 'cliente1@autonick-teste.example', nome: 'Cliente Kátia' },
  K2: { id: ID(8), email: 'cliente2@autonick-teste.example', nome: 'Cliente Kleber' },
  R: { id: ID(9), email: 'pessoa-real@teste.example', nome: 'Pessoa Real' },
  S: { id: ID(10), email: 'sem-perfil@autonick-teste.example', nome: 'Sem Perfil' },
  K3: { id: ID(11), email: 'cliente3@autonick-teste.example', nome: 'Cliente Kelly' },
  K4: { id: ID(12), email: 'cliente4@autonick-teste.example', nome: 'Cliente Kauã' },
};

let chave = 0;
const k = () => `vendas-teste-${String(++chave).padStart(4, '0')}`;
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
const saldo = (v) => adm(`SELECT fisico || '/' || reservado || '/' || disponivel FROM public.saldos_estoque WHERE variacao_id = ${q(v)}`);
const versaoVenda = (id) => Number(adm(`SELECT versao FROM public.vendas WHERE id = ${q(id)}`));
const versaoPedido = (id) => Number(adm(`SELECT versao FROM public.pedidos WHERE id = ${q(id)}`));
const item = (v, quantidade, desconto) => (desconto ? { variacao_id: v, quantidade, desconto_centavos: desconto } : { variacao_id: v, quantidade });
function produto(nome, preco, quantidade, extra = {}) {
  const r = ok(P.O, 'criar_produto', `${q(A)}, ${j({ nome, finalidade: 'comercializavel', preco_centavos: preco, ...(quantidade ? { quantidade_inicial: quantidade, custo_centavos: Math.round(preco / 2) } : {}), ...extra })}, NULL, ${q(k())}`);
  return { id: r.id, v: r.variacoes[0].id };
}
const entrada = (v, quantidade) => ok(P.O, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: v, quantidade }])}, NULL, ${q(k())}`);
const direta = (p, itens, pagamento = {}, dados = {}, total = null) => rpc(p, 'registrar_venda_direta',
  `${q(A)}, ${j(dados)}, ${j(itens)}, ${j(pagamento)}, ${total === null ? 'NULL' : total}, ${q(k())}`);
const parcelasDe = (venda) => JSON.parse(adm(`SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'saldo', pa.saldo, 'estado', pa.estado) ORDER BY pa.sequencia)::text
  FROM public.parcelas_financeiras pa JOIN public.titulos_financeiros t ON t.id = pa.titulo_id WHERE t.origem_id = ${q(venda)}`));
const tituloDe = (venda) => JSON.parse(adm(`SELECT row_to_json(t)::text FROM public.titulos_financeiros t WHERE origem_id = ${q(venda)}`));

/** Sessão real (conexão própria) com a identidade da pessoa e espera antes do COMMIT, para provocar disputa. */
const sessao = (p, comando, espera = 0) => new Promise((resolver) => {
  const bloco = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${p.id}","role":"authenticated"}', true) \\gset
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
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

let A; let B;
const perfis = {};
const prod = {};

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  for (const p of Object.values(P)) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
  }
  for (const p of [P.O, P.X]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`);
  for (const p of [P.K1, P.K2, P.K3, P.K4, P.R]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('cliente', ${q(p.nome)})`);
  const cat = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'").saida;
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'comercio', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'privado@teste.example' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('[TESTE] Doceria A')}'::jsonb, 'vendas-setup-01')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('[TESTE] Loja B')}'::jsonb, 'vendas-setup-02')::text`).saida).id;
  // A empresa A está publicada e é dado de teste (só contas fictícias pedem); B continua em rascunho.
  sql(banco.url, `UPDATE public.empresas SET situacao_vitrine = 'publicada', dado_de_teste = true WHERE id = '${A}'`);
  const perfil = (nome, perms) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.criar_perfil_permissao(${q(A)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())})::text`).saida);
  perfis.gerente = perfil('Gerente', ['clientes.visualizar', 'clientes.criar', 'clientes.alterar', 'produtos.visualizar', 'estoque.visualizar',
    'pedidos.visualizar', 'pedidos.aprovar', 'pedidos.cancelar', 'vendas.visualizar', 'vendas.criar', 'vendas.aprovar', 'vendas.cancelar',
    'vendas.aplicar_desconto', 'vendas.registrar_recebimento']);
  perfis.vendas = perfil('Vendas', ['clientes.visualizar', 'clientes.criar', 'vendas.visualizar', 'vendas.criar', 'vendas.aplicar_desconto']);
  perfis.caixa = perfil('Caixa', ['vendas.visualizar', 'vendas.registrar_recebimento']);
  perfis.financeiro = perfil('Financeiro', ['financeiro.visualizar', 'financeiro.cancelar']);
  for (const [p, perfilId] of [[P.G, perfis.gerente.id], [P.V, perfis.vendas.id], [P.C, perfis.caixa.id], [P.F, perfis.financeiro.id]]) {
    const c = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.convidar_funcionario(${q(A)}, ${q(p.email)}, ${q(perfilId)}, ${q(k())})::text`).saida);
    comoPapel(banco.url, { sub: p.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`);
  }
});
after(() => banco?.encerrar());

test('catálogo ganha vendas.registrar_recebimento (51); limite de desconto por perfil só pelo proprietário (D6-04, D6-17)', opcoes, () => {
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '51');
  assert.equal(adm("SELECT sensivel FROM public.permissoes_catalogo WHERE codigo = 'vendas.registrar_recebimento'"), 't');
  const vv = () => Number(adm(`SELECT versao FROM public.perfis_permissao WHERE id = ${q(perfis.vendas.id)}`));
  falha(rpc(P.G, 'definir_desconto_maximo', `${q(perfis.vendas.id)}, 10, ${vv()}, ${q(k())}`), 'Só o proprietário');
  falha(rpc(P.O, 'definir_desconto_maximo', `${q(perfis.vendas.id)}, 120, ${vv()}, ${q(k())}`), 'de 0 a 100');
  falha(rpc(P.X, 'definir_desconto_maximo', `${q(perfis.vendas.id)}, 10, ${vv()}, ${q(k())}`), 'TENANT_FORBIDDEN');
  const r = ok(P.O, 'definir_desconto_maximo', `${q(perfis.vendas.id)}, 10, ${vv()}, ${q(k())}`);
  assert.equal(Number(r.desconto_maximo_percentual), 10);
  ok(P.O, 'definir_desconto_maximo', `${q(perfis.gerente.id)}, 20, 1, ${q(k())}`);
  assert.equal(obj(P.V, `public.meu_limite_desconto(${q(A)})`).percentual, 10);
  assert.equal(obj(P.O, `public.meu_limite_desconto(${q(A)})`).sem_limite, true);
  assert.equal(obj(P.C, `public.meu_limite_desconto(${q(A)})`).percentual, 0);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'perfil.limite_desconto'"), '2');
});

function obj(p, expr) {
  const r = como(p, `SELECT (${expr})::text`);
  assert.ok(r.ok, r.erro);
  return JSON.parse(r.saida);
}

test('clientes da empresa: nome obrigatório, contatos opcionais, sem CPF, versão e desativação (D6-10, RF-033 a RF-038)', opcoes, () => {
  falha(rpc(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'A' })}, ${q(k())}`), '2 a 120');
  falha(rpc(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana', cpf: '12345678901' })}, ${q(k())}`), 'não permitido: cpf');
  falha(rpc(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana', telefone: '123' })}, ${q(k())}`), 'DDD');
  falha(rpc(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana', email: 'sem-arroba' })}, ${q(k())}`), 'e-mail válido');
  falha(rpc(P.C, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana' })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.X, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana' })}, ${q(k())}`), 'TENANT_FORBIDDEN');
  const ch = k();
  const ana = ok(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana Souza', telefone: '(19) 99999-0000', email: 'ANA@Teste.example' })}, ${q(ch)}`);
  assert.equal(ok(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Ana Souza', telefone: '(19) 99999-0000', email: 'ANA@Teste.example' })}, ${q(ch)}`).id, ana.id);
  assert.equal(adm(`SELECT telefone || ' ' || email FROM public.clientes_empresa WHERE id = ${q(ana.id)}`), '19999990000 ana@teste.example');
  prod.ana = ana.id;
  falha(rpc(P.V, 'alterar_cliente', `${q(ana.id)}, ${j({ nome: 'Ana S.' })}, 1, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'alterar_cliente', `${q(ana.id)}, ${j({ nome: 'Ana S.' })}, 9, ${q(k())}`), 'VERSION_CONFLICT');
  assert.equal(ok(P.G, 'alterar_cliente', `${q(ana.id)}, ${j({ observacoes: 'Prefere retirar à tarde' })}, 1, ${q(k())}`).versao, 2);
  const semContato = ok(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Bruno' })}, ${q(k())}`);
  ok(P.G, 'definir_cliente_ativo', `${q(semContato.id)}, false, 1, ${q(k())}`);
  falha(rpc(P.G, 'definir_cliente_ativo', `${q(semContato.id)}, false, 2, ${q(k())}`), 'já está desativado');
  const lista = obj(P.V, `public.clientes_da_empresa(${q(A)}, 'ana', 50, 0)`);
  assert.deepEqual(lista.map((c) => c.nome), ['Ana Souza']);
  assert.equal(lista[0].conta_vinculada, false);
  falha(rpc(P.C, 'clientes_da_empresa', `${q(A)}, NULL, 50, 0`), 'FORBIDDEN_ACTION');
  falha(como(P.V, `DELETE FROM public.clientes_empresa WHERE id = ${q(ana.id)}`), 'permission denied');
  assert.equal(como(P.X, 'SELECT count(*) FROM public.clientes_empresa').saida, '0');
  falha(como(P.V, 'SELECT perfil_cliente_id FROM public.clientes_empresa'), 'permission denied');
});

test('balcão: rascunho não mexe no estoque; preço vem do catálogo; confirmação numera, baixa e cria o a receber (D6-02, D6-05, D6-06)', opcoes, () => {
  prod.brigadeiro = produto('Brigadeiro', 350, 10);
  prod.bolo = produto('Bolo de pote', 3500, 5);
  prod.caixa = produto('Caixa presente', 2000, 3);
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([{ variacao_id: prod.bolo.v, quantidade: 1, preco_centavos: 1 }])}, ${q(k())}`), 'preço vem do catálogo');
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({ total_centavos: 1 })}, ${j([item(prod.bolo.v, 1)])}, ${q(k())}`), 'não permitido: total_centavos');
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.bolo.v, 1), item(prod.bolo.v, 2)])}, ${q(k())}`), 'duas vezes');
  falha(rpc(P.C, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.bolo.v, 1)])}, ${q(k())}`), 'FORBIDDEN_ACTION');
  // Exemplo 1 do FIN-001: 2 × R$ 35 + R$ 20 − R$ 10 de desconto = R$ 80.
  const ch = k();
  const r = ok(P.G, 'criar_venda', `${q(A)}, ${j({ cliente_empresa_id: prod.ana, desconto_geral_centavos: 1000 })}, ${j([item(prod.bolo.v, 2), item(prod.caixa.v, 1)])}, ${q(ch)}`);
  assert.equal(r.estado, 'rascunho');
  assert.equal(r.numero, null);
  assert.equal(r.subtotal_centavos, 9000);
  assert.equal(r.total_centavos, 8000);
  assert.equal(ok(P.G, 'criar_venda', `${q(A)}, ${j({ cliente_empresa_id: prod.ana, desconto_geral_centavos: 1000 })}, ${j([item(prod.bolo.v, 2), item(prod.caixa.v, 1)])}, ${q(ch)}`).id, r.id);
  // O mesmo desconto (11%) passa do limite de 10% do vendedor.
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({ desconto_geral_centavos: 1000 })}, ${j([item(prod.bolo.v, 2), item(prod.caixa.v, 1)])}, ${q(k())}`), 'DISCOUNT_EXCEEDS_LIMIT');
  assert.equal(saldo(prod.bolo.v), '5/0/5');
  assert.equal(adm("SELECT count(*) FROM public.reservas_estoque WHERE origem_tipo = 'venda'"), '0');
  falha(rpc(P.V, 'confirmar_venda', `${q(r.id)}, ${j({})}, 8000, ${versaoVenda(r.id)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 8000, 1, ${q(k())}`), 'VERSION_CONFLICT');
  falha(rpc(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 7999, ${versaoVenda(r.id)}, ${q(k())}`), 'total mudou');
  const c = ok(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 8000, ${versaoVenda(r.id)}, ${q(k())}`);
  assert.equal(c.numero, 1);
  assert.equal(c.entrega, 'entregue');
  assert.equal(saldo(prod.bolo.v), '3/0/3');
  assert.equal(saldo(prod.caixa.v), '2/0/2');
  assert.equal(adm(`SELECT count(*) FROM public.movimentacoes_estoque WHERE origem_tipo = 'venda' AND origem_id = ${q(r.id)}`), '2');
  const t = tituloDe(r.id);
  assert.equal(Number(t.total), 80);
  assert.equal(t.estado, 'aberto');
  assert.equal(parcelasDe(r.id).length, 1);
  prod.venda1 = r.id;
  falha(rpc(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 8000, ${versaoVenda(r.id)}, ${q(k())}`), 'já foi confirmada');
  falha(rpc(P.G, 'alterar_venda', `${q(r.id)}, ${j({})}, ${j([item(prod.bolo.v, 1)])}, ${versaoVenda(r.id)}, ${q(k())}`), 'Só rascunhos');
  // Custo do momento guardado, mas só para quem vê custo.
  assert.equal(adm(`SELECT custo_unitario FROM public.venda_itens WHERE venda_id = ${q(r.id)} AND variacao_id = ${q(prod.bolo.v)}`), '17.50');
  falha(como(P.G, 'SELECT custo_unitario FROM public.venda_itens'), 'permission denied');
  assert.equal(obj(P.G, `public.venda_detalhe(${q(r.id)})`).itens.every((i) => i.custo_centavos === null), true);
  assert.equal(obj(P.O, `public.venda_detalhe(${q(r.id)})`).itens.find((i) => i.produto === 'Bolo de pote').custo_centavos, 1750);
});

test('preço mudou entre o rascunho e a confirmação: o total esperado barra e o novo preço vale (D6-05)', opcoes, () => {
  const r = ok(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.brigadeiro.v, 2)])}, ${q(k())}`);
  assert.equal(r.total_centavos, 700);
  const vv = Number(adm(`SELECT versao FROM public.produto_variacoes WHERE id = ${q(prod.brigadeiro.v)}`));
  ok(P.O, 'alterar_preco', `${q(prod.brigadeiro.v)}, 400, 'Reajuste do chocolate', ${vv}, ${q(k())}`);
  falha(rpc(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 700, ${versaoVenda(r.id)}, ${q(k())}`), 'R\\$ 8,00|R\\$ 8.00');
  assert.equal(adm(`SELECT preco_unitario FROM public.venda_itens WHERE venda_id = ${q(r.id)}`), '3.50');   // a tentativa foi desfeita
  const c = ok(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 800, ${versaoVenda(r.id)}, ${q(k())}`);
  assert.equal(c.total_centavos, 800);
  assert.equal(c.numero, 2);
  // Histórico preservado: a venda 1 continua com o preço antigo.
  assert.equal(adm(`SELECT total FROM public.vendas WHERE id = ${q(prod.venda1)}`), '80.00');
});

test('desconto: sem permissão é recusado; acima do limite do perfil é recusado; o proprietário não tem limite (D6-04, FIN-I14)', opcoes, () => {
  falha(rpc(P.G, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.brigadeiro.v, 1, 5000)])}, ${q(k())}`), 'maior que o valor do item');
  // Vendedor com 10%: R$ 40 × 10% = R$ 4; R$ 6 de desconto passa do limite.
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({ desconto_geral_centavos: 600 })}, ${j([item(prod.brigadeiro.v, 10)])}, ${q(k())}`), 'DISCOUNT_EXCEEDS_LIMIT');
  const dentro = ok(P.V, 'criar_venda', `${q(A)}, ${j({ desconto_geral_centavos: 100 })}, ${j([item(prod.brigadeiro.v, 5, 100)])}, ${q(k())}`);
  assert.equal(dentro.total_centavos, 1800);   // exatamente 10%
  // Quem não tem aplicar_desconto não dá desconto, nem por item.
  const vp = Number(adm(`SELECT versao FROM public.perfis_permissao WHERE id = ${q(perfis.vendas.id)}`));
  ok(P.O, 'alterar_perfil_permissao', `${q(perfis.vendas.id)}, 'Vendas', NULL, ARRAY['clientes.visualizar','clientes.criar','vendas.visualizar','vendas.criar']::text[], ${vp}, ${q(k())}`);
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.brigadeiro.v, 1, 10)])}, ${q(k())}`), 'não permite dar desconto');
  // O rascunho com desconto que o vendedor já tinha: quem confirma também precisa caber no limite.
  ok(P.O, 'alterar_perfil_permissao', `${q(perfis.vendas.id)}, 'Vendas', NULL, ARRAY['clientes.visualizar','clientes.criar','vendas.visualizar','vendas.criar','vendas.aplicar_desconto']::text[], ${vp + 1}, ${q(k())}`);
  const grande = ok(P.O, 'criar_venda', `${q(A)}, ${j({ desconto_geral_centavos: 1000 })}, ${j([item(prod.brigadeiro.v, 5)])}, ${q(k())}`);
  falha(rpc(P.G, 'confirmar_venda', `${q(grande.id)}, ${j({})}, 1000, ${versaoVenda(grande.id)}, ${q(k())}`), 'DISCOUNT_EXCEEDS_LIMIT');
  assert.equal(ok(P.O, 'confirmar_venda', `${q(grande.id)}, ${j({})}, 1000, ${versaoVenda(grande.id)}, ${q(k())}`).estado, 'confirmada');
  ok(P.V, 'descartar_venda', `${q(dentro.id)}, ${versaoVenda(dentro.id)}, ${q(k())}`);
  assert.equal(adm(`SELECT count(*) FROM public.vendas WHERE id = ${q(dentro.id)}`), '0');
  assert.equal(adm("SELECT count(*) FROM public.eventos_comerciais WHERE tipo = 'venda_rascunho_descartado'"), '1');
});

test('produto pausado, desativado ou de uso interno não entra em venda; pausa depois do rascunho barra a confirmação (D6-07)', opcoes, () => {
  const insumo = ok(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Leite condensado (insumo)', finalidade: 'uso_interno', preco_centavos: 100, quantidade_inicial: 9 })}, NULL, ${q(k())}`);
  prod.insumo = insumo.variacoes[0].id;
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.insumo, 1)])}, ${q(k())}`), 'uso interno');
  prod.trufa = produto('Trufa', 500, 4);
  const r = ok(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.trufa.v, 1)])}, ${q(k())}`);
  const vp = Number(adm(`SELECT versao FROM public.produtos WHERE id = ${q(prod.trufa.id)}`));
  ok(P.O, 'pausar_venda_produto', `${q(prod.trufa.id)}, true, 'Receita em revisão', ${vp}, ${q(k())}`);
  falha(rpc(P.V, 'criar_venda', `${q(A)}, ${j({})}, ${j([item(prod.trufa.v, 1)])}, ${q(k())}`), 'PRODUCT_PAUSED');
  falha(rpc(P.G, 'confirmar_venda', `${q(r.id)}, ${j({})}, 500, ${versaoVenda(r.id)}, ${q(k())}`), 'PRODUCT_PAUSED');
  assert.equal(saldo(prod.trufa.v), '4/0/4');
  const cat = obj(P.V, `public.catalogo_para_venda(${q(A)}, 'trufa')`);
  assert.equal(cat[0].venda_pausada, true);
  assert.equal(cat[0].disponivel, null);   // vendedor sem estoque.visualizar não vê a quantidade
  assert.equal(obj(P.G, `public.catalogo_para_venda(${q(A)}, 'trufa')`)[0].disponivel, 4);
  assert.equal(obj(P.V, `public.catalogo_para_venda(${q(A)}, 'leite')`).length, 0);
  ok(P.O, 'pausar_venda_produto', `${q(prod.trufa.id)}, false, NULL, ${vp + 1}, ${q(k())}`);
  ok(P.V, 'descartar_venda', `${q(r.id)}, ${versaoVenda(r.id)}, ${q(k())}`);
  // Estoque insuficiente em produto comum: recusa com o disponível, nada aplicado.
  falha(direta(P.G, [item(prod.trufa.v, 5)]), 'INSUFFICIENT_STOCK');
  assert.equal(saldo(prod.trufa.v), '4/0/4');
});

test('sob encomenda: venda contratada pendente, reserva só o que existe, entrega só com unidades reais (D6-08)', opcoes, () => {
  prod.torta = produto('Torta inteira', 9000, 1, { sob_encomenda: true });
  const sem = produto('Torta comum', 9000, 1);
  falha(direta(P.G, [item(sem.v, 3)]), 'INSUFFICIENT_STOCK');
  const c = JSON.parse(direta(P.G, [item(prod.torta.v, 3)], { condicao: 'a_vista' }, {}, 27000).saida);
  assert.equal(c.entrega, 'pendente');
  assert.equal(c.reserva.reservas[0].reservado, 1);
  assert.equal(c.reserva.reservas[0].a_encomendar, 2);
  assert.equal(saldo(prod.torta.v), '1/1/0');   // nenhuma unidade inexistente baixada
  assert.equal(adm(`SELECT count(*) FROM public.movimentacoes_estoque WHERE origem_tipo = 'venda' AND origem_id = ${q(c.id)}`), '0');
  assert.equal(Number(tituloDe(c.id).total), 270);   // a venda contratada existe e tem a receber
  const detalhe = obj(P.G, `public.venda_detalhe(${q(c.id)})`);
  assert.equal(detalhe.itens[0].entrega, 'pendente');
  assert.equal(detalhe.itens[0].reservado, 1);
  // A unidade reservada não vai para outro cliente: uma nova encomenda fica pendente sem reserva.
  const outra = JSON.parse(direta(P.G, [item(prod.torta.v, 1)], {}, {}, 9000).saida);
  assert.equal(outra.entrega, 'pendente');
  assert.equal(outra.reserva.reservas[0].reservado, 0);
  assert.equal(saldo(prod.torta.v), '1/1/0');
  ok(P.G, 'cancelar_venda', `${q(outra.id)}, 'Encomenda duplicada por engano', ${j({})}, ${versaoVenda(outra.id)}, ${q(k())}`);
  assert.equal(saldo(prod.torta.v), '1/1/0');
  // Produto comum sem estoque: a unidade reservada para a encomenda continua protegida.
  falha(direta(P.G, [item(sem.v, 2)]), 'INSUFFICIENT_STOCK');
  // Entrega sem unidades suficientes é recusada (sem entrega fictícia).
  falha(rpc(P.G, 'registrar_entrega', `${q(c.id)}, ${versaoVenda(c.id)}, ${q(k())}`), 'INSUFFICIENT_STOCK');
  assert.equal(saldo(prod.torta.v), '1/1/0');
  falha(rpc(P.V, 'registrar_entrega', `${q(c.id)}, ${versaoVenda(c.id)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  // Produção é uma entrada normal do M05; depois a entrega baixa as 3 unidades de uma vez.
  entrada(prod.torta.v, 2);
  assert.equal(saldo(prod.torta.v), '3/1/2');
  const e = ok(P.G, 'registrar_entrega', `${q(c.id)}, ${versaoVenda(c.id)}, ${q(k())}`);
  assert.equal(e.entrega, 'entregue');
  assert.equal(saldo(prod.torta.v), '0/0/0');
  assert.equal(adm(`SELECT estado FROM public.reservas_estoque WHERE origem_tipo = 'venda' AND origem_id = ${q(c.id)}`), 'consumida');
  falha(rpc(P.G, 'registrar_entrega', `${q(c.id)}, ${versaoVenda(c.id)}, ${q(k())}`), 'não tem entrega pendente');
  prod.vendaTorta = c.id;
});

test('parcelas: soma igual ao total, de 2 a 24, vencimentos de hoje em diante e em ordem, sem juros (D6-13)', opcoes, () => {
  const hoje = adm("SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date");
  const mais = (d) => adm(`SELECT ('${hoje}'::date + ${d})::text`);
  const it = [item(prod.brigadeiro.v, 3)];   // 3 × R$ 4 = R$ 12
  falha(direta(P.G, it, { condicao: 'parcelado', parcelas: [{ valor_centavos: 1200, vencimento: mais(30) }] }), '2 a 24');
  falha(direta(P.G, it, { condicao: 'parcelado', parcelas: [{ valor_centavos: 600, vencimento: mais(30) }, { valor_centavos: 500, vencimento: mais(60) }] }), 'soma das parcelas');
  falha(direta(P.G, it, { condicao: 'parcelado', parcelas: [{ valor_centavos: 600, vencimento: mais(-1) }, { valor_centavos: 600, vencimento: mais(30) }] }), 'de hoje em diante');
  falha(direta(P.G, it, { condicao: 'parcelado', parcelas: [{ valor_centavos: 600, vencimento: mais(60) }, { valor_centavos: 600, vencimento: mais(30) }] }), 'em ordem');
  falha(direta(P.G, it, { condicao: 'fiado' }), 'Condição de pagamento');
  const antes = saldo(prod.brigadeiro.v);
  assert.equal(antes.split('/')[0], adm(`SELECT fisico FROM public.saldos_estoque WHERE variacao_id = ${q(prod.brigadeiro.v)}`));
  const c = JSON.parse(direta(P.G, it, { condicao: 'parcelado', parcelas: [{ valor_centavos: 400, vencimento: hoje }, { valor_centavos: 400, vencimento: mais(30) }, { valor_centavos: 400, vencimento: mais(60) }] }).saida);
  assert.equal(parcelasDe(c.id).length, 3);
  assert.equal(adm(`SELECT condicao FROM public.vendas WHERE id = ${q(c.id)}`), 'parcelado');
  prod.vendaParcelada = c.id;
});

test('recebimentos: parcial, acima do saldo recusado, repetição sem duplicar, permissões e estorno só no financeiro (D6-03, D6-14, D6-17)', opcoes, () => {
  const pa = parcelasDe(prod.venda1)[0].id;   // venda 1: R$ 80
  falha(rpc(P.V, 'registrar_recebimento', `${q(pa)}, 3000, 'pix', NULL, ${q(k())}`), 'não permite registrar recebimentos');
  falha(rpc(P.C, 'registrar_recebimento', `${q(pa)}, 3000, 'cheque', NULL, ${q(k())}`), 'forma de pagamento');
  falha(rpc(P.C, 'registrar_recebimento', `${q(pa)}, 3000, 'pix', '2999-01-01', ${q(k())}`), 'futuro');
  const ch = k();
  const r1 = ok(P.C, 'registrar_recebimento', `${q(pa)}, 3000, 'pix', NULL, ${q(ch)}`);
  assert.equal(r1.saldo_parcela_centavos, 5000);
  assert.equal(ok(P.C, 'registrar_recebimento', `${q(pa)}, 3000, 'pix', NULL, ${q(ch)}`).recebimento_id, r1.recebimento_id);
  assert.equal(adm(`SELECT count(*) FROM public.recebimentos WHERE parcela_id = ${q(pa)}`), '1');
  falha(rpc(P.C, 'registrar_recebimento', `${q(pa)}, 6000, 'dinheiro', NULL, ${q(k())}`), 'PAYMENT_EXCEEDS_BALANCE');
  assert.equal(tituloDe(prod.venda1).estado, 'parcial');
  assert.equal(adm(`SELECT c.nome FROM public.recebimentos r JOIN public.contas_financeiras c ON c.id = r.conta_id WHERE r.id = ${q(r1.recebimento_id)}`), 'Caixa da empresa');
  // Estorno: só financeiro.cancelar, com motivo, uma vez; devolve o saldo.
  falha(rpc(P.C, 'estornar_recebimento', `${q(r1.recebimento_id)}, 'Pix devolvido pelo banco', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'estornar_recebimento', `${q(r1.recebimento_id)}, 'curto', ${q(k())}`), '10 a 300');
  const est = ok(P.F, 'estornar_recebimento', `${q(r1.recebimento_id)}, 'Pix devolvido pelo banco', ${q(k())}`);
  falha(rpc(P.F, 'estornar_recebimento', `${q(r1.recebimento_id)}, 'Pix devolvido pelo banco', ${q(k())}`), 'já foi estornado');
  falha(rpc(P.F, 'estornar_recebimento', `${q(est.id)}, 'Estorno do estorno não existe', ${q(k())}`), 'Só recebimentos');
  assert.equal(Number(tituloDe(prod.venda1).recebido), 0);
  assert.equal(tituloDe(prod.venda1).estado, 'aberto');
  // Recebe tudo: liquida parcela e título.
  ok(P.C, 'registrar_recebimento', `${q(pa)}, 8000, 'dinheiro', NULL, ${q(k())}`);
  assert.equal(tituloDe(prod.venda1).estado, 'liquidado');
  assert.equal(parcelasDe(prod.venda1)[0].estado, 'liquidada');
  // Recebimento na confirmação, com permissão; sem ela, recusado e nada fica.
  entrada(prod.brigadeiro.v, 20);   // os 10 iniciais já foram vendidos
  falha(direta(P.V, [item(prod.brigadeiro.v, 1)], { recebimento_inicial: { valor_centavos: 400, forma: 'pix' } }), 'FORBIDDEN_ACTION');
  const c = JSON.parse(direta(P.G, [item(prod.brigadeiro.v, 1)], { recebimento_inicial: { valor_centavos: 400, forma: 'pix' } }).saida);
  assert.equal(c.recebimento.saldo_titulo_centavos, 0);
  // Recebimento é registro, não cobrança: nada recebido sem registro (pedido/venda nunca vira pago sozinho).
  assert.equal(tituloDe(prod.vendaParcelada).estado, 'aberto');
  // Movimentações financeiras não são alteradas nem apagadas.
  falha(como(P.O, `UPDATE public.recebimentos SET valor = 1 WHERE id = ${q(r1.recebimento_id)}`), 'permission denied');
  falha(sql(banco.url, `UPDATE public.recebimentos SET valor = 1 WHERE id = ${q(r1.recebimento_id)}`), 'histórico|não pode');
  falha(sql(banco.url, `DELETE FROM public.parcelas_financeiras WHERE id = ${q(pa)}`), 'histórico|não pode');
});

test('cancelamento total: destino por item, reserva liberada, valores a devolver e devolução registrada (D6-09)', opcoes, () => {
  // Venda com 2 itens entregues e recebimento parcial.
  const c = JSON.parse(direta(P.G, [item(prod.bolo.v, 2), item(prod.caixa.v, 1)], { recebimento_inicial: { valor_centavos: 5000, forma: 'dinheiro' } }).saida);
  assert.equal(saldo(prod.bolo.v), '1/0/1');
  assert.equal(saldo(prod.caixa.v), '1/0/1');
  falha(rpc(P.V, 'cancelar_venda', `${q(c.id)}, 'Cliente desistiu da compra', ${j({})}, ${versaoVenda(c.id)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'cancelar_venda', `${q(c.id)}, 'curto', ${j({})}, ${versaoVenda(c.id)}, ${q(k())}`), '10 a 300');
  falha(rpc(P.G, 'cancelar_venda', `${q(c.id)}, 'Cliente desistiu da compra', ${j({ [prod.bolo.v]: 'voltou' })}, ${versaoVenda(c.id)}, ${q(k())}`), 'voltou, não voltou');
  const r = ok(P.G, 'cancelar_venda', `${q(c.id)}, 'Cliente desistiu da compra', ${j({ [prod.bolo.v]: 'voltou', [prod.caixa.v]: 'danificado' })}, ${versaoVenda(c.id)}, ${q(k())}`);
  assert.equal(r.estado, 'cancelada');
  assert.equal(r.a_devolver_centavos, 5000);
  assert.equal(saldo(prod.bolo.v), '3/0/3');   // voltou
  assert.equal(saldo(prod.caixa.v), '1/0/1');  // danificado não volta como vendável
  assert.equal(adm(`SELECT count(*) FROM public.movimentacoes_estoque WHERE origem_tipo = 'devolucao_venda' AND origem_id = ${q(c.id)}`), '1');
  assert.equal(tituloDe(c.id).estado, 'cancelado');
  assert.equal(parcelasDe(c.id).every((p) => p.estado === 'cancelada'), true);
  falha(rpc(P.G, 'cancelar_venda', `${q(c.id)}, 'Cliente desistiu da compra', ${j({})}, ${versaoVenda(c.id)}, ${q(k())}`), 'já foi cancelada');
  falha(rpc(P.C, 'registrar_recebimento', `${q(parcelasDe(c.id)[0].id)}, 100, 'pix', NULL, ${q(k())}`), 'cancelada');
  const t = tituloDe(c.id).id;
  falha(rpc(P.C, 'registrar_devolucao_valor', `${q(t)}, 6000, 'dinheiro', 'Devolução no balcão', ${q(k())}`), 'PAYMENT_EXCEEDS_BALANCE');
  falha(rpc(P.V, 'registrar_devolucao_valor', `${q(t)}, 5000, 'dinheiro', 'Devolução no balcão', ${q(k())}`), 'não permite');
  const d = ok(P.C, 'registrar_devolucao_valor', `${q(t)}, 5000, 'dinheiro', 'Devolução no balcão', ${q(k())}`);
  assert.equal(d.a_devolver_centavos, 0);
  falha(rpc(P.C, 'registrar_devolucao_valor', `${q(t)}, 1, 'dinheiro', 'Devolução no balcão', ${q(k())}`), 'PAYMENT_EXCEEDS_BALANCE');
  falha(rpc(P.F, 'estornar_recebimento', `${q(adm(`SELECT id FROM public.recebimentos WHERE titulo_id = ${q(t)} AND tipo = 'recebimento'`))}, 'Tentativa depois do cancelamento', ${q(k())}`), 'devolução do valor');
  // Sob encomenda pendente cancelada: a reserva volta; nada entra no estoque porque nada saiu.
  entrada(prod.torta.v, 1);
  const p = JSON.parse(direta(P.G, [item(prod.torta.v, 2)], {}, {}, 18000).saida);
  assert.equal(saldo(prod.torta.v), '1/1/0');
  ok(P.G, 'cancelar_venda', `${q(p.id)}, 'Cliente cancelou a encomenda', ${j({})}, ${versaoVenda(p.id)}, ${q(k())}`);
  assert.equal(saldo(prod.torta.v), '1/0/1');
  assert.equal(adm(`SELECT destino_cancelamento FROM public.venda_itens WHERE venda_id = ${q(p.id)}`), 'nao_entregue');
  assert.equal(adm(`SELECT count(*) FROM public.movimentacoes_estoque WHERE origem_id = ${q(p.id)}`), '0');
  // Venda confirmada nunca é apagada.
  falha(sql(banco.url, `DELETE FROM public.vendas WHERE id = ${q(c.id)}`), 'não pode ser excluída');
  falha(sql(banco.url, `UPDATE public.venda_itens SET quantidade = 9 WHERE venda_id = ${q(c.id)}`), 'não podem ser alterados');
});

test('pedido externo: só conta fictícia em empresa de teste publicada; nada reservado antes do aceite (D6-01, D6-06)', opcoes, () => {
  prod.picole = produto('Picolé', 600, 2);
  falha(rpc(P.R, 'criar_pedido', `${q(A)}, ${j([item(prod.picole.v, 1)])}, NULL, ${q(k())}`), 'NOT_FOUND');   // conta real × empresa de teste
  falha(rpc(P.S, 'criar_pedido', `${q(A)}, ${j([item(prod.picole.v, 1)])}, NULL, ${q(k())}`), 'perfil de cliente');
  falha(rpc(P.K1, 'criar_pedido', `${q(B)}, ${j([item(prod.picole.v, 1)])}, NULL, ${q(k())}`), 'NOT_FOUND');   // B não publicada
  // Insumo interno: resposta genérica, sem revelar o nome (ADR-004).
  const insumo = rpc(P.K1, 'criar_pedido', `${q(A)}, ${j([item(prod.insumo, 1)])}, NULL, ${q(k())}`);
  falha(insumo, 'não está disponível');
  assert.doesNotMatch(insumo.erro, /Leite/);
  falha(rpc(P.K1, 'criar_pedido', `${q(A)}, ${j([item(prod.picole.v, 1, 100)])}, NULL, ${q(k())}`), 'não aceita desconto');
  assert.deepEqual(obj(P.K1, 'public.empresas_para_pedido()').map((e) => e.id), [A]);
  assert.deepEqual(obj(P.R, 'public.empresas_para_pedido()'), []);
  const itens = obj(P.K1, `public.itens_para_pedido(${q(A)})`);
  assert.equal(itens.some((i) => i.produto.startsWith('Leite')), false);
  assert.equal(itens.some((i) => 'disponivel' in i || 'custo_centavos' in i), false);
  const ch = k();
  const p1 = ok(P.K1, 'criar_pedido', `${q(A)}, ${j([item(prod.picole.v, 2)])}, 'Retiro sábado', ${q(ch)}`);
  assert.equal(ok(P.K1, 'criar_pedido', `${q(A)}, ${j([item(prod.picole.v, 2)])}, 'Retiro sábado', ${q(ch)}`).id, p1.id);
  assert.equal(p1.estado, 'solicitado');
  assert.equal(p1.total_centavos, 1200);
  assert.equal(saldo(prod.picole.v), '2/0/2');
  prod.p1 = p1.id;
  const p2 = ok(P.K2, 'criar_pedido', `${q(A)}, ${j([item(prod.picole.v, 1)])}, NULL, ${q(k())}`);
  prod.p2 = p2.id;
  // Cada cliente vê só o próprio pedido; a empresa vê a fila.
  assert.equal(obj(P.K1, 'public.meus_pedidos()').length, 1);
  assert.equal(como(P.K1, 'SELECT count(*) FROM public.pedidos').saida, '1');
  assert.equal(como(P.K2, `SELECT count(*) FROM public.pedido_itens WHERE pedido_id = ${q(p1.id)}`).saida, '0');
  falha(como(P.K1, 'SELECT cliente_auth_id FROM public.pedidos'), 'permission denied');
  const fila = obj(P.G, `public.pedidos_da_empresa(${q(A)}, 'solicitado', 50)`);
  assert.equal(fila.length, 2);
  assert.equal(fila.find((p) => p.id === p1.id).itens[0].suficiente, true);
  falha(rpc(P.V, 'pedidos_da_empresa', `${q(A)}, NULL, 50`), 'FORBIDDEN_ACTION');
});

test('aceite reserva tudo ou nada; vínculo do cliente pelo pedido; recusa e cancelamentos liberam uma vez (D6-06, D6-11)', opcoes, () => {
  falha(rpc(P.V, 'aceitar_pedido', `${q(prod.p1)}, ${versaoPedido(prod.p1)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const a = ok(P.G, 'aceitar_pedido', `${q(prod.p1)}, ${versaoPedido(prod.p1)}, ${q(k())}`);
  assert.equal(a.estado, 'aceito');
  assert.equal(saldo(prod.picole.v), '2/2/0');
  falha(rpc(P.G, 'aceitar_pedido', `${q(prod.p1)}, ${versaoPedido(prod.p1)}, ${q(k())}`), 'já foi respondido');
  // Última unidade já reservada: o segundo aceite é recusado e nada fica reservado.
  falha(rpc(P.G, 'aceitar_pedido', `${q(prod.p2)}, ${versaoPedido(prod.p2)}, ${q(k())}`), 'INSUFFICIENT_STOCK');
  assert.equal(saldo(prod.picole.v), '2/2/0');
  // D6-11: o cliente da empresa nasce do pedido aceito, ligado à conta; nunca por e-mail igual.
  const cli = adm(`SELECT cliente_empresa_id FROM public.pedidos WHERE id = ${q(prod.p1)}`);
  assert.equal(adm(`SELECT perfil_cliente_id FROM public.clientes_empresa WHERE id = ${q(cli)}`), P.K1.id);
  ok(P.V, 'criar_cliente', `${q(A)}, ${j({ nome: 'Kleber homônimo', email: P.K2.email })}, ${q(k())}`);
  assert.equal(adm(`SELECT count(*) FROM public.clientes_empresa WHERE email = ${q(P.K2.email)} AND perfil_cliente_id IS NOT NULL`), '0');
  // Recusa: motivo obrigatório e visível ao cliente; sem efeito no estoque.
  falha(rpc(P.G, 'recusar_pedido', `${q(prod.p2)}, 'não', ${versaoPedido(prod.p2)}, ${q(k())}`), '10 a 300');
  ok(P.G, 'recusar_pedido', `${q(prod.p2)}, 'Sem picolé de uva esta semana', ${versaoPedido(prod.p2)}, ${q(k())}`);
  assert.equal(obj(P.K2, 'public.meus_pedidos()')[0].motivo, 'Sem picolé de uva esta semana');
  // Cliente cancela antes do aceite; depois do aceite, só a empresa.
  const p3 = ok(P.K2, 'criar_pedido', `${q(A)}, ${j([item(prod.brigadeiro.v, 1)])}, NULL, ${q(k())}`);
  ok(P.K2, 'cancelar_pedido', `${q(p3.id)}, NULL, ${versaoPedido(p3.id)}, ${q(k())}`);
  falha(rpc(P.K1, 'cancelar_pedido', `${q(prod.p1)}, NULL, ${versaoPedido(prod.p1)}, ${q(k())}`), 'Fale com ela');
  falha(rpc(P.K2, 'cancelar_pedido', `${q(prod.p1)}, NULL, ${versaoPedido(prod.p1)}, ${q(k())}`), 'TENANT_FORBIDDEN');
  const p4 = ok(P.K2, 'criar_pedido', `${q(A)}, ${j([item(prod.bolo.v, 1)])}, NULL, ${q(k())}`);
  ok(P.G, 'aceitar_pedido', `${q(p4.id)}, ${versaoPedido(p4.id)}, ${q(k())}`);
  assert.equal(saldo(prod.bolo.v), '3/1/2');
  falha(rpc(P.V, 'cancelar_pedido', `${q(p4.id)}, 'Sem entregador hoje', ${versaoPedido(p4.id)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const cp = ok(P.G, 'cancelar_pedido', `${q(p4.id)}, 'Sem entregador hoje', ${versaoPedido(p4.id)}, ${q(k())}`);
  assert.equal(cp.reservas_liberadas, 1);
  assert.equal(saldo(prod.bolo.v), '3/0/3');
  falha(rpc(P.G, 'cancelar_pedido', `${q(p4.id)}, 'Sem entregador hoje', ${versaoPedido(p4.id)}, ${q(k())}`), 'não pode mais');
  assert.equal(saldo(prod.bolo.v), '3/0/3');
  // O mesmo cliente em novo pedido aceito reaproveita o cadastro (um por conta).
  assert.equal(adm(`SELECT count(*) FROM public.clientes_empresa WHERE perfil_cliente_id = ${q(P.K2.id)}`), '1');
});

test('concluir pedido: vira venda com o preço combinado, a reserva passa para a venda e o estoque baixa (RF-069)', opcoes, () => {
  // Preço muda depois do pedido: o combinado vale.
  const vv = Number(adm(`SELECT versao FROM public.produto_variacoes WHERE id = ${q(prod.picole.v)}`));
  ok(P.O, 'alterar_preco', `${q(prod.picole.v)}, 700, 'Reajuste', ${vv}, ${q(k())}`);
  falha(rpc(P.V, 'concluir_pedido', `${q(prod.p1)}, ${j({})}, ${versaoPedido(prod.p1)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const ch = k();
  const r = ok(P.G, 'concluir_pedido', `${q(prod.p1)}, ${j({ recebimento_inicial: { valor_centavos: 1200, forma: 'pix' } })}, ${versaoPedido(prod.p1)}, ${q(ch)}`);
  assert.equal(r.estado, 'concluido');
  assert.equal(r.venda.total_centavos, 1200);
  assert.equal(r.venda.entrega, 'entregue');
  assert.equal(ok(P.G, 'concluir_pedido', `${q(prod.p1)}, ${j({ recebimento_inicial: { valor_centavos: 1200, forma: 'pix' } })}, ${versaoPedido(prod.p1) - 1}, ${q(ch)}`).venda.id, r.venda.id);
  assert.equal(saldo(prod.picole.v), '0/0/0');
  assert.equal(adm(`SELECT origem || ' ' || cliente_nome FROM public.vendas WHERE id = ${q(r.venda.id)}`), `pedido ${P.K1.nome}`);
  assert.equal(adm(`SELECT estado FROM public.reservas_estoque WHERE origem_tipo = 'pedido' AND origem_id = ${q(prod.p1)}`), 'liberada');
  assert.equal(tituloDe(r.venda.id).estado, 'liquidado');
  falha(rpc(P.G, 'concluir_pedido', `${q(prod.p1)}, ${j({})}, ${versaoPedido(prod.p1)}, ${q(k())}`), 'já foi encerrado');
  const meus = obj(P.K1, 'public.meus_pedidos()');
  assert.equal(meus[0].estado, 'concluido');
  assert.equal(meus[0].entrega, 'entregue');
  // Produto pausado: o aceite é recusado com o nome do produto.
  const pp = produto('Sorvete de pote', 1500, 5);
  const ped = ok(P.K1, 'criar_pedido', `${q(A)}, ${j([item(pp.v, 1)])}, NULL, ${q(k())}`);
  const vp = Number(adm(`SELECT versao FROM public.produtos WHERE id = ${q(pp.id)}`));
  ok(P.O, 'pausar_venda_produto', `${q(pp.id)}, true, 'Freezer em manutenção', ${vp}, ${q(k())}`);
  falha(rpc(P.G, 'aceitar_pedido', `${q(ped.id)}, ${versaoPedido(ped.id)}, ${q(k())}`), 'PRODUCT_PAUSED');
  assert.equal(saldo(pp.v), '5/0/5');
  // Sob encomenda no pedido: o aceite reserva o que há; a conclusão contrata a venda com entrega pendente (D6-08).
  const enc = ok(P.K1, 'criar_pedido', `${q(A)}, ${j([item(prod.torta.v, 2)])}, NULL, ${q(k())}`);
  const ac = ok(P.G, 'aceitar_pedido', `${q(enc.id)}, ${versaoPedido(enc.id)}, ${q(k())}`);
  assert.equal(ac.reservas[0].a_encomendar, 1);
  assert.equal(saldo(prod.torta.v), '1/1/0');
  const cc = ok(P.G, 'concluir_pedido', `${q(enc.id)}, ${j({})}, ${versaoPedido(enc.id)}, ${q(k())}`);
  assert.equal(cc.venda.entrega, 'pendente');
  assert.equal(saldo(prod.torta.v), '1/1/0');
  assert.equal(obj(P.K1, 'public.meus_pedidos()')[0].entrega, 'pendente');
  // Cancelar a venda do pedido cancela o pedido com o mesmo motivo.
  ok(P.G, 'cancelar_venda', `${q(cc.venda.id)}, 'Forno quebrou, encomenda cancelada', ${j({})}, ${versaoVenda(cc.venda.id)}, ${q(k())}`);
  assert.equal(adm(`SELECT estado || ' / ' || motivo_decisao FROM public.pedidos WHERE id = ${q(enc.id)}`), 'cancelado / Forno quebrou, encomenda cancelada');
  assert.equal(saldo(prod.torta.v), '1/0/1');
  // Proteção contra excesso: até 5 pedidos aguardando por cliente e empresa.
  for (let i = 0; i < 4; i += 1) ok(P.K2, 'criar_pedido', `${q(A)}, ${j([item(prod.brigadeiro.v, 1)])}, NULL, ${q(k())}`);
  ok(P.K2, 'criar_pedido', `${q(A)}, ${j([item(prod.brigadeiro.v, 1)])}, NULL, ${q(k())}`);
  falha(rpc(P.K2, 'criar_pedido', `${q(A)}, ${j([item(prod.brigadeiro.v, 1)])}, NULL, ${q(k())}`), 'já tem 5 pedidos');
});

test('histórico do cliente, lista de vendas com filtros, visão única das operações e isolamento (RF-034, RF-081 a RF-083, D6-16)', opcoes, () => {
  const h = obj(P.G, `public.historico_do_cliente(${q(prod.ana)})`);
  assert.equal(h.vendas.length, 1);
  assert.equal(h.vendas[0].numero, 1);
  falha(rpc(P.C, 'historico_do_cliente', q(prod.ana)), 'FORBIDDEN_ACTION');
  const canceladas = obj(P.C, `public.vendas_da_empresa(${q(A)}, ${j({ estado: 'cancelada' })}, 50, 0)`);
  assert.ok(canceladas.length >= 2);
  assert.equal(canceladas.every((v) => v.estado === 'cancelada'), true);
  assert.equal(obj(P.C, `public.vendas_da_empresa(${q(A)}, ${j({ numero: '1' })}, 50, 0)`)[0].pagamento.estado, 'liquidado');
  assert.equal(obj(P.C, `public.vendas_da_empresa(${q(A)}, ${j({ origem: 'pedido' })}, 50, 0)`).every((v) => v.origem === 'pedido'), true);
  falha(rpc(P.C, 'vendas_da_empresa', `${q(A)}, ${j({ de: 'ontem' })}, 50, 0`), 'Período inválido');
  const ops = obj(P.G, `public.operacoes_da_empresa(${q(A)}, 200)`);
  assert.ok(ops.some((o) => o.tipo === 'venda' && o.origem === 'balcao'));
  assert.ok(ops.some((o) => o.tipo === 'venda' && o.origem === 'pedido'));
  assert.ok(ops.some((o) => o.tipo === 'pedido'));
  assert.equal(obj(P.C, `public.operacoes_da_empresa(${q(A)}, 200)`).some((o) => o.tipo === 'pedido'), false);   // caixa não vê pedidos
  falha(rpc(P.F, 'operacoes_da_empresa', `${q(A)}, 50`), 'nem pedidos');
  // Outra empresa: nada pela função, nada pelas tabelas; identificadores adulterados não passam.
  for (const [nome, args] of [['vendas_da_empresa', `${q(A)}, '{}'::jsonb, 50, 0`], ['venda_detalhe', q(prod.venda1)],
    ['pedidos_da_empresa', `${q(A)}, NULL, 50`], ['clientes_da_empresa', `${q(A)}, NULL, 50, 0`], ['catalogo_para_venda', `${q(A)}, NULL`]]) {
    falha(rpc(P.X, nome, args), 'TENANT_FORBIDDEN');
  }
  for (const tabela of ['vendas', 'venda_itens', 'pedidos', 'pedido_itens', 'titulos_financeiros', 'parcelas_financeiras', 'recebimentos', 'eventos_comerciais', 'contas_financeiras']) {
    assert.equal(como(P.X, `SELECT count(*) FROM public.${tabela}`).saida, '0', tabela);
  }
  const outro = ok(P.X, 'criar_produto', `${q(B)}, ${j({ nome: 'Item de B', finalidade: 'comercializavel', preco_centavos: 100, quantidade_inicial: 5 })}, NULL, ${q(k())}`).variacoes[0].id;
  falha(direta(P.G, [item(outro, 1)]), 'NOT_FOUND');
  falha(rpc(P.X, 'registrar_recebimento', `${q(parcelasDe(prod.vendaParcelada)[1].id)}, 100, 'pix', NULL, ${q(k())}`), 'TENANT_FORBIDDEN');
  falha(rpc(P.X, 'criar_venda', `${q(A)}, ${j({ cliente_empresa_id: prod.ana })}, ${j([item(prod.brigadeiro.v, 1)])}, ${q(k())}`), 'TENANT_FORBIDDEN');
  const clienteDeB = ok(P.X, 'criar_cliente', `${q(B)}, ${j({ nome: 'Cliente de B' })}, ${q(k())}`).id;
  falha(rpc(P.G, 'criar_venda', `${q(A)}, ${j({ cliente_empresa_id: clienteDeB })}, ${j([item(prod.brigadeiro.v, 1)])}, ${q(k())}`), 'Cliente não encontrado');
  // Escrita direta nas tabelas é negada ao app.
  for (const comando of [
    `INSERT INTO public.vendas (empresa_id, origem, autor) VALUES (${q(A)}, 'balcao', 'x')`,
    `UPDATE public.titulos_financeiros SET recebido = 0`,
    `UPDATE public.pedidos SET estado = 'aceito'`,
    `INSERT INTO public.recebimentos (empresa_id) VALUES (${q(A)})`,
    'SELECT * FROM app_private.contadores_empresa',
  ]) falha(como(P.O, comando), 'permission denied');
});

test('identidade vazia (D-07): tabelas e leituras do M06 dão AUTH_REQUIRED, nunca lista vazia', opcoes, () => {
  const vazio = (c) => comoPapel(banco.url, { sub: null }, c);
  for (const tabela of ['clientes_empresa', 'vendas', 'venda_itens', 'pedidos', 'pedido_itens', 'eventos_comerciais', 'contas_financeiras',
    'titulos_financeiros', 'parcelas_financeiras', 'recebimentos']) {
    falha(vazio(`SELECT count(*) FROM public.${tabela}`), 'AUTH_REQUIRED|Sessão ausente');
  }
  for (const leitura of [`public.vendas_da_empresa(${q(A)})`, `public.venda_detalhe(${q(prod.venda1)})`, `public.pedidos_da_empresa(${q(A)})`,
    'public.meus_pedidos()', `public.operacoes_da_empresa(${q(A)})`, `public.clientes_da_empresa(${q(A)})`, 'public.empresas_para_pedido()',
    `public.itens_para_pedido(${q(A)})`, `public.catalogo_para_venda(${q(A)})`, `public.historico_do_cliente(${q(prod.ana)})`]) {
    falha(vazio(`SELECT ${leitura}`), 'AUTH_REQUIRED|Sessão ausente');
  }
});

test('concorrência real: última unidade, venda × aceite, dois aceites, recebimentos e concluir × cancelar (DBT-007, FIN-I03, FIN-I08)', opcoes, async () => {
  const fn = (nome, args) => `SELECT public.${nome}(${args})`;
  // 1) Duas vendas diretas disputando a última unidade.
  const u = produto('Última fatia', 1000, 1);
  const vd = (p) => fn('registrar_venda_direta', `'${A}', '{}'::jsonb, '[{"variacao_id":"${u.v}","quantidade":1}]'::jsonb, '{}'::jsonb, NULL, '${k()}'`);
  const primeira = sessao(P.O, vd(P.O), 0.8);
  await pausa(250);
  let r = await Promise.all([primeira, sessao(P.G, vd(P.G))]);
  assert.equal(r.filter((x) => x.ok).length, 1, r.map((x) => x.erro).join(' | '));
  assert.match(r.find((x) => !x.ok).erro, /INSUFFICIENT_STOCK|Estoque insuficiente/);
  assert.equal(saldo(u.v), '0/0/0');

  // 2) Venda de balcão × aceite de pedido pela última unidade (nas duas ordens).
  for (const ordem of ['venda_primeiro', 'aceite_primeiro']) {
    const w = produto(`Disputa ${ordem}`, 1000, 1);
    const ped = ok(P.K3, 'criar_pedido', `${q(A)}, ${j([item(w.v, 1)])}, NULL, ${q(k())}`);
    const venda = () => sessao(P.O, fn('registrar_venda_direta', `'${A}', '{}'::jsonb, '[{"variacao_id":"${w.v}","quantidade":1}]'::jsonb, '{}'::jsonb, NULL, '${k()}'`), ordem === 'venda_primeiro' ? 0.8 : 0);
    const aceite = () => sessao(P.G, fn('aceitar_pedido', `'${ped.id}', ${versaoPedido(ped.id)}, '${k()}'`), ordem === 'aceite_primeiro' ? 0.8 : 0);
    const a = ordem === 'venda_primeiro' ? venda() : aceite();
    await pausa(250);
    r = await Promise.all([a, ordem === 'venda_primeiro' ? aceite() : venda()]);
    assert.equal(r.filter((x) => x.ok).length, 1, `${ordem}: ${r.map((x) => x.erro).join(' | ')}`);
    assert.match(saldo(w.v), /^(0\/0\/0|1\/1\/0)$/);
    assert.equal(r[0].ok, true, `${ordem}: quem pegou a trava primeiro vence`);
  }

  // 3) Dois aceites de pedidos diferentes pela última unidade; dois aceites do MESMO pedido.
  const z = produto('Último pote', 1000, 1);
  const pa = ok(P.K3, 'criar_pedido', `${q(A)}, ${j([item(z.v, 1)])}, NULL, ${q(k())}`);
  const pb = ok(P.K4, 'criar_pedido', `${q(A)}, ${j([item(z.v, 1)])}, NULL, ${q(k())}`);
  const x1 = sessao(P.G, fn('aceitar_pedido', `'${pa.id}', 1, '${k()}'`), 0.8);
  await pausa(250);
  r = await Promise.all([x1, sessao(P.O, fn('aceitar_pedido', `'${pb.id}', 1, '${k()}'`))]);
  assert.equal(r.filter((x) => x.ok).length, 1, r.map((x) => x.erro).join(' | '));
  assert.equal(saldo(z.v), '1/1/0');
  const z2 = produto('Pote duplo', 1000, 3);
  const pc = ok(P.K4, 'criar_pedido', `${q(A)}, ${j([item(z2.v, 1)])}, NULL, ${q(k())}`);
  const y1 = sessao(P.G, fn('aceitar_pedido', `'${pc.id}', 1, '${k()}'`), 0.8);
  await pausa(250);
  r = await Promise.all([y1, sessao(P.O, fn('aceitar_pedido', `'${pc.id}', 1, '${k()}'`))]);
  assert.equal(r.filter((x) => x.ok).length, 1);
  assert.match(r.find((x) => !x.ok).erro, /já foi respondido|VERSION_CONFLICT|mudou/);
  assert.equal(saldo(z2.v), '3/1/2');

  // 4) Concluir × cancelar o mesmo pedido: um só efeito.
  const cancel = sessao(P.G, fn('cancelar_pedido', `'${pc.id}', 'Cliente desistiu na porta', 2, '${k()}'`), 0.8);
  await pausa(250);
  r = await Promise.all([cancel, sessao(P.O, fn('concluir_pedido', `'${pc.id}', '{}'::jsonb, 2, '${k()}'`))]);
  assert.equal(r.filter((x) => x.ok).length, 1, r.map((x) => x.erro).join(' | '));
  assert.equal(saldo(z2.v), '3/0/3');
  assert.equal(adm(`SELECT estado FROM public.pedidos WHERE id = ${q(pc.id)}`), 'cancelado');

  // 5) Dois recebimentos simultâneos na mesma parcela: nunca somam além do saldo.
  const pr = parcelasDe(prod.vendaParcelada)[1];   // R$ 4,00
  const rec = (p) => sessao(p, fn('registrar_recebimento', `'${pr.id}', 300, 'dinheiro', NULL, '${k()}'`), p === P.C ? 0.8 : 0);
  const rc1 = rec(P.C);
  await pausa(250);
  r = await Promise.all([rc1, rec(P.G)]);
  assert.equal(r.filter((x) => x.ok).length, 1);
  assert.match(r.find((x) => !x.ok).erro, /PAYMENT_EXCEEDS_BALANCE|maior que o saldo/);
  assert.equal(parcelasDe(prod.vendaParcelada)[1].saldo, 1);
});

test('numeração (D6-15): confirmações simultâneas recebem números distintos e seguidos; falhas não abrem lacunas', opcoes, async () => {
  const antes = Number(adm(`SELECT coalesce(max(numero), 0) FROM public.vendas WHERE empresa_id = ${q(A)}`));
  const n = produto('Numerado', 100, 5);
  const ped = (i) => sessao(i % 2 ? P.O : P.G, `SELECT public.registrar_venda_direta('${A}', '{}'::jsonb, '[{"variacao_id":"${n.v}","quantidade":1}]'::jsonb, '{}'::jsonb, NULL, '${k()}')`, 0.2);
  // 8 confirmações com 5 unidades: 5 confirmam, 3 falham por estoque.
  const r = await Promise.all(Array.from({ length: 8 }, (_, i) => ped(i)));
  assert.equal(r.filter((x) => x.ok).length, 5, r.map((x) => x.erro).filter(Boolean).join(' | '));
  const numeros = adm(`SELECT string_agg(numero::text, ',' ORDER BY numero) FROM public.vendas WHERE empresa_id = ${q(A)} AND numero > ${antes}`).split(',').map(Number);
  assert.deepEqual(numeros, [1, 2, 3, 4, 5].map((i) => antes + i));
  // Nenhuma lacuna em toda a empresa, e outra empresa tem a própria sequência.
  assert.equal(adm(`SELECT max(numero) = count(*) FROM public.vendas WHERE empresa_id = ${q(A)} AND numero IS NOT NULL`), 't');
  const b1 = JSON.parse(rpc(P.X, 'registrar_venda_direta', `${q(B)}, '{}'::jsonb, ${j([{ variacao_id: adm(`SELECT v.id FROM public.produto_variacoes v JOIN public.produtos p ON p.id = v.produto_id WHERE p.empresa_id = ${q(B)} LIMIT 1`), quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`).saida);
  assert.equal(b1.numero, 1);
});

test('reconciliação do estoque fecha depois de tudo e o histórico comercial é imutável; rollback recusa com dados', opcoes, () => {
  assert.equal(como(P.O, `SELECT count(*) FROM public.reconciliar_estoque(${q(A)})`).saida, '0');
  falha(sql(banco.url, "UPDATE public.eventos_comerciais SET tipo = 'x'"), 'histórico|não pode');
  falha(sql(banco.url, `DELETE FROM public.pedidos WHERE id = ${q(prod.p1)}`), 'histórico|não pode');
  assert.ok(Number(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao LIKE 'venda.%' OR tipo_acao LIKE 'pedido.%'")) >= 5);
  const down = sql(banco.url, `\\i ${process.cwd()}/db/migrations_propostas/202611020002_clientes_vendas.down.sql`);
  falha(down, 'Rollback recusado');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611020002'"), '1');
});
