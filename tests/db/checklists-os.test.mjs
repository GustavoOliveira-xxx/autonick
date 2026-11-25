/**
 * Testes de banco do E07 (migration 202611290001): checklist persistente das OS.
 * - Adicionar itens, responsável da equipe, concluir com data e autor, observação, reabrir, remover; histórico na linha do tempo.
 * - Obrigatório pendente impede concluir a OS (no banco); opcional nunca bloqueia.
 * - Cliente vê só os itens marcados como visíveis; outra empresa e perfil sem permissão negados. Modelos. Rollback.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const ID = (n) => `ea070000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-e07@teste.example', nome: 'Dona Olga', tipo: 'business' },
  C: { id: ID(2), email: 'cliente-e07@teste.example', nome: 'Cliente Cida', tipo: 'cliente' },
  OUT: { id: ID(3), email: 'outra-e07@teste.example', nome: 'Dona de Outra', tipo: 'business' },
  TEC: { id: ID(4), email: 'tec-e07@teste.example', nome: 'Técnico Téo', tipo: 'business' },
};
let chave = 0;
const k = () => `e07-teste-${String(++chave).padStart(4, '0')}`;
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
const E = {};
const lista = () => ok(P.O, 'checklist_os', q(E.os));
const item = (texto) => lista().itens.find((i) => i.texto === texto);
const estadoOs = (acao) => rpc(P.O, 'mudar_estado_os', `${q(E.os)}, ${q(acao)}, NULL, ${versao('ordens_servico', E.os)}, ${q(k())}`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', bairro: 'Cambuí', uf: 'SP', email_contato: 'privado-e07@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Olga');
  E.b = nova(P.OUT, 'Outra Costura');
  ok(P.O, 'enviar_vitrine_para_analise', `${q(E.a)}, ${versao('empresas', E.a)}, ${q(k())}`);
  adm(`SELECT app_private.conceder_ck_admin(${q(P.OUT.id)}, 'teste E07')`);
  ok(P.OUT, 'ck_decidir_solicitacao', `${q(adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.a)} AND estado = 'aberta'`))}, 'aprovar', NULL, NULL, ${q(k())}`);
  const s = ok(P.O, 'criar_servico', `${q(E.a)}, ${j({ nome: 'Barra de calça', politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  ok(P.O, 'salvar_formulario_servico', `${q(s.id)}, ${j([{ texto: 'Peças', tipo: 'numero', obrigatoria: true, configuracao: { minimo: 1, maximo: 20 } }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  const perg = adm(`SELECT id FROM public.servico_perguntas WHERE servico_id = ${q(s.id)} AND ativa`);
  ok(P.O, 'salvar_regras_servico', `${q(s.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: perg, rotulo: 'Por peça', valor_unitario_centavos: 2500 }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  ok(P.O, 'definir_vitrine_servico', `${q(s.id)}, true, ${versao('servicos', s.id)}, ${q(k())}`);
  const sol = ok(P.C, 'criar_solicitacao', `${q(s.id)}, ${j({ respostas: { [perg]: 2 }, relato: 'Duas calças.' })}, ${q(k())}`).id;
  ok(P.C, 'aceitar_orcamento', `${q(sol)}, ${q(adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(sol)}`))}, true, ${q(k())}`);
  E.os = adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(sol)}`);
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, 'Técnico', NULL, ARRAY['servicos.visualizar']::text[], ${q(k())}`).id;
  const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P.TEC.email)}, ${q(perfil)}, ${q(k())}`);
  assert.ok(comoPapel(banco.url, { sub: P.TEC.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
});
after(() => banco?.encerrar());

test('itens: adicionar, responsável, concluir com autor e data, observação, reabrir, remover; histórico', opcoes, () => {
  assert.equal(ok(P.O, 'adicionar_itens_checklist', `${q(E.os)}, ${j([
    { texto: 'Conferir medidas', obrigatorio: true, responsavel_auth_id: P.TEC.id },
    { texto: 'Fotografar antes', visivel_cliente: true },
    { texto: 'Limpar a bancada' }])}, ${q(k())}`).adicionados, 3);
  const l = lista();
  assert.equal(l.itens.length, 3);
  assert.equal(l.pendentes_obrigatorios, 1);
  assert.equal(item('Conferir medidas').responsavel, 'Técnico Téo');
  falha(rpc(P.O, 'adicionar_itens_checklist', `${q(E.os)}, ${j([{ texto: 'Fora da equipe', responsavel_auth_id: P.OUT.id }])}, ${q(k())}`), 'equipe');
  falha(rpc(P.O, 'adicionar_itens_checklist', `${q(E.os)}, ${j([{ texto: 'x' }])}, ${q(k())}`), '2 a 200');
  const m = item('Conferir medidas');
  const feito = ok(P.O, 'alterar_item_checklist', `${q(m.id)}, ${j({ concluido: true, observacao: 'Cintura 82 cm.' })}, ${m.versao}, ${q(k())}`);
  assert.equal(feito.concluido, true);
  assert.equal(feito.concluido_por, 'Dona Olga');
  assert.ok(feito.concluido_em);
  assert.equal(feito.observacao, 'Cintura 82 cm.');
  falha(rpc(P.O, 'alterar_item_checklist', `${q(m.id)}, ${j({ concluido: false })}, ${m.versao}, ${q(k())}`), 'VERSION_CONFLICT|mudou');
  const reaberto = ok(P.O, 'alterar_item_checklist', `${q(m.id)}, ${j({ concluido: false })}, ${feito.versao}, ${q(k())}`);
  assert.deepEqual([reaberto.concluido, reaberto.concluido_por], [false, null]);
  const limpar = item('Limpar a bancada');
  assert.equal(ok(P.O, 'remover_item_checklist', `${q(limpar.id)}, ${limpar.versao}, ${q(k())}`).removido, true);
  assert.equal(lista().itens.length, 2);
  const hist = lista().historico.map((h) => h.tipo);
  for (const t of ['checklist_itens_adicionados', 'checklist_item_concluido', 'checklist_item_reaberto', 'checklist_item_removido']) assert.ok(hist.includes(t), t);
  falha(rpc(P.O, 'alterar_item_checklist', `${q(m.id)}, ${j({ campo_inventado: 1 })}, ${reaberto.versao}, ${q(k())}`), 'não permitido|VALIDATION');
});

test('obrigatório pendente impede concluir a OS; opcional não bloqueia', opcoes, () => {
  assert.ok(estadoOs('iniciar').ok);
  falha(estadoOs('concluir'), 'STATE_CONFLICT|item obrigatório');
  assert.equal(adm(`SELECT estado FROM public.ordens_servico WHERE id = ${q(E.os)}`), 'em_execucao');
  const m = item('Conferir medidas');
  ok(P.O, 'alterar_item_checklist', `${q(m.id)}, ${j({ concluido: true })}, ${m.versao}, ${q(k())}`);
  assert.equal(item('Fotografar antes').concluido, false, 'opcional continua pendente');
  assert.ok(estadoOs('concluir').ok, 'opcional pendente não bloqueia');
  falha(rpc(P.O, 'adicionar_itens_checklist', `${q(E.os)}, ${j([{ texto: 'Depois de concluída' }])}, ${q(k())}`), 'em andamento');
});

test('cliente vê só os visíveis; técnico só consulta; outra empresa negada', opcoes, () => {
  const cli = ok(P.C, 'checklist_os_cliente', q(E.os));
  assert.deepEqual(cli.map((i) => i.texto), ['Fotografar antes']);
  assert.ok(!JSON.stringify(cli).includes('Cintura'), 'observação interna não vai ao cliente');
  falha(rpc(P.OUT, 'checklist_os_cliente', q(E.os)), 'NOT_FOUND|não encontrado');
  assert.equal(ok(P.TEC, 'checklist_os', q(E.os)).pode_alterar, false);
  falha(rpc(P.OUT, 'checklist_os', q(E.os)), 'NOT_FOUND|não encontrada');
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.O.id }, 'SELECT count(*) FROM public.os_checklist_itens'), 'permission denied');
  // Linha do tempo pública mostra só o que é visível ao cliente.
  const publicos = adm(`SELECT string_agg(texto, '|' ORDER BY criado_em) FROM public.os_eventos WHERE os_id = ${q(E.os)} AND tipo LIKE 'checklist_%' AND publico`);
  assert.ok(!(publicos ?? '').includes('Conferir medidas'));
});

test('modelos: criar, nome único, sem responsável no modelo, desativar; técnico sem alterar negado', opcoes, () => {
  const m = ok(P.O, 'salvar_modelo_checklist', `${q(E.a)}, NULL, 'Ajuste de roupa', ${j([{ texto: 'Medir', obrigatorio: true, responsavel_auth_id: P.TEC.id }, { texto: 'Passar a ferro' }])}, NULL, ${q(k())}`);
  assert.equal(m.itens.length, 2);
  assert.ok(!('responsavel_auth_id' in m.itens[0]));
  falha(rpc(P.O, 'salvar_modelo_checklist', `${q(E.a)}, NULL, 'ajuste de roupa', ${j([{ texto: 'Outro' }])}, NULL, ${q(k())}`), 'mesmo nome|Já existe');
  falha(rpc(P.TEC, 'salvar_modelo_checklist', `${q(E.a)}, NULL, 'Do técnico', ${j([{ texto: 'Item' }])}, NULL, ${q(k())}`), 'FORBIDDEN_ACTION|permite');
  assert.equal(ok(P.O, 'modelos_checklist', q(E.a)).length, 1);
  assert.equal(ok(P.O, 'salvar_modelo_checklist', `${q(E.a)}, ${q(m.id)}, NULL, NULL, ${m.versao}, ${q(k())}`).ativo, false);
  assert.equal(ok(P.O, 'modelos_checklist', q(E.a)).length, 0);
});

test('rollback da 202611290001 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  adm('ALTER TABLE public.os_eventos DISABLE TRIGGER USER; DELETE FROM public.os_checklist_itens; DELETE FROM public.modelos_checklist; ALTER TABLE public.os_eventos ENABLE TRIGGER USER');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611290001_checklists_os.down.sql');
  assert.equal(adm("SELECT to_regclass('public.os_checklist_itens') IS NULL"), 't');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611290001_checklists_os.sql');
  assert.equal(foto(), depois);
});
