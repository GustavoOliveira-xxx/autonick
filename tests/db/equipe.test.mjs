/**
 * Testes de banco do M04 (migration 202611010006): equipe, convites, perfis de
 * permissão, multiempresa, revogação imediata e proteção contra autoelevação.
 * PostgreSQL LOCAL com emulação do Neon. Cenários de MINI-ESPEC_M04 §7,
 * FCT-010 a FCT-015, SEC-T05, SEC-T20, SEC-T21 e BDD-001 §6.5.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const M = ['202611010001_fundacao_identidade', '202611010002_correcao_identidade_sessao', '202611010003_empresas_ck',
  '202611010004_identidade_vazia_explicita', '202611010005_marcacao_dados_de_teste', '202611010006_equipe_permissoes'];

const ID = (n) => `e4000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dono@teste.example', nome: 'Dona Olga' },
  G: { id: ID(2), email: 'gerente@teste.example', nome: 'Gerente Gil' },
  E: { id: ID(3), email: 'estoque@teste.example', nome: 'Estoquista Eva' },
  F: { id: ID(4), email: 'multi@teste.example', nome: 'Fábio Multi' },
  X: { id: ID(5), email: 'outra@teste.example', nome: 'Xênia Outra Empresa' },
  U: { id: ID(6), email: 'naoconfirmado@teste.example', nome: 'Ugo', verificado: false },
  C: { id: ID(7), email: 'ck@teste.example', nome: 'Carla CK' },
};

let chave = 0;
const k = () => `equipe-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const arr = (lista) => (lista ? `ARRAY[${lista.map(q).join(',')}]::text[]` : 'NULL');
const como = (p, comando) => comoPapel(banco.url, { sub: p.id }, comando);
const adm = (comando) => { const r = sql(banco.url, comando); assert.ok(r.ok, r.erro); return r.saida; };
function obj(p, expressao) {
  const r = como(p, `SELECT (${expressao})::text`);
  assert.ok(r.ok, r.erro);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}

const criarPerfil = (p, empresa, nome, perms, chaveOp = k()) =>
  como(p, `SELECT public.criar_perfil_permissao(${q(empresa)}, ${q(nome)}, NULL, ${arr(perms)}, ${q(chaveOp)})::text`);
const convidar = (p, empresa, email, perfil, chaveOp = k()) =>
  como(p, `SELECT public.convidar_funcionario(${q(empresa)}, ${q(email)}, ${q(perfil)}, ${q(chaveOp)})::text`);
const aceitar = (p, convite, chaveOp = k()) => como(p, `SELECT public.aceitar_convite(${q(convite)}, ${q(chaveOp)})::text`);
const permissoes = (p, empresa) => obj(p, `public.minhas_permissoes(${q(empresa)})`).permissoes;
const membroDe = (p, empresa) => adm(`SELECT id FROM public.membros_empresa WHERE empresa_id = ${q(empresa)} AND auth_user_id = ${q(p.id)} AND estado = 'ativo'`);
const versaoMembro = (id) => Number(adm(`SELECT versao FROM public.membros_empresa WHERE id = ${q(id)}`));

let A; // empresa da Olga
let B; // empresa da Xênia
const perfis = {};
let todas;

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of M) aplicarArquivo(banco.url, `db/migrations_propostas/${m}.sql`);
  for (const p of Object.values(P)) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, ${p.verificado === false ? 'false' : 'true'})`);
  }
  for (const p of [P.O, P.X]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`);
  sql(banco.url, `SELECT app_private.conceder_ck_admin(${q(P.C.id)}, 'teste')`);
  const categoria = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'alimentacao'").saida;
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'ambos', categoria_id: categoria, cidade: 'Campinas', uf: 'SP',
    email_contato: 'privado@teste.example', documento: '12345678000199', endereco_privado: 'Rua Privada, 1' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('Empresa A')}'::jsonb, 'equipe-setup-0001')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('Empresa B')}'::jsonb, 'equipe-setup-0002')::text`).saida).id;
  todas = sql(banco.url, 'SELECT string_agg(codigo, \',\' ORDER BY codigo) FROM public.permissoes_catalogo').saida.split(',');
});
after(() => banco?.encerrar());

test('catálogo: 48 permissões por módulo e ação, nenhuma da CK; só usuário autenticado lê', opcoes, () => {
  assert.equal(todas.length, 48);
  assert.equal(todas.some((c) => /ck|admin/.test(c)), false);
  assert.equal(como(P.E, 'SELECT count(*) FROM public.permissoes_catalogo').saida, '48');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT count(*) FROM public.permissoes_catalogo'), 'permission denied');
});

test('proprietário cria perfis; validações e idempotência (RF-025, RF-026)', opcoes, () => {
  const chaveOp = k();
  const gerente = criarPerfil(P.O, A, 'Gerente', todas.filter((c) => c !== 'financeiro.fechar'), chaveOp);
  assert.ok(gerente.ok, gerente.erro);
  perfis.gerente = JSON.parse(gerente.saida);
  assert.equal(perfis.gerente.permissoes.length, 47);
  assert.equal(JSON.parse(criarPerfil(P.O, A, 'Gerente', todas.filter((c) => c !== 'financeiro.fechar'), chaveOp).saida).id, perfis.gerente.id);
  perfis.estoque = JSON.parse(criarPerfil(P.O, A, 'Estoque', ['produtos.visualizar', 'estoque.visualizar', 'estoque.propor', 'estoque.aprovar']).saida);
  perfis.vitrine = JSON.parse(criarPerfil(P.O, A, 'Vitrine', ['vitrine.visualizar', 'vitrine.alterar']).saida);
  perfis.financeiroTotal = JSON.parse(criarPerfil(P.O, A, 'Financeiro total', ['financeiro.visualizar', 'financeiro.fechar']).saida);
  falha(criarPerfil(P.O, A, 'Invasor', ['ck_admin.tudo']), 'Permissão desconhecida');
  falha(criarPerfil(P.O, A, 'Vazio', []), 'pelo menos uma permissão');
  falha(criarPerfil(P.O, A, 'gerente', ['vitrine.visualizar']), 'Já existe um perfil com esse nome');
  falha(criarPerfil(P.E, A, 'Intruso', ['vitrine.visualizar']), 'TENANT_FORBIDDEN');
  perfis.somenteVitrineB = JSON.parse(criarPerfil(P.X, B, 'Somente vitrine', ['vitrine.visualizar']).saida);
});

test('convites: validações, um pendente por e-mail e perfil só da própria empresa (RF-023)', opcoes, () => {
  falha(convidar(P.O, A, 'não-é-email', perfis.estoque.id), 'VALIDATION_ERROR');
  falha(convidar(P.O, A, P.E.email, perfis.somenteVitrineB.id), 'perfil de acesso ativo desta empresa');
  const r = convidar(P.O, A, P.E.email.toUpperCase(), perfis.estoque.id);
  assert.ok(r.ok, r.erro);
  assert.equal(JSON.parse(r.saida).email, P.E.email);
  falha(convidar(P.O, A, P.E.email, perfis.estoque.id), 'convite pendente');
  falha(convidar(P.O, A, P.O.email, perfis.estoque.id), 'já faz parte da equipe');
  falha(convidar(P.X, A, P.F.email, perfis.estoque.id), 'TENANT_FORBIDDEN');
  assert.ok(convidar(P.O, A, P.G.email, perfis.gerente.id).ok);
  assert.equal(adm(`SELECT count(*) FROM public.convites_empresa WHERE empresa_id = ${q(A)} AND estado = 'pendente'`), '2');
});

test('só o dono do e-mail confirmado vê e aceita o convite (D4-1, RF-024)', opcoes, () => {
  const meus = (p) => como(p, 'SELECT count(*) FROM public.meus_convites()').saida;
  assert.equal(meus(P.E), '1');
  assert.equal(meus(P.X), '0');
  const convite = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.E.email)} AND estado = 'pendente'`);
  falha(aceitar(P.X, convite), 'Convite não encontrado');
  sql(banco.url, `UPDATE neon_auth."user" SET "emailVerified" = false WHERE id = ${q(P.E.id)}`);
  falha(aceitar(P.E, convite), 'Confirme seu e-mail');
  sql(banco.url, `UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = ${q(P.E.id)}`);
  const chaveOp = k();
  const r = aceitar(P.E, convite, chaveOp);
  assert.ok(r.ok, r.erro);
  assert.equal(JSON.parse(r.saida).perfil_nome, 'Estoque');
  assert.equal(JSON.parse(aceitar(P.E, convite, chaveOp).saida).membro_id, JSON.parse(r.saida).membro_id);
  falha(aceitar(P.E, convite), 'não está mais disponível');
  assert.equal(adm(`SELECT tipo_conta FROM public.perfis_identidade WHERE auth_user_id = ${q(P.E.id)}`), 'business');
  assert.equal(adm(`SELECT nome FROM public.perfis_identidade WHERE auth_user_id = ${q(P.E.id)}`), P.E.nome);
  const conviteG = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.G.email)} AND estado = 'pendente'`);
  assert.ok(aceitar(P.G, conviteG).ok);
});

test('funcionário só faz o que o perfil permite, no banco (FCT-013, RF-031)', opcoes, () => {
  assert.deepEqual(permissoes(P.E, A), ['estoque.aprovar', 'estoque.propor', 'estoque.visualizar', 'produtos.visualizar']);
  falha(como(P.E, `SELECT public.empresa_dados_privados(${q(A)})`), 'FORBIDDEN_ACTION');
  falha(como(P.E, `SELECT documento FROM public.empresas WHERE id = ${q(A)}`), 'permission denied');
  assert.equal(como(P.E, `SELECT nome_publico FROM public.empresas WHERE id = ${q(A)}`).saida, 'Empresa A');
  falha(como(P.E, `SELECT public.atualizar_empresa(${q(A)}, '{"nome_publico":"Invadida"}'::jsonb, 1, ${q(k())})`), 'FORBIDDEN_ACTION');
  falha(como(P.E, `SELECT public.enviar_vitrine_para_analise(${q(A)}, 1, ${q(k())})`), 'FORBIDDEN_ACTION');
  falha(como(P.E, `SELECT * FROM public.equipe_membros(${q(A)})`), 'FORBIDDEN_ACTION');
  assert.equal(como(P.E, `SELECT count(*) FROM public.membros_empresa WHERE empresa_id = ${q(A)}`).saida, '1');
  assert.equal(como(P.E, 'SELECT count(*) FROM public.perfis_permissao').saida, '0');
  assert.equal(como(P.E, 'SELECT count(*) FROM public.convites_empresa').saida, '0');
  falha(convidar(P.E, A, 'alguem@teste.example', perfis.estoque.id), 'FORBIDDEN_ACTION');
  assert.equal(como(P.E, 'SELECT count(*) FROM public.solicitacoes_publicacao').saida, '0');
});

test('isolamento entre empresas: nada de A aparece para quem é só de B (FCT-011, DBT-001)', opcoes, () => {
  assert.equal(como(P.X, `SELECT count(*) FROM public.empresas WHERE id = ${q(A)}`).saida, '0');
  assert.equal(como(P.X, `SELECT count(*) FROM public.membros_empresa WHERE empresa_id = ${q(A)}`).saida, '0');
  assert.equal(como(P.X, `SELECT count(*) FROM public.perfis_permissao WHERE empresa_id = ${q(A)}`).saida, '0');
  falha(como(P.X, `SELECT public.minhas_permissoes(${q(A)})`), 'TENANT_FORBIDDEN');
  falha(como(P.X, `SELECT * FROM public.equipe_membros(${q(A)})`), 'TENANT_FORBIDDEN');
  falha(como(P.X, `SELECT public.desligar_membro(${q(membroDe(P.E, A))}, NULL, ${q(k())})`), 'TENANT_FORBIDDEN');
  falha(como(P.E, `SELECT public.minhas_permissoes(${q(B)})`), 'TENANT_FORBIDDEN');
});

test('gestor designado não se autoeleva nem ultrapassa as próprias permissões (D4-2, SEC-T05, RF-032)', opcoes, () => {
  assert.equal(permissoes(P.G, A).includes('financeiro.fechar'), false);
  falha(criarPerfil(P.G, A, 'Atalho', ['financeiro.fechar']), 'que você mesmo tem');
  falha(como(P.G, `SELECT public.alterar_perfil_permissao(${q(perfis.gerente.id)}, 'Gerente', NULL, ${arr(todas)}, 1, ${q(k())})`), 'perfil que você mesmo usa');
  falha(como(P.G, `SELECT public.alterar_perfil_do_membro(${q(membroDe(P.G, A))}, ${q(perfis.financeiroTotal.id)}, 1, ${q(k())})`), 'seu próprio acesso');
  falha(como(P.G, `SELECT public.alterar_perfil_do_membro(${q(membroDe(P.E, A))}, ${q(perfis.financeiroTotal.id)}, ${versaoMembro(membroDe(P.E, A))}, ${q(k())})`), 'que você mesmo tem');
  falha(convidar(P.G, A, 'novo@teste.example', perfis.financeiroTotal.id), 'que você mesmo tem');
  falha(como(P.G, `SELECT public.desligar_membro(${q(membroDe(P.O, A))}, NULL, ${q(k())})`), 'proprietário não pode ser desligado');
  falha(como(P.G, `SELECT public.alterar_perfil_permissao(${q(perfis.financeiroTotal.id)}, 'Financeiro total', NULL, ARRAY['financeiro.visualizar'], 1, ${q(k())})`), 'que você mesmo tem');
  falha(como(P.G, `SELECT app_private.conceder_ck_admin(${q(P.G.id)}, 'eu')`), 'permission denied');
  assert.equal(como(P.G, 'SELECT public.sou_ck_admin()').saida, 'f');
  // Dentro das próprias permissões, o gestor designado administra normalmente.
  assert.ok(convidar(P.G, A, P.F.email, perfis.estoque.id).ok);
  assert.equal(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao LIKE 'equipe.%'`) > '0', true);
});

test('manipulação direta das tabelas de permissão é negada (SEC-T05)', opcoes, () => {
  falha(como(P.E, `INSERT INTO public.perfil_permissoes (perfil_id, codigo) VALUES (${q(perfis.estoque.id)}, 'financeiro.fechar')`), 'permission denied');
  falha(como(P.E, `UPDATE public.membros_empresa SET perfil_permissao_id = ${q(perfis.gerente.id)} WHERE auth_user_id = ${q(P.E.id)}`), 'permission denied');
  falha(como(P.E, `INSERT INTO public.membros_empresa (empresa_id, auth_user_id, papel) VALUES (${q(B)}, ${q(P.E.id)}, 'proprietario')`), 'permission denied');
  falha(como(P.G, `INSERT INTO public.convites_empresa (empresa_id, email, perfil_permissao_id, criado_por) VALUES (${q(A)}, 'x@teste.example', ${q(perfis.gerente.id)}, 'x')`), 'permission denied');
  falha(como(P.O, `DELETE FROM public.eventos_equipe WHERE empresa_id = ${q(A)}`), 'permission denied');
  falha(como(P.O, `INSERT INTO public.permissoes_catalogo VALUES ('ck.tudo', 'ck', 'CK', 'tudo', 'Tudo', 'x', true, 1)`), 'permission denied');
  assert.equal(sql(banco.url, `DELETE FROM public.eventos_equipe WHERE empresa_id = ${q(A)}`).ok, false);
  assert.deepEqual(permissoes(P.E, A), ['estoque.aprovar', 'estoque.propor', 'estoque.visualizar', 'produtos.visualizar']);
});

test('mesma pessoa com permissões independentes em duas empresas (FCT-014, RF-028)', opcoes, () => {
  const emA = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.F.email)} AND empresa_id = ${q(A)} AND estado = 'pendente'`);
  assert.ok(aceitar(P.F, emA).ok);
  assert.ok(convidar(P.X, B, P.F.email, perfis.somenteVitrineB.id).ok);
  const emB = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.F.email)} AND empresa_id = ${q(B)} AND estado = 'pendente'`);
  assert.ok(aceitar(P.F, emB).ok);
  assert.deepEqual(permissoes(P.F, A), ['estoque.aprovar', 'estoque.propor', 'estoque.visualizar', 'produtos.visualizar']);
  assert.deepEqual(permissoes(P.F, B), ['vitrine.visualizar']);
  assert.equal(como(P.F, 'SELECT count(*) FROM public.minhas_empresas()').saida, '2');
  falha(como(P.F, `SELECT public.atualizar_empresa(${q(B)}, '{"descricao_publica":"Mudou"}'::jsonb, 1, ${q(k())})`), 'FORBIDDEN_ACTION');
  assert.equal(como(P.F, `SELECT count(*) FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(A)}`).saida, '0');
});

test('troca de perfil e alteração do perfil valem na hora', opcoes, () => {
  const e = membroDe(P.E, A);
  assert.ok(como(P.O, `SELECT public.alterar_perfil_do_membro(${q(e)}, ${q(perfis.vitrine.id)}, ${versaoMembro(e)}, ${q(k())})`).ok);
  assert.deepEqual(permissoes(P.E, A), ['vitrine.alterar', 'vitrine.visualizar']);
  assert.ok(como(P.O, `SELECT public.alterar_perfil_permissao(${q(perfis.vitrine.id)}, 'Vitrine', NULL, ARRAY['vitrine.visualizar'], 1, ${q(k())})`).ok);
  assert.deepEqual(permissoes(P.E, A), ['vitrine.visualizar']);
  falha(como(P.O, `SELECT public.alterar_perfil_permissao(${q(perfis.vitrine.id)}, 'Vitrine', NULL, ARRAY['vitrine.visualizar'], 1, ${q(k())})`), 'VERSION_CONFLICT');
});

test('alterações simultâneas: uma vence, a outra recebe conflito de versão', opcoes, async () => {
  const f = membroDe(P.F, A);
  const versao = versaoMembro(f);
  const sessao = (perfil, espera) => new Promise((resolver) => {
    const bloco = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${P.O.id}","role":"authenticated"}', true) \\gset
SELECT public.alterar_perfil_do_membro('${f}', '${perfil}', ${versao}, '${k()}');
SELECT pg_sleep(${espera});
COMMIT;`;
    const p = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', banco.url]);
    let erro = '';
    p.stderr.on('data', (d) => { erro += d; });
    p.on('close', (codigo) => resolver({ ok: codigo === 0, erro }));
    p.stdin.end(bloco);
  });
  const primeira = sessao(perfis.vitrine.id, 1.0);
  await new Promise((r) => setTimeout(r, 300));
  const [a, b] = await Promise.all([primeira, sessao(perfis.gerente.id, 0)]);
  assert.ok(a.ok, a.erro);
  falha(b, 'VERSION_CONFLICT');
  assert.equal(adm(`SELECT perfil_permissao_id FROM public.membros_empresa WHERE id = ${q(f)}`), perfis.vitrine.id);
});

test('desligamento: acesso cai na próxima requisição e o histórico fica (FCT-015, RF-029, RF-030)', opcoes, () => {
  const g = membroDe(P.G, A);
  const versao = Number(adm(`SELECT versao FROM public.empresas WHERE id = ${q(A)}`));
  assert.ok(como(P.G, `SELECT public.atualizar_empresa(${q(A)}, '{"descricao_publica":"Feito pelo gerente"}'::jsonb, ${versao}, ${q(k())})`).ok);
  assert.ok(como(P.O, `SELECT public.desligar_membro(${q(g)}, 'Fim do contrato', ${q(k())})`).ok);
  // Mesmo "JWT" (mesmo sub e papel) da sessão anterior: nada mais passa.
  falha(como(P.G, `SELECT public.minhas_permissoes(${q(A)})`), 'TENANT_FORBIDDEN');
  falha(como(P.G, `SELECT public.atualizar_empresa(${q(A)}, '{"descricao_publica":"De novo"}'::jsonb, ${versao + 1}, ${q(k())})`), 'TENANT_FORBIDDEN');
  falha(convidar(P.G, A, 'depois@teste.example', perfis.estoque.id), 'TENANT_FORBIDDEN');
  assert.equal(como(P.G, `SELECT count(*) FROM public.empresas WHERE id = ${q(A)}`).saida, '0');
  assert.equal(como(P.G, 'SELECT count(*) FROM public.eventos_equipe').saida, '0');
  const historico = como(P.O, `SELECT count(*) FROM public.equipe_historico(${q(A)}) WHERE ator_nome = ${q(P.G.nome)}`);
  assert.ok(Number(historico.saida) >= 1, historico.erro);
  assert.equal(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE empresa_id = ${q(A)} AND ator_auth_id = ${q(P.G.id)} AND tipo_acao = 'empresa.alterada'`), '1');
  falha(como(P.O, `SELECT public.desligar_membro(${q(g)}, NULL, ${q(k())})`), 'já foi encerrado');
  const lista = como(P.O, `SELECT estado || ':' || coalesce(motivo_encerramento, '') FROM public.equipe_membros(${q(A)}) WHERE nome = ${q(P.G.nome)}`);
  assert.equal(lista.saida, 'encerrado:desligado');
});

test('saída voluntária (D4-4) e proprietário não sai', opcoes, () => {
  assert.ok(como(P.F, `SELECT public.sair_da_empresa(${q(B)}, ${q(k())})`).ok);
  falha(como(P.F, `SELECT public.minhas_permissoes(${q(B)})`), 'TENANT_FORBIDDEN');
  assert.equal(como(P.F, 'SELECT count(*) FROM public.minhas_empresas()').saida, '1');
  falha(como(P.O, `SELECT public.sair_da_empresa(${q(A)}, ${q(k())})`), 'proprietário não pode sair');
});

test('convite expirado, cancelado e recusado; reconvite depois do desligamento', opcoes, () => {
  assert.ok(convidar(P.O, A, P.G.email, perfis.estoque.id).ok);
  const c1 = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.G.email)} AND estado = 'pendente'`);
  sql(banco.url, `UPDATE public.convites_empresa SET expira_em = now() - interval '1 minute' WHERE id = ${q(c1)}`);
  falha(aceitar(P.G, c1), 'expirou');
  assert.equal(como(P.G, 'SELECT count(*) FROM public.meus_convites()').saida, '0');
  assert.ok(convidar(P.O, A, P.G.email, perfis.estoque.id).ok);
  assert.equal(adm(`SELECT estado FROM public.convites_empresa WHERE id = ${q(c1)}`), 'expirado');
  const c2 = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.G.email)} AND estado = 'pendente'`);
  assert.ok(como(P.O, `SELECT public.cancelar_convite(${q(c2)}, ${q(k())})`).ok);
  falha(aceitar(P.G, c2), 'não está mais disponível');
  assert.ok(convidar(P.O, A, P.G.email, perfis.estoque.id).ok);
  const c3 = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.G.email)} AND estado = 'pendente'`);
  assert.ok(como(P.G, `SELECT public.recusar_convite(${q(c3)}, ${q(k())})`).ok);
  assert.ok(convidar(P.O, A, P.G.email, perfis.estoque.id).ok);
  const c4 = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.G.email)} AND estado = 'pendente'`);
  assert.ok(aceitar(P.G, c4).ok);
  assert.deepEqual(permissoes(P.G, A), ['estoque.aprovar', 'estoque.propor', 'estoque.visualizar', 'produtos.visualizar']);
  assert.equal(adm(`SELECT count(*) FROM public.membros_empresa WHERE empresa_id = ${q(A)} AND auth_user_id = ${q(P.G.id)}`), '2');
});

test('perfil em uso não é desativado; sem uso, é desativado e some das escolhas', opcoes, () => {
  falha(como(P.O, `SELECT public.desativar_perfil_permissao(${q(perfis.estoque.id)}, 1, ${q(k())})`), 'usando este perfil');
  assert.ok(como(P.O, `SELECT public.desativar_perfil_permissao(${q(perfis.financeiroTotal.id)}, 1, ${q(k())})`).ok);
  falha(convidar(P.O, A, 'z@teste.example', perfis.financeiroTotal.id), 'perfil de acesso ativo');
});

test('CK que vira funcionário de uma empresa não decide sobre ela (conflito de interesse)', opcoes, () => {
  assert.ok(convidar(P.O, A, P.C.email, perfis.vitrine.id).ok);
  const c = adm(`SELECT id FROM public.convites_empresa WHERE email = ${q(P.C.email)} AND estado = 'pendente'`);
  assert.ok(aceitar(P.C, c).ok);
  const versao = Number(adm(`SELECT versao FROM public.empresas WHERE id = ${q(A)}`));
  assert.ok(como(P.O, `SELECT public.enviar_vitrine_para_analise(${q(A)}, ${versao}, ${q(k())})`).ok);
  const sol = adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(A)} AND estado = 'aberta'`);
  falha(como(P.C, `SELECT public.ck_decidir_solicitacao(${q(sol)}, 'aprovar', NULL, NULL, ${q(k())})`), 'conflito de interesse');
});

test('sem sessão, nada de equipe funciona', opcoes, () => {
  for (const chamada of [`public.minhas_empresas()`, `public.meus_convites()`, `public.minhas_permissoes(${q(A)})`]) {
    falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT * FROM ${chamada}`), 'permission denied');
  }
  falha(comoPapel(banco.url, { sub: null }, 'SELECT * FROM public.minhas_empresas()'), 'Sessão ausente');
});

test('rollback e reaplicação da 202611010006', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010006_equipe_permissoes.down.sql');
  assert.equal(adm("SELECT to_regclass('public.perfis_permissao') IS NULL"), 't');
  assert.equal(adm("SELECT count(*) FROM public.membros_empresa WHERE papel <> 'proprietario'"), '0');
  assert.equal(como(P.O, `SELECT documento FROM public.empresas WHERE id = ${q(A)}`).saida, '12345678000199');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010006_equipe_permissoes.sql');
  assert.equal(adm("SELECT count(*) FROM public.permissoes_catalogo"), '48');
});
