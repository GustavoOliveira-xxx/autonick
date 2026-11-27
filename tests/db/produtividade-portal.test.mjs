/**
 * Testes de banco do pacote 27/11 (migration 202612010002).
 * - Vendas: busca por número ou nome do cliente (sem acento).
 * - Feature flags: padrão, só a CK altera (com motivo e auditoria), ajuste por empresa só nas de escopo empresa, visitante vê só as da plataforma.
 * - Notificações: geradas pelos fluxos reais (solicitação nova, orçamento disponível, aceite, OS iniciada/concluída, proposta de
 *   estoque), sem duplicar, só para quem tem a permissão; leitura, preferências; vínculo encerrado some; cada um só vê as suas.
 * - Onboarding dispensável. Modelos de orçamento: validação, nome único, permissão e remoção. Rollback sem resíduo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const ID = (n) => `ca280000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-p28@teste.example', nome: 'Dona Olívia', tipo: 'business' },
  C: { id: ID(2), email: 'cliente-p28@teste.example', nome: 'Cliente Célia', tipo: 'cliente' },
  CK: { id: ID(3), email: 'ck-p28@teste.example', nome: 'Admin CK', tipo: 'business' },
  EST: { id: ID(4), email: 'estoque-p28@teste.example', nome: 'Edu Estoque', tipo: 'business' },
};
let chave = 0;
const k = () => `p28-teste-${String(++chave).padStart(4, '0')}`;
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
const notas = (p) => ok(p, 'minhas_notificacoes', 'NULL, 50');
const E = {};

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  E.a = ok(P.O, 'criar_empresa', `${j({ nome_publico: 'Costura da Olívia', modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', bairro: 'Cambuí', uf: 'SP', email_contato: 'privado-p28@teste.example' })}, ${q(k())}`).id;
  ok(P.O, 'enviar_vitrine_para_analise', `${q(E.a)}, ${versao('empresas', E.a)}, ${q(k())}`);
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste P28')`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.a)} AND estado = 'aberta'`))}, 'aprovar', NULL, NULL, ${q(k())}`);
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.a)}, 'Estoque', NULL, ARRAY['estoque.visualizar','estoque.propor']::text[], ${q(k())}`).id;
  const c = ok(P.O, 'convidar_funcionario', `${q(E.a)}, ${q(P.EST.email)}, ${q(perfil)}, ${q(k())}`);
  assert.ok(comoPapel(banco.url, { sub: P.EST.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
  E.membroEst = adm(`SELECT id FROM public.membros_empresa WHERE empresa_id = ${q(E.a)} AND auth_user_id = ${q(P.EST.id)}`);
});
after(() => banco?.encerrar());

test('notificações nascem dos fluxos reais, sem duplicar e só para quem deve ver', opcoes, () => {
  const s = ok(P.O, 'criar_servico', `${q(E.a)}, ${j({ nome: 'Barra de calça', politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  ok(P.O, 'salvar_formulario_servico', `${q(s.id)}, ${j([{ texto: 'Peças', tipo: 'numero', obrigatoria: true, configuracao: { minimo: 1, maximo: 20 } }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  const perg = adm(`SELECT id FROM public.servico_perguntas WHERE servico_id = ${q(s.id)} AND ativa`);
  ok(P.O, 'salvar_regras_servico', `${q(s.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: perg, rotulo: 'Por peça', valor_unitario_centavos: 2500 }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  ok(P.O, 'definir_vitrine_servico', `${q(s.id)}, true, ${versao('servicos', s.id)}, ${q(k())}`);
  const sol = ok(P.C, 'criar_solicitacao', `${q(s.id)}, ${j({ respostas: { [perg]: 2 }, relato: 'Duas calças.' })}, ${q(k())}`).id;
  const dona = notas(P.O).itens;
  assert.ok(dona.some((n) => n.titulo.startsWith('Nova solicitação') && n.link.includes(sol)), 'dona sabe da nova solicitação');
  const cliente = notas(P.C);
  assert.ok(cliente.itens.some((n) => n.titulo === 'Orçamento disponível' && n.link === `/cliente/solicitacoes.html?s=${sol}`), 'orçamento automático avisa o cliente');
  assert.equal(notas(P.EST).itens.length, 0, 'perfil de estoque não recebe orçamento');
  ok(P.C, 'aceitar_orcamento', `${q(sol)}, ${q(adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(sol)}`))}, true, ${q(k())}`);
  assert.ok(notas(P.O).itens.some((n) => /aceito/.test(n.titulo)));
  E.os = adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(sol)}`);
  ok(P.O, 'mudar_estado_os', `${q(E.os)}, 'iniciar', NULL, ${versao('ordens_servico', E.os)}, ${q(k())}`);
  ok(P.O, 'mudar_estado_os', `${q(E.os)}, 'concluir', NULL, ${versao('ordens_servico', E.os)}, ${q(k())}`);
  const titulos = notas(P.C).itens.map((n) => n.titulo);
  assert.ok(titulos.some((t) => /em andamento/.test(t)) && titulos.some((t) => /concluído/.test(t)), titulos.join(' | '));
  // Deduplicação: a mesma chave não gera duas.
  const antes = Number(adm(`SELECT count(*) FROM public.notificacoes WHERE usuario = ${q(P.C.id)}`));
  adm(`SELECT app_private.notificar(${q(P.C.id)}, ${q(E.a)}, 'cliente', 'os', 'Repetida', NULL, '/cliente/ordens.html', ${q(`os:${E.os}:concluida:${versao('ordens_servico', E.os)}`)})`);
  assert.equal(Number(adm(`SELECT count(*) FROM public.notificacoes WHERE usuario = ${q(P.C.id)}`)), antes);
  // Nada de dado interno: só título, texto curto e link.
  assert.ok(notas(P.C).itens.every((n) => !/R\$|interna/i.test(`${n.titulo} ${n.texto}`)));
});

test('proposta de estoque avisa quem aprova; leitura e preferências; cada um só vê as suas', opcoes, () => {
  const prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Linha', finalidade: 'comercializavel', preco_centavos: 1000, quantidade_inicial: 5 })}, NULL, ${q(k())}`).id;
  const v = adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(prod)} LIMIT 1`);
  ok(P.EST, 'propor_movimentacao', `${q(E.a)}, 'entrada', ${j([{ variacao_id: v, quantidade: 3 }])}, NULL, ${q(k())}`);
  const n = notas(P.O);
  const est = n.itens.find((x) => x.tipo === 'estoque');
  assert.ok(est, 'dona (aprova estoque) é avisada');
  assert.equal(notas(P.EST).itens.filter((x) => x.tipo === 'estoque').length, 0, 'quem propôs não avisa a si mesmo');
  assert.ok(n.nao_lidas >= 1);
  assert.equal(ok(P.O, 'marcar_notificacoes_lidas', `ARRAY[${q(est.id)}]::uuid[]`).marcadas, 1);
  assert.equal(ok(P.C, 'marcar_notificacoes_lidas', `ARRAY[${q(est.id)}]::uuid[]`).marcadas, 0, 'não marca a de outra pessoa');
  assert.equal(notas(P.O).itens.find((x) => x.id === est.id).lida, true);
  ok(P.O, 'marcar_notificacoes_lidas', 'NULL');
  assert.equal(notas(P.O).nao_lidas, 0);
  assert.deepEqual(ok(P.O, 'definir_preferencia_notificacao', `'estoque', false`).estoque, false);
  ok(P.EST, 'propor_movimentacao', `${q(E.a)}, 'entrada', ${j([{ variacao_id: v, quantidade: 1 }])}, NULL, ${q(k())}`);
  assert.equal(notas(P.O).nao_lidas, 0, 'tipo desligado não gera aviso');
  falha(rpc(P.O, 'definir_preferencia_notificacao', `'email', true`), 'inválida');
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.O.id }, 'SELECT count(*) FROM public.notificacoes'), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT public.minhas_notificacoes()'), 'permission denied');
});

test('vínculo encerrado: avisos da equipe daquela empresa deixam de aparecer', opcoes, () => {
  adm(`SELECT app_private.notificar(${q(P.EST.id)}, ${q(E.a)}, 'business', 'estoque', 'Aviso de teste', NULL, '/business/estoque-empresa.html', 'teste:vinculo')`);
  assert.equal(notas(P.EST).itens.length, 1);
  ok(P.O, 'desligar_membro', `${q(E.membroEst)}, 'Fim do contrato de teste', ${q(k())}`);
  assert.equal(notas(P.EST).itens.length, 0);
});

test('feature flags: padrão, só a CK altera com motivo e auditoria, ajuste por empresa, visitante só plataforma', opcoes, () => {
  const visitante = JSON.parse(comoPapel(banco.url, { papel: 'anonymous' }, 'SELECT public.flags_ativas()::text').saida);
  assert.deepEqual(visitante, { animacoes_decorativas: true, busca_cep: true });
  assert.equal(ok(P.O, 'flags_ativas', q(E.a)).onboarding_contextual, true);
  assert.equal(ok(P.C, 'flags_ativas', q(E.a)).onboarding_contextual, undefined, 'quem não é da empresa não vê as da empresa');
  falha(rpc(P.O, 'ck_definir_flag', `'busca_cep', false, 'teste de recusa', 1, ${q(k())}`), 'FORBIDDEN|CK');
  falha(rpc(P.CK, 'ck_definir_flag', `'busca_cep', false, 'x', 1, ${q(k())}`), 'motivo');
  assert.equal(ok(P.CK, 'ck_definir_flag', `'busca_cep', false, 'Serviço de CEP fora do ar', 1, ${q(k())}`).ativa, false);
  assert.equal(ok(P.O, 'flags_ativas', 'NULL').busca_cep, false);
  falha(rpc(P.CK, 'ck_definir_flag', `'busca_cep', true, 'volta ao normal', 1, ${q(k())}`), 'VERSION_CONFLICT|mudou');
  assert.ok(ok(P.CK, 'ck_flags').find((f) => f.chave === 'busca_cep'));
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'ck.flag_alterada'"), '1');
  ok(P.O, 'definir_flag_empresa', `${q(E.a)}, 'onboarding_contextual', false, ${q(k())}`);
  assert.equal(ok(P.O, 'flags_ativas', q(E.a)).onboarding_contextual, false);
  falha(rpc(P.O, 'definir_flag_empresa', `${q(E.a)}, 'animacoes_decorativas', false, ${q(k())}`), 'não pode ser ajustada');
  falha(rpc(P.C, 'definir_flag_empresa', `${q(E.a)}, 'onboarding_contextual', true, ${q(k())}`), 'TENANT_FORBIDDEN|acesso');
});

test('onboarding: dispensar, listar, reiniciar; chave validada', opcoes, () => {
  assert.deepEqual(ok(P.O, 'meu_onboarding'), []);
  assert.deepEqual(ok(P.O, 'dispensar_onboarding', `'business.vendas'`), ['business.vendas']);
  assert.deepEqual(ok(P.O, 'dispensar_onboarding', `'business.vendas'`), ['business.vendas'], 'idempotente');
  assert.deepEqual(ok(P.C, 'meu_onboarding'), [], 'de cada pessoa');
  falha(rpc(P.O, 'dispensar_onboarding', `'<script>'`), 'desconhecida');
  assert.deepEqual(ok(P.O, 'reiniciar_onboarding'), []);
});

test('modelos de orçamento: salvar, validar, nome único, editar com versão, remover; permissão', opcoes, () => {
  const comp = [{ tipo: 'mao_de_obra', descricao: 'Barra simples', quantidade: 1, valor_unitario_centavos: 2500 }, { tipo: 'material', descricao: 'Linha', quantidade: 2, valor_unitario_centavos: 300 }];
  const m = ok(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, NULL, ${j({ nome: 'Barra padrão', componentes: comp, prazo_execucao: '2 dias' })}, NULL, ${q(k())}`);
  falha(rpc(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, NULL, ${j({ nome: 'barra PADRÃO', componentes: comp })}, NULL, ${q(k())}`), 'Já existe|nome');
  falha(rpc(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, NULL, ${j({ nome: 'Vazio', componentes: [] })}, NULL, ${q(k())}`), '1 a 50');
  falha(rpc(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, NULL, ${j({ nome: 'Ruim', componentes: [{ tipo: 'brinde', descricao: 'xx', quantidade: 1, valor_unitario_centavos: 1 }] })}, NULL, ${q(k())}`), 'Tipo');
  falha(rpc(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, NULL, ${j({ nome: 'Ruim 2', componentes: [{ tipo: 'outro', descricao: 'xx', quantidade: 1, valor_unitario_centavos: 1.5 }] })}, NULL, ${q(k())}`), 'centavos');
  falha(rpc(P.EST, 'salvar_modelo_orcamento', `${q(E.a)}, NULL, ${j({ nome: 'Sem permissão', componentes: comp })}, NULL, ${q(k())}`), 'FORBIDDEN|permiss');
  const lista = ok(P.O, 'modelos_orcamento', q(E.a));
  assert.deepEqual([lista.length, lista[0].componentes.length, lista[0].prazo_execucao], [1, 2, '2 dias']);
  const ed = ok(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, ${q(m.id)}, ${j({ nome: 'Barra padrão', componentes: comp.slice(0, 1) })}, ${m.versao}, ${q(k())}`);
  falha(rpc(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, ${q(m.id)}, ${j({ nome: 'Barra padrão', componentes: comp })}, ${m.versao}, ${q(k())}`), 'VERSION_CONFLICT|mudou');
  ok(P.O, 'salvar_modelo_orcamento', `${q(E.a)}, ${q(m.id)}, ${j({ ativo: false })}, ${ed.versao}, ${q(k())}`);
  assert.deepEqual(ok(P.O, 'modelos_orcamento', q(E.a)), []);
});

test('vendas: busca por número ou cliente, sem acento', opcoes, () => {
  const prod = ok(P.O, 'criar_produto', `${q(E.a)}, ${j({ nome: 'Botão', finalidade: 'comercializavel', preco_centavos: 500, quantidade_inicial: 50 })}, NULL, ${q(k())}`).id;
  const v = adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(prod)} LIMIT 1`);
  const cli = ok(P.O, 'criar_cliente', `${q(E.a)}, ${j({ nome: 'José Conceição' })}, ${q(k())}`).id;
  const venda = ok(P.O, 'registrar_venda_direta', `${q(E.a)}, ${j({ cliente_empresa_id: cli })}, ${j([{ variacao_id: v, quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  ok(P.O, 'registrar_venda_direta', `${q(E.a)}, '{}'::jsonb, ${j([{ variacao_id: v, quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  const busca = (t) => ok(P.O, 'vendas_da_empresa', `${q(E.a)}, ${j({ busca: t })}`);
  assert.deepEqual(busca('jose conceicao').map((x) => x.id), [venda.id]);
  assert.deepEqual(busca(String(venda.numero)).map((x) => x.id), [venda.id]);
  assert.equal(busca('consumidor').length, 1);
  assert.equal(busca('%').length, 0);
  assert.equal(ok(P.O, 'vendas_da_empresa', `${q(E.a)}, '{}'::jsonb`).length, 2);
});

test('rollback da 202612010002 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  aplicarArquivo(banco.url, 'db/migrations_propostas/202612010002_produtividade_portal.down.sql');
  assert.equal(adm("SELECT to_regclass('public.notificacoes') IS NULL AND to_regclass('app_private.feature_flags') IS NULL"), 't');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202612010002_produtividade_portal.sql');
  assert.equal(foto(), depois);
});
