/**
 * Testes de banco do M13b (migration 202611180001; ADR-G13b D13b-09 = A e D13b-10 = A).
 * - painel_empresa: uma leitura; cada bloco só com a permissão correspondente; outra empresa e cliente negados; valores reais.
 * - Marcador de novas mensagens: conta só o outro lado, depois do "lido até" da própria pessoa; respeita a regra de leitura
 *   da conversa; marcar como lido nunca volta no tempo nem vai para o futuro; ninguém marca conversa alheia.
 * - Privilégios: tabela fechada; nenhuma função para o anônimo; rollback sem resíduo.
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

const ID = (n) => `eb130000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m13b@teste.example', nome: 'Dona Olga', tipo: 'business' },
  C1: { id: ID(2), email: 'cliente-m13b@teste.example', nome: 'Cliente Cida', tipo: 'cliente' },
  C2: { id: ID(3), email: 'cliente2-m13b@teste.example', nome: 'Cliente Rui', tipo: 'cliente' },
  ORC: { id: ID(4), email: 'orc-m13b@teste.example', nome: 'Orçamentista', tipo: 'business' },
  TEC: { id: ID(5), email: 'tec-m13b@teste.example', nome: 'Técnico', tipo: 'business' },
  PED: { id: ID(6), email: 'ped-m13b@teste.example', nome: 'Pedidos', tipo: 'business' },
  FIN: { id: ID(7), email: 'fin-m13b@teste.example', nome: 'Financeiro', tipo: 'business' },
  EST: { id: ID(8), email: 'est-m13b@teste.example', nome: 'Estoque', tipo: 'business' },
  OUT: { id: ID(9), email: 'outra-m13b@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  CK: { id: ID(10), email: 'ck-m13b@teste.example', nome: 'Admin CK', tipo: null },
};
let chave = 0;
const k = () => `m13b-teste-${String(++chave).padStart(4, '0')}`;
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
const enviar = (p, tipo, id, texto) => ok(p, 'enviar_mensagem', `${q(tipo)}, ${q(id)}, ${q(texto)}, ${q(k())}`);
const novas = (p, emp = null) => ok(p, 'mensagens_novas', emp ? q(emp) : '');
const painel = (p, emp) => ok(p, 'painel_empresa', q(emp));

const E = {};
const R = {};

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    if (p.tipo) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste M13b')`);
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', bairro: 'Cambuí', uf: 'SP', email_contato: 'privado-m13b@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Olga');
  E.b = nova(P.OUT, 'Outra Costura');
  ok(P.O, 'enviar_vitrine_para_analise', `${q(E.a)}, ${versao('empresas', E.a)}, ${q(k())}`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.a)} AND estado = 'aberta'`))}, 'aprovar', NULL, NULL, ${q(k())}`);
  // Serviço com orçamento automático: uma solicitação fica aberta; outra é aceita e vira OS.
  const s = ok(P.O, 'criar_servico', `${q(E.a)}, ${j({ nome: 'Barra de calça', politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  ok(P.O, 'salvar_formulario_servico', `${q(s.id)}, ${j([{ texto: 'Peças', tipo: 'numero', obrigatoria: true, configuracao: { minimo: 1, maximo: 20 } }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  const perg = adm(`SELECT id FROM public.servico_perguntas WHERE servico_id = ${q(s.id)} AND ativa`);
  ok(P.O, 'salvar_regras_servico', `${q(s.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: perg, rotulo: 'Por peça', valor_unitario_centavos: 2500 }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  ok(P.O, 'definir_vitrine_servico', `${q(s.id)}, true, ${versao('servicos', s.id)}, ${q(k())}`);
  R.solAberta = ok(P.C1, 'criar_solicitacao', `${q(s.id)}, ${j({ respostas: { [perg]: 2 }, relato: 'Duas calças.' })}, ${q(k())}`).id;
  R.solOs = ok(P.C1, 'criar_solicitacao', `${q(s.id)}, ${j({ respostas: { [perg]: 3 }, relato: 'Três calças.' })}, ${q(k())}`).id;
  ok(P.C1, 'aceitar_orcamento', `${q(R.solOs)}, ${q(adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(R.solOs)}`))}, true, ${q(k())}`);
  R.os = adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(R.solOs)}`);
  // Produto público com estoque mínimo acima do disponível; um pedido do cliente fica aguardando aceite.
  R.prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Linha preta', finalidade: 'comercializavel', preco_centavos: 1000, quantidade_inicial: 3, estoque_minimo: 10 })}, NULL, ${q(k())}`).id;
  ok(P.O, 'definir_vitrine_produto', `${q(R.prod)}, true, ${versao('produtos', R.prod)}, ${q(k())}`);
  R.pedido = ok(P.C1, 'criar_pedido', `${q(E.a)}, ${j([{ variacao_id: variacao(R.prod), quantidade: 1 }])}, NULL, ${q(k())}`).id;
  // Uma venda confirmada no mês (R$ 20,00) com o valor a receber em aberto.
  ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: variacao(R.prod), quantidade: 2 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  // Equipe com uma permissão de leitura cada
  const perfil = (nome, perms) => ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())}`).id;
  const perfis = { ORC: ['orcamentos.visualizar'], TEC: ['servicos.visualizar'], PED: ['pedidos.visualizar'], FIN: ['financeiro.visualizar'], EST: ['estoque.visualizar'] };
  for (const [nome, perms] of Object.entries(perfis)) {
    const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P[nome].email)}, ${q(perfil(`Perfil ${nome}`, perms))}, ${q(k())}`);
    assert.ok(comoPapel(banco.url, { sub: P[nome].id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
  }
  // Conversa: cliente escreve na solicitação aberta (2), na OS (1) e no pedido (1); a empresa escreve uma vez na solicitação.
  enviar(P.C1, 'solicitacao', R.solAberta, 'Posso levar amanhã?');
  enviar(P.C1, 'solicitacao', R.solAberta, 'São calças de linho.');
  enviar(P.C1, 'os', R.os, 'Obrigada pelo aceite!');
  enviar(P.C1, 'pedido', R.pedido, 'Retiro no sábado.');
  enviar(P.O, 'solicitacao', R.solAberta, 'Pode trazer, sim.');
});
after(() => banco?.encerrar());

test('painel_empresa: proprietária vê todos os blocos com valores reais', opcoes, () => {
  const p = painel(P.O, E.a);
  assert.equal(p.empresa.nome_publico, 'Costura da Olga');
  assert.equal(p.pedidos.aguardando, 1);
  assert.equal(p.pedidos.ultimos[0].total_estimado_centavos, 1000);
  // Orçamento automático já nasce enviado: "para responder" conta só nova, em análise e revisão pedida.
  assert.equal(p.orcamentos.abertas, Number(adm(`SELECT count(*) FROM public.solicitacoes_servico WHERE empresa_id = ${q(E.a)} AND estado IN ('nova', 'em_analise', 'revisao_pedida')`)));
  assert.equal(adm(`SELECT estado FROM public.solicitacoes_servico WHERE id = ${q(R.solAberta)}`), 'orcamento_enviado');
  assert.equal(p.ordens.em_andamento, 1);
  assert.equal(p.vendas.quantidade, 1);
  assert.equal(p.vendas.total_centavos, 2000);
  assert.equal(p.vendas.semanas.length, 4);
  assert.equal(p.vendas.semanas.reduce((a, b) => a + b, 0), 2000);
  assert.equal(p.financeiro.receber_7_dias.valor_centavos, 2000);
  assert.equal(typeof p.financeiro.saldo_contas_centavos, 'number');
  assert.equal(p.estoque.abaixo_do_minimo, 1);
  assert.deepEqual({ produto: p.estoque.itens[0].produto, minimo: p.estoque.itens[0].minimo }, { produto: 'Linha preta', minimo: 10 });
  assert.ok(Array.isArray(p.agenda_hoje));
  assert.equal(p.mensagens.total, 4, 'só as do cliente: 2 na solicitação, 1 na OS, 1 no pedido');
});

test('painel_empresa: cada bloco só aparece com a permissão correspondente', opcoes, () => {
  const blocos = (p) => ['pedidos', 'orcamentos', 'ordens', 'vendas', 'financeiro', 'estoque', 'agenda_hoje', 'mensagens'].filter((b) => p[b] !== null);
  assert.deepEqual(blocos(painel(P.ORC, E.a)), ['orcamentos', 'mensagens']);
  assert.deepEqual(blocos(painel(P.TEC, E.a)), ['ordens', 'mensagens']);
  assert.deepEqual(blocos(painel(P.PED, E.a)), ['pedidos', 'mensagens']);
  assert.deepEqual(blocos(painel(P.FIN, E.a)), ['financeiro']);
  assert.deepEqual(blocos(painel(P.EST, E.a)), ['estoque']);
  falha(rpc(P.OUT, 'painel_empresa', q(E.a)), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.C1, 'painel_empresa', q(E.a)), 'TENANT_FORBIDDEN|acesso');
  assert.equal(painel(P.OUT, E.b).pedidos.aguardando, 0, 'empresa sem dados: zeros, nada de exemplo');
});

test('mensagens novas: conta o outro lado, por pessoa, respeitando a regra de leitura da conversa', opcoes, () => {
  const cli = novas(P.C1);
  assert.equal(cli.total, 1, 'para a cliente, só a resposta da empresa');
  assert.equal(cli.conversas[0].tipo, 'solicitacao');
  assert.equal(cli.conversas[0].empresa, 'Costura da Olga');
  assert.equal(novas(P.ORC, E.a).total, 3, 'orçamentos lê solicitação e OS: 2 + 1');
  assert.equal(novas(P.TEC, E.a).total, 1, 'serviços lê só a OS, desde o aceite');
  assert.equal(novas(P.PED, E.a).total, 1, 'pedidos lê só o pedido');
  assert.equal(novas(P.C2).total, 0);
  falha(rpc(P.OUT, 'mensagens_novas', q(E.a)), 'TENANT_FORBIDDEN|acesso');
  assert.equal(novas(P.FIN, E.a).total, 0, 'quem não lê nenhuma conversa vê zero');
});

test('marcar como lida: só para quem participa, por pessoa, sem voltar no tempo nem ir ao futuro', opcoes, () => {
  // Marcar a OS marca a conversa da solicitação de origem (é a mesma conversa)
  const r = ok(P.ORC, 'marcar_conversa_lida', `'os', ${q(R.os)}, NULL`);
  assert.equal(r.tipo, 'solicitacao');
  assert.equal(r.id, R.solOs);
  assert.equal(novas(P.ORC, E.a).total, 2);
  assert.equal(novas(P.O, E.a).total, 4, 'a leitura de uma pessoa não marca para a outra');
  ok(P.ORC, 'marcar_conversa_lida', `'solicitacao', ${q(R.solAberta)}, NULL`);
  assert.equal(novas(P.ORC, E.a).total, 0);
  const antes = adm(`SELECT lido_ate FROM public.leituras_conversa WHERE auth_user_id = ${q(P.ORC.id)} AND conversa_id = ${q(R.solAberta)}`);
  ok(P.ORC, 'marcar_conversa_lida', `'solicitacao', ${q(R.solAberta)}, '2020-01-01T00:00:00Z'`);
  assert.equal(adm(`SELECT lido_ate FROM public.leituras_conversa WHERE auth_user_id = ${q(P.ORC.id)} AND conversa_id = ${q(R.solAberta)}`), antes, 'não volta no tempo');
  const futuro = ok(P.PED, 'marcar_conversa_lida', `'pedido', ${q(R.pedido)}, '2099-01-01T00:00:00Z'`);
  assert.ok(new Date(futuro.lido_ate) <= new Date(Date.now() + 60000), 'nunca no futuro');
  // Nova mensagem depois da leitura volta a aparecer
  enviar(P.C1, 'solicitacao', R.solAberta, 'Chego às 10h.');
  assert.equal(novas(P.ORC, E.a).total, 1);
  falha(rpc(P.FIN, 'marcar_conversa_lida', `'solicitacao', ${q(R.solAberta)}, NULL`), 'FORBIDDEN_ACTION|conversa');
  falha(rpc(P.C2, 'marcar_conversa_lida', `'pedido', ${q(R.pedido)}, NULL`), 'NOT_FOUND|não encontrado');
  falha(rpc(P.OUT, 'marcar_conversa_lida', `'solicitacao', ${q(R.solAberta)}, NULL`), 'NOT_FOUND|não encontrado');
});

test('privilégios: tabela fechada, nenhuma função nova para o anônimo além das leituras da vitrine, nenhuma permissão nova', opcoes, () => {
  falha(comoPapel(banco.url, { sub: P.O.id }, 'SELECT count(*) FROM public.leituras_conversa'), 'permission denied|permissão');
  assert.equal(adm(`SELECT has_function_privilege('anonymous', 'public.painel_empresa(uuid)', 'EXECUTE')`), 'f');
  assert.equal(adm(`SELECT has_function_privilege('anonymous', 'public.mensagens_novas(uuid)', 'EXECUTE')`), 'f');
  assert.equal(adm(`SELECT has_function_privilege('anonymous', 'public.marcar_conversa_lida(text, uuid, timestamptz)', 'EXECUTE')`), 'f');
  assert.equal(adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'EXECUTE')`), 'buscar_vitrine,filtros_vitrine,flags_ativas,imagens_publicas_de_produtos,logos_publicos,vitrine_publica' /* flags_ativas (202612010002): só liga/desliga de recursos da plataforma */ /* + leituras públicas de logos e imagens do E03 */);
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55');
});
