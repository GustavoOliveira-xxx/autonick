/**
 * Testes de banco do M03 (migration 202611010003, sobre o esquema atual até a 202611010006): empresas, vitrine, CK,
 * moderação, suspensão e contestação. PostgreSQL LOCAL com emulação do Neon.
 * Cenários de MINI-ESPEC_M03 §11 e §12 (DBT-001, 005, 006, 016, 021, 022;
 * SEC-T04, T05, T10, T21).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };

// Identidades fictícias
const G1 = '10000000-0000-4000-8000-000000000001'; // gestor A, e-mail confirmado
const G2 = '20000000-0000-4000-8000-000000000002'; // gestor B
const U = '30000000-0000-4000-8000-000000000003';  // gestor sem e-mail confirmado
const C = '40000000-0000-4000-8000-000000000004';  // só perfil Cliente
const CK = '50000000-0000-4000-8000-000000000005'; // CK Admin
const CK2 = '60000000-0000-4000-8000-000000000006'; // segundo CK Admin
const M = '70000000-0000-4000-8000-000000000007';  // CK Admin que também é gestor

let chave = 0;
const k = () => `chave-teste-${String(++chave).padStart(4, '0')}`;
const q = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
const jsonb = (obj) => `${q(JSON.stringify(obj))}::jsonb`;

function como(sub, comando) {
  return comoPapel(banco.url, { sub }, comando);
}
function obj(sub, expressao) {
  const r = como(sub, `SELECT (${expressao})::text`);
  assert.ok(r.ok, r.erro);
  return JSON.parse(r.saida);
}
function falha(r, codigo) {
  assert.equal(r.ok, false, `deveria falhar com ${codigo}`);
  assert.match(r.erro, new RegExp(codigo), r.erro);
}
const adm = (comando) => {
  const r = sql(banco.url, comando);
  assert.ok(r.ok, r.erro);
  return r.saida;
};

let categoria;
const base = () => ({
  nome_publico: 'Doces da Vila Teste',
  modalidade: 'comercio',
  categoria_id: categoria,
  cidade: 'Campinas',
  uf: 'SP',
  bairro: 'Centro',
  descricao_publica: 'Bolos e doces caseiros sob encomenda.',
  horario_funcionamento: 'Segunda a sábado, das 9h às 18h',
  email_contato: 'contato@doces-teste.example',
  documento: '12345678000199',
  endereco_privado: 'Rua Fictícia, 100',
});
const criar = (sub, dados = base(), chaveOp = k()) => como(sub, `SELECT public.criar_empresa(${jsonb(dados)}, ${q(chaveOp)})::text`);
const enviar = (sub, id, versao, chaveOp = k()) => como(sub, `SELECT public.enviar_vitrine_para_analise(${q(id)}, ${versao}, ${q(chaveOp)})::text`);
const decidir = (sub, sol, decisao, motivo = null, campos = null, chaveOp = k()) =>
  como(sub, `SELECT public.ck_decidir_solicitacao(${q(sol)}, ${q(decisao)}, ${motivo === null ? 'NULL' : q(motivo)}, ${campos ? `ARRAY[${campos.map(q).join(',')}]` : 'NULL'}, ${q(chaveOp)})::text`);
const atualizar = (sub, id, dados, versao, chaveOp = k()) =>
  como(sub, `SELECT public.atualizar_empresa(${q(id)}, ${jsonb(dados)}, ${versao}, ${q(chaveOp)})::text`);
// Desde a 202611010006 a tabela não entrega colunas privadas: a visibilidade é conferida
// pela RLS (como o usuário) e o conteúdo é lido como administrador do banco.
const empresa = (sub, id) => {
  const r = como(sub, `SELECT count(*) FROM public.empresas e WHERE id = ${q(id)}`);
  assert.ok(r.ok, r.erro);
  if (r.saida !== '1') return null;
  return JSON.parse(adm(`SELECT row_to_json(e)::text FROM public.empresas e WHERE id = ${q(id)}`));
};
const cartao = (id) => {
  const r = sql(banco.url, `SELECT row_to_json(c)::text FROM public.public_empresa_cards c WHERE empresa_id = ${q(id)}`);
  return r.saida ? JSON.parse(r.saida) : null;
};
const solAberta = (id) => adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(id)} AND estado = 'aberta'`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010001_fundacao_identidade.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010002_correcao_identidade_sessao.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010003_empresas_ck.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010004_identidade_vazia_explicita.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010005_marcacao_dados_de_teste.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010006_equipe_permissoes.sql');
  sql(banco.url, `INSERT INTO neon_auth."user" (id, email, "emailVerified") VALUES
    ('${G1}', 'g1@teste.example', true), ('${G2}', 'g2@teste.example', true), ('${U}', 'u@teste.example', false),
    ('${C}', 'c@teste.example', true), ('${CK}', 'ck@teste.example', true), ('${CK2}', 'ck2@teste.example', true),
    ('${M}', 'm@teste.example', true)`);
  for (const sub of [G1, G2, U, M]) comoPapel(banco.url, { sub }, "SELECT public.garantir_perfil('business', 'Gestor Teste')");
  comoPapel(banco.url, { sub: C }, "SELECT public.garantir_perfil('cliente', 'Cliente Teste')");
  sql(banco.url, `SELECT app_private.conceder_ck_admin('${CK}', 'teste'), app_private.conceder_ck_admin('${CK2}', 'teste'), app_private.conceder_ck_admin('${M}', 'teste')`);
  categoria = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'alimentacao'").saida;
});
after(() => banco?.encerrar());

// Estado compartilhado entre testes (executados em ordem)
let e1;
let e2;

test('gestor cria empresa: rascunho, ERP ativa, proprietário e evento (T1)', opcoes, () => {
  const operacao = k();
  const r = criar(G1, base(), operacao);
  assert.ok(r.ok, r.erro);
  e1 = JSON.parse(r.saida);
  assert.equal(e1.situacao_vitrine, 'rascunho');
  assert.equal(e1.situacao_erp, 'ativa');
  assert.equal(e1.versao, 1);
  assert.equal(adm(`SELECT papel FROM public.membros_empresa WHERE empresa_id = ${q(e1.id)} AND auth_user_id = '${G1}'`), 'proprietario');
  assert.equal(adm(`SELECT tipo FROM public.eventos_publicacao WHERE empresa_id = ${q(e1.id)}`), 'empresa_criada');
  // Idempotência: mesma chave e mesmos dados devolvem a mesma empresa.
  const repetida = JSON.parse(criar(G1, base(), operacao).saida);
  assert.equal(repetida.id, e1.id);
  assert.equal(adm(`SELECT count(*) FROM public.empresas WHERE criada_por = '${G1}'`), '1');
  // Mesma chave com outros dados: conflito, nada gravado.
  falha(criar(G1, { ...base(), nome_publico: 'Outro Nome' }, operacao), 'IDEMPOTENCY_CONFLICT');
});

test('perfil Cliente e sessão anônima não criam empresa (ADR-001 = B)', opcoes, () => {
  falha(criar(C), 'FORBIDDEN_ACTION');
  const anonimo = comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.criar_empresa(${jsonb(base())}, 'chave-anonima')`);
  falha(anonimo, 'permission denied');
});

test('validação no banco: UF fora de SP, contato na descrição e campo não permitido', opcoes, () => {
  falha(criar(G2, { ...base(), uf: 'RJ' }), 'VALIDATION_ERROR');
  falha(criar(G2, { ...base(), descricao_publica: 'Ligue (19) 99999-1234' }), 'VALIDATION_ERROR');
  falha(criar(G2, { ...base(), descricao_publica: 'Veja www.exemplo.com.br' }), 'VALIDATION_ERROR');
  falha(criar(G2, { ...base(), horario_funcionamento: 'fale em teste@exemplo.com' }), 'VALIDATION_ERROR');
  falha(criar(G2, { ...base(), situacao_vitrine: 'publicada' }), 'VALIDATION_ERROR');
  falha(criar(G2, { ...base(), documento: '123' }), 'VALIDATION_ERROR');
  assert.equal(adm(`SELECT count(*) FROM public.empresas WHERE criada_por = '${G2}'`), '0');
});

test('isolamento entre empresas: B não lê, não altera e não envia a empresa de A (DBT-001, DBT-006)', opcoes, () => {
  assert.equal(empresa(G2, e1.id), null);
  falha(atualizar(G2, e1.id, { nome_publico: 'Invadido' }, 1), 'TENANT_FORBIDDEN');
  falha(enviar(G2, e1.id, 1), 'TENANT_FORBIDDEN');
  falha(como(G2, `SELECT public.abrir_contestacao(${q(e1.id)}, 'motivo qualquer longo', ${q(k())})`), 'TENANT_FORBIDDEN');
  assert.equal(empresa(G1, e1.id).nome_publico, 'Doces da Vila Teste');
});

test('nenhuma escrita direta pela Data API e nenhum acesso anônimo', opcoes, () => {
  falha(como(G1, `UPDATE public.empresas SET situacao_vitrine = 'publicada' WHERE id = ${q(e1.id)}`), 'permission denied');
  falha(como(G1, `INSERT INTO public.public_empresa_cards (empresa_id, nome_publico, modalidade, categoria_id, cidade, uf) VALUES (${q(e1.id)}, 'x', 'comercio', ${q(categoria)}, 'x', 'SP')`), 'permission denied');
  falha(como(G1, `INSERT INTO public.solicitacoes_publicacao (empresa_id, tipo, dados_publicos, enviada_por) VALUES (${q(e1.id)}, 'publicacao_inicial', '{}', 'x')`), 'permission denied');
  falha(como(G1, `DELETE FROM public.eventos_publicacao WHERE empresa_id = ${q(e1.id)}`), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT count(*) FROM public.empresas'), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT count(*) FROM public.public_empresa_cards'), 'permission denied');
});

test('envio exige e-mail confirmado e versão atual', opcoes, () => {
  const eu = JSON.parse(criar(U, { ...base(), nome_publico: 'Empresa Sem Email' }).saida);
  falha(enviar(U, eu.id, eu.versao), 'FORBIDDEN_ACTION');
  falha(enviar(G1, e1.id, 99), 'VERSION_CONFLICT');
});

test('gestor envia: em análise com cópia congelada; repetição e reenvio (T2)', opcoes, () => {
  const operacao = k();
  const r = enviar(G1, e1.id, 1, operacao);
  assert.ok(r.ok, r.erro);
  const depois = JSON.parse(r.saida);
  assert.equal(depois.situacao_vitrine, 'em_analise');
  assert.equal(depois.solicitacao_aberta.tipo, 'publicacao_inicial');
  // Mesma chave: mesmo resultado, uma única solicitação.
  assert.equal(JSON.parse(enviar(G1, e1.id, 1, operacao).saida).solicitacao_aberta.id, depois.solicitacao_aberta.id);
  assert.equal(adm(`SELECT count(*) FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(e1.id)}`), '1');
  // Outra chave com envio já aberto: conflito de estado.
  falha(enviar(G1, e1.id, depois.versao), 'STATE_CONFLICT');
  // A cópia congelada não muda nem pelo dono do banco.
  const s = solAberta(e1.id);
  assert.equal(sql(banco.url, `UPDATE public.solicitacoes_publicacao SET dados_publicos = '{}' WHERE id = ${q(s)}`).ok, false);
  e1 = depois;
});

test('gestor não executa ações da CK nem se torna CK (SEC-T05, RF-032)', opcoes, () => {
  const s = solAberta(e1.id);
  falha(decidir(G1, s, 'aprovar'), 'FORBIDDEN_ACTION');
  falha(como(G1, `SELECT public.ck_suspender_vitrine(${q(e1.id)}, 'motivo de teste longo', 'comum', NULL, ${q(k())})`), 'FORBIDDEN_ACTION');
  falha(como(G1, 'SELECT * FROM public.ck_listar_empresas()'), 'FORBIDDEN_ACTION');
  falha(como(G1, `SELECT app_private.conceder_ck_admin('${G1}', 'eu')`), 'permission denied');
  assert.equal(como(G1, 'SELECT public.sou_ck_admin()').saida, 'f');
  assert.equal(como(CK, 'SELECT public.sou_ck_admin()').saida, 't');
});

test('CK não lê dados privados da empresa; a lista da CK só tem dados públicos (DBT-005, SEC-T21)', opcoes, () => {
  assert.equal(como(CK, 'SELECT count(*) FROM public.empresas').saida, '0');
  const lista = como(CK, 'SELECT row_to_json(l)::text FROM public.ck_listar_empresas() l LIMIT 1');
  assert.ok(lista.ok, lista.erro);
  const linha = JSON.parse(lista.saida);
  for (const privado of ['documento', 'email_contato', 'endereco_privado', 'observacoes_internas']) {
    assert.equal(privado in linha, false, privado);
  }
  const snapshot = JSON.parse(como(CK, `SELECT dados_publicos::text FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(e1.id)}`).saida);
  assert.equal('documento' in snapshot, false);
  assert.equal('email_contato' in snapshot, false);
});

test('CK que é membro da empresa não decide sobre ela (conflito de interesse)', opcoes, () => {
  const em = JSON.parse(criar(M, { ...base(), nome_publico: 'Empresa da Pessoa CK' }).saida);
  assert.ok(enviar(M, em.id, em.versao).ok);
  falha(decidir(M, solAberta(em.id), 'aprovar'), 'conflito de interesse');
  assert.ok(decidir(CK, solAberta(em.id), 'aprovar').ok);
});

test('CK pede correção; reenvio exige mudar campo apontado (T4, T6)', opcoes, () => {
  falha(decidir(CK, solAberta(e1.id), 'pedir_correcao', 'Ajuste o nome público, por favor.'), 'VALIDATION_ERROR');
  falha(decidir(CK, solAberta(e1.id), 'pedir_correcao', 'curto', ['nome_publico']), 'VALIDATION_ERROR');
  assert.ok(decidir(CK, solAberta(e1.id), 'pedir_correcao', 'Ajuste o nome público, por favor.', ['nome_publico']).ok);
  let atual = empresa(G1, e1.id);
  assert.equal(atual.situacao_vitrine, 'correcao_solicitada');
  // Sem mudar o campo apontado: recusado.
  falha(enviar(G1, e1.id, atual.versao), 'VALIDATION_ERROR');
  assert.ok(atualizar(G1, e1.id, { nome_publico: 'Doces da Vila' }, atual.versao).ok);
  atual = empresa(G1, e1.id);
  assert.ok(enviar(G1, e1.id, atual.versao).ok);
  assert.equal(empresa(G1, e1.id).situacao_vitrine, 'em_analise');
});

test('CK rejeita com motivo; gestor pode corrigir e reenviar (T5, T7, Q2)', opcoes, () => {
  falha(decidir(CK, solAberta(e1.id), 'rejeitar'), 'VALIDATION_ERROR');
  assert.ok(decidir(CK, solAberta(e1.id), 'rejeitar', 'Categoria não corresponde ao negócio.').ok);
  const atual = empresa(G1, e1.id);
  assert.equal(atual.situacao_vitrine, 'rejeitada');
  assert.equal(cartao(e1.id), null);
  assert.ok(enviar(G1, e1.id, atual.versao).ok);
  assert.equal(empresa(G1, e1.id).situacao_vitrine, 'em_analise');
});

test('CK aprova: projeção com campos públicos e selo, sem campos privados (T3, SEC-T10)', opcoes, () => {
  const s = solAberta(e1.id);
  assert.ok(decidir(CK, s, 'aprovar').ok);
  const atual = empresa(G1, e1.id);
  assert.equal(atual.situacao_vitrine, 'publicada');
  assert.equal(atual.situacao_erp, 'ativa');
  const c = cartao(e1.id);
  assert.equal(c.nome_publico, 'Doces da Vila');
  assert.equal(c.selo, 'Aprovado para publicação');
  assert.equal(c.solicitacao_origem_id, s);
  const colunas = adm("SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'public_empresa_cards'");
  for (const privado of ['documento', 'email_contato', 'endereco_privado', 'observacoes_internas']) {
    assert.equal(colunas.split(',').includes(privado), false, privado);
  }
  falha(decidir(CK, s, 'rejeitar', 'Decisão repetida em envio já decidido.'), 'STATE_CONFLICT');
});

test('concorrência: duas pessoas da CK decidem o mesmo envio; só a primeira vence', opcoes, async () => {
  e2 = JSON.parse(criar(G2, { ...base(), nome_publico: 'Oficina Concorrente' }).saida);
  assert.ok(enviar(G2, e2.id, e2.versao).ok);
  const s = solAberta(e2.id);
  const sessao = (sub, decisao, espera) => new Promise((resolver) => {
    const bloco = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true) \\gset
SELECT public.ck_decidir_solicitacao('${s}', '${decisao}', 'Motivo da decisão concorrente.', NULL, '${k()}');
SELECT pg_sleep(${espera});
COMMIT;`;
    const p = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', banco.url]);
    let erro = '';
    p.stderr.on('data', (d) => { erro += d; });
    p.on('close', (codigo) => resolver({ ok: codigo === 0, erro }));
    p.stdin.end(bloco);
  });
  const primeira = sessao(CK, 'aprovar', 1.0);
  await new Promise((r) => setTimeout(r, 300));
  const segunda = sessao(CK2, 'rejeitar', 0);
  const [a, b] = await Promise.all([primeira, segunda]);
  assert.ok(a.ok, a.erro);
  falha(b, 'STATE_CONFLICT');
  assert.equal(adm(`SELECT estado FROM public.solicitacoes_publicacao WHERE id = ${q(s)}`), 'aprovada');
  assert.equal(adm(`SELECT situacao_vitrine FROM public.empresas WHERE id = ${q(e2.id)}`), 'publicada');
});

test('falha no meio da transação desfaz tudo (DBT-022)', opcoes, () => {
  const e3 = JSON.parse(criar(G2, { ...base(), nome_publico: 'Empresa Rollback' }).saida);
  assert.ok(enviar(G2, e3.id, e3.versao).ok);
  const s = solAberta(e3.id);
  const r = como(CK, `SELECT public.ck_decidir_solicitacao(${q(s)}, 'aprovar', NULL, NULL, ${q(k())}); SELECT 1/0`);
  assert.equal(r.ok, false);
  assert.equal(adm(`SELECT situacao_vitrine FROM public.empresas WHERE id = ${q(e3.id)}`), 'em_analise');
  assert.equal(cartao(e3.id), null);
  assert.equal(adm(`SELECT estado FROM public.solicitacoes_publicacao WHERE id = ${q(s)}`), 'aberta');
});

test('Q4 = B: alteração de menor risco publica na hora e vai para moderação (R6)', opcoes, () => {
  let atual = empresa(G1, e1.id);
  const r = atualizar(G1, e1.id, { descricao_publica: 'Bolos, tortas e doces caseiros.' }, atual.versao);
  assert.ok(r.ok, r.erro);
  assert.deepEqual(JSON.parse(r.saida).publicado_direto, ['descricao_publica']);
  assert.equal(cartao(e1.id).descricao_publica, 'Bolos, tortas e doces caseiros.');
  assert.equal(adm(`SELECT estado FROM public.moderacoes_vitrine WHERE empresa_id = ${q(e1.id)}`), 'pendente');
  atual = empresa(G1, e1.id);
  falha(atualizar(G1, e1.id, { descricao_publica: 'Pedidos: (19) 98888-7777' }, atual.versao), 'VALIDATION_ERROR');
  assert.equal(cartao(e1.id).descricao_publica, 'Bolos, tortas e doces caseiros.');
});

test('Q4 = B: alteração relevante fica fora do ar até a CK aprovar (R1 a R3, Q3)', opcoes, () => {
  let atual = empresa(G1, e1.id);
  // Edição mista: horário publica, cidade fica pendente.
  const r = atualizar(G1, e1.id, { cidade: 'Valinhos', horario_funcionamento: 'Terça a sábado, das 10h às 19h' }, atual.versao);
  assert.ok(r.ok, r.erro);
  const resposta = JSON.parse(r.saida);
  assert.deepEqual(resposta.publicado_direto, ['horario_funcionamento']);
  assert.deepEqual(resposta.relevantes_pendentes, ['cidade']);
  assert.equal(cartao(e1.id).cidade, 'Campinas');
  assert.equal(cartao(e1.id).horario_funcionamento, 'Terça a sábado, das 10h às 19h');
  atual = empresa(G1, e1.id);
  assert.ok(enviar(G1, e1.id, atual.versao).ok);
  const s = solAberta(e1.id);
  assert.equal(adm(`SELECT tipo FROM public.solicitacoes_publicacao WHERE id = ${q(s)}`), 'alteracao');
  assert.equal(empresa(G1, e1.id).situacao_vitrine, 'publicada');
  assert.equal(cartao(e1.id).cidade, 'Campinas');
  assert.ok(decidir(CK, s, 'aprovar').ok);
  assert.equal(cartao(e1.id).cidade, 'Valinhos');
  // Sem alteração relevante, não há o que enviar.
  falha(enviar(G1, e1.id, empresa(G1, e1.id).versao), 'VALIDATION_ERROR');
});

test('moderação: restaurar volta a versão anterior; manter e pedir correção mantêm (R7)', opcoes, () => {
  const pendentes = adm(`SELECT string_agg(id::text, ',' ORDER BY criada_em) FROM public.moderacoes_vitrine WHERE empresa_id = ${q(e1.id)} AND estado = 'pendente'`).split(',');
  assert.equal(pendentes.length, 2);
  falha(como(G1, `SELECT public.ck_moderar_alteracao_direta(${q(pendentes[0])}, 'manter', NULL, ${q(k())})`), 'FORBIDDEN_ACTION');
  falha(como(CK, `SELECT public.ck_moderar_alteracao_direta(${q(pendentes[0])}, 'restaurar', NULL, ${q(k())})`), 'VALIDATION_ERROR');
  assert.ok(como(CK, `SELECT public.ck_moderar_alteracao_direta(${q(pendentes[0])}, 'restaurar', 'Descrição promete prazo indevido.', ${q(k())})`).ok);
  assert.equal(cartao(e1.id).descricao_publica, 'Bolos e doces caseiros sob encomenda.');
  assert.equal(empresa(G1, e1.id).descricao_publica, 'Bolos e doces caseiros sob encomenda.');
  assert.ok(como(CK, `SELECT public.ck_moderar_alteracao_direta(${q(pendentes[1])}, 'manter', NULL, ${q(k())})`).ok);
  assert.equal(cartao(e1.id).horario_funcionamento, 'Terça a sábado, das 10h às 19h');
  falha(como(CK, `SELECT public.ck_moderar_alteracao_direta(${q(pendentes[1])}, 'restaurar', 'Moderação repetida aqui.', ${q(k())})`), 'STATE_CONFLICT');
});

test('suspensão: gravidade e fundamento, projeção removida na mesma transação, ERP intacto (T8, Q6)', opcoes, () => {
  // Alteração relevante aberta deve ser cancelada pela suspensão.
  let atual = empresa(G1, e1.id);
  assert.ok(atualizar(G1, e1.id, { bairro: 'Jardim Teste' }, atual.versao).ok);
  assert.ok(enviar(G1, e1.id, empresa(G1, e1.id).versao).ok);
  const susp = (gravidade, fundamento) => como(CK, `SELECT public.ck_suspender_vitrine(${q(e1.id)}, 'Denúncia de produto irregular.', ${gravidade === null ? 'NULL' : q(gravidade)}, ${fundamento === null ? 'NULL' : q(fundamento)}, ${q(k())})`);
  falha(susp(null, null), 'VALIDATION_ERROR');
  falha(susp('grave', null), 'VALIDATION_ERROR');
  falha(susp('comum', 'fraude'), 'VALIDATION_ERROR');
  assert.ok(susp('grave', 'risco_consumidor').ok);
  atual = empresa(G1, e1.id);
  assert.equal(atual.situacao_vitrine, 'suspensa');
  assert.equal(atual.situacao_erp, 'ativa');
  assert.equal(atual.suspensao_gravidade, 'grave');
  assert.equal(atual.suspensao_fundamento, 'risco_consumidor');
  assert.equal(cartao(e1.id), null);
  assert.equal(adm(`SELECT count(*) FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(e1.id)} AND estado = 'cancelada_por_suspensao'`), '1');
  assert.equal(adm(`SELECT fundamento FROM public.eventos_publicacao WHERE empresa_id = ${q(e1.id)} AND tipo = 'suspensa'`), 'risco_consumidor');
  falha(susp('comum', null), 'STATE_CONFLICT');
});

test('contestação da suspensão: decisão pelo mesmo administrador, com justificativa (Q7 = C, T11)', opcoes, () => {
  falha(como(G1, `SELECT public.abrir_contestacao(${q(e1.id)}, 'curto', ${q(k())})`), 'VALIDATION_ERROR');
  const r = como(G1, `SELECT public.abrir_contestacao(${q(e1.id)}, 'O produto foi retirado e há nota fiscal.', ${q(k())})::text`);
  assert.ok(r.ok, r.erro);
  const ct = JSON.parse(r.saida);
  falha(como(G1, `SELECT public.abrir_contestacao(${q(e1.id)}, 'Segunda contestação simultânea.', ${q(k())})`), 'STATE_CONFLICT');
  falha(como(CK, `SELECT public.ck_decidir_contestacao(${q(ct.id)}, 'deferir', 'Justificativa suficiente e detalhada.', ${q(k())})`), 'STATE_CONFLICT');
  assert.ok(como(CK, `SELECT public.ck_assumir_contestacao(${q(ct.id)}, ${q(k())})`).ok);
  falha(como(CK, `SELECT public.ck_decidir_contestacao(${q(ct.id)}, 'deferir', 'curta', ${q(k())})`), 'VALIDATION_ERROR');
  const d = como(CK, `SELECT public.ck_decidir_contestacao(${q(ct.id)}, 'deferir', 'Nota fiscal comprova a regularidade do produto.', ${q(k())})::text`);
  assert.ok(d.ok, d.erro);
  const resultado = JSON.parse(d.saida);
  assert.equal(resultado.mesmo_decisor, true);
  assert.equal(resultado.situacao_vitrine, 'publicada');
  assert.equal(cartao(e1.id).cidade, 'Valinhos');
  assert.equal(empresa(G1, e1.id).suspensao_gravidade, null);
});

test('contestação de rejeição decidida por outra pessoa da CK: nova análise (T10)', opcoes, () => {
  const e4 = JSON.parse(criar(G2, { ...base(), nome_publico: 'Empresa Contestada' }).saida);
  assert.ok(enviar(G2, e4.id, e4.versao).ok);
  assert.ok(decidir(CK, solAberta(e4.id), 'rejeitar', 'Dados insuficientes para publicação.').ok);
  const ct = JSON.parse(como(G2, `SELECT public.abrir_contestacao(${q(e4.id)}, 'Os dados estão completos, revejam.', ${q(k())})::text`).saida);
  // Enquanto a contestação está aberta, o reenvio direto é bloqueado.
  falha(enviar(G2, e4.id, empresa(G2, e4.id).versao), 'STATE_CONFLICT');
  assert.ok(como(CK2, `SELECT public.ck_assumir_contestacao(${q(ct.id)}, ${q(k())})`).ok);
  const resultado = JSON.parse(como(CK2, `SELECT public.ck_decidir_contestacao(${q(ct.id)}, 'deferir', 'Os dados atendem aos requisitos mínimos.', ${q(k())})::text`).saida);
  assert.equal(resultado.mesmo_decisor, false);
  assert.equal(resultado.situacao_vitrine, 'em_analise');
  assert.equal(adm(`SELECT origem_contestacao_id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(e4.id)} AND estado = 'aberta'`), ct.id);
});

test('gestor não vê quem da CK decidiu; CK vê o histórico completo', opcoes, () => {
  falha(como(G1, 'SELECT ator_auth_id FROM public.eventos_publicacao LIMIT 1'), 'permission denied');
  falha(como(G1, 'SELECT decidida_por FROM public.solicitacoes_publicacao LIMIT 1'), 'permission denied');
  const motivos = como(G1, `SELECT count(*) FROM public.eventos_publicacao WHERE empresa_id = ${q(e1.id)} AND motivo IS NOT NULL`);
  assert.ok(Number(motivos.saida) >= 3);
  const historico = como(CK, `SELECT count(*) FROM public.ck_historico_empresa(${q(e1.id)}) WHERE ator_auth_id = '${CK}'`);
  assert.ok(Number(historico.saida) >= 5, historico.erro);
  falha(como(G1, `SELECT * FROM public.ck_historico_empresa(${q(e1.id)})`), 'FORBIDDEN_ACTION');
});

test('histórico e auditoria imutáveis, inclusive para o dono do banco (DBT-021)', opcoes, () => {
  assert.equal(sql(banco.url, 'UPDATE public.eventos_publicacao SET motivo = NULL').ok, false);
  assert.equal(sql(banco.url, 'DELETE FROM public.eventos_publicacao').ok, false);
  assert.equal(sql(banco.url, 'DELETE FROM public.solicitacoes_publicacao').ok, false);
  assert.equal(sql(banco.url, 'DELETE FROM public.contestacoes').ok, false);
  assert.ok(Number(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao LIKE 'ck.%'")) >= 8);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'ck_admin.concedido'"), '3');
});

test('rollback da 202611010003 remove o M03 e preserva o M02', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010006_equipe_permissoes.down.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010005_marcacao_dados_de_teste.down.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010004_identidade_vazia_explicita.down.sql');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010003_empresas_ck.down.sql');
  assert.equal(adm("SELECT to_regclass('public.empresas') IS NULL"), 't');
  assert.equal(adm("SELECT string_agg(id, ',' ORDER BY id) FROM app_private.historico_migracoes"), '202611010001,202611010002');
  assert.ok(Number(adm('SELECT count(*) FROM public.perfis_identidade')) >= 5);
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611010003_empresas_ck.sql');
  assert.equal(adm("SELECT string_agg(id, ',' ORDER BY id) FROM app_private.historico_migracoes"), '202611010001,202611010002,202611010003');
});
