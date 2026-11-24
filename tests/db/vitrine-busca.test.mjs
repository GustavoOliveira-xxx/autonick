/**
 * Testes de banco do M10 (migration 202611130002): rota pública (busca, filtros, faixas de localização, perfil), lista
 * fechada de campos do papel `anonymous`, exclusão de dados fictícios (DF-06), visibilidade explícita de produtos e serviços
 * (D10-03 = C, D10-04 = B), nome aprovado nos fluxos do cliente (C-01), área de demonstração com autorização válida,
 * vencida e revogada (D10-14, D10-25), histórico de limites da CK (D10-23), privilégios e rollback.
 *
 * D10-26 = A, limitada aos testes automatizados: só este banco local descartável tem empresas sintéticas SEM a marcação
 * de teste, para comprovar o caminho positivo da rota pública. Nenhum branch do Neon recebe exceção ao DF-03.
 * PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();

const ID = (n) => `ea000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m10@teste.example', nome: 'Dona Ana' },
  O2: { id: ID(2), email: 'dona2-m10@teste.example', nome: 'Dona Bela' },
  G: { id: ID(3), email: 'gestor-m10@teste.example', nome: 'Gestor Sem Vitrine' },
  C: { id: ID(4), email: 'cliente-m10@teste.example', nome: 'Cliente Carla' },
  BZ: { id: ID(5), email: 'empresarial-m10@teste.example', nome: 'Só Empresarial' },
  D1: { id: ID(6), email: 'demo1-m10@autonick-teste.example', nome: 'Demo Autorizada' },
  D2: { id: ID(7), email: 'demo2-m10@autonick-teste.example', nome: 'Demo Sem Autorização' },
  D3: { id: ID(8), email: 'demo3-m10@autonick-teste.example', nome: 'Demo Vencida' },
  D4: { id: ID(9), email: 'demo4-m10@autonick-teste.example', nome: 'Demo Sem Confirmação', naoConfirmado: true },
  CK: { id: ID(10), email: 'ck-m10@teste.example', nome: 'Admin CK' },
};
let chave = 0;
const k = () => `m10-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args = '') => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
// Como o token anônimo real do Neon Auth (GET /token/anonymous): papel anonymous COM `sub` (achado da verificação real, 0003).
const ANON = { papel: 'anonymous', sub: 'anonimo-neon-auth-m10' };
const anon = (nome, args = '') => comoPapel(banco.url, ANON, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args = '') {
  const r = p === null ? anon(nome, args) : rpc(p, nome, args);
  assert.ok(r.ok, `${nome}: ${r.erro}`);
  return JSON.parse(r.saida);
}
function falha(r, padrao) {
  assert.equal(r.ok, false, `deveria falhar com ${padrao}`);
  assert.match(r.erro, new RegExp(padrao), r.erro);
}
const buscar = (filtros = {}, pagina = 1, p = null) => ok(p, 'buscar_vitrine', `${j(filtros)}, ${pagina}`);
const nomes = (r) => r.itens.map((i) => i.nome_publico);
const E = {};
const S = {};
const PR = {};
const cat = (slug) => adm(`SELECT id FROM public.categorias_plataforma WHERE slug = ${q(slug)}`);
const versaoServ = (id) => Number(adm(`SELECT versao FROM public.servicos WHERE id = ${q(id)}`));
const versaoProd = (id) => Number(adm(`SELECT versao FROM public.produtos WHERE id = ${q(id)}`));
const versaoEmp = (id) => Number(adm(`SELECT versao FROM public.empresas WHERE id = ${q(id)}`));

function empresa(dono, dados) {
  const e = ok(dono, 'criar_empresa', `${j({ modalidade: 'ambos', uf: 'SP', email_contato: 'privado-m10@teste.example', ...dados })}, ${q(k())}`);
  return e.id;
}
function publicar(id, dono) {
  ok(dono, 'enviar_vitrine_para_analise', `${q(id)}, ${versaoEmp(id)}, ${q(k())}`);
  const sol = adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(id)} AND estado = 'aberta'`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(sol)}, 'aprovar', NULL, NULL, ${q(k())}`);
}
const servico = (dono, emp, dados) => ok(dono, 'criar_servico', `${q(emp)}, ${j(dados)}, ${q(k())}`).id;
const produto = (dono, emp, dados) => ok(dono, 'criar_produto', `${q(emp)}, ${j({ quantidade_inicial: 5, ...dados })}, NULL, ${q(k())}`).id;
const vitrineServ = (dono, id, exibir = true) => ok(dono, 'definir_vitrine_servico', `${q(id)}, ${exibir}, ${versaoServ(id)}, ${q(k())}`);
const vitrineProd = (dono, id, exibir = true) => ok(dono, 'definir_vitrine_produto', `${q(id)}, ${exibir}, ${versaoProd(id)}, ${q(k())}`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, ${!p.naoConfirmado})`);
  }
  for (const p of [P.O, P.O2, P.G, P.BZ]) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`).ok);
  for (const p of [P.C, P.D1, P.D2, P.D3, P.D4]) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('cliente', ${q(p.nome)})`).ok);
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste M10')`);
  const costura = cat('costura-moda');
  const reformas = cat('construcao-reformas');

  // Empresas sintéticas sem marcação de teste (D10-26 = A, só neste banco descartável).
  E.ana = empresa(P.O, { nome_publico: 'Costura da Ana', categoria_id: costura, cidade: 'Campinas', bairro: 'Cambuí',
    descricao_publica: 'Ajustes e consertos de roupas.', telefone_publico: '(19) 3333-0000', area_atendimento: 'Campinas e região' });
  E.bela = empresa(P.O2, { nome_publico: 'Ateliê Bela Moda', categoria_id: costura, cidade: 'Campinas', bairro: 'Centro' });
  E.eletrica = empresa(P.O2, { nome_publico: 'Elétrica Paulista', categoria_id: reformas, cidade: 'São Paulo', bairro: 'Mooca', modalidade: 'servicos' });
  E.suspensa = empresa(P.O2, { nome_publico: 'Costura Suspensa', categoria_id: costura, cidade: 'Campinas', bairro: 'Cambuí' });
  E.rascunho = empresa(P.O2, { nome_publico: 'Costura Rascunho', categoria_id: costura, cidade: 'Campinas' });
  E.lia = empresa(P.O2, { nome_publico: 'Costura da Lia', categoria_id: costura, cidade: 'Jundiaí', bairro: 'Centro' });
  E.demo = empresa(P.O2, { nome_publico: 'Costura Demonstrativa', categoria_id: costura, cidade: 'Sorocaba', bairro: 'Centro' });
  for (const id of [E.ana, E.bela, E.eletrica, E.suspensa, E.lia, E.demo]) publicar(id, id === E.ana ? P.O : P.O2);
  adm(`SELECT app_private.marcar_empresa_de_teste(${q(E.demo)}, 'teste M10: área de demonstração')`);
  ok(P.CK, 'ck_suspender_vitrine', `${q(E.suspensa)}, 'Teste de suspensão da vitrine.', 'comum', NULL, ${q(k())}`);

  S.barra = servico(P.O, E.ana, { nome: 'Ajuste de barra', politica_preco: 'fixo', preco_centavos: 3000, categoria_id: costura, duracao_min: 30 });
  S.ziper = servico(P.O, E.ana, { nome: 'Conserto de zíper', politica_preco: 'a_partir_de', preco_centavos: 2500, descricao: 'Troca completa do zíper.' });
  S.interno = servico(P.O, E.ana, { nome: 'Revisão interna de máquinas', politica_preco: 'sob_consulta' });
  S.pacote = servico(P.O, E.ana, { nome: 'Pacote noiva', politica_preco: 'pacote', preco_centavos: 20000 });
  ok(P.O, 'salvar_itens_pacote', `${q(S.pacote)}, ARRAY[${q(S.barra)}, ${q(S.interno)}]::uuid[], ${versaoServ(S.pacote)}, ${q(k())}`);
  S.sob = servico(P.O2, E.bela, { nome: 'Costura sob medida', politica_preco: 'sob_consulta' });
  S.chuveiro = servico(P.O2, E.eletrica, { nome: 'Troca de chuveiro', politica_preco: 'fixo', preco_centavos: 15000,
    descricao: 'Ligue (11) 98888-7777 para combinar.' });
  S.lia = servico(P.O2, E.lia, { nome: 'Barra de calça', politica_preco: 'fixo', preco_centavos: 2000 });
  S.demo = servico(P.O2, E.demo, { nome: 'Costura demonstrativa', politica_preco: 'fixo', preco_centavos: 1000 });
  S.suspensa = servico(P.O2, E.suspensa, { nome: 'Costura escondida', politica_preco: 'fixo', preco_centavos: 1000 });
  for (const [dono, id] of [[P.O, S.barra], [P.O, S.ziper], [P.O, S.pacote], [P.O2, S.sob], [P.O2, S.chuveiro], [P.O2, S.lia],
    [P.O2, S.demo], [P.O2, S.suspensa]]) vitrineServ(dono, id);

  PR.linha = produto(P.O, E.ana, { nome: 'Linha de costura', finalidade: 'comercializavel', preco_centavos: 800 });
  PR.botao = produto(P.O, E.ana, { nome: 'Botão de madrepérola', finalidade: 'comercializavel', preco_centavos: 150 });
  PR.agulha = produto(P.O, E.ana, { nome: 'Agulha industrial', finalidade: 'uso_interno', preco_centavos: 100 });
  PR.pausado = produto(P.O, E.ana, { nome: 'Tecido pausado', finalidade: 'comercializavel', preco_centavos: 2000 });
  vitrineProd(P.O, PR.linha);
  vitrineProd(P.O, PR.pausado);
  ok(P.O, 'pausar_venda_produto', `${q(PR.pausado)}, true, 'Sem estoque no fornecedor.', ${versaoProd(PR.pausado)}, ${q(k())}`);

  // Gestor com catálogo mas sem vitrine.alterar.
  const perfil = ok(P.O, 'criar_perfil_permissao', `${q(E.ana)}, 'Catálogo sem vitrine', NULL,
    ARRAY['produtos.visualizar', 'produtos.alterar', 'catalogo_servicos.visualizar', 'catalogo_servicos.alterar']::text[], ${q(k())}`);
  const conv = ok(P.O, 'convidar_funcionario', `${q(E.ana)}, ${q(P.G.email)}, ${q(perfil.id)}, ${q(k())}`);
  ok(P.G, 'aceitar_convite', `${q(conv.id)}, ${q(k())}`);
});
after(() => banco?.encerrar());

test('rota pública, positivo (local): nome, serviço e produto; acento e maiúsculas; termo composto; vazio sem erro', opcoes, () => {
  let r = buscar({ termo: 'ana' });
  assert.deepEqual(nomes(r), ['Costura da Ana']);
  assert.ok(r.itens[0].casou_em.includes('nome'));
  r = buscar({ termo: 'ZÍPER' });
  assert.deepEqual(nomes(r), ['Costura da Ana']);
  assert.deepEqual(r.itens[0].itens_que_casaram.map((i) => [i.tipo, i.nome]), [['servico', 'Conserto de zíper']]);
  assert.deepEqual(nomes(buscar({ termo: 'ziper' })), ['Costura da Ana'], 'sem acento casa com acento');
  r = buscar({ termo: 'linha' });
  assert.deepEqual(r.itens[0].itens_que_casaram.map((i) => i.tipo), ['produto']);
  // Termo composto: todas as palavras precisam casar na mesma empresa; "de" é ignorada.
  assert.deepEqual(nomes(buscar({ termo: 'conserto de ziper' })), ['Costura da Ana']);
  assert.deepEqual(nomes(buscar({ termo: 'conserto chuveiro' })), []);
  // Início de palavra: "ostura" não casa; sem tolerância a erro de digitação.
  assert.deepEqual(nomes(buscar({ termo: 'ostura' })), []);
  assert.deepEqual(nomes(buscar({ termo: 'costrua' })), []);
  r = buscar({ termo: 'nada parecido com isto' });
  assert.equal(r.total, 0);
  assert.deepEqual(r.itens, []);
  assert.match(r.ordem, /Nenhuma posição é paga/);
});

test('rota pública: filtros combinados, cidade e bairro restringem e só a ação explícita amplia (D10-07)', opcoes, () => {
  let r = buscar({ cidade: 'Campinas' });
  assert.deepEqual(new Set(nomes(r)), new Set(['Costura da Ana', 'Ateliê Bela Moda']));
  assert.ok(r.itens.every((i) => i.faixa === 'mesma_cidade'));
  r = buscar({ cidade: 'campinas', bairro: 'CAMBUI' });
  assert.deepEqual(nomes(r), ['Costura da Ana'], 'filtro de bairro não traz outro bairro');
  assert.equal(r.itens[0].faixa, 'mesmo_bairro');
  r = buscar({ cidade: 'Campinas', bairro: 'Cambuí', ampliar: 'bairro' });
  assert.deepEqual(nomes(r), ['Costura da Ana', 'Ateliê Bela Moda']);
  assert.deepEqual(r.itens.map((i) => i.faixa), ['mesmo_bairro', 'mesma_cidade']);
  r = buscar({ cidade: 'Campinas', bairro: 'Cambuí', ampliar: 'cidade' });
  assert.deepEqual(r.itens.map((i) => i.faixa), ['mesmo_bairro', 'mesma_cidade', 'outros', 'outros']);
  assert.match(r.ordem, /Primeiro neste bairro, depois nesta cidade, depois em outras cidades/);
  r = buscar({ cidade: 'São Paulo' });
  assert.deepEqual(nomes(r), ['Elétrica Paulista']);
  assert.deepEqual(nomes(buscar({ categoria_id: cat('construcao-reformas') })), ['Elétrica Paulista']);
  assert.deepEqual(nomes(buscar({ tipo: 'produtos' })), ['Costura da Ana'], 'só empresas com produto público');
  assert.deepEqual(nomes(buscar({ tipo: 'servicos', termo: 'calca' })), ['Costura da Lia']);
  assert.deepEqual(nomes(buscar({ modalidade: 'servicos', cidade: 'São Paulo' })), ['Elétrica Paulista']);
  assert.deepEqual(nomes(buscar({ modalidade: 'comercio', cidade: 'São Paulo' })), [], 'modalidade serviços não entra em comércio');
});

test('rota pública: sem localização ordena por relevância, desempate estável, nenhum campo de distância', opcoes, () => {
  const r1 = buscar({ termo: 'costura' });
  const r2 = buscar({ termo: 'costura' });
  assert.deepEqual(nomes(r1), nomes(r2));
  assert.ok(r1.itens.every((i) => i.faixa === null));
  // Nome casa (8) vence descrição de item (1): empresas com "Costura" no nome antes.
  assert.ok(nomes(r1).indexOf('Costura da Ana') < nomes(r1).indexOf('Ateliê Bela Moda'));
  const texto = JSON.stringify(r1);
  assert.doesNotMatch(texto, /km|distancia|latitude|longitude|coordenad/i);
  assert.match(buscar({}).ordem, /ordem alfabética/);
});

test('rota pública: suspensa, rascunho e fictícia fora da busca e do link direto, com a mesma resposta de inexistente', opcoes, () => {
  const todas = nomes(buscar({}));
  for (const n of ['Costura Suspensa', 'Costura Rascunho', 'Costura Demonstrativa']) assert.ok(!todas.includes(n), n);
  const inexistente = anon('vitrine_publica', `${q('ea000000-0000-4000-8000-00000000ffff')}`);
  falha(inexistente, 'Esta vitrine não está disponível');
  for (const id of [E.suspensa, E.rascunho, E.demo]) {
    const r = anon('vitrine_publica', q(id));
    falha(r, 'Esta vitrine não está disponível');
    assert.equal(r.erro.replace(/\s+/g, ' ').match(/ERROR:[^\n]*/)[0], inexistente.erro.replace(/\s+/g, ' ').match(/ERROR:[^\n]*/)[0]);
  }
  // DF-06 ajustado: nem conta fictícia autorizada vê dado fictício na rota pública.
  adm(`SELECT app_private.autorizar_demonstracao(${q(P.D1.id)}, 'Teste da área de demonstração.', 'teste automatizado', 30)`);
  assert.ok(!nomes(buscar({}, 1, P.D1)).includes('Costura Demonstrativa'));
  falha(rpc(P.D1, 'vitrine_publica', q(E.demo)), 'Esta vitrine não está disponível');
  // Nenhum parâmetro da rota pública habilita dados fictícios.
  for (const chaveEstranha of ['demonstracao', 'incluir_teste', 'conjunto']) falha(anon('buscar_vitrine', `${j({ [chaveEstranha]: true })}, 1`), 'Campo não permitido');
});

test('C-01: alteração em análise mantém o nome aprovado na vitrine, na busca e nos fluxos do M08 e do M06', opcoes, () => {
  ok(P.O2, 'atualizar_empresa', `${q(E.lia)}, ${j({ nome_publico: 'Ateliê Lia Moda Nova' })}, ${versaoEmp(E.lia)}, ${q(k())}`);
  ok(P.O2, 'enviar_vitrine_para_analise', `${q(E.lia)}, ${versaoEmp(E.lia)}, ${q(k())}`);
  assert.equal(adm(`SELECT nome_publico FROM public.empresas WHERE id = ${q(E.lia)}`), 'Ateliê Lia Moda Nova', 'cópia de trabalho com outro nome');
  assert.equal(adm(`SELECT situacao_vitrine FROM public.empresas WHERE id = ${q(E.lia)}`), 'publicada');
  assert.deepEqual(nomes(buscar({ termo: 'lia' })), ['Costura da Lia']);
  assert.equal(ok(null, 'vitrine_publica', q(E.lia)).empresa.nome_publico, 'Costura da Lia');
  const sc = ok(P.C, 'servicos_para_cliente', q(E.lia));
  assert.equal(sc.empresa.nome, 'Costura da Lia');
  assert.ok(!ok(P.C, 'empresas_para_pedido').some((e) => e.nome === 'Ateliê Lia Moda Nova'));
  const sol = ok(P.C, 'criar_solicitacao', `${q(S.lia)}, ${j({ relato: 'Fazer a barra de duas calças jeans.' })}, ${q(k())}`);
  assert.equal(ok(P.C, 'minha_solicitacao', q(sol.id)).empresa, 'Costura da Lia');
  const lista = ok(P.C, 'minhas_solicitacoes');
  assert.equal(lista.find((x) => x.id === sol.id).empresa, 'Costura da Lia');
  assert.doesNotMatch(JSON.stringify([sc, lista, ok(P.C, 'minha_solicitacao', q(sol.id))]), /Ateliê Lia Moda Nova/);
  // A equipe continua vendo a própria cópia de trabalho na área interna.
  assert.equal(ok(P.O2, 'solicitacao_detalhe', q(sol.id)).empresa, 'Ateliê Lia Moda Nova');
  // Aprovada a alteração, o novo nome passa a valer para o cliente.
  const pend = adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(E.lia)} AND estado = 'aberta'`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(pend)}, 'aprovar', NULL, NULL, ${q(k())}`);
  assert.equal(ok(null, 'vitrine_publica', q(E.lia)).empresa.nome_publico, 'Ateliê Lia Moda Nova');
  assert.equal(ok(P.C, 'minha_solicitacao', q(sol.id)).empresa, 'Ateliê Lia Moda Nova');
});

test('visibilidade: serviço ativo fica fora da vitrine até o gestor publicar; publicar exige vitrine.alterar', opcoes, () => {
  const novo = servico(P.O, E.ana, { nome: 'Bainha invisível', politica_preco: 'fixo', preco_centavos: 4000 });
  assert.equal(adm(`SELECT ativo AND NOT exibir_na_vitrine FROM public.servicos WHERE id = ${q(novo)}`), 't', 'nasce ativo e fora da vitrine');
  assert.ok(!ok(null, 'vitrine_publica', q(E.ana)).servicos.some((s) => s.id === novo));
  assert.deepEqual(nomes(buscar({ termo: 'bainha' })), []);
  // M11 (D11-01): o login não amplia o catálogo; fora da vitrine também fica fora da tela do cliente logado.
  assert.ok(!ok(P.C, 'servicos_para_cliente', q(E.ana)).servicos.some((s) => s.id === novo));
  falha(rpc(P.G, 'definir_vitrine_servico', `${q(novo)}, true, ${versaoServ(novo)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.C, 'definir_vitrine_servico', `${q(novo)}, true, ${versaoServ(novo)}, ${q(k())}`), 'TENANT_FORBIDDEN|FORBIDDEN');
  const chaveOp = k();
  const v = versaoServ(novo);
  ok(P.O, 'definir_vitrine_servico', `${q(novo)}, true, ${v}, ${q(chaveOp)}`);
  ok(P.O, 'definir_vitrine_servico', `${q(novo)}, true, ${v}, ${q(chaveOp)}`);
  assert.equal(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'servicos.vitrine_ligada' AND recurso_id = ${q(novo)}`), '1', 'idempotente');
  assert.deepEqual(nomes(buscar({ termo: 'bainha' })), ['Costura da Ana']);
  assert.ok(ok(P.C, 'servicos_para_cliente', q(E.ana)).servicos.some((s) => s.id === novo), 'publicado, o cliente logado passa a ver');
  ok(P.O, 'definir_servico_ativo', `${q(novo)}, false, ${versaoServ(novo)}, ${q(k())}`);
  assert.deepEqual(nomes(buscar({ termo: 'bainha' })), [], 'serviço desativado sai da vitrine');
  falha(rpc(P.O, 'definir_vitrine_servico', `${q(novo)}, false, ${versaoServ(novo) - 1}, ${q(k())}`), 'VERSION_CONFLICT');
});

test('visibilidade: produto comercializável não basta; insumo nunca; pausa e desativação saem na chamada seguinte', opcoes, () => {
  let pub = ok(null, 'vitrine_publica', q(E.ana));
  assert.deepEqual(pub.produtos.map((p) => p.nome), ['Linha de costura'], 'botão comercializável sem publicação e tecido pausado ficam fora');
  falha(rpc(P.O, 'definir_vitrine_produto', `${q(PR.agulha)}, true, ${versaoProd(PR.agulha)}, ${q(k())}`), 'uso interno');
  falha(rpc(P.G, 'definir_vitrine_produto', `${q(PR.botao)}, true, ${versaoProd(PR.botao)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  vitrineProd(P.O, PR.botao);
  assert.deepEqual(ok(null, 'vitrine_publica', q(E.ana)).produtos.map((p) => p.nome).sort(), ['Botão de madrepérola', 'Linha de costura']);
  ok(P.O, 'alterar_produto', `${q(PR.botao)}, ${j({ finalidade: 'uso_interno' })}, ${versaoProd(PR.botao)}, ${q(k())}`);
  assert.deepEqual(ok(null, 'vitrine_publica', q(E.ana)).produtos.map((p) => p.nome), ['Linha de costura'], 'virou insumo: sai na hora');
  ok(P.O, 'pausar_venda_produto', `${q(PR.pausado)}, false, NULL, ${versaoProd(PR.pausado)}, ${q(k())}`);
  pub = ok(null, 'vitrine_publica', q(E.ana));
  assert.ok(pub.produtos.some((p) => p.nome === 'Tecido pausado'), 'retomada a venda, volta');
  ok(P.O, 'definir_produto_ativo', `${q(PR.pausado)}, false, ${versaoProd(PR.pausado)}, ${q(k())}`);
  assert.ok(!ok(null, 'vitrine_publica', q(E.ana)).produtos.some((p) => p.nome === 'Tecido pausado'));
  // As listas internas mostram o controle e se o item aparece de fato.
  const lista = ok(P.O, 'produtos_da_empresa', q(E.ana));
  assert.equal(lista.find((p) => p.id === PR.botao).exibir_na_vitrine, true);
  assert.equal(lista.find((p) => p.id === PR.botao).aparece_na_vitrine, false);
});

test('lista fechada de campos das três funções do anônimo; contatos só com login; sem estoque, custo nem regra', opcoes, () => {
  const f = ok(null, 'filtros_vitrine');
  assert.deepEqual(Object.keys(f).sort(), ['bairros', 'categorias_negocio', 'categorias_produto', 'cidades']);
  assert.deepEqual(f.cidades.map((c) => c.nome).sort(), ['Campinas', 'Jundiaí', 'São Paulo'], 'D10-08: só localidades das empresas públicas; Sorocaba é só fictícia');
  for (const b of f.bairros) assert.deepEqual(Object.keys(b).sort(), ['cidade', 'nome']);
  const r = buscar({ termo: 'costura' });
  assert.deepEqual(Object.keys(r).sort(), ['ha_mais', 'itens', 'mais_de_100', 'ordem', 'pagina', 'por_pagina', 'total']);
  for (const i of r.itens) {
    assert.deepEqual(Object.keys(i).sort(), ['bairro', 'casou_em', 'categoria', 'cidade', 'empresa_id', 'faixa', 'itens_que_casaram', 'modalidade', 'nome_publico', 'selo']);
    for (const x of i.itens_que_casaram) assert.deepEqual(Object.keys(x).sort(), ['id', 'nome', 'tipo']);
  }
  const v = ok(null, 'vitrine_publica', q(E.ana));
  // M12 (D12-14): a vitrine passa a trazer as avaliações publicadas, com lista fechada de campos.
  assert.deepEqual(Object.keys(v).sort(), ['avaliacoes', 'empresa', 'produtos', 'sem_itens', 'servicos'], 'anônimo (mesmo com sub no token) não recebe contatos');
  assert.deepEqual(Object.keys(v.avaliacoes).sort(), ['itens', 'media', 'minimo_para_media', 'quantidade']);
  const semSub = comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.vitrine_publica(${q(E.ana)})::text`);
  assert.ok(semSub.ok && !('contatos' in JSON.parse(semSub.saida)), 'anônimo sem sub também não');
  assert.deepEqual(Object.keys(v.empresa).sort(), ['area_atendimento', 'bairro', 'categoria', 'cidade', 'descricao_publica', 'horario_funcionamento',
    'id', 'modalidade', 'nome_publico', 'selo', 'uf']);
  for (const s of v.servicos) assert.deepEqual(Object.keys(s).sort(), ['categoria', 'descricao', 'duracao_min', 'id', 'nome', 'pacote', 'politica_preco', 'preco_centavos']);
  for (const p of v.produtos) {
    assert.deepEqual(Object.keys(p).sort(), ['categoria', 'descricao', 'id', 'nome', 'sob_encomenda', 'variacoes']);
    for (const x of p.variacoes) assert.deepEqual(Object.keys(x).sort(), ['preco_centavos', 'rotulo', 'variacao_id']);
  }
  const texto = JSON.stringify([f, r, v]);
  assert.doesNotMatch(texto, /privado-m10|email_contato|documento|endereco_privado|observacoes|custo|fisico|reservado|disponivel|regras|perguntas|desconto/i);
  // Contatos: só os públicos configurados, só para quem está logado (D10-20, restritivo).
  const logado = ok(P.C, 'vitrine_publica', q(E.ana));
  assert.deepEqual(logado.contatos, { telefone_publico: '1933330000' });
  assert.equal(ok(P.C, 'vitrine_publica', q(E.bela)).contatos && Object.keys(ok(P.C, 'vitrine_publica', q(E.bela)).contatos).length, 0);
});

test('preço conforme a política, pacote sem nome de serviço interno, descrição com contato oculta (D10-05)', opcoes, () => {
  const v = ok(null, 'vitrine_publica', q(E.ana));
  const por = Object.fromEntries(v.servicos.map((s) => [s.nome, s]));
  assert.equal(por['Ajuste de barra'].preco_centavos, 3000);
  assert.equal(por['Conserto de zíper'].politica_preco, 'a_partir_de');
  assert.equal(por['Pacote noiva'].preco_centavos, 20000);
  assert.deepEqual(por['Pacote noiva'].pacote, { incluidos: ['Ajuste de barra'], outros_incluidos: 1 });
  assert.doesNotMatch(JSON.stringify(v), /Revisão interna de máquinas/);
  assert.equal(ok(null, 'vitrine_publica', q(E.bela)).servicos[0].preco_centavos, null, 'sob consulta sem preço');
  const el = ok(null, 'vitrine_publica', q(E.eletrica));
  assert.equal(el.servicos[0].descricao, null, 'descrição com telefone não vai à vitrine');
  assert.equal(ok(null, 'vitrine_publica', q(E.bela)).sem_itens, false);
});

test('limites no servidor: 20 por página, até 5 páginas, termo e palavras, chaves e valores inválidos (D10-22)', opcoes, () => {
  falha(anon('buscar_vitrine', `${j({})}, 6`), 'até 5 páginas');
  falha(anon('buscar_vitrine', `${j({})}, 0`), 'até 5 páginas');
  falha(anon('buscar_vitrine', `${j({ termo: 'x'.repeat(81) })}, 1`), 'até 80');
  falha(anon('buscar_vitrine', `${j({ termo: 'um dois tres quatro cinco seis sete' })}, 1`), 'até 6 palavras');
  falha(anon('buscar_vitrine', `${j({ categoria_id: 'nao-e-uuid' })}, 1`), 'Identificador inválido');
  falha(anon('buscar_vitrine', `${j({ categoria_id: 'ea000000-0000-4000-8000-00000000eeee' })}, 1`), 'Categoria inválida');
  falha(anon('buscar_vitrine', `${j({ bairro: 'Centro' })}, 1`), 'cidade antes do bairro');
  falha(anon('buscar_vitrine', `${j({ tipo: 'tudo_mesmo' })}, 1`), 'Tipo de resultado');
  falha(anon('buscar_vitrine', `${j({ cidade: 'Campinas', ampliar: 'bairro' })}, 1`), 'Ampliação inválida');
  const r = buscar({});
  assert.equal(r.por_pagina, 20);
  assert.equal(r.ha_mais, false);
  assert.equal(r.mais_de_100, false);
});

test('área de demonstração: autorizada vê só fictícias com a marca; sem autorização, vencida, revogada e real são negadas', opcoes, () => {
  falha(rpc(P.D2, 'buscar_demonstracao', `${j({})}, 1`), 'contas de demonstração autorizadas');
  falha(anon('buscar_demonstracao', `${j({})}, 1`), 'permission denied|AUTH_REQUIRED|FORBIDDEN');
  falha(rpc(P.C, 'buscar_demonstracao', `${j({})}, 1`), 'contas de demonstração autorizadas');
  // Só conta fictícia confirmada pode ser autorizada; validade de 1 a 30 dias.
  assert.equal(sql(banco.url, `SELECT app_private.autorizar_demonstracao(${q(P.C.id)}, 'Tentativa com conta real.', 'teste', 30)`).ok, false);
  assert.equal(sql(banco.url, `SELECT app_private.autorizar_demonstracao(${q(P.D4.id)}, 'Conta sem e-mail confirmado.', 'teste', 30)`).ok, false);
  assert.equal(sql(banco.url, `SELECT app_private.autorizar_demonstracao(${q(P.D2.id)}, 'Validade acima do permitido.', 'teste', 31)`).ok, false);
  const r = ok(P.D1, 'buscar_demonstracao', `${j({ termo: 'costura' })}, 1`);
  assert.equal(r.demonstracao, true);
  assert.deepEqual(nomes(r), ['Costura Demonstrativa']);
  assert.ok(!nomes(ok(P.D1, 'buscar_demonstracao', `${j({})}, 1`)).includes('Costura da Ana'), 'demonstração não mostra empresa real');
  const v = ok(P.D1, 'vitrine_demonstracao', q(E.demo));
  assert.equal(v.demonstracao, true);
  falha(rpc(P.D1, 'vitrine_demonstracao', q(E.ana)), 'Esta vitrine não está disponível');
  assert.deepEqual(ok(P.D1, 'filtros_demonstracao').cidades.map((c) => c.nome), ['Sorocaba']);
  assert.equal(ok(P.D1, 'minha_autorizacao_demonstracao').autorizada, true);
  // Vale entre logins enquanto estiver válida; vencida, perde o acesso.
  adm(`SELECT app_private.autorizar_demonstracao(${q(P.D3.id)}, 'Conta que vai vencer no teste.', 'teste automatizado', 1)`);
  ok(P.D3, 'buscar_demonstracao', `${j({})}, 1`);
  adm(`UPDATE app_private.autorizacoes_demonstracao SET autorizada_em = now() - interval '2 days', expira_em = now() - interval '1 day' WHERE auth_user_id = ${q(P.D3.id)}`);
  falha(rpc(P.D3, 'buscar_demonstracao', `${j({})}, 1`), 'contas de demonstração autorizadas');
  falha(rpc(P.D3, 'vitrine_demonstracao', q(E.demo)), 'contas de demonstração autorizadas');
  assert.equal(ok(P.D3, 'minha_autorizacao_demonstracao').autorizada, false);
  // Renovação devolve o acesso; revogação tira na chamada seguinte.
  adm(`SELECT app_private.autorizar_demonstracao(${q(P.D3.id)}, 'Renovação da conta de teste.', 'teste automatizado', 30)`);
  ok(P.D3, 'buscar_demonstracao', `${j({})}, 1`);
  assert.equal(adm(`SELECT app_private.revogar_demonstracao(${q(P.D3.id)}, 'Fim do teste de revogação.', 'teste automatizado')`), '1');
  falha(rpc(P.D3, 'buscar_demonstracao', `${j({})}, 1`), 'contas de demonstração autorizadas');
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao IN ('demonstracao.autorizada', 'demonstracao.revogada')"), '4');
});

test('da vitrine ao orçamento e ao pedido: perfil Cliente exigido, sem troca automática; banco continua decidindo', opcoes, () => {
  falha(rpc(P.BZ, 'servicos_para_cliente', q(E.ana)), 'Crie seu perfil de cliente');
  const sc = ok(P.C, 'servicos_para_cliente', q(E.ana));
  assert.ok(sc.servicos.some((s) => s.id === S.barra));
  const sol = ok(P.C, 'criar_solicitacao', `${q(S.barra)}, ${j({ relato: 'Ajustar a barra de uma calça social.' })}, ${q(k())}`);
  assert.equal(ok(P.O, 'solicitacao_detalhe', q(sol.id)).servico, 'Ajuste de barra', 'a empresa recebe a solicitação');
  const itens = ok(P.C, 'itens_para_pedido', q(E.ana));
  assert.ok(itens.length >= 1);
  // Empresa fictícia não recebe pedido de conta real (regra do M06, inalterada).
  falha(rpc(P.C, 'servicos_para_cliente', q(E.demo)), 'NOT_FOUND|não encontrada');
});

test('limites da CK: só administrador CK, motivo obrigatório, faixa, idempotência e histórico sem dados de clientes', opcoes, () => {
  falha(rpc(P.O, 'ck_limites'), 'FORBIDDEN_ACTION');
  falha(rpc(P.O, 'ck_historico_limites'), 'FORBIDDEN_ACTION');
  falha(rpc(P.C, 'ck_definir_limite', `'reagendamentos_por_os', 4, 'Teste sem permissão de CK.', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 99, 'Valor acima da faixa permitida.', ${q(k())}`), 'O valor vai de 1 a 10');
  falha(rpc(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 4, 'curto', ${q(k())}`), 'Explique a mudança');
  const chaveOp = k();
  ok(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 4, 'Mais flexibilidade nos testes do M10.', ${q(chaveOp)}`);
  ok(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 4, 'Mais flexibilidade nos testes do M10.', ${q(chaveOp)}`);
  const h = ok(P.CK, 'ck_historico_limites');
  assert.equal(h.length, 1, 'repetir a chave não altera duas vezes');
  assert.deepEqual(Object.keys(h[0]).sort(), ['antes', 'autor', 'chave', 'depois', 'motivo', 'quando']);
  assert.deepEqual([h[0].chave, h[0].antes, h[0].depois, h[0].autor], ['reagendamentos_por_os', 3, 4, 'Admin CK']);
  assert.equal(ok(P.CK, 'ck_limites').find((l) => l.chave === 'reagendamentos_por_os').valor, 4);
  ok(P.CK, 'ck_definir_limite', `'reagendamentos_por_os', 3, 'Volta ao valor padrão depois do teste.', ${q(k())}`);
});

test('privilégios: anônimo só nas leituras da vitrine (3 do M10 e 2 de logos e imagens do E03), nenhuma tabela, núcleo e demonstração fechados', opcoes, () => {
  const anonimas = adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'app_private', 'authz') AND has_function_privilege('anonymous', p.oid, 'EXECUTE')`);
  assert.equal(anonimas, 'buscar_vitrine,filtros_vitrine,imagens_publicas_de_produtos,logos_publicos,vitrine_publica' /* + leituras públicas de logos e imagens do E03 */);
  assert.equal(adm(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'app_private')
    AND c.relkind IN ('r', 'v', 'm') AND (has_table_privilege('anonymous', c.oid, 'SELECT') OR has_table_privilege('anonymous', c.oid, 'INSERT')
    OR has_table_privilege('anonymous', c.oid, 'UPDATE') OR has_table_privilege('anonymous', c.oid, 'DELETE'))`), '0');
  falha(comoPapel(banco.url, ANON, 'SELECT count(*) FROM public.public_empresa_cards'), 'permission denied');
  falha(comoPapel(banco.url, ANON, 'SELECT count(*) FROM public.servicos'), 'permission denied');
  falha(comoPapel(banco.url, ANON, "SELECT app_private.buscar_no_conjunto('demonstracao', '{}'::jsonb, 1)"), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.D1.id }, "SELECT app_private.buscar_no_conjunto('demonstracao', '{}'::jsonb, 1)"), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.D1.id }, 'SELECT count(*) FROM app_private.autorizacoes_demonstracao'), 'permission denied');
  assert.equal(adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN ('filtros_vitrine', 'buscar_vitrine', 'vitrine_publica', 'filtros_demonstracao', 'buscar_demonstracao', 'vitrine_demonstracao',
      'minha_autorizacao_demonstracao', 'definir_vitrine_produto', 'definir_vitrine_servico', 'ck_historico_limites')
    AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)`), '10');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55', 'nenhuma permissão nova');
  assert.equal(adm("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"), '0');
});
