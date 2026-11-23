/**
 * Testes de banco do M13 (migration 202611170002, D13-10 = A): registro do formato do exportado na auditoria.
 * - CSV (M07) passa a registrar 'formato': 'csv'.
 * - PDF: `registrar_exportacao_pdf` confere a permissão do relatório ou do registro de origem e grava só o fato.
 * - Registro de outra empresa ou inexistente: NOT_FOUND; sem permissão: negado; nenhum conteúdo do documento no banco.
 * PostgreSQL LOCAL com emulação do Neon; banco descartável.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();

const ID = (n) => `ec130000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m13@teste.example', nome: 'Dona Olga', tipo: 'business' },
  C1: { id: ID(2), email: 'cliente-m13@teste.example', nome: 'Cliente Cida', tipo: 'cliente' },
  FV: { id: ID(3), email: 'fin-ver-m13@teste.example', nome: 'Fin Só Ver', tipo: 'business' },
  FX: { id: ID(4), email: 'fin-exp-m13@teste.example', nome: 'Fin Exporta', tipo: 'business' },
  ORC: { id: ID(5), email: 'orc-m13@teste.example', nome: 'Orçamentista', tipo: 'business' },
  TEC: { id: ID(6), email: 'tec-m13@teste.example', nome: 'Técnico', tipo: 'business' },
  VEN: { id: ID(7), email: 'ven-m13@teste.example', nome: 'Vendedor', tipo: 'business' },
  OUT: { id: ID(8), email: 'outra-m13@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  CK: { id: ID(9), email: 'ck-m13@teste.example', nome: 'Admin CK', tipo: null },
};
let chave = 0;
const k = () => `m13-teste-${String(++chave).padStart(4, '0')}`;
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
const versao = (tabela, id) => Number(adm(`SELECT versao FROM public.${tabela} WHERE id = ${q(id)}`));
const variacao = (produto) => adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(produto)} ORDER BY padrao DESC, id LIMIT 1`);
const registrar = (p, emp, documento, ref = null, de = '2026-11-01', ate = '2026-11-17', chaveOp = k()) =>
  rpc(p, 'registrar_exportacao_pdf', `${q(emp)}, ${q(documento)}, ${q(ref)}, ${q(de)}, ${q(ate)}, ${q(chaveOp)}`);
const eventos = (acao, onde = 'true') => JSON.parse(adm(`SELECT coalesce(jsonb_agg(dados_minimizados ORDER BY criado_em), '[]') FROM app_private.eventos_auditoria WHERE tipo_acao = ${q(acao)} AND ${onde}`));

const E = {};
const R = {};

function empresa(dono, nome) {
  return ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', bairro: 'Cambuí', uf: 'SP', email_contato: 'privado-m13@teste.example' })}, ${q(k())}`).id;
}

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    if (p.tipo) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste M13')`);
  E.a = empresa(P.O, 'Costura da Olga');
  E.b = empresa(P.OUT, 'Outra Costura');
  ok(P.O, 'enviar_vitrine_para_analise', `${q(E.a)}, ${versao('empresas', E.a)}, ${q(k())}`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.a)} AND estado = 'aberta'`))}, 'aprovar', NULL, NULL, ${q(k())}`);
  // Serviço com orçamento automático: a solicitação do cliente já nasce com orçamento; o aceite cria a OS.
  const s = ok(P.O, 'criar_servico', `${q(E.a)}, ${j({ nome: 'Barra de calça', politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  ok(P.O, 'salvar_formulario_servico', `${q(s.id)}, ${j([{ texto: 'Peças', tipo: 'numero', obrigatoria: true, configuracao: { minimo: 1, maximo: 20 } }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  const perg = adm(`SELECT id FROM public.servico_perguntas WHERE servico_id = ${q(s.id)} AND ativa`);
  ok(P.O, 'salvar_regras_servico', `${q(s.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: perg, rotulo: 'Por peça', valor_unitario_centavos: 2500 }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  ok(P.O, 'definir_vitrine_servico', `${q(s.id)}, true, ${versao('servicos', s.id)}, ${q(k())}`);
  const sol = ok(P.C1, 'criar_solicitacao', `${q(s.id)}, ${j({ respostas: { [perg]: 2 }, relato: 'Duas calças.' })}, ${q(k())}`);
  R.versaoEnviada = adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(sol.id)}`);
  const sol2 = ok(P.C1, 'criar_solicitacao', `${q(s.id)}, ${j({ respostas: { [perg]: 3 }, relato: 'Três calças.' })}, ${q(k())}`);
  R.versaoAceita = adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(sol2.id)}`);
  ok(P.C1, 'aceitar_orcamento', `${q(sol2.id)}, ${q(R.versaoAceita)}, true, ${q(k())}`);
  R.os = adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(sol2.id)}`);
  const prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Linha', finalidade: 'comercializavel', preco_centavos: 1000, quantidade_inicial: 20 })}, NULL, ${q(k())}`).id;
  R.venda = ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: variacao(prod), quantidade: 2 }])}, '{}'::jsonb, NULL, ${q(k())}`).id;
  const perfil = (nome, perms) => ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())}`).id;
  const perfis = { FV: perfil('Financeiro leitura', ['financeiro.visualizar']), FX: perfil('Financeiro exporta', ['financeiro.visualizar', 'financeiro.exportar']),
    ORC: perfil('Orçamentos', ['orcamentos.visualizar']), TEC: perfil('Técnico', ['servicos.visualizar']), VEN: perfil('Vendas', ['vendas.visualizar']) };
  for (const [nome, perfilId] of Object.entries(perfis)) {
    const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P[nome].email)}, ${q(perfilId)}, ${q(k())}`);
    assert.ok(comoPapel(banco.url, { sub: P[nome].id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
  }
});
after(() => banco?.encerrar());

test('relatórios financeiros em PDF: exigem ver e exportar o financeiro; o formato vai para a auditoria', opcoes, () => {
  for (const doc of ['relatorio_categorias', 'relatorio_contas', 'relatorio_vencimentos', 'relatorio_mensal', 'relatorio_conferencias']) {
    const r = registrar(P.FX, E.a, doc);
    assert.ok(r.ok, `${doc}: ${r.erro}`);
    assert.deepEqual(JSON.parse(r.saida), { registrado: true, documento: doc, formato: 'pdf' });
  }
  falha(registrar(P.FV, E.a, 'relatorio_categorias'), 'FORBIDDEN_ACTION|permiss');
  falha(registrar(P.TEC, E.a, 'relatorio_categorias'), 'FORBIDDEN_ACTION|permiss');
  falha(registrar(P.OUT, E.a, 'relatorio_categorias'), 'TENANT_FORBIDDEN|acesso');
  falha(registrar(P.C1, E.a, 'relatorio_categorias'), 'TENANT_FORBIDDEN|acesso');
  falha(registrar(P.FX, E.a, 'relatorio_categorias', null, '2026-11-17', '2026-11-01'), 'VALIDATION_ERROR|período');
  falha(registrar(P.FX, E.a, 'planilha_secreta'), 'VALIDATION_ERROR|desconhecido');
  const pdfs = eventos('financeiro.exportacao', `empresa_id = ${q(E.a)} AND dados_minimizados->>'formato' = 'pdf'`);
  assert.equal(pdfs.length, 5);
  assert.deepEqual(pdfs.map((e) => e.tipo).sort(), ['categorias', 'conferencias', 'contas', 'mensal', 'vencimentos']);
  for (const e of pdfs) assert.deepEqual(Object.keys(e).sort(), ['ate', 'de', 'formato', 'tipo'], 'só o fato, nenhum conteúdo');
});

test('CSV do M07 continua igual e passa a registrar o formato "csv"', opcoes, () => {
  const r = ok(P.FX, 'exportar_financeiro', `${q(E.a)}, 'lancamentos', '2026-11-01', '2026-11-17'`);
  assert.equal(r.tipo, 'lancamentos');
  const csv = eventos('financeiro.exportacao', `empresa_id = ${q(E.a)} AND dados_minimizados->>'formato' = 'csv'`);
  assert.equal(csv.length, 1);
  assert.equal(csv[0].tipo, 'lancamentos');
});

test('comprovantes: cada um com a permissão do registro de origem; só orçamento aceito; venda confirmada', opcoes, () => {
  assert.ok(registrar(P.ORC, E.a, 'orcamento', R.versaoAceita).ok);
  assert.ok(registrar(P.TEC, E.a, 'os', R.os).ok);
  assert.ok(registrar(P.VEN, E.a, 'venda', R.venda).ok);
  assert.ok(registrar(P.O, E.a, 'orcamento', R.versaoAceita).ok, 'a proprietária tem todas as permissões');
  falha(registrar(P.ORC, E.a, 'orcamento', R.versaoEnviada), 'STATE_CONFLICT|aceito');
  falha(registrar(P.TEC, E.a, 'orcamento', R.versaoAceita), 'FORBIDDEN_ACTION|permiss');
  falha(registrar(P.ORC, E.a, 'os', R.os), 'FORBIDDEN_ACTION|permiss');
  falha(registrar(P.TEC, E.a, 'venda', R.venda), 'FORBIDDEN_ACTION|permiss');
  falha(registrar(P.FX, E.a, 'venda', R.venda), 'FORBIDDEN_ACTION|permiss');
  const evs = eventos('documento.exportacao', `empresa_id = ${q(E.a)}`);
  assert.equal(evs.length, 4);
  for (const e of evs) {
    assert.equal(e.formato, 'pdf');
    assert.deepEqual(Object.keys(e).sort(), ['documento', 'formato', 'numero'], 'só o fato, nenhum conteúdo');
  }
});

test('outra empresa e registro inexistente: NOT_FOUND, sem revelar; o cliente não gera comprovante (D13-09)', opcoes, () => {
  falha(registrar(P.OUT, E.b, 'os', R.os), 'NOT_FOUND|Não encontramos');
  falha(registrar(P.OUT, E.b, 'venda', R.venda), 'NOT_FOUND|Não encontramos');
  falha(registrar(P.O, E.a, 'os', ID(99)), 'NOT_FOUND|Não encontramos');
  falha(registrar(P.C1, E.a, 'os', R.os), 'TENANT_FORBIDDEN|acesso');
  falha(registrar(P.C1, E.a, 'orcamento', R.versaoAceita), 'TENANT_FORBIDDEN|acesso');
});

test('repetição com a mesma chave não registra de novo; nenhuma tabela, permissão ou função anônima nova', opcoes, () => {
  const chaveOp = k();
  const antes = eventos('documento.exportacao').length;
  assert.ok(registrar(P.VEN, E.a, 'venda', R.venda, null, null, chaveOp).ok);
  assert.ok(registrar(P.VEN, E.a, 'venda', R.venda, null, null, chaveOp).ok);
  assert.equal(eventos('documento.exportacao').length, antes + 1);
  assert.equal(Number(adm('SELECT count(*) FROM public.permissoes_catalogo')), 55);
  const anon = adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'EXECUTE')`);
  assert.equal(anon, 'buscar_vitrine,filtros_vitrine,vitrine_publica');
  falha(comoPapel(banco.url, { papel: 'anonymous', sub: 'anon-m13' }, `SELECT public.registrar_exportacao_pdf(${q(E.a)}, 'os', ${q(R.os)}, NULL, NULL, ${q(k())})`), 'permission denied|negad');
});
