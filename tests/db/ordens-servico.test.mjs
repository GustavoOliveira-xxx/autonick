/**
 * Testes de banco do M09 (migration 202611130001): OS criada no aceite (D9-01 = B) e carga dos aceites do M08, execução e
 * estados (D9-03 a D9-06), materiais com reserva, uso pendente e baixa (D9-07 a D9-09), sinal e saldo a receber pelo M07
 * (D9-10, D9-11), cancelamento com arrependimento, custos e contestação (D9-12 a D9-16), agenda operacional e reagendamento
 * por acordo com limites da CK (D9-17 a D9-20, D9-24, D9-26, D9-28), garantia (D9-21), pacotes (D9-22), recorrência (D9-23),
 * permissões por combinação (D9-27), concorrência real, isolamento, acesso indevido e rollback recusado com dados.
 * PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ANTES = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) <= '202611120005').sort();
const M09 = 'db/migrations_propostas/202611130001_ordens_servico.sql';

const ID = (n) => `e9000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m09@teste.example', nome: 'Dona Olga' },
  G: { id: ID(2), email: 'gerente-m09@teste.example', nome: 'Gerente Gil' },
  T: { id: ID(3), email: 'tecnico-m09@teste.example', nome: 'Técnico Téo' },
  F: { id: ID(4), email: 'financeiro-m09@teste.example', nome: 'Financeiro Fábia' },
  X: { id: ID(5), email: 'outra-m09@autonick-teste.example', nome: 'Xavier Outra' },
  C1: { id: ID(6), email: 'cliente1-m09@autonick-teste.example', nome: 'Cliente Clara' },
  C2: { id: ID(7), email: 'cliente2-m09@autonick-teste.example', nome: 'Cliente Cauã' },
  CK: { id: ID(8), email: 'ck-m09@teste.example', nome: 'Admin CK' },
};
let chave = 0;
const k = () => `m09-teste-${String(++chave).padStart(4, '0')}`;
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

let A; let B;
const M = {};
const versaoSol = (id) => Number(adm(`SELECT versao FROM public.solicitacoes_servico WHERE id = ${q(id)}`));
const versaoOs = (id) => Number(adm(`SELECT versao FROM public.ordens_servico WHERE id = ${q(id)}`));
const versaoServ = (id) => Number(adm(`SELECT versao FROM public.servicos WHERE id = ${q(id)}`));
const saldo = (v) => adm(`SELECT fisico || '/' || reservado || '/' || disponivel FROM public.saldos_estoque WHERE variacao_id = ${q(v)}`);
const segunda = (hora, semanas = 1) => adm(`SELECT ((date_trunc('week', app_private.hoje_sp()) + interval '${7 * semanas} days')::date + time '${hora}')
  AT TIME ZONE 'America/Sao_Paulo'`);
const hoje = () => adm('SELECT app_private.hoje_sp()::text');
const estado = (os, acao, motivo = null, p = P.G) => ok(p, 'mudar_estado_os', `${q(os)}, ${q(acao)}, ${q(motivo)}, ${versaoOs(os)}, ${q(k())}`);
const osDaSol = (s) => adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(s)}`);

// Contratação completa pela plataforma (cliente aceita) ou interna (equipe registra o aceite informado).
function orcar(s, componentes, extra = {}) {
  let v = ok(P.G, 'salvar_rascunho_orcamento', `${q(s)}, ${j({ componentes, ...extra })}, ${versaoSol(s)}, ${q(k())}`);
  v = ok(P.G, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  return v;
}
function contratar({ cliente = P.C1, valor = 20000, material = 0, condicoes = null, interna = false } = {}) {
  const s = interna
    ? ok(P.G, 'criar_solicitacao_interna', `${q(A)}, ${q(M.clienteInterno)}, ${q(M.servico)}, ${j({ relato: 'Serviço interno de teste do M09.' })}, ${q(k())}`)
    : ok(cliente, 'criar_solicitacao', `${q(M.servico)}, ${j({ relato: 'Instalar tomadas e revisar o quadro.' })}, ${q(k())}`);
  const comp = [{ tipo: 'mao_de_obra', descricao: 'Instalação', quantidade: 1, valor_unitario_centavos: valor }];
  if (material) comp.push({ tipo: 'material', descricao: 'Cabo flexível', quantidade: material, valor_unitario_centavos: 1000, variacao_id: M.cabo });
  const v = orcar(s.id, comp, condicoes ? { condicoes } : {});
  const ac = ok(interna ? P.G : cliente, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(k())}`);
  return { s: s.id, v: v.id, ac, os: osDaSol(s.id) };
}

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ANTES) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
  }
  for (const p of [P.O, P.X]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`);
  for (const p of [P.C1, P.C2]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('cliente', ${q(p.nome)})`);
  adm(`INSERT INTO app_private.administradores_ck (auth_user_id, concedido_por) VALUES (${q(P.CK.id)}, 'teste')`);
  const cat = adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'");
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'ambos', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'privado@teste.example' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('[TESTE] Elétrica A')}'::jsonb, 'm09-setup-01')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('[TESTE] Elétrica B')}'::jsonb, 'm09-setup-02')::text`).saida).id;
  adm(`UPDATE public.empresas SET situacao_vitrine = 'publicada', dado_de_teste = true WHERE id IN ('${A}', '${B}')`);
  adm("UPDATE app_private.limites_plataforma SET valor = 20 WHERE chave IN ('solicitacoes_abertas_por_empresa', 'solicitacoes_novas_por_dia')");
  const perfil = (nome, perms) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.criar_perfil_permissao(${q(A)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())})::text`).saida);
  M.perfis = {
    gerente: perfil('Gerente de serviços', ['catalogo_servicos.visualizar', 'catalogo_servicos.alterar', 'orcamentos.visualizar', 'orcamentos.criar',
      'orcamentos.aprovar', 'orcamentos.cancelar', 'agenda.visualizar', 'agenda.alterar', 'servicos.visualizar', 'servicos.alterar', 'servicos.cancelar',
      'estoque.visualizar', 'estoque.propor', 'financeiro.criar', 'produtos.visualizar', 'clientes.visualizar']),
    tecnico: perfil('Técnico', ['servicos.visualizar', 'servicos.alterar', 'agenda.visualizar']),
    financeiro: perfil('Financeiro', ['financeiro.visualizar', 'financeiro.criar', 'financeiro.aprovar']),
  };
  for (const [p, perfilId] of [[P.G, M.perfis.gerente.id], [P.T, M.perfis.tecnico.id], [P.F, M.perfis.financeiro.id]]) {
    const c = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.convidar_funcionario(${q(A)}, ${q(p.email)}, ${q(perfilId)}, ${q(k())})::text`).saida);
    comoPapel(banco.url, { sub: p.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`);
  }
  const produto = (empresa, dono, nome, qtd) => JSON.parse(comoPapel(banco.url, { sub: dono.id }, `SELECT public.criar_produto(${q(empresa)}, ${j({ nome,
    finalidade: 'uso_interno', preco_centavos: 100, custo_centavos: 500, quantidade_inicial: qtd })}, NULL, ${q(k())})::text`).saida).variacoes[0].id;
  M.cabo = produto(A, P.O, 'Cabo flexível 2,5 mm', 10);
  M.disjuntor = produto(A, P.O, 'Disjuntor 20 A', 3);
  M.pecaB = produto(B, P.X, 'Peça da B', 5);
  M.clienteInterno = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_cliente(${q(A)}, ${j({ nome: 'Seu Lauro (balcão)' })}, ${q(k())})::text`).saida).id;
  M.servico = JSON.parse(comoPapel(banco.url, { sub: P.G.id }, `SELECT public.criar_servico(${q(A)}, ${j({ nome: 'Instalação elétrica', politica_preco: 'sob_consulta',
    duracao_min: 120 })}, ${q(k())})::text`).saida).id;
  M.servicoB = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_servico(${q(B)}, ${j({ nome: 'Serviço da B', politica_preco: 'fixo',
    preco_centavos: 5000 })}, ${q(k())})::text`).saida).id;
  // Aceite feito ainda no M08 (antes da 202611130001): precisa ganhar a OS na carga.
  const s0 = JSON.parse(comoPapel(banco.url, { sub: P.C1.id }, `SELECT public.criar_solicitacao(${q(M.servico)}, ${j({ relato: 'Pedido aceito no M08.' })}, ${q(k())})::text`).saida);
  let v0 = JSON.parse(comoPapel(banco.url, { sub: P.G.id }, `SELECT public.salvar_rascunho_orcamento(${q(s0.id)}, ${j({ componentes: [
    { tipo: 'mao_de_obra', descricao: 'Instalação', quantidade: 1, valor_unitario_centavos: 15000 },
    { tipo: 'material', descricao: 'Cabo flexível', quantidade: 1.5, valor_unitario_centavos: 1000, variacao_id: M.cabo }] })}, ${versaoSol(s0.id)}, ${q(k())})::text`).saida);
  v0 = JSON.parse(comoPapel(banco.url, { sub: P.G.id }, `SELECT public.enviar_orcamento(${q(v0.id)}, ${v0.versao}, ${q(k())})::text`).saida);
  comoPapel(banco.url, { sub: P.C1.id }, `SELECT public.aceitar_orcamento(${q(s0.id)}, ${q(v0.id)}, true, ${q(k())})`);
  M.s0 = s0.id;
  M.antesDaCarga = adm('SELECT (SELECT count(*) FROM public.titulos_financeiros) || \'/\' || (SELECT count(*) FROM public.reservas_estoque) || \'/\' || (SELECT count(*) FROM public.agendamentos)');
  aplicarArquivo(banco.url, M09);
});
after(() => banco?.encerrar());

test('carga do M08 (D9-01): o aceite antigo ganha uma OS, sem título, reserva ou horário novo; catálogo continua com 55', opcoes, () => {
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55');
  const os = adm(`SELECT numero || '/' || estado || '/' || origem_carga || '/' || valor_contratado FROM public.ordens_servico WHERE solicitacao_id = ${q(M.s0)}`);
  assert.equal(os, '1/aguardando_inicio/m08/165.00');
  M.os0 = osDaSol(M.s0);
  assert.equal(adm(`SELECT qtd_prevista FROM public.os_materiais WHERE os_id = ${q(M.os0)}`), '2');   // 1,5 arredonda para 2 unidades inteiras
  assert.equal(adm('SELECT (SELECT count(*) FROM public.titulos_financeiros) || \'/\' || (SELECT count(*) FROM public.reservas_estoque) || \'/\' || (SELECT count(*) FROM public.agendamentos)'), M.antesDaCarga);
  const sol = ok(P.C1, 'minha_solicitacao', q(M.s0));
  assert.equal(sol.aguarda_os, false);
  assert.equal(sol.os.numero, 1);
  assert.equal(ok(P.C1, 'minha_os', q(M.os0)).eventos[0].tipo, 'criada');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611130001'"), '1');
});


test('política de cancelamento (D9-16) e OS no aceite (D9-01): versionada, mostrada no orçamento, gravada no aceite; uma OS por aceite', opcoes, () => {
  falha(rpc(P.T, 'salvar_politica_cancelamento', `${q(A)}, 'Cancelamento depois da visita: cobramos o deslocamento.', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'salvar_politica_cancelamento', `${q(A)}, 'curta', ${q(k())}`), '20 a 2.000');
  falha(rpc(P.G, 'salvar_politica_cancelamento', `${q(A)}, 'Ligue 19 99999-0000 para cancelar o serviço.', ${q(k())}`), 'telefone');
  ok(P.G, 'salvar_politica_cancelamento', `${q(A)}, 'Cancelamento depois do início: custos de deslocamento e material usado.', ${q(k())}`);
  const pol = ok(P.G, 'salvar_politica_cancelamento', `${q(A)}, 'Cancelamento depois do início: só deslocamento e material já usado, com demonstrativo.', ${q(k())}`);
  assert.equal(pol.versao, 2);
  falha(rpc(P.T, 'politica_cancelamento', q(A)), 'FORBIDDEN_ACTION');
  const lida = ok(P.G, 'politica_cancelamento', q(A));
  assert.equal(lida.ativa.versao, 2);
  assert.equal(lida.historico.length, 2);
  // O cliente vê a política antes de aceitar; o aceite a grava.
  const s = ok(P.C1, 'criar_solicitacao', `${q(M.servico)}, ${j({ relato: 'Trocar o chuveiro e a fiação.' })}, ${q(k())}`);
  const v = orcar(s.id, [{ tipo: 'mao_de_obra', descricao: 'Troca', quantidade: 1, valor_unitario_centavos: 30000 },
    { tipo: 'material', descricao: 'Cabo flexível', quantidade: 3, valor_unitario_centavos: 1000, variacao_id: M.cabo }]);
  assert.match(ok(P.C1, 'minha_solicitacao', q(s.id)).politica_cancelamento.texto, /demonstrativo/);
  const ch = k();
  const ac = ok(P.C1, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(ch)}`);
  assert.equal(ok(P.C1, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(ch)}`).os.numero, ac.os.numero);   // mesma chave: mesmo efeito
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(k())}`), 'já foi aceito');
  assert.equal(ac.aguarda_os, false);
  assert.equal(ac.os.estado, 'aguardando_inicio');
  assert.equal(ac.aceite.politica_cancelamento.versao, 2);
  assert.equal(adm(`SELECT count(*) FROM public.ordens_servico WHERE solicitacao_id = ${q(s.id)}`), '1');
  M.os1 = ac.os.id;
  const os = ok(P.G, 'os_detalhe', q(M.os1));
  assert.equal(os.numero, 2);
  assert.equal(os.valores.contratado_centavos, 33000);
  assert.equal(os.valores.situacao, 'sem_cobranca');
  assert.equal(os.materiais[0].prevista, 3);
  assert.equal(os.condicoes_cancelamento.politica.versao, 2);
  assert.equal(adm('SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo = \'servico\''), '0');   // nenhum título no aceite
  // Depois do aceite: horário só pela OS; cancelamento só pela OS.
  falha(rpc(P.G, 'confirmar_horario', `${q(s.id)}, ${q(segunda('09:00'))}, 60, true, NULL, ${q(k())}`), 'ordem de serviço');
  falha(rpc(P.C1, 'cancelar_solicitacao', `${q(s.id)}, NULL, ${q(k())}`), 'cancele pela ordem de serviço');
});

test('concorrência: dois aceites simultâneos da mesma versão criam uma só OS; numeração sem repetição', opcoes, async () => {
  const s = ok(P.C2, 'criar_solicitacao', `${q(M.servico)}, ${j({ relato: 'Aceite em duas abas ao mesmo tempo.' })}, ${q(k())}`);
  const v = orcar(s.id, [{ tipo: 'mao_de_obra', descricao: 'Serviço', quantidade: 1, valor_unitario_centavos: 10000 }]);
  const dois = await Promise.all([1, 2].map(() => sessao(P.C2, `SELECT public.aceitar_orcamento(${q(s.id)}, ${q(v.id)}, true, ${q(k())})`, 0.3)));
  assert.equal(dois.filter((r) => r.ok).length, 1, dois.map((r) => r.erro).join(' | '));
  assert.equal(adm(`SELECT count(*) FROM public.ordens_servico WHERE solicitacao_id = ${q(s.id)}`), '1');
  // Aceites de solicitações diferentes em paralelo: números distintos e seguidos.
  const sols = [];
  for (let i = 0; i < 4; i += 1) {
    const x = ok(P.C2, 'criar_solicitacao', `${q(M.servico)}, ${j({ relato: `Pedido paralelo número ${i}.` })}, ${q(k())}`);
    sols.push([x.id, orcar(x.id, [{ tipo: 'mao_de_obra', descricao: 'Serviço', quantidade: 1, valor_unitario_centavos: 5000 }]).id]);
  }
  const rs = await Promise.all(sols.map(([si, vi]) => sessao(P.C2, `SELECT public.aceitar_orcamento(${q(si)}, ${q(vi)}, true, ${q(k())})`, 0.2)));
  assert.equal(rs.every((r) => r.ok), true, rs.map((r) => r.erro).join(' | '));
  assert.equal(adm(`SELECT count(*) - count(DISTINCT numero) FROM public.ordens_servico WHERE empresa_id = ${q(A)}`), '0');
  assert.equal(adm(`SELECT max(numero) - count(*) FROM public.ordens_servico WHERE empresa_id = ${q(A)}`), '0');
  M.osParalelas = sols.map(([si]) => osDaSol(si));
});

test('isolamento e acesso indevido: outra empresa, outro cliente, tabelas diretas, anônimo e identidade vazia (D-07)', opcoes, () => {
  falha(rpc(P.X, 'os_detalhe', q(M.os1)), 'TENANT_FORBIDDEN');
  falha(rpc(P.X, 'ordens_da_empresa', `${q(A)}, '{}'::jsonb, 50, 0`), 'TENANT_FORBIDDEN');
  falha(rpc(P.X, 'mudar_estado_os', `${q(M.os1)}, 'iniciar', NULL, ${versaoOs(M.os1)}, ${q(k())}`), 'TENANT_FORBIDDEN');
  falha(rpc(P.C2, 'minha_os', q(M.os1)), 'NOT_FOUND');
  falha(rpc(P.C2, 'cancelar_os', `${q(M.os1)}, NULL, false, ${q(k())}`), 'NOT_FOUND');
  falha(rpc(P.C1, 'os_detalhe', q(M.os1)), 'TENANT_FORBIDDEN');
  falha(rpc(P.F, 'os_detalhe', q(M.os1)), 'FORBIDDEN_ACTION');
  // Material de outra empresa: não aparece.
  falha(rpc(P.G, 'adicionar_material_os', `${q(M.os1)}, ${q(M.pecaB)}, 1, ${q(k())}`), 'NOT_FOUND');
  assert.deepEqual(ok(P.C2, 'minhas_os').map((o) => o.id).includes(M.os1), false);
  assert.equal(ok(P.C1, 'minhas_os').filter((o) => o.id === M.os1).length, 1);
  for (const t of ['ordens_servico', 'os_eventos', 'os_materiais', 'os_material_usos', 'cancelamentos_os', 'propostas_custo_cancelamento',
    'reagendamentos', 'politicas_cancelamento', 'servico_pacote_itens']) {
    falha(comoPapel(banco.url, { sub: P.O.id }, `SELECT count(*) FROM public.${t}`), 'permission denied');
    falha(comoPapel(banco.url, { sub: P.C1.id }, `SELECT count(*) FROM public.${t}`), 'permission denied');
    assert.equal(adm(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass`), 't');
  }
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.minha_os(${q(M.os1)})`), 'permission denied');
  falha(comoPapel(banco.url, { sub: null }, 'SELECT public.minhas_os()'), 'AUTH_REQUIRED|Sessão ausente');
  falha(comoPapel(banco.url, { sub: null }, `SELECT public.os_detalhe(${q(M.os1)})`), 'AUTH_REQUIRED|Sessão ausente');
});

test('execução (D9-03 a D9-05): estados válidos, versão, pausa com motivo interno, responsável da equipe, previsão; cliente vê só o público', opcoes, () => {
  falha(rpc(P.G, 'mudar_estado_os', `${q(M.os1)}, 'concluir', NULL, ${versaoOs(M.os1)}, ${q(k())}`), 'Não é possível concluir');
  falha(rpc(P.G, 'mudar_estado_os', `${q(M.os1)}, 'voar', NULL, ${versaoOs(M.os1)}, ${q(k())}`), 'Ação inválida');
  falha(rpc(P.G, 'mudar_estado_os', `${q(M.os1)}, 'iniciar', NULL, 99, ${q(k())}`), 'VERSION_CONFLICT');
  falha(rpc(P.F, 'mudar_estado_os', `${q(M.os1)}, 'iniciar', NULL, ${versaoOs(M.os1)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const ch = k();
  const v0 = versaoOs(M.os1);
  const ini = ok(P.T, 'mudar_estado_os', `${q(M.os1)}, 'iniciar', NULL, ${v0}, ${q(ch)}`);
  assert.equal(ok(P.T, 'mudar_estado_os', `${q(M.os1)}, 'iniciar', NULL, ${v0}, ${q(ch)}`).estado, 'em_execucao');   // repetição idempotente
  assert.equal(ini.estado, 'em_execucao');
  falha(rpc(P.T, 'mudar_estado_os', `${q(M.os1)}, 'pausar', 'ok', ${versaoOs(M.os1)}, ${q(k())}`), '5 a 300');
  estado(M.os1, 'pausar', 'Aguardando a peça chegar do fornecedor X.', P.T);
  estado(M.os1, 'retomar', null, P.T);
  const cli = ok(P.C1, 'minha_os', q(M.os1));
  assert.ok(cli.eventos.some((e) => e.tipo === 'pausa_publica'));
  assert.equal(cli.eventos.some((e) => e.tipo === 'pausar' || /fornecedor/.test(e.texto ?? '')), false);
  assert.equal(cli.materiais, undefined);
  assert.equal(cli.valores.titulos, undefined);
  falha(rpc(P.G, 'atualizar_dados_os', `${q(M.os1)}, ${j({ responsavel_auth_id: P.X.id })}, ${versaoOs(M.os1)}, ${q(k())}`), 'membro ativo');
  falha(rpc(P.G, 'atualizar_dados_os', `${q(M.os1)}, ${j({ previsao_conclusao: '2020-01-01' })}, ${versaoOs(M.os1)}, ${q(k())}`), 'de hoje até 1 ano');
  falha(rpc(P.G, 'atualizar_dados_os', `${q(M.os1)}, ${j({ valor_contratado: 1 })}, ${versaoOs(M.os1)}, ${q(k())}`), 'Campo não permitido');
  const d = ok(P.G, 'atualizar_dados_os', `${q(M.os1)}, ${j({ responsavel_auth_id: P.T.id, previsao_conclusao: hoje() })}, ${versaoOs(M.os1)}, ${q(k())}`);
  assert.equal(d.responsavel, 'Técnico Téo');
  const pub = ok(P.T, 'publicar_atualizacao_os', `${q(M.os1)}, 'Fiação passada nos dois cômodos.', true, ${q(k())}`);
  assert.ok(pub.eventos.some((e) => e.tipo === 'atualizacao'));
  falha(rpc(P.T, 'publicar_atualizacao_os', `${q(M.os1)}, 'Veja em www.exemplo.com', true, ${q(k())}`), 'link');
  ok(P.T, 'publicar_atualizacao_os', `${q(M.os1)}, 'Nota interna: cliente prefere à tarde.', false, ${q(k())}`);
  assert.equal(ok(P.C1, 'minha_os', q(M.os1)).eventos.some((e) => /prefere/.test(e.texto ?? '')), false);
  const lista = ok(P.G, 'ordens_da_empresa', `${q(A)}, ${j({ estado: 'ativas', responsavel: P.T.id })}, 50, 0`);
  assert.deepEqual(lista.itens.map((o) => o.id), [M.os1]);
  falha(rpc(P.G, 'ordens_da_empresa', `${q(A)}, '{}'::jsonb, 500, 0`), 'Paginação');
});

test('materiais (D9-07 a D9-09): reserva opcional, uso do técnico fica pendente, baixa pelo aprovador, devolução limitada, custo só com permissão', opcoes, () => {
  assert.equal(saldo(M.cabo), '10/0/10');
  falha(rpc(P.T, 'reservar_material_os', `${q(ok(P.G, 'os_detalhe', q(M.os1)).materiais[0].id)}, true, ${q(k())}`), 'FORBIDDEN_ACTION');
  const mat = ok(P.G, 'os_detalhe', q(M.os1)).materiais[0];
  ok(P.G, 'reservar_material_os', `${q(mat.id)}, true, ${q(k())}`);
  assert.equal(saldo(M.cabo), '10/3/7');
  falha(rpc(P.G, 'reservar_material_os', `${q(mat.id)}, true, ${q(k())}`), 'já está reservado');
  // Técnico registra uso: fica pendente, estoque não muda.
  const uso = ok(P.T, 'registrar_uso_material', `${q(M.os1)}, ${q(M.cabo)}, 2, 'Usado no quarto', ${q(k())}`);
  assert.equal(uso.estado, 'pendente');
  assert.equal(saldo(M.cabo), '10/3/7');
  const verT = ok(P.T, 'os_detalhe', q(M.os1));
  assert.equal(verT.materiais[0].custo_previsto_centavos, undefined);
  assert.equal(verT.pode.estoque_aprovar, false);
  // Quem aprova estoque baixa: a reserva vira saída e o restante volta a ser reservado.
  falha(rpc(P.G, 'decidir_uso_material', `${q(uso.uso_id)}, true, NULL, 1, ${q(k())}`), 'FORBIDDEN_ACTION');
  const dec = ok(P.O, 'decidir_uso_material', `${q(uso.uso_id)}, true, NULL, 1, ${q(k())}`);
  assert.equal(dec[0].usada, 2);
  assert.equal(dec[0].reservada, 1);
  assert.equal(saldo(M.cabo), '8/1/7');
  assert.equal(dec[0].custo_confirmado_centavos, 1000);   // 2 × R$ 5,00 do custo do M05
  falha(rpc(P.O, 'decidir_uso_material', `${q(uso.uso_id)}, true, NULL, 2, ${q(k())}`), 'já foi decidido');
  // Uso direto do proprietário (tem estoque.aprovar) e recusa de pendente.
  ok(P.O, 'registrar_uso_material', `${q(M.os1)}, ${q(M.disjuntor)}, 1, NULL, ${q(k())}`);
  assert.equal(saldo(M.disjuntor), '2/0/2');
  const pend = ok(P.T, 'registrar_uso_material', `${q(M.os1)}, ${q(M.disjuntor)}, 1, NULL, ${q(k())}`);
  falha(rpc(P.O, 'decidir_uso_material', `${q(pend.uso_id)}, false, 'x', 1, ${q(k())}`), '3 a 300');
  ok(P.O, 'decidir_uso_material', `${q(pend.uso_id)}, false, 'Não foi usado de fato.', 1, ${q(k())}`);
  assert.equal(saldo(M.disjuntor), '2/0/2');
  // Devolução: só quem tem servicos.alterar + estoque.aprovar; nunca mais do que o baixado.
  falha(rpc(P.G, 'devolver_material_os', `${q(mat.id)}, 1, 'Sobrou um pedaço', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.O, 'devolver_material_os', `${q(mat.id)}, 3, 'Sobrou um pedaço', ${q(k())}`), 'Devolva de 1 a 2');
  ok(P.O, 'devolver_material_os', `${q(mat.id)}, 1, 'Sobrou um pedaço', ${q(k())}`);
  assert.equal(saldo(M.cabo), '9/1/8');
  assert.equal(adm(`SELECT string_agg(tipo || ':' || quantidade, ',' ORDER BY criado_em) FROM public.movimentacoes_estoque WHERE origem_tipo = 'os' AND origem_id = ${q(M.os1)} AND variacao_id = ${q(M.cabo)}`),
    'saida:-2,entrada:1');
  // Reserva desfeita à mão.
  ok(P.G, 'reservar_material_os', `${q(mat.id)}, false, ${q(k())}`);
  assert.equal(saldo(M.cabo), '9/0/9');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('concorrência: consumo simultâneo do último estoque e reservas em paralelo nunca deixam o saldo negativo', opcoes, async () => {
  // Disjuntor: 2 disponíveis. Duas baixas de 2 ao mesmo tempo (OS diferentes): uma passa, a outra recebe estoque insuficiente.
  const [o1, o2] = M.osParalelas;
  estado(o1, 'iniciar');
  estado(o2, 'iniciar');
  const rs = await Promise.all([o1, o2].map((o) => sessao(P.O, `SELECT public.registrar_uso_material(${q(o)}, ${q(M.disjuntor)}, 2, NULL, ${q(k())})`, 0.3)));
  assert.equal(rs.filter((r) => r.ok).length, 1, rs.map((r) => r.erro).join(' | '));
  assert.match(rs.find((r) => !r.ok).erro, /INSUFFICIENT_STOCK/);
  assert.equal(saldo(M.disjuntor), '0/0/0');
  // Cabo: 9 disponíveis; três reservas de 4 em paralelo: no máximo duas.
  const mats = [];
  for (const o of M.osParalelas.slice(0, 3)) {
    ok(P.G, 'adicionar_material_os', `${q(o)}, ${q(M.cabo)}, 4, ${q(k())}`);
    mats.push(adm(`SELECT id FROM public.os_materiais WHERE os_id = ${q(o)} AND variacao_id = ${q(M.cabo)}`));
  }
  const res = await Promise.all(mats.map((m) => sessao(P.G, `SELECT public.reservar_material_os(${q(m)}, true, ${q(k())})`, 0.2)));
  assert.equal(res.filter((r) => r.ok).length, 2, res.map((r) => r.erro).join(' | '));
  assert.equal(saldo(M.cabo), '9/8/1');
  for (const m of mats) sql(banco.url, `SELECT 1`) && comoPapel(banco.url, { sub: P.G.id }, `SELECT public.reservar_material_os(${q(m)}, false, ${q(k())})`);
  assert.equal(saldo(M.cabo), '9/0/9');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('financeiro (D9-10, D9-11): sinal explícito, saldo na conclusão, revisão e reabertura sem título duplicado, baixa pelo M07, reparcelamento', opcoes, () => {
  // Sinal: financeiro.criar; até o contratado; um só.
  falha(rpc(P.T, 'gerar_antecipacao_os', `${q(M.os1)}, 5000, NULL, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'gerar_antecipacao_os', `${q(M.os1)}, 99999999, NULL, ${q(k())}`), 'até o valor contratado');
  const sinal = ok(P.F, 'gerar_antecipacao_os', `${q(M.os1)}, 10000, NULL, ${q(k())}`);
  assert.equal(sinal.antecipado_centavos, 10000);
  assert.equal(sinal.a_titular_centavos, 23000);
  falha(rpc(P.F, 'gerar_antecipacao_os', `${q(M.os1)}, 1000, NULL, ${q(k())}`), 'já tem conta a receber');
  // Baixa do sinal pelo M07 (técnico e gerente não baixam).
  const parcela = sinal.titulos[0].parcelas[0].id;
  falha(rpc(P.G, 'registrar_recebimento', `${q(parcela)}, 10000, 'pix', ${q(hoje())}, ${q(k())}`), 'FORBIDDEN_ACTION');
  ok(P.F, 'registrar_recebimento', `${q(parcela)}, 10000, 'pix', ${q(hoje())}, ${q(k())}`);
  // Conclusão: libera reservas e cria o saldo (contratado − sinal) uma única vez.
  const mat = ok(P.G, 'os_detalhe', q(M.os1)).materiais[0];
  ok(P.G, 'reservar_material_os', `${q(mat.id)}, true, ${q(k())}`);
  const conc = estado(M.os1, 'concluir', null, P.T);
  assert.equal(conc.estado, 'concluida');
  assert.equal(adm(`SELECT count(*) FROM public.reservas_estoque WHERE origem_tipo = 'os_material' AND estado = 'ativa' AND origem_id IN (SELECT reserva_origem_id FROM public.os_materiais WHERE os_id = ${q(M.os1)})`), '0');
  assert.equal(conc.valores.titulos.length, 2);
  assert.equal(conc.valores.titulos.find((t) => t.parte === 'saldo').total_centavos, 23000);
  assert.equal(conc.valores.recebido_centavos, 10000);
  assert.equal(conc.valores.saldo_pendente_centavos, 23000);
  assert.equal(conc.valores.situacao, 'parcial');
  // Revisão pedida pelo cliente: a empresa não encerra; reabre com motivo; nova conclusão não duplica o saldo.
  falha(rpc(P.C1, 'pedir_revisao_os', `${q(M.os1)}, 'curto', ${q(k())}`), '10 a 1.000');
  ok(P.C1, 'pedir_revisao_os', `${q(M.os1)}, 'A tomada da sala ficou sem espelho.', ${q(k())}`);
  falha(rpc(P.C1, 'pedir_revisao_os', `${q(M.os1)}, 'De novo a tomada da sala.', ${q(k())}`), 'Já existe um pedido');
  falha(rpc(P.G, 'mudar_estado_os', `${q(M.os1)}, 'encerrar', NULL, ${versaoOs(M.os1)}, ${q(k())}`), 'pediu revisão');
  falha(rpc(P.G, 'mudar_estado_os', `${q(M.os1)}, 'reabrir', 'curto', ${versaoOs(M.os1)}, ${q(k())}`), '10 a 300');
  estado(M.os1, 'reabrir', 'Colocar o espelho da tomada da sala.');
  estado(M.os1, 'concluir');
  assert.equal(adm(`SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo = 'servico' AND origem_id = ${q(M.os1)} AND parte_servico = 'saldo' AND estado <> 'cancelado'`), '1');
  // Reparcelar o saldo antes de qualquer baixa: soma igual ao saldo.
  falha(rpc(P.F, 'reparcelar_titulo_os', `${q(M.os1)}, ${j([{ valor_centavos: 10000, vencimento: hoje() }])}, ${q(k())}`), 'precisa ser igual');
  const rep = ok(P.F, 'reparcelar_titulo_os', `${q(M.os1)}, ${j([{ valor_centavos: 13000, vencimento: hoje() }, { valor_centavos: 10000, vencimento: hoje() }])}, ${q(k())}`);
  const saldoT = rep.titulos.find((t) => t.parte === 'saldo' && t.estado !== 'cancelado');
  assert.equal(saldoT.parcelas.length, 2);
  // A conta da OS não é cancelada pelo financeiro avulso.
  falha(rpc(P.O, 'cancelar_titulo', `${q(saldoT.id)}, 'Tentativa de cancelar por fora da OS.', ${saldoT.versao}, ${q(k())}`), 'pela própria OS');
  for (const pa of saldoT.parcelas) ok(P.F, 'registrar_recebimento', `${q(pa.id)}, ${pa.saldo_centavos}, 'dinheiro', ${q(hoje())}, ${q(k())}`);
  falha(rpc(P.F, 'reparcelar_titulo_os', `${q(M.os1)}, ${j([{ valor_centavos: 23000, vencimento: hoje() }])}, ${q(k())}`), 'Já há recebimento');
  const cli = ok(P.C1, 'minha_os', q(M.os1));
  assert.equal(cli.valores.situacao, 'pago');
  assert.equal(cli.valores.recebido_centavos, 33000);
  assert.match(cli.valores.aviso, /não é confirmação bancária/);
  assert.equal(cli.valores.titulos, undefined);
  // Resultado do período: receita de serviços pela competência.
  const r = JSON.parse(adm(`SELECT app_private.resumo_periodo(${q(A)}, date_trunc('month', app_private.hoje_sp())::date, app_private.hoje_sp(), true)::text`));
  assert.equal(r.resultado.receita_servicos_centavos, 33000);
  // Cliente confirma o recebimento: encerra.
  const enc = ok(P.C1, 'confirmar_recebimento_servico', `${q(M.os1)}, ${q(k())}`);
  assert.equal(enc.estado, 'encerrada');
  assert.equal(enc.encerrada_por, 'cliente');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('encerramento pela empresa (D9-06): interna a qualquer momento depois da conclusão; plataforma só 7 dias depois, com aviso legal', opcoes, () => {
  const interna = contratar({ interna: true, valor: 8000 });
  M.osInterna = interna.os;
  estado(interna.os, 'iniciar');
  estado(interna.os, 'concluir');
  const e = estado(interna.os, 'encerrar');
  assert.equal(e.encerrada_por, 'empresa');
  assert.match(e.encerramento.aviso, /não elimina direitos legais/);
  const plat = M.osParalelas[3];
  estado(plat, 'iniciar');
  estado(plat, 'concluir');
  falha(rpc(P.G, 'mudar_estado_os', `${q(plat)}, 'encerrar', NULL, ${versaoOs(plat)}, ${q(k())}`), '7 dias');
  adm(`UPDATE public.ordens_servico SET concluida_em = now() - interval '8 days' WHERE id = ${q(plat)}`);   // simula o tempo passado
  assert.equal(ok(P.G, 'os_detalhe', q(plat)).encerramento.empresa_pode_encerrar, true);
  assert.equal(estado(plat, 'encerrar').estado, 'encerrada');
  falha(rpc(P.C2, 'confirmar_recebimento_servico', `${q(plat)}, ${q(k())}`), 'concluído');
});

test('garantia (D9-21) e recorrência (D9-23): garantia na conclusão; próxima execução só por ação explícita e com novo aceite', opcoes, () => {
  const c = contratar({ valor: 12000, material: 1 });
  falha(rpc(P.G, 'registrar_garantia_os', `${q(c.os)}, 90, 'Mão de obra.', ${q(k())}`), 'concluída');
  ok(P.G, 'atualizar_dados_os', `${q(c.os)}, ${j({ recorrencia: 'mensal' })}, ${versaoOs(c.os)}, ${q(k())}`);
  falha(rpc(P.G, 'atualizar_dados_os', `${q(c.os)}, ${j({ recorrencia: 'diaria' })}, ${versaoOs(c.os)}, ${q(k())}`), 'semanal, quinzenal ou mensal');
  estado(c.os, 'iniciar');
  estado(c.os, 'concluir');
  falha(rpc(P.G, 'registrar_garantia_os', `${q(c.os)}, 5000, NULL, ${q(k())}`), '0 a 3.650');
  const g = ok(P.G, 'registrar_garantia_os', `${q(c.os)}, 90, 'Garantia da mão de obra; não cobre mau uso.', ${q(k())}`);
  assert.equal(g.garantia.dias, 90);
  assert.match(g.garantia.aviso, /não substitui os direitos previstos em lei/);
  falha(rpc(P.G, 'gerar_proxima_os', `${q(c.os)}, ${q(k())}`), 'depois do encerramento');
  ok(P.C1, 'confirmar_recebimento_servico', `${q(c.os)}, ${q(k())}`);
  falha(rpc(P.T, 'gerar_proxima_os', `${q(c.os)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const prox = ok(P.G, 'gerar_proxima_os', `${q(c.os)}, ${q(k())}`);
  falha(rpc(P.G, 'gerar_proxima_os', `${q(c.os)}, ${q(k())}`), 'já foi gerada');
  assert.match(prox.aviso, /quando ele aceitar/);
  const sol = ok(P.C1, 'minha_solicitacao', q(prox.solicitacao_id));
  assert.equal(sol.estado, 'orcamento_enviado');
  assert.equal(sol.origem_os_id, c.os);
  assert.equal(sol.versoes[0].total_centavos, 13000);   // mesmo preço do aceite anterior
  assert.equal(adm(`SELECT count(*) FROM public.ordens_servico WHERE solicitacao_id = ${q(prox.solicitacao_id)}`), '0');   // nada automático
  const ac = ok(P.C1, 'aceitar_orcamento', `${q(prox.solicitacao_id)}, ${q(sol.versoes[0].id)}, true, ${q(k())}`);
  assert.equal(ac.os.estado, 'aguardando_inicio');
  assert.equal(ok(P.G, 'os_detalhe', q(c.os)).proxima.numero, sol.numero);
});

test('cancelamento (D9-12, D9-15): cliente cancela na hora; arrependimento sem custos; efeitos na mesma transação; concluída não cancela', opcoes, () => {
  const c = contratar({ cliente: P.C2, valor: 15000, material: 2 });
  ok(P.G, 'propor_horario_os', `${q(c.os)}, ${q(segunda('10:00', 4))}, 60, NULL, true, NULL, false, ${q(k())}`);
  const g = adm(`SELECT id FROM public.reagendamentos WHERE os_id = ${q(c.os)}`);
  ok(P.C2, 'responder_reagendamento', `${q(g)}, true, NULL, false, NULL, ${q(k())}`);
  const mat = ok(P.G, 'os_detalhe', q(c.os)).materiais[0];
  ok(P.G, 'reservar_material_os', `${q(mat.id)}, true, ${q(k())}`);
  const antes = saldo(M.cabo);
  ok(P.F, 'gerar_antecipacao_os', `${q(c.os)}, 5000, NULL, ${q(k())}`);
  falha(rpc(P.C2, 'cancelar_os', `${q(c.os)}, 'Me chame no 19 99999-0000', false, ${q(k())}`), 'telefone');
  const cc = ok(P.C2, 'cancelar_os', `${q(c.os)}, NULL, false, ${q(k())}`);
  assert.equal(cc.estado, 'cancelada');
  assert.equal(cc.cancelamento.arrependimento_possivel, true);
  assert.match(cc.cancelamento.aviso_arrependimento, /revisão jurídica/);
  assert.equal(cc.horario, null);
  assert.notEqual(saldo(M.cabo), antes);   // reserva liberada
  assert.equal(adm(`SELECT count(*) FROM public.titulos_financeiros WHERE origem_id = ${q(c.os)} AND estado <> 'cancelado'`), '0');
  assert.equal(adm(`SELECT count(*) FROM public.agendamentos WHERE solicitacao_id = ${q(c.s)} AND estado = 'confirmado'`), '0');
  falha(rpc(P.C2, 'cancelar_os', `${q(c.os)}, NULL, false, ${q(k())}`), 'já foi cancelada');
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(c.os)}, ${j([{ tipo: 'deslocamento', descricao: 'Ida', valor_centavos: 1000, justificativa: 'Fomos ao local.' }])}, 'Custos do deslocamento feito.', ${q(k())}`), 'arrependimento');
  // A equipe cancela com motivo; na plataforma não registra "a pedido do cliente".
  const c2 = contratar({ cliente: P.C2, valor: 9000 });
  falha(rpc(P.T, 'cancelar_os', `${q(c2.os)}, 'Sem material para atender agora.', false, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'cancelar_os', `${q(c2.os)}, 'curto', false, ${q(k())}`), '10 a 300');
  falha(rpc(P.G, 'cancelar_os', `${q(c2.os)}, 'O cliente pediu por telefone.', true, ${q(k())}`), 'próprio cliente');
  const ce = ok(P.G, 'cancelar_os', `${q(c2.os)}, 'Sem material para atender agora.', false, ${q(k())}`);
  assert.equal(ce.cancelamento.solicitado_por, 'empresa');
  assert.equal(ok(P.C2, 'minha_os', q(c2.os)).cancelamento.motivo, 'Sem material para atender agora.');
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(c2.os)}, ${j([{ tipo: 'outro', descricao: 'X', valor_centavos: 100, justificativa: 'Qualquer.' }])}, 'Tentativa indevida de custos.', ${q(k())}`), 'cancelamento foi da empresa');
  falha(rpc(P.C1, 'cancelar_os', `${q(M.os1)}, NULL, false, ${q(k())}`), 'já foi concluído');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('custos e contestação (D9-13, D9-14): só com condições e sem arrependimento; teto; contestação, revisão, aceite e título explícito', opcoes, () => {
  const c = contratar({ valor: 20000, material: 1 });
  estado(c.os, 'iniciar');   // depois do início não há arrependimento
  ok(P.C1, 'cancelar_os', `${q(c.os)}, 'Desisti do serviço.', false, ${q(k())}`);
  const item = (valor) => ({ tipo: 'deslocamento', descricao: 'Ida e volta', valor_centavos: valor, justificativa: 'Equipe foi ao endereço.' });
  falha(rpc(P.T, 'propor_custos_cancelamento', `${q(c.os)}, ${j([item(1000)])}, 'Custos incorridos até o cancelamento.', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(c.os)}, ${j([item(25000)])}, 'Custos incorridos até o cancelamento.', ${q(k())}`), 'passa do valor contratado');
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(c.os)}, ${j([{ ...item(1000), percentual: 10 }])}, 'Custos incorridos até o cancelamento.', ${q(k())}`), 'Campo não permitido');
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(c.os)}, ${j([])}, 'Custos incorridos até o cancelamento.', ${q(k())}`), '1 a 10');
  const p1 = ok(P.G, 'propor_custos_cancelamento', `${q(c.os)}, ${j([item(3000), { tipo: 'material_usado', descricao: 'Cabo', valor_centavos: 1000, justificativa: 'Um metro instalado.' }])}, 'Custos incorridos até o cancelamento.', ${q(k())}`).custos[0];
  assert.equal(p1.total_centavos, 4000);
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(c.os)}, ${j([item(1000)])}, 'Outra proposta ao mesmo tempo.', ${q(k())}`), 'proposta de custos ativa');
  falha(rpc(P.F, 'gerar_titulo_custos', `${q(p1.id)}, NULL, ${q(k())}`), 'só nasce de proposta aceita');
  // Cliente contesta; a empresa não responde no lugar dele.
  falha(rpc(P.G, 'responder_custos', `${q(p1.id)}, true, NULL, ${p1.versao}, ${q(k())}`), 'Só o cliente');
  falha(rpc(P.C2, 'responder_custos', `${q(p1.id)}, true, NULL, ${p1.versao}, ${q(k())}`), 'NOT_FOUND');
  const ct = ok(P.C1, 'responder_custos', `${q(p1.id)}, false, 'O cabo não foi instalado, só deixado no local.', ${p1.versao}, ${q(k())}`).custos[0];
  assert.equal(ct.estado, 'contestada');
  assert.match(ct.aviso, /não é dívida/);
  falha(rpc(P.F, 'gerar_titulo_custos', `${q(p1.id)}, NULL, ${q(k())}`), 'só nasce');
  assert.equal(adm(`SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo = 'cancelamento_servico'`), '0');
  // Revisão: a contestada vira revisada e nasce outra pendente.
  const p2 = ok(P.G, 'revisar_custos', `${q(p1.id)}, ${j([item(3000)])}, 'Retiramos o cabo, que foi devolvido ao estoque.', ${ct.versao}, ${q(k())}`).custos[0];
  assert.equal(p2.numero, 2);
  assert.equal(adm(`SELECT estado FROM public.propostas_custo_cancelamento WHERE id = ${q(p1.id)}`), 'revisada');
  ok(P.C1, 'responder_custos', `${q(p2.id)}, true, NULL, ${p2.versao}, ${q(k())}`);
  falha(rpc(P.T, 'gerar_titulo_custos', `${q(p2.id)}, NULL, ${q(k())}`), 'FORBIDDEN_ACTION');
  const t = ok(P.F, 'gerar_titulo_custos', `${q(p2.id)}, NULL, ${q(k())}`);
  assert.equal(t.total_centavos, 3000);
  falha(rpc(P.F, 'gerar_titulo_custos', `${q(p2.id)}, NULL, ${q(k())}`), 'já tem conta');
  falha(rpc(P.G, 'retirar_custos', `${q(p2.id)}, 'Desistimos da cobrança.', ${Number(adm(`SELECT versao FROM public.propostas_custo_cancelamento WHERE id = ${q(p2.id)}`))}, ${q(k())}`), 'conta a receber ativa');
  // Interna: acordo com concordância informada.
  const ci = contratar({ interna: true, valor: 10000 });
  estado(ci.os, 'iniciar');
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(ci.os)}, ${j([item(1000)])}, 'Custos incorridos até o cancelamento.', ${q(k())}`), 'depois do cancelamento');
  ok(P.G, 'cancelar_os', `${q(ci.os)}, 'Cliente desistiu no balcão.', true, ${q(k())}`);
  const pi = ok(P.G, 'propor_custos_cancelamento', `${q(ci.os)}, ${j([item(2000)])}, 'Custos incorridos até o cancelamento.', ${q(k())}`).custos[0];
  falha(rpc(P.G, 'registrar_acordo_custos', `${q(pi.id)}, 3000, 'Acordo maior que o proposto.', true, ${pi.versao}, ${q(k())}`), 'até o total proposto');
  falha(rpc(P.G, 'registrar_acordo_custos', `${q(pi.id)}, 1000, 'Acordo de metade combinado no balcão.', false, ${pi.versao}, ${q(k())}`), 'cliente concordou');
  const ai = ok(P.G, 'registrar_acordo_custos', `${q(pi.id)}, 1000, 'Acordo de metade combinado no balcão.', true, ${pi.versao}, ${q(k())}`).custos[0];
  assert.equal(ai.estado, 'acordo');
  assert.equal(ok(P.F, 'gerar_titulo_custos', `${q(pi.id)}, NULL, ${q(k())}`).total_centavos, 1000);
  // Sem condições no aceite: cancelamento sem custos.
  ok(P.G, 'salvar_politica_cancelamento', `${q(A)}, '', ${q(k())}`);
  const sc = contratar({ valor: 7000 });
  estado(sc.os, 'iniciar');
  ok(P.C1, 'cancelar_os', `${q(sc.os)}, NULL, false, ${q(k())}`);
  falha(rpc(P.G, 'propor_custos_cancelamento', `${q(sc.os)}, ${j([item(1000)])}, 'Custos incorridos até o cancelamento.', ${q(k())}`), 'não trazia condições');
  ok(P.G, 'salvar_politica_cancelamento', `${q(A)}, 'Cancelamento depois do início: só deslocamento e material já usado, com demonstrativo.', ${q(k())}`);
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('sinal recebido e cancelamento (D9-12): o valor fica "a devolver" e só sai por devolução explícita com financeiro.aprovar', opcoes, () => {
  const c = contratar({ valor: 20000 });
  const s = ok(P.F, 'gerar_antecipacao_os', `${q(c.os)}, 8000, NULL, ${q(k())}`);
  ok(P.F, 'registrar_recebimento', `${q(s.titulos[0].parcelas[0].id)}, 8000, 'pix', ${q(hoje())}, ${q(k())}`);
  const cc = ok(P.G, 'cancelar_os', `${q(c.os)}, 'Não conseguimos atender no prazo.', false, ${q(k())}`);
  assert.equal(cc.valores.a_devolver_centavos, 8000);
  assert.equal(cc.valores.recebido_centavos, 8000);
  const titulo = cc.valores.titulos[0].id;
  falha(rpc(P.G, 'registrar_devolucao_valor', `${q(titulo)}, 8000, 'pix', 'Devolução do sinal.', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.F, 'registrar_devolucao_valor', `${q(titulo)}, 9000, 'pix', 'Devolução do sinal.', ${q(k())}`), 'PAYMENT_EXCEEDS_BALANCE');
  ok(P.F, 'registrar_devolucao_valor', `${q(titulo)}, 3000, 'pix', 'Primeira parte da devolução.', ${q(k())}`);
  assert.equal(ok(P.C1, 'minha_os', q(c.os)).valores.a_devolver_centavos, 5000);
  assert.equal(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'servicos.valor_devolvido'`), '1');
});

test('concorrência: cancelamentos simultâneos (cliente e empresa) e cancelamento × conclusão têm um só efeito', opcoes, async () => {
  const c = contratar({ valor: 6000 });
  const rs = await Promise.all([
    sessao(P.C1, `SELECT public.cancelar_os(${q(c.os)}, NULL, false, ${q(k())})`, 0.3),
    sessao(P.G, `SELECT public.cancelar_os(${q(c.os)}, 'Empresa sem agenda neste mês.', false, ${q(k())})`, 0.3)]);
  assert.equal(rs.filter((r) => r.ok).length, 1, rs.map((r) => r.erro).join(' | '));
  assert.equal(adm(`SELECT count(*) FROM public.cancelamentos_os WHERE os_id = ${q(c.os)}`), '1');
  const d = contratar({ valor: 6000 });
  estado(d.os, 'iniciar');
  const v = versaoOs(d.os);
  const [canc, conc] = await Promise.all([
    sessao(P.C1, `SELECT public.cancelar_os(${q(d.os)}, NULL, false, ${q(k())})`, 0.3),
    sessao(P.G, `SELECT public.mudar_estado_os(${q(d.os)}, 'concluir', NULL, ${v}, ${q(k())})`, 0.3)]);
  assert.equal(canc.ok !== conc.ok, true, `${canc.erro} | ${conc.erro}`);
  const final = adm(`SELECT estado FROM public.ordens_servico WHERE id = ${q(d.os)}`);
  assert.ok(['cancelada', 'concluida'].includes(final));
  if (final === 'cancelada') assert.equal(adm(`SELECT count(*) FROM public.titulos_financeiros WHERE origem_id = ${q(d.os)} AND estado <> 'cancelado'`), '0');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('agenda e reagendamento (D9-17 a D9-20, D9-24, D9-26, D9-28): proposta até a concordância, avisos sem gravar, limites com exceção justificada', opcoes, () => {
  ok(P.G, 'salvar_horarios_empresa', `${q(A)}, ${j([1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, intervalos: [{ abre: '08:00', fecha: '18:00' }] })))}, ${q(k())}`);
  const c = contratar({ valor: 10000 });
  const outra = contratar({ cliente: P.C2, valor: 10000 });
  M.osAgenda = c.os;
  // Sem horário: a empresa propõe; na plataforma fica pendente até o cliente concordar.
  falha(rpc(P.T, 'propor_horario_os', `${q(c.os)}, ${q(segunda('09:00', 5))}, 60, NULL, false, NULL, false, ${q(k())}`), 'FORBIDDEN_ACTION');
  const p1 = ok(P.G, 'propor_horario_os', `${q(c.os)}, ${q(segunda('09:00', 5))}, 60, NULL, false, NULL, false, ${q(k())}`);
  assert.equal(p1.estado, 'pendente');
  assert.equal(ok(P.G, 'os_detalhe', q(c.os)).horario, null);
  assert.equal(ok(P.C1, 'minhas_os').find((o) => o.id === c.os).acao_pendente, 'responder_horario');
  falha(rpc(P.G, 'responder_reagendamento', `${q(p1.reagendamento_id)}, true, NULL, false, NULL, ${q(k())}`), 'NOT_FOUND');
  ok(P.C1, 'responder_reagendamento', `${q(p1.reagendamento_id)}, true, NULL, false, NULL, ${q(k())}`);
  assert.ok(ok(P.C1, 'minha_os', q(c.os)).horario.inicio);
  falha(rpc(P.C1, 'responder_reagendamento', `${q(p1.reagendamento_id)}, true, NULL, false, NULL, ${q(k())}`), 'já foi respondido');
  // Outra OS no mesmo horário: aviso de sobreposição, nada gravado sem confirmação explícita.
  const aviso = ok(P.G, 'propor_horario_os', `${q(outra.os)}, ${q(segunda('09:30', 5))}, 60, NULL, false, NULL, false, ${q(k())}`);
  assert.equal(aviso.gravado, false);
  assert.equal(aviso.avisos[0].tipo, 'sobreposicao');
  assert.equal(adm(`SELECT count(*) FROM public.reagendamentos WHERE os_id = ${q(outra.os)}`), '0');
  const fora = ok(P.G, 'propor_horario_os', `${q(outra.os)}, ${q(segunda('20:00', 5))}, 60, NULL, false, NULL, false, ${q(k())}`);
  assert.equal(fora.avisos[0].tipo, 'fora_do_horario');
  const aceito = ok(P.G, 'propor_horario_os', `${q(outra.os)}, ${q(segunda('09:30', 5))}, 60, NULL, true, 'Dois técnicos disponíveis.', false, ${q(k())}`);
  assert.equal(aceito.gravado, true);
  // Mudança de horário confirmado exige motivo; até a resposta, vale o horário atual.
  falha(rpc(P.G, 'propor_horario_os', `${q(c.os)}, ${q(segunda('14:00', 5))}, 60, NULL, false, NULL, false, ${q(k())}`), 'Diga por que');
  const inicioAtual = ok(P.C1, 'minha_os', q(c.os)).horario.inicio;
  const p2 = ok(P.G, 'propor_horario_os', `${q(c.os)}, ${q(segunda('14:00', 5))}, 60, 'Técnico em outro atendimento.', false, NULL, false, ${q(k())}`);
  assert.equal(ok(P.C1, 'minha_os', q(c.os)).horario.inicio, inicioAtual);
  ok(P.C1, 'responder_reagendamento', `${q(p2.reagendamento_id)}, false, 'Não posso à tarde.', false, NULL, ${q(k())}`);
  assert.equal(ok(P.C1, 'minha_os', q(c.os)).horario.inicio, inicioAtual);
  // Pedidos do cliente: 1 pendente por vez e 3 no total; o 4º só com justificativa excepcional.
  const pedir = (h, exc = null) => rpc(P.C1, 'pedir_reagendamento_os', `${q(c.os)}, ${q(segunda(h, 6))}, NULL, 'Viagem de trabalho nesta data.', ${q(exc)}, ${q(k())}`);
  assert.ok(pedir('08:00').ok);
  falha(pedir('10:00'), 'aguardando a empresa');
  let pend = adm(`SELECT id FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`);
  falha(rpc(P.C1, 'responder_reagendamento', `${q(pend)}, true, NULL, false, NULL, ${q(k())}`), 'Quem responde ao seu pedido é a empresa');
  falha(rpc(P.G, 'responder_reagendamento', `${q(pend)}, false, NULL, false, NULL, ${q(k())}`), '5 a 300');
  ok(P.G, 'responder_reagendamento', `${q(pend)}, false, 'Agenda cheia nesse dia.', false, NULL, ${q(k())}`);
  assert.ok(pedir('11:00').ok);
  pend = adm(`SELECT id FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`);
  ok(P.C1, 'retirar_reagendamento', `${q(pend)}, ${q(k())}`);
  assert.ok(pedir('15:00').ok);
  pend = adm(`SELECT id FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`);
  const resp = ok(P.G, 'responder_reagendamento', `${q(pend)}, true, NULL, false, NULL, ${q(k())}`);
  assert.equal(resp.estado, 'aceito');
  assert.equal(adm(`SELECT count(*) FROM public.agendamentos WHERE solicitacao_id = ${q(c.s)} AND estado = 'confirmado'`), '1');
  falha(pedir('16:00'), 'Limite de 3 pedidos');
  falha(pedir('16:00', 'curta'), '20 a 300');
  assert.ok(pedir('16:00', 'Internação de um familiar, preciso remarcar de novo.').ok);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'agenda.reagendamento_pedido' AND dados_minimizados->>'excepcional' = 'true'"), '1');
  // A CK ajusta o limite; equipe não.
  falha(rpc(P.G, 'ck_definir_limite', `'reagendamentos_por_os', 5, 'Mais folga para testes.', ${q(k())}`), 'administração CK');
  ok(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 5, 'Mais folga para testes.', ${q(k())}`);
  assert.equal(ok(P.CK, 'ck_limites').length, 4);
  ok(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 3, 'Volta ao padrão aprovado.', ${q(k())}`);
  // Agenda operacional: confirmados, propostos e OS sem horário; filtro informativo por responsável.
  const ag = ok(P.T, 'agenda_operacional', `${q(A)}, ${q(adm(`SELECT (${q(segunda('00:00', 5))}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`))}, NULL, NULL`);
  assert.ok(ag.propostos.some((x) => x.os_id === outra.os && x.proposto_por === 'empresa'));   // plataforma: aguarda o cliente
  assert.ok(ag.os_sem_horario.length >= 1);
  falha(rpc(P.F, 'agenda_operacional', `${q(A)}, NULL, NULL, NULL`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'agenda_operacional', `${q(A)}, ${q(hoje())}, ${q(adm('SELECT (app_private.hoje_sp() + 90)::text'))}, NULL`), '62 dias');
  assert.equal(ok(P.G, 'agenda_operacional', `${q(A)}, NULL, NULL, ${q(P.F.id)}`).confirmados.length, 0);
  // Cancelar só o horário (D9-24): a OS continua.
  falha(rpc(P.C1, 'cancelar_horario_os', `${q(c.os)}, NULL, ${q(k())}`), '5 a 300');
  const ch = ok(P.C1, 'cancelar_horario_os', `${q(c.os)}, 'Vou viajar e aviso quando voltar.', ${q(k())}`);
  assert.equal(ch.horario, null);
  assert.equal(ch.estado, 'aguardando_inicio');
  assert.equal(adm(`SELECT count(*) FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`), '0');
  // Interna: o horário vale na hora com a concordância informada.
  const ci = contratar({ interna: true, valor: 5000 });
  falha(rpc(P.G, 'propor_horario_os', `${q(ci.os)}, ${q(segunda('11:00', 7))}, 60, NULL, true, NULL, false, ${q(k())}`), 'cliente concordou');
  assert.equal(ok(P.G, 'propor_horario_os', `${q(ci.os)}, ${q(segunda('11:00', 7))}, 60, NULL, true, NULL, true, ${q(k())}`).estado, 'aceito');
  assert.equal(ok(P.O, 'reconciliar_os', q(A)).consistente, true);
});

test('concorrência: reagendamentos simultâneos deixam um só horário confirmado e uma só proposta pendente', opcoes, async () => {
  const c = contratar({ valor: 10000 });
  const propostas = await Promise.all(['09:00', '10:00', '11:00'].map((h) => sessao(P.G,
    `SELECT public.propor_horario_os(${q(c.os)}, ${q(segunda(h, 8))}, 60, NULL, true, NULL, false, ${q(k())})`, 0.2)));
  assert.equal(propostas.every((r) => r.ok), true, propostas.map((r) => r.erro).join(' | '));
  assert.equal(adm(`SELECT count(*) FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`), '1');
  assert.equal(adm(`SELECT count(*) FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'substituido'`), '2');
  const g = adm(`SELECT id FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`);
  // O cliente aceita em duas abas enquanto a empresa propõe outro: um efeito coerente.
  const [a1, a2, nova] = await Promise.all([
    sessao(P.C1, `SELECT public.responder_reagendamento(${q(g)}, true, NULL, false, NULL, ${q(k())})`, 0.3),
    sessao(P.C1, `SELECT public.responder_reagendamento(${q(g)}, true, NULL, false, NULL, ${q(k())})`, 0.3),
    sessao(P.G, `SELECT public.propor_horario_os(${q(c.os)}, ${q(segunda('15:00', 8))}, 60, 'Mudança de rota do técnico.', true, NULL, false, ${q(k())})`, 0.3)]);
  assert.ok([a1, a2].filter((r) => r.ok).length <= 1, `${a1.erro} | ${a2.erro}`);
  assert.ok(Number(adm(`SELECT count(*) FROM public.agendamentos WHERE solicitacao_id = ${q(c.s)} AND estado = 'confirmado'`)) <= 1);
  assert.ok(Number(adm(`SELECT count(*) FROM public.reagendamentos WHERE os_id = ${q(c.os)} AND estado = 'pendente'`)) <= 1);
  assert.equal(nova.ok || /mudou|STATE_CONFLICT|motivo/.test(nova.erro), true, nova.erro);
  // Duas OS diferentes no mesmo horário ao mesmo tempo: a segunda vê a primeira nos avisos (trava da agenda).
  const x = contratar({ interna: true, valor: 5000 });
  const y = contratar({ interna: true, valor: 5000 });
  const hora = segunda('16:00', 9);
  const rs = await Promise.all([x.os, y.os].map((o) => sessao(P.G, `SELECT public.propor_horario_os(${q(o)}, ${q(hora)}, 60, NULL, false, NULL, true, ${q(k())})::text`, 0.3)));
  const gravados = rs.map((r) => JSON.parse(r.saida.split('\n').find((l) => l.startsWith('{')))).filter((r) => r.gravado);
  assert.equal(gravados.length, 1, JSON.stringify(rs.map((r) => r.saida)));
});

test('pacotes (D9-22): 2 a 10 serviços ativos da empresa, preço fechado sem valor em dobro; sem itens, não recebe pedido', opcoes, () => {
  const pac = ok(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Pacote casa segura', politica_preco: 'pacote', preco_centavos: 45000 })}, ${q(k())}`);
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Pacote sem preço', politica_preco: 'pacote' })}, ${q(k())}`), 'Informe o preço');
  falha(rpc(P.C1, 'criar_solicitacao', `${q(pac.id)}, ${j({ relato: 'Quero o pacote completo.' })}, ${q(k())}`), 'ainda não tem os serviços');
  const outro = ok(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Revisão do quadro', politica_preco: 'fixo', preco_centavos: 15000 })}, ${q(k())}`);
  falha(rpc(P.T, 'salvar_itens_pacote', `${q(pac.id)}, ARRAY[${q(M.servico)}, ${q(outro.id)}]::uuid[], ${versaoServ(pac.id)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'salvar_itens_pacote', `${q(pac.id)}, ARRAY[${q(M.servico)}]::uuid[], ${versaoServ(pac.id)}, ${q(k())}`), '2 a 10');
  falha(rpc(P.G, 'salvar_itens_pacote', `${q(pac.id)}, ARRAY[${q(M.servico)}, ${q(M.servico)}]::uuid[], ${versaoServ(pac.id)}, ${q(k())}`), 'diferentes');
  falha(rpc(P.G, 'salvar_itens_pacote', `${q(pac.id)}, ARRAY[${q(M.servico)}, ${q(M.servicoB)}]::uuid[], ${versaoServ(pac.id)}, ${q(k())}`), 'desta empresa');
  falha(rpc(P.G, 'salvar_itens_pacote', `${q(pac.id)}, ARRAY[${q(M.servico)}, ${q(pac.id)}]::uuid[], ${versaoServ(pac.id)}, ${q(k())}`), 'outro pacote');
  falha(rpc(P.G, 'salvar_itens_pacote', `${q(outro.id)}, ARRAY[${q(M.servico)}, ${q(pac.id)}]::uuid[], ${versaoServ(outro.id)}, ${q(k())}`), 'não é um pacote');
  const salvo = ok(P.G, 'salvar_itens_pacote', `${q(pac.id)}, ARRAY[${q(M.servico)}, ${q(outro.id)}]::uuid[], ${versaoServ(pac.id)}, ${q(k())}`);
  assert.equal(salvo.itens_pacote.length, 2);
  falha(rpc(P.G, 'alterar_servico', `${q(outro.id)}, ${j({ politica_preco: 'pacote' })}, ${versaoServ(outro.id)}, ${q(k())}`), 'faz parte de um pacote');
  const e = ok(P.C1, 'estimar_servico', `${q(pac.id)}, '{}'::jsonb`);
  assert.equal(e.tipo, 'pacote');
  assert.equal(e.valor_centavos, 45000);
  assert.equal(e.base.length, 1);   // um valor só: os serviços incluídos não somam
  assert.equal(e.itens_pacote.length, 2);
  const s = ok(P.C1, 'criar_solicitacao', `${q(pac.id)}, ${j({ relato: 'Quero o pacote completo.' })}, ${q(k())}`);
  assert.equal(s.estimativa.valor_centavos, 45000);
  assert.equal(ok(P.C1, 'servicos_para_cliente', q(A)).servicos?.find?.((x) => x.id === pac.id)?.politica_preco ?? 'pacote', 'pacote');
});

test('privilégios e conferência final: funções internas fechadas, públicas com definer e search_path vazio; rollback recusado com dados', opcoes, () => {
  assert.equal(adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app_private'
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anonymous', p.oid, 'EXECUTE'))`), '0');
  const novas = ['ordens_da_empresa', 'os_detalhe', 'minhas_os', 'minha_os', 'mudar_estado_os', 'cancelar_os', 'propor_custos_cancelamento',
    'responder_custos', 'gerar_titulo_custos', 'registrar_uso_material', 'propor_horario_os', 'pedir_reagendamento_os', 'agenda_operacional', 'reconciliar_os'];
  assert.equal(adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN (${novas.map(q).join(',')}) AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anonymous', p.oid, 'EXECUTE')`), String(novas.length));
  falha(rpc(P.G, 'reconciliar_os', q(A)), 'Só o proprietário');
  const r = ok(P.O, 'reconciliar_os', q(A));
  assert.equal(r.consistente, true, JSON.stringify(r));
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55');
  // Linha do tempo imutável.
  falha(sql(banco.url, `UPDATE public.os_eventos SET texto = 'x' WHERE os_id = ${q(M.os1)}`), 'não|imut|histórico|FORBIDDEN');
  falha(sql(banco.url, `DELETE FROM public.ordens_servico WHERE id = ${q(M.os1)}`), 'não|imut|histórico|FORBIDDEN');
  assert.throws(() => aplicarArquivo(banco.url, 'db/migrations_propostas/202611130001_ordens_servico.down.sql'), /Decisão humana/);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611130001'"), '1');
});
