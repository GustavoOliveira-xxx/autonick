/**
 * Testes de banco do M05 (migration 202611010008): produtos, variações, preço e custo, estoque,
 * propostas e aprovação (D5-04), estornos, fornecedores, compras, alertas por variação (D5-02),
 * pausa comercial (D5-08), sob encomenda (D5-10), motor de reservas (D5-05) e concorrência real.
 * PostgreSQL LOCAL com emulação do Neon. Casos de MINI-ESPEC_M05 §10.2, FIN-001 §6 e DBT-001/DBT-007.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['0001_fundacao_identidade', '0002_correcao_identidade_sessao', '0003_empresas_ck', '0004_identidade_vazia_explicita',
  '0005_marcacao_dados_de_teste', '0006_equipe_permissoes', '0007_categorias_oficiais', '0008_produtos_estoque'].map((m) => `20261101${m}`);

const ID = (n) => `e5000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona@teste.example', nome: 'Dona Olga' },
  G: { id: ID(2), email: 'gerente@teste.example', nome: 'Gerente Gil' },
  E: { id: ID(3), email: 'estoque@teste.example', nome: 'Estoquista Eva' },
  V: { id: ID(4), email: 'vendas@teste.example', nome: 'Vendedor Vitor' },
  X: { id: ID(5), email: 'outra@teste.example', nome: 'Xênia Outra' },
};

let chave = 0;
const k = () => `estoque-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const como = (p, c) => comoPapel(banco.url, { sub: p.id }, c);
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
function obj(p, expr) {
  const r = como(p, `SELECT (${expr})::text`);
  assert.ok(r.ok, r.erro);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}
const rpc = (p, nome, args) => como(p, `SELECT public.${nome}(${args})::text`);
const saldo = (v) => adm(`SELECT fisico || '/' || reservado || '/' || disponivel FROM public.saldos_estoque WHERE variacao_id = ${q(v)}`);
const versaoProposta = (id) => Number(adm(`SELECT versao FROM public.propostas_movimentacao WHERE id = ${q(id)}`));

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
  const cat = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'").saida;
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'comercio', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'privado@teste.example' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('Loja A')}'::jsonb, 'estoque-setup-01')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('Loja B')}'::jsonb, 'estoque-setup-02')::text`).saida).id;
  const perfil = (nome, perms) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.criar_perfil_permissao(${q(A)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())})::text`).saida);
  perfis.estoque = perfil('Estoque', ['produtos.visualizar', 'produtos.criar', 'produtos.alterar', 'estoque.visualizar', 'estoque.propor']);
  perfis.gerente = perfil('Gerente', ['produtos.visualizar', 'produtos.criar', 'produtos.alterar', 'produtos.alterar_preco', 'produtos.ver_custo',
    'estoque.visualizar', 'estoque.propor', 'estoque.aprovar', 'fornecedores.visualizar', 'fornecedores.alterar']);
  perfis.vendas = perfil('Vendas', ['produtos.visualizar', 'estoque.visualizar']);
  for (const [p, perfilId] of [[P.E, perfis.estoque.id], [P.G, perfis.gerente.id], [P.V, perfis.vendas.id]]) {
    const c = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.convidar_funcionario(${q(A)}, ${q(p.email)}, ${q(perfilId)}, ${q(k())})::text`).saida);
    comoPapel(banco.url, { sub: p.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`);
  }
});
after(() => banco?.encerrar());

test('catálogo ganha 2 permissões de fornecedores (50 no total); nenhuma da CK', opcoes, () => {
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '50');
  assert.equal(adm("SELECT string_agg(codigo, ',' ORDER BY codigo) FROM public.permissoes_catalogo WHERE modulo = 'fornecedores'"), 'fornecedores.alterar,fornecedores.visualizar');
  assert.equal(adm("SELECT count(*) FROM public.perfil_permissoes WHERE perfil_id = " + q(perfis.estoque.id) + " AND codigo LIKE 'fornecedores.%'"), '0');
});

test('produto simples: variação padrão oculta, finalidade obrigatória, dinheiro em centavos (D5-01, D5-12, C-13)', opcoes, () => {
  falha(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caneta', preco_centavos: 350 })}, NULL, ${q(k())}`), 'comercializável ou de uso interno');
  falha(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caneta', finalidade: 'comercializavel', preco_centavos: 350.5 })}, NULL, ${q(k())}`), 'duas casas');
  falha(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caneta', finalidade: 'comercializavel', preco_centavos: 0 })}, NULL, ${q(k())}`), 'Valor inválido');
  falha(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caneta', finalidade: 'comercializavel', preco_centavos: 350, cor: 'azul' })}, NULL, ${q(k())}`), 'não permitido');
  const ch = k();
  const r = rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caneta azul', finalidade: 'comercializavel', preco_centavos: 350, quantidade_inicial: 10, custo_centavos: 120 })}, NULL, ${q(ch)}`);
  assert.ok(r.ok, r.erro);
  prod.caneta = JSON.parse(r.saida);
  assert.equal(prod.caneta.variacoes.length, 1);
  assert.equal(prod.caneta.variacoes[0].padrao, true);
  assert.equal(prod.caneta.estoque_inicial.estado, 'aprovada');
  prod.canetaVar = prod.caneta.variacoes[0].id;
  assert.equal(saldo(prod.canetaVar), '10/0/10');
  assert.equal(adm(`SELECT preco FROM public.produto_variacoes WHERE id = ${q(prod.canetaVar)}`), '3.50');
  assert.equal(JSON.parse(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caneta azul', finalidade: 'comercializavel', preco_centavos: 350, quantidade_inicial: 10, custo_centavos: 120 })}, NULL, ${q(ch)}`).saida).id, prod.caneta.id);
  falha(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Outra', finalidade: 'uso_interno', preco_centavos: 1 })}, NULL, ${q(ch)}`), 'IDEMPOTENCY_CONFLICT');
  assert.equal(adm(`SELECT count(*) FROM public.produtos WHERE empresa_id = ${q(A)}`), '1');
});

test('variações com preço e estoque próprios; atributos e SKU únicos (RF-041 a RF-043)', opcoes, () => {
  const r = rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Camiseta', finalidade: 'comercializavel' })}, ${j([
    { atributos: { Cor: 'Azul', Tamanho: 'M' }, preco_centavos: 4990, sku: 'CAM-AZ-M', quantidade_inicial: 8, estoque_minimo: 3 },
    { atributos: { Cor: 'Azul', Tamanho: 'G' }, preco_centavos: 5490, sku: 'CAM-AZ-G' }])}, ${q(k())}`);
  assert.ok(r.ok, r.erro);
  prod.camiseta = JSON.parse(r.saida);
  [prod.camM, prod.camG] = prod.camiseta.variacoes.map((v) => v.id);
  assert.equal(saldo(prod.camM), '8/0/8');
  assert.equal(saldo(prod.camG), '0/0/0');
  falha(rpc(P.O, 'adicionar_variacao', `${q(prod.camiseta.id)}, ${j({ atributos: { cor: ' azul ', tamanho: 'm' }, preco_centavos: 100 })}, ${q(k())}`), 'mesmos atributos|esses atributos');
  falha(rpc(P.O, 'adicionar_variacao', `${q(prod.camiseta.id)}, ${j({ atributos: { Cor: 'Preta', Tamanho: 'M' }, preco_centavos: 100, sku: 'cam-az-m' })}, ${q(k())}`), 'SKU');
  falha(rpc(P.O, 'adicionar_variacao', `${q(prod.camiseta.id)}, ${j({ atributos: {}, preco_centavos: 100 })}, ${q(k())}`), 'ao menos um atributo');
  const nova = rpc(P.O, 'adicionar_variacao', `${q(prod.camiseta.id)}, ${j({ atributos: { Cor: 'Preta', Tamanho: 'M' }, preco_centavos: 4990 })}, ${q(k())}`);
  assert.ok(nova.ok, nova.erro);
  prod.camPreta = JSON.parse(nova.saida).id;
});

test('produto simples com estoque não vira produto com variações sem zerar o estoque (D5-12)', opcoes, () => {
  falha(rpc(P.O, 'adicionar_variacao', `${q(prod.caneta.id)}, ${j({ atributos: { Cor: 'Azul' }, preco_centavos: 350 })}, ${q(k())}`), 'estoque sem variação');
  const simples = JSON.parse(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Caderno', finalidade: 'comercializavel', preco_centavos: 1500 })}, NULL, ${q(k())}`).saida);
  const r = rpc(P.O, 'adicionar_variacao', `${q(simples.id)}, ${j({ atributos: { Capa: 'Dura' }, preco_centavos: 1800 })}, ${q(k())}`);
  assert.ok(r.ok, r.erro);
  assert.equal(adm(`SELECT ativo FROM public.produto_variacoes WHERE id = ${q(simples.variacoes[0].id)}`), 'f');
});

test('custo protegido: só com produtos.ver_custo, na tabela e nas funções (SEC-001)', opcoes, () => {
  falha(rpc(P.E, 'criar_produto', `${q(A)}, ${j({ nome: 'Fita', finalidade: 'uso_interno', preco_centavos: 100, custo_centavos: 50 })}, NULL, ${q(k())}`), 'informar custo');
  falha(como(P.E, `SELECT custo_atual FROM public.produto_variacoes WHERE id = ${q(prod.canetaVar)}`), 'permission denied');
  falha(como(P.G, `SELECT custo_atual FROM public.produto_variacoes WHERE id = ${q(prod.canetaVar)}`), 'permission denied');
  falha(rpc(P.E, 'custos_da_variacao', q(prod.canetaVar)), 'FORBIDDEN_ACTION');
  const custos = obj(P.G, `public.custos_da_variacao(${q(prod.canetaVar)})`);
  assert.equal(custos.ultimo_custo_centavos, 120);
  assert.equal(custos.metodo, 'ultimo_custo_informado');
  const lista = obj(P.E, `public.produtos_da_empresa(${q(A)})`);
  assert.equal(lista.some((p) => p.variacoes.some((v) => 'custo_centavos' in v)), false);
  assert.equal(obj(P.O, `public.produtos_da_empresa(${q(A)})`).find((p) => p.id === prod.caneta.id).variacoes[0].custo_centavos, 120);
  falha(como(P.G, 'SELECT count(*) FROM public.historico_custos'), 'permission denied');
});

test('preço: só com alterar_preco, histórico e versão (RF-045)', opcoes, () => {
  const versao = Number(adm(`SELECT versao FROM public.produto_variacoes WHERE id = ${q(prod.camM)}`));
  falha(rpc(P.E, 'alterar_preco', `${q(prod.camM)}, 5290, NULL, ${versao}, ${q(k())}`), 'FORBIDDEN_ACTION');
  assert.ok(rpc(P.G, 'alterar_preco', `${q(prod.camM)}, 5290, 'Reajuste', ${versao}, ${q(k())}`).ok);
  falha(rpc(P.G, 'alterar_preco', `${q(prod.camM)}, 5390, NULL, ${versao}, ${q(k())}`), 'VERSION_CONFLICT');
  assert.equal(adm(`SELECT count(*) FROM public.historico_precos WHERE variacao_id = ${q(prod.camM)}`), '2');
  assert.equal(sql(banco.url, `UPDATE public.historico_precos SET preco_novo = 1 WHERE variacao_id = ${q(prod.camM)}`).ok, false);
});

test('proposta não muda o estoque; aprovação aplica tudo ou nada (FIN-I15, RF-056, D5-04)', opcoes, () => {
  falha(rpc(P.E, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camG, quantidade: 5 }])}, NULL, ${q(k())}`), 'FORBIDDEN_ACTION');
  const prop = JSON.parse(rpc(P.E, 'propor_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camG, quantidade: 5 }, { variacao_id: prod.camM, quantidade: 2 }])}, 'Chegada de mercadoria', ${q(k())}`).saida);
  assert.equal(prop.estado, 'pendente');
  assert.equal(saldo(prod.camG), '0/0/0');
  falha(rpc(P.E, 'aprovar_proposta', `${q(prop.proposta_id)}, 1, ${q(k())}`), 'FORBIDDEN_ACTION');
  const ap = rpc(P.G, 'aprovar_proposta', `${q(prop.proposta_id)}, 1, ${q(k())}`);
  assert.ok(ap.ok, ap.erro);
  assert.equal(saldo(prod.camG), '5/0/5');
  assert.equal(saldo(prod.camM), '10/0/10');
  falha(rpc(P.G, 'aprovar_proposta', `${q(prop.proposta_id)}, 2, ${q(k())}`), 'já foi decidida');
  // Tudo ou nada: o segundo item falta, então o primeiro também não sai.
  const saida = JSON.parse(rpc(P.E, 'propor_movimentacao', `${q(A)}, 'saida', ${j([{ variacao_id: prod.camM, quantidade: 1 }, { variacao_id: prod.camG, quantidade: 99 }])}, 'Amostra para cliente', ${q(k())}`).saida);
  falha(rpc(P.G, 'aprovar_proposta', `${q(saida.proposta_id)}, 1, ${q(k())}`), 'INSUFFICIENT_STOCK');
  assert.equal(saldo(prod.camM), '10/0/10');
  assert.equal(adm(`SELECT estado FROM public.propostas_movimentacao WHERE id = ${q(saida.proposta_id)}`), 'pendente');
  falha(rpc(P.E, 'decidir_proposta_sem_aplicar', `${q(saida.proposta_id)}, 'rejeitar', 'não', 1, ${q(k())}`), 'FORBIDDEN_ACTION');
  assert.ok(rpc(P.E, 'decidir_proposta_sem_aplicar', `${q(saida.proposta_id)}, 'cancelar', NULL, 1, ${q(k())}`).ok);
});

test('quem aprova movimenta direto, com aprovação própria registrada; validações de saída e ajuste', opcoes, () => {
  const r = JSON.parse(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'saida', ${j([{ variacao_id: prod.camM, quantidade: 1 }])}, 'Uso na vitrine da loja', ${q(k())}`).saida);
  assert.equal(r.aprovacao_propria, true);
  assert.equal(saldo(prod.camM), '9/0/9');
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'saida', ${j([{ variacao_id: prod.camM, quantidade: 1 }])}, NULL, ${q(k())}`), 'motivo da saída');
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'ajuste', ${j([{ variacao_id: prod.camM, quantidade: -1 }])}, 'curto', ${q(k())}`), '10 caracteres');
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'ajuste', ${j([{ variacao_id: prod.camM, quantidade: -50 }])}, 'Contagem do inventário mensal', ${q(k())}`), 'INSUFFICIENT_STOCK');
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camM, quantidade: 1.5 }])}, NULL, ${q(k())}`), 'inteiro');
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camM, quantidade: 1 }, { variacao_id: prod.camM, quantidade: 2 }])}, NULL, ${q(k())}`), 'duas vezes');
  assert.ok(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'ajuste', ${j([{ variacao_id: prod.camM, quantidade: -2 }])}, 'Contagem do inventário mensal', ${q(k())}`).ok);
  assert.equal(saldo(prod.camM), '7/0/7');
});

test('estorno: uma vez só, sem apagar a original; não estorna estorno nem deixa negativo (RF-054, FIN-I16)', opcoes, () => {
  const ent = JSON.parse(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camPreta, quantidade: 4 }])}, NULL, ${q(k())}`).saida);
  const mov = adm(`SELECT id FROM public.movimentacoes_estoque WHERE proposta_id = ${q(ent.proposta_id)}`);
  falha(rpc(P.G, 'estornar_movimentacao', `${q(mov)}, 'curto', ${q(k())}`), '10 a 300');
  falha(rpc(P.E, 'estornar_movimentacao', `${q(mov)}, 'Lançada na variação errada', ${q(k())}`), 'FORBIDDEN_ACTION');
  assert.ok(rpc(P.G, 'estornar_movimentacao', `${q(mov)}, 'Lançada na variação errada', ${q(k())}`).ok);
  assert.equal(saldo(prod.camPreta), '0/0/0');
  falha(rpc(P.G, 'estornar_movimentacao', `${q(mov)}, 'Lançada na variação errada de novo', ${q(k())}`), 'já foi estornada');
  const est = adm(`SELECT id FROM public.movimentacoes_estoque WHERE estorno_de = ${q(mov)}`);
  falha(rpc(P.G, 'estornar_movimentacao', `${q(est)}, 'Desfazer o estorno anterior', ${q(k())}`), 'não pode ser estornado');
  // Entrada já consumida: estornar deixaria negativo.
  const e2 = JSON.parse(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camPreta, quantidade: 3 }])}, NULL, ${q(k())}`).saida);
  rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'saida', ${j([{ variacao_id: prod.camPreta, quantidade: 2 }])}, 'Doação para evento', ${q(k())}`);
  const mov2 = adm(`SELECT id FROM public.movimentacoes_estoque WHERE proposta_id = ${q(e2.proposta_id)}`);
  falha(rpc(P.G, 'estornar_movimentacao', `${q(mov2)}, 'Entrada lançada em duplicidade', ${q(k())}`), 'INSUFFICIENT_STOCK');
  assert.equal(sql(banco.url, `DELETE FROM public.movimentacoes_estoque WHERE id = ${q(mov)}`).ok, false);
});

test('mínimo por variação, alertas e visão consolidada do produto (D5-02, RF-057, RF-058)', opcoes, () => {
  const v = Number(adm(`SELECT versao FROM public.produto_variacoes WHERE id = ${q(prod.camG)}`));
  assert.ok(rpc(P.E, 'alterar_variacao', `${q(prod.camG)}, ${j({ estoque_minimo: 6 })}, ${v}, ${q(k())}`).ok);
  const alertas = como(P.V, `SELECT string_agg(rotulo || ':' || disponivel || '<=' || estoque_minimo, ';' ORDER BY rotulo) FROM public.alertas_estoque(${q(A)})`);
  assert.ok(alertas.ok, alertas.erro);
  assert.equal(alertas.saida, 'Azul, G:5<=6');
  const camiseta = obj(P.V, `public.produtos_da_empresa(${q(A)})`).find((p) => p.id === prod.camiseta.id);
  assert.equal(camiseta.resumo.variacoes_em_alerta, 1);
  assert.equal(camiseta.resumo.fisico, 7 + 5 + 1);
  assert.equal(camiseta.variacoes.find((x) => x.id === prod.camG).abaixo_minimo, true);
  falha(rpc(P.E, 'alterar_variacao', `${q(prod.camG)}, ${j({ estoque_minimo: -1 })}, ${v + 1}, ${q(k())}`), 'mínimo');
});

test('pausa comercial com estoque disponível (D5-08) e finalidade alterável com histórico', opcoes, () => {
  falha(rpc(P.V, 'pausar_venda_produto', `${q(prod.camiseta.id)}, true, 'Coleção encerrada', 1, ${q(k())}`), 'FORBIDDEN_ACTION');
  const versao = Number(adm(`SELECT versao FROM public.produtos WHERE id = ${q(prod.camiseta.id)}`));
  assert.ok(rpc(P.E, 'pausar_venda_produto', `${q(prod.camiseta.id)}, true, 'Coleção encerrada', ${versao}, ${q(k())}`).ok);
  assert.equal(adm(`SELECT venda_pausada || ':' || motivo_pausa FROM public.produtos WHERE id = ${q(prod.camiseta.id)}`), 'true:Coleção encerrada');
  assert.equal(saldo(prod.camM), '7/0/7');
  falha(rpc(P.E, 'pausar_venda_produto', `${q(prod.camiseta.id)}, true, NULL, ${versao + 1}, ${q(k())}`), 'já está pausada');
  assert.ok(rpc(P.E, 'pausar_venda_produto', `${q(prod.camiseta.id)}, false, NULL, ${versao + 1}, ${q(k())}`).ok);
  assert.ok(rpc(P.E, 'alterar_produto', `${q(prod.caneta.id)}, ${j({ finalidade: 'uso_interno' })}, ${Number(adm(`SELECT versao FROM public.produtos WHERE id = ${q(prod.caneta.id)}`))}, ${q(k())}`).ok);
  assert.equal(adm(`SELECT detalhes->>'finalidade_depois' FROM public.eventos_estoque WHERE alvo_id = ${q(prod.caneta.id)} AND tipo = 'produto_alterado'`), 'uso_interno');
});

test('motor de reservas: exemplo 2 do FIN-001, repetição, liberação e consumo (D5-05, FIN-I09, FIN-I10)', opcoes, () => {
  const v = JSON.parse(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Produto X', finalidade: 'comercializavel', preco_centavos: 1000, quantidade_inicial: 10 })}, NULL, ${q(k())}`).saida).variacoes[0].id;
  prod.x = v;
  const reservar = (origem, qtd, ch = k()) => sql(banco.url, `SELECT app_private.reservar_estoque(${q(A)}, ${q(P.O.id)}, 'pedido', ${q(origem)}, ${j([{ variacao_id: v, quantidade: qtd }])}, ${q(ch)})::text`);
  const o1 = 'f0000000-0000-4000-8000-000000000001';
  const o2 = 'f0000000-0000-4000-8000-000000000002';
  const o3 = 'f0000000-0000-4000-8000-000000000003';
  assert.ok(reservar(o1, 4).ok);
  assert.equal(saldo(v), '10/4/6');
  assert.ok(reservar(o2, 6).ok);
  assert.equal(saldo(v), '10/10/0');
  falha(reservar(o3, 1), 'INSUFFICIENT_STOCK');
  assert.equal(JSON.parse(reservar(o1, 4).saida).repetida, true);
  assert.equal(saldo(v), '10/10/0');
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'saida', ${j([{ variacao_id: v, quantidade: 1 }])}, 'Tentativa sobre unidade reservada', ${q(k())}`), 'INSUFFICIENT_STOCK');
  assert.equal(adm(`SELECT app_private.liberar_reservas(${q(A)}, ${q(P.O.id)}, 'pedido', ${q(o2)}, 'Pedido recusado')`), '1');
  assert.equal(adm(`SELECT app_private.liberar_reservas(${q(A)}, ${q(P.O.id)}, 'pedido', ${q(o2)}, 'Repetição')`), '0');
  assert.equal(saldo(v), '10/4/6');
  assert.equal(adm(`SELECT app_private.consumir_reservas(${q(A)}, ${q(P.O.id)}, 'pedido', ${q(o1)}, ${q(k())})`), '1');
  assert.equal(adm(`SELECT app_private.consumir_reservas(${q(A)}, ${q(P.O.id)}, 'pedido', ${q(o1)}, ${q(k())})`), '0');
  assert.equal(saldo(v), '6/0/6');
  const consumo = adm(`SELECT id FROM public.movimentacoes_estoque WHERE variacao_id = ${q(v)} AND origem_tipo = 'reserva'`);
  falha(rpc(P.G, 'estornar_movimentacao', `${q(consumo)}, 'Tentativa de estornar venda por aqui', ${q(k())}`), 'outro módulo');
  falha(como(P.O, `SELECT app_private.reservar_estoque(${q(A)}, ${q(P.O.id)}, 'pedido', ${q(o3)}, '[]'::jsonb, 'x')`), 'permission denied');
});

test('sob encomenda: controla unidades existentes e reserva o que houver (D5-10)', opcoes, () => {
  const p = JSON.parse(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Bolo de pote', finalidade: 'comercializavel', sob_encomenda: true, preco_centavos: 1200, quantidade_inicial: 2 })}, NULL, ${q(k())}`).saida);
  const v = p.variacoes[0].id;
  assert.equal(saldo(v), '2/0/2');
  const r = JSON.parse(adm(`SELECT app_private.reservar_estoque(${q(A)}, ${q(P.O.id)}, 'pedido', 'f0000000-0000-4000-8000-000000000010', ${j([{ variacao_id: v, quantidade: 5 }])}, ${q(k())})::text`));
  assert.deepEqual(r.reservas.map((x) => [x.reservado, x.a_encomendar]), [[2, 3]]);
  assert.equal(saldo(v), '2/2/0');
});

test('fornecedores: permissões próprias, validação e isolamento (D5-06, RF-065)', opcoes, () => {
  falha(rpc(P.E, 'criar_fornecedor', `${q(A)}, ${j({ nome: 'Distribuidora' })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'criar_fornecedor', `${q(A)}, ${j({ nome: 'Distribuidora', documento: '123' })}, ${q(k())}`), 'CPF tem 11');
  const f = JSON.parse(rpc(P.G, 'criar_fornecedor', `${q(A)}, ${j({ nome: 'Distribuidora Fictícia', documento: '12.345.678/0001-99', telefone: '(19) 3333-4444' })}, ${q(k())}`).saida);
  prod.fornecedor = f.id;
  assert.equal(adm(`SELECT documento || '|' || telefone FROM public.fornecedores WHERE id = ${q(f.id)}`), '12345678000199|1933334444');
  assert.equal(como(P.E, 'SELECT count(*) FROM public.fornecedores').saida, '0');
  assert.equal(como(P.X, 'SELECT count(*) FROM public.fornecedores').saida, '0');
  assert.equal(como(P.G, 'SELECT count(*) FROM public.fornecedores').saida, '1');
});

test('compras: proposta de entrada, recebimento e custo pela entrada (RF-055, FIN-001 §4.3)', opcoes, () => {
  const c = JSON.parse(rpc(P.E, 'criar_compra', `${q(A)}, ${j({ fornecedor_id: prod.fornecedor, numero_documento: 'NF 123' })}, ${j([{ variacao_id: prod.camG, quantidade: 10 }])}, ${q(k())}`).saida);
  falha(rpc(P.E, 'criar_compra', `${q(A)}, ${j({})}, ${j([{ variacao_id: prod.camG, quantidade: 1, custo_centavos: 2000 }])}, ${q(k())}`), 'informar custo');
  const reg = JSON.parse(rpc(P.E, 'registrar_compra', `${q(c.id)}, 1, ${q(k())}`).saida);
  assert.equal(reg.estado, 'registrada');
  assert.equal(saldo(prod.camG), '5/0/5');
  assert.ok(rpc(P.G, 'aprovar_proposta', `${q(reg.proposta.proposta_id)}, 1, ${q(k())}`).ok);
  assert.equal(saldo(prod.camG), '15/0/15');
  assert.equal(adm(`SELECT estado FROM public.compras_fornecedor WHERE id = ${q(c.id)}`), 'recebida');
  falha(rpc(P.G, 'cancelar_compra', `${q(c.id)}, 'Não precisa mais', 3, ${q(k())}`), 'estorne a movimentação');
  const c2 = JSON.parse(rpc(P.G, 'criar_compra', `${q(A)}, ${j({ fornecedor_id: prod.fornecedor })}, ${j([{ variacao_id: prod.camG, quantidade: 2, custo_centavos: 2150 }])}, ${q(k())}`).saida);
  const r2 = JSON.parse(rpc(P.G, 'registrar_compra', `${q(c2.id)}, 1, ${q(k())}`).saida);
  assert.equal(r2.estado, 'recebida');
  assert.equal(adm(`SELECT custo_atual FROM public.produto_variacoes WHERE id = ${q(prod.camG)}`), '21.50');
  assert.equal(adm(`SELECT origem FROM public.historico_custos WHERE variacao_id = ${q(prod.camG)} ORDER BY vigente_desde DESC LIMIT 1`), 'entrada');
  falha(rpc(P.G, 'criar_compra', `${q(A)}, ${j({ data_compra: '2999-01-01' })}, ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, ${q(k())}`), 'futuro');
});

test('isolamento: nada da empresa A é lido ou alterado por quem é de B (DBT-001, FIN-001 §7)', opcoes, () => {
  assert.equal(como(P.X, `SELECT count(*) FROM public.produtos WHERE empresa_id = ${q(A)}`).saida, '0');
  assert.equal(como(P.X, `SELECT count(*) FROM public.saldos_estoque WHERE empresa_id = ${q(A)}`).saida, '0');
  falha(rpc(P.X, 'produtos_da_empresa', q(A)), 'TENANT_FORBIDDEN');
  const pB = JSON.parse(rpc(P.X, 'criar_produto', `${q(B)}, ${j({ nome: 'Item B', finalidade: 'comercializavel', preco_centavos: 100 })}, NULL, ${q(k())}`).saida);
  falha(rpc(P.X, 'registrar_movimentacao', `${q(B)}, 'entrada', ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, NULL, ${q(k())}`), 'não encontrado nesta empresa');
  falha(rpc(P.X, 'alterar_preco', `${q(prod.camG)}, 1, NULL, 1, ${q(k())}`), 'TENANT_FORBIDDEN');
  falha(rpc(P.O, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: pB.variacoes[0].id, quantidade: 1 }])}, NULL, ${q(k())}`), 'não encontrado nesta empresa');
  const prop = adm(`SELECT id FROM public.propostas_movimentacao WHERE empresa_id = ${q(A)} LIMIT 1`);
  falha(rpc(P.X, 'aprovar_proposta', `${q(prop)}, 1, ${q(k())}`), 'TENANT_FORBIDDEN');
});

test('escrita direta negada em todas as tabelas do M05 (menor privilégio)', opcoes, () => {
  for (const comando of [
    `INSERT INTO public.produtos (empresa_id, nome, finalidade, criado_por) VALUES (${q(A)}, 'X', 'uso_interno', 'x')`,
    `UPDATE public.saldos_estoque SET fisico = 999 WHERE variacao_id = ${q(prod.camG)}`,
    `UPDATE public.produto_variacoes SET preco = 0.01 WHERE id = ${q(prod.camG)}`,
    `DELETE FROM public.movimentacoes_estoque WHERE empresa_id = ${q(A)}`,
    `INSERT INTO public.reservas_estoque (empresa_id, variacao_id, quantidade, origem_tipo, origem_id, criada_por) VALUES (${q(A)}, ${q(prod.camG)}, 1, 'x', ${q(A)}, 'x')`,
    `UPDATE public.propostas_movimentacao SET estado = 'aprovada'`,
  ]) falha(como(P.O, comando), 'permission denied');
  assert.equal(saldo(prod.camG), '17/0/17');
});

test('operações simultâneas reais: a última unidade sai uma vez só; aprovação dupla aplica uma vez (FIN-I08, DBT-007)', opcoes, async () => {
  const v = JSON.parse(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Última unidade', finalidade: 'comercializavel', preco_centavos: 500, quantidade_inicial: 1 })}, NULL, ${q(k())}`).saida).variacoes[0].id;
  const sessao = (p, comando, espera) => new Promise((resolver) => {
    const bloco = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${p.id}","role":"authenticated"}', true) \\gset
${comando};
SELECT pg_sleep(${espera});
COMMIT;`;
    const ps = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', banco.url]);
    let erro = '';
    ps.stderr.on('data', (d) => { erro += d; });
    ps.on('close', (codigo) => resolver({ ok: codigo === 0, erro }));
    ps.stdin.end(bloco);
  });
  const saida = (p) => `SELECT public.registrar_movimentacao('${A}', 'saida', '[{"variacao_id":"${v}","quantidade":1}]'::jsonb, 'Venda de balcão', '${k()}')`;
  const primeira = sessao(P.O, saida(P.O), 0.8);
  await new Promise((r) => setTimeout(r, 250));
  const resultados = await Promise.all([primeira, sessao(P.G, saida(P.G), 0)]);
  assert.equal(resultados.filter((r) => r.ok).length, 1);
  assert.match(resultados.find((r) => !r.ok).erro, /INSUFFICIENT_STOCK|Estoque insuficiente/);
  assert.equal(saldo(v), '0/0/0');

  rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: v, quantidade: 3 }])}, NULL, ${q(k())}`);
  const prop = JSON.parse(rpc(P.E, 'propor_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: v, quantidade: 2 }])}, NULL, ${q(k())}`).saida).proposta_id;
  const aprovar = () => `SELECT public.aprovar_proposta('${prop}', 1, '${k()}')`;
  const a1 = sessao(P.O, aprovar(), 0.8);
  await new Promise((r) => setTimeout(r, 250));
  const r2 = await Promise.all([a1, sessao(P.G, aprovar(), 0)]);
  assert.equal(r2.filter((r) => r.ok).length, 1);
  assert.equal(saldo(v), '5/0/5');

  // Duas reservas disputando a última unidade, com travas em ordens opostas de variação (sem impasse).
  const w = JSON.parse(rpc(P.O, 'criar_produto', `${q(A)}, ${j({ nome: 'Par', finalidade: 'comercializavel', preco_centavos: 500, quantidade_inicial: 1 })}, NULL, ${q(k())}`).saida).variacoes[0].id;
  const reservar = (origem, itens) => new Promise((resolver) => {
    const ps = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', banco.url]);
    let erro = '';
    ps.stderr.on('data', (d) => { erro += d; });
    ps.on('close', (codigo) => resolver({ ok: codigo === 0, erro }));
    ps.stdin.end(`BEGIN; SELECT app_private.reservar_estoque('${A}', '${P.O.id}', 'pedido', '${origem}', '${JSON.stringify(itens)}'::jsonb, '${k()}'); SELECT pg_sleep(0.5); COMMIT;`);
  });
  const rr = await Promise.all([
    reservar('f0000000-0000-4000-8000-000000000020', [{ variacao_id: v, quantidade: 1 }, { variacao_id: w, quantidade: 1 }]),
    reservar('f0000000-0000-4000-8000-000000000021', [{ variacao_id: w, quantidade: 1 }, { variacao_id: v, quantidade: 1 }]),
  ]);
  assert.equal(rr.filter((r) => r.ok).length, 1, rr.map((r) => r.erro).join(' | '));
  assert.equal(saldo(w), '1/1/0');
});

test('funções restantes: custo corrigido, ativação, leituras, fornecedor e cancelamento de compra', opcoes, () => {
  const vv = () => Number(adm(`SELECT versao FROM public.produto_variacoes WHERE id = ${q(prod.camPreta)}`));
  falha(rpc(P.G, 'alterar_custo', `${q(prod.camPreta)}, 1800, 'ok', ${vv()}, ${q(k())}`), '3 a 300');
  assert.ok(rpc(P.G, 'alterar_custo', `${q(prod.camPreta)}, 1800, 'Nota fiscal corrigida pelo fornecedor', ${vv()}, ${q(k())}`).ok);
  assert.equal(adm(`SELECT origem FROM public.historico_custos WHERE variacao_id = ${q(prod.camPreta)} ORDER BY vigente_desde DESC LIMIT 1`), 'correcao');
  falha(rpc(P.V, 'alterar_custo', `${q(prod.camPreta)}, 1900, 'Tentativa sem permissão', ${vv()}, ${q(k())}`), 'FORBIDDEN_ACTION');
  // Variação com reserva não é desativada; sem reserva, sim; reativação confere atributos.
  const r = sql(banco.url, `SELECT app_private.reservar_estoque(${q(A)}, ${q(P.O.id)}, 'pedido', 'f0000000-0000-4000-8000-000000000030', ${j([{ variacao_id: prod.camPreta, quantidade: 1 }])}, ${q(k())})`);
  assert.ok(r.ok, r.erro);
  falha(rpc(P.G, 'definir_variacao_ativa', `${q(prod.camPreta)}, false, ${vv()}, ${q(k())}`), 'reservadas');
  adm(`SELECT app_private.liberar_reservas(${q(A)}, ${q(P.O.id)}, 'pedido', 'f0000000-0000-4000-8000-000000000030', 'Teste')`);
  assert.ok(rpc(P.G, 'definir_variacao_ativa', `${q(prod.camPreta)}, false, ${vv()}, ${q(k())}`).ok);
  falha(rpc(P.G, 'registrar_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camPreta, quantidade: 1 }])}, NULL, ${q(k())}`), 'desativado');
  assert.ok(rpc(P.G, 'definir_variacao_ativa', `${q(prod.camPreta)}, true, ${vv()}, ${q(k())}`).ok);
  const pv = () => Number(adm(`SELECT versao FROM public.produtos WHERE id = ${q(prod.caneta.id)}`));
  assert.ok(rpc(P.G, 'definir_produto_ativo', `${q(prod.caneta.id)}, false, ${pv()}, ${q(k())}`).ok);
  falha(rpc(P.G, 'definir_produto_ativo', `${q(prod.caneta.id)}, false, ${pv()}, ${q(k())}`), 'já está desativado');
  assert.ok(rpc(P.G, 'definir_produto_ativo', `${q(prod.caneta.id)}, true, ${pv()}, ${q(k())}`).ok);
  // Leituras com e sem custo.
  const hist = como(P.V, `SELECT count(*) || ':' || count(custo_centavos) FROM public.historico_movimentacoes(${q(A)}, NULL, 500)`);
  assert.ok(hist.ok, hist.erro);
  assert.match(hist.saida, /^\d+:0$/);
  assert.ok(Number(como(P.O, `SELECT count(custo_centavos) FROM public.historico_movimentacoes(${q(A)})`).saida) >= 1);
  const props = obj(P.V, `public.propostas_da_empresa(${q(A)}, NULL)`);
  assert.ok(props.length >= 3 && props.every((x) => x.itens.every((i) => !('custo_centavos' in i))));
  const compras = obj(P.O, `public.compras_da_empresa(${q(A)})`);
  assert.ok(compras.some((c) => c.custo_total_centavos === 4300));
  assert.equal(obj(P.V, `public.compras_da_empresa(${q(A)})`).some((c) => 'custo_total_centavos' in c), false);
  // Fornecedor alterado e desativado; compra em rascunho cancelada pelo autor.
  const fv = Number(adm(`SELECT versao FROM public.fornecedores WHERE id = ${q(prod.fornecedor)}`));
  assert.ok(rpc(P.G, 'alterar_fornecedor', `${q(prod.fornecedor)}, ${j({ email: 'Vendas@Fornecedor.example', ativo: false })}, ${fv}, ${q(k())}`).ok);
  assert.equal(adm(`SELECT email || ':' || ativo FROM public.fornecedores WHERE id = ${q(prod.fornecedor)}`), 'vendas@fornecedor.example:false');
  falha(rpc(P.G, 'criar_compra', `${q(A)}, ${j({ fornecedor_id: prod.fornecedor })}, ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, ${q(k())}`), 'Fornecedor não encontrado');
  const rasc = JSON.parse(rpc(P.G, 'criar_compra', `${q(A)}, ${j({ numero_documento: 'Pedido 77' })}, ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, ${q(k())}`).saida);
  falha(rpc(P.G, 'cancelar_compra', `${q(rasc.id)}, 'x', 1, ${q(k())}`), '3 a 300');
  assert.ok(rpc(P.G, 'cancelar_compra', `${q(rasc.id)}, 'Pedido desistido', 1, ${q(k())}`).ok);
  // Compra registrada sem aprovação: cancelamento cancela também a proposta pendente.
  const reg = JSON.parse(rpc(P.E, 'criar_compra', `${q(A)}, ${j({})}, ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, ${q(k())}`).saida);
  const r2 = JSON.parse(rpc(P.E, 'registrar_compra', `${q(reg.id)}, 1, ${q(k())}`).saida);
  assert.ok(rpc(P.G, 'cancelar_compra', `${q(reg.id)}, 'Entrega não veio', 2, ${q(k())}`).ok);
  assert.equal(adm(`SELECT estado FROM public.propostas_movimentacao WHERE id = ${q(r2.proposta.proposta_id)}`), 'cancelada');
  const pend = JSON.parse(rpc(P.E, 'propor_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, NULL, ${q(k())}`).saida);
  falha(rpc(P.G, 'decidir_proposta_sem_aplicar', `${q(pend.proposta_id)}, 'rejeitar', NULL, 1, ${q(k())}`), '3 a 300');
  assert.ok(rpc(P.G, 'decidir_proposta_sem_aplicar', `${q(pend.proposta_id)}, 'rejeitar', 'Quantidade não confere', 1, ${q(k())}`).ok);
});

test('revogação imediata: estoquista desligado perde acesso na hora (M04)', opcoes, () => {
  const membro = adm(`SELECT id FROM public.membros_empresa WHERE empresa_id = ${q(A)} AND auth_user_id = ${q(P.E.id)} AND estado = 'ativo'`);
  assert.ok(como(P.O, `SELECT public.desligar_membro(${q(membro)}, 'Fim do teste', ${q(k())})`).ok);
  falha(rpc(P.E, 'propor_movimentacao', `${q(A)}, 'entrada', ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, NULL, ${q(k())}`), 'TENANT_FORBIDDEN');
  assert.equal(como(P.E, `SELECT count(*) FROM public.produtos WHERE empresa_id = ${q(A)}`).saida, '0');
});

test('reconciliação: saldo = histórico e reservado = reservas ativas; só o proprietário consulta (FIN-P6)', opcoes, () => {
  assert.equal(como(P.O, `SELECT count(*) FROM public.reconciliar_estoque(${q(A)})`).saida, '0');
  falha(como(P.G, `SELECT count(*) FROM public.reconciliar_estoque(${q(A)})`), 'proprietário');
  assert.equal(adm(`SELECT count(*) FROM app_private.divergencias_estoque(${q(B)})`), '0');
});

test('D-07: identidade vazia em qualquer leitura do M05 vira AUTH_REQUIRED, nunca lista vazia (leitura incorreta)', opcoes, () => {
  // Pré-condição: há linhas em todas as tabelas; uma lista vazia aqui seria uma leitura enganosa.
  for (const tabela of ['produtos', 'produto_variacoes', 'saldos_estoque', 'movimentacoes_estoque', 'propostas_movimentacao', 'proposta_itens',
    'reservas_estoque', 'compras_fornecedor', 'compra_itens', 'historico_precos', 'eventos_estoque', 'fornecedores']) {
    assert.ok(Number(adm(`SELECT count(*) FROM public.${tabela}`)) > 0, `${tabela} sem linhas`);
    const colunas = tabela === 'produto_variacoes' ? 'id' : tabela.endsWith('itens') ? 'variacao_id' : tabela === 'saldos_estoque' ? 'variacao_id' : 'id';
    falha(comoPapel(banco.url, { sub: null }, `SELECT ${colunas} FROM public.${tabela}`), 'Sessão ausente');
  }
  for (const leitura of [`public.produtos_da_empresa(${q(A)})`, `public.alertas_estoque(${q(A)})`, `public.historico_movimentacoes(${q(A)})`,
    `public.propostas_da_empresa(${q(A)}, NULL)`, `public.compras_da_empresa(${q(A)})`, `public.custos_da_variacao(${q(prod.camG)})`,
    `public.reconciliar_estoque(${q(A)})`]) {
    falha(comoPapel(banco.url, { sub: null }, `SELECT * FROM ${leitura}`), 'Sessão ausente');
  }
  // E nenhuma gravação passa sem identidade.
  falha(comoPapel(banco.url, { sub: null }, `SELECT public.registrar_movimentacao(${q(A)}, 'entrada', ${j([{ variacao_id: prod.camG, quantidade: 1 }])}, NULL, ${q(k())})`), 'Sessão ausente');
});

test('rollback e reaplicação da 202611010008', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010008_produtos_estoque.down.sql');
  assert.equal(adm("SELECT to_regclass('public.produtos') IS NULL"), 't');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '48');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010008_produtos_estoque.sql');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '50');
});
