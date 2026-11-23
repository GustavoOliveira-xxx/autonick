/**
 * Testes de banco do M11 (migration 202611140001): jornada completa do Cliente.
 * - D11-01 a D11-03: o login não amplia o catálogo; novas solicitações e pedidos só com item publicado e empresa com
 *   cartão aprovado, conferido na lista, na estimativa e no envio; item retirado bloqueia novas operações sem apagar o
 *   histórico; venda interna e balcão continuam iguais.
 * - D11-06 e D11-07: suspensão comum e grave congelam aceites pendentes; desistência sem custo; o já aceito continua;
 *   o cliente vê só "comum" ou "grave", nunca a justificativa interna da CK.
 * - D11-08: conta fictícia precisa de autorização de demonstração válida também no envio.
 * Jornadas completas: serviço até a OS e o recebimento; produto até o pedido concluído.
 * PostgreSQL LOCAL com emulação do Neon; banco descartável (D10-26: empresas sintéticas sem marcação só aqui).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();

const ID = (n) => `eb000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m11@teste.example', nome: 'Dona Olga', tipo: 'business' },
  O2: { id: ID(2), email: 'dono-demo-m11@autonick-teste.example', nome: 'Dono Demo', tipo: 'business' },
  C1: { id: ID(3), email: 'cliente1-m11@teste.example', nome: 'Cliente Cida', tipo: 'cliente' },
  C2: { id: ID(4), email: 'cliente2-m11@teste.example', nome: 'Cliente Davi', tipo: 'cliente' },
  D1: { id: ID(5), email: 'demo1-m11@autonick-teste.example', nome: 'Demo Autorizada', tipo: 'cliente' },
  D2: { id: ID(6), email: 'demo2-m11@autonick-teste.example', nome: 'Demo Sem Autorização', tipo: 'cliente' },
  BZ: { id: ID(7), email: 'empresarial-m11@teste.example', nome: 'Só Empresarial', tipo: 'business' },
  CK: { id: ID(8), email: 'ck-m11@teste.example', nome: 'Admin CK', tipo: null },
};
let chave = 0;
const k = () => `m11-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args = '') => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
const anon = (nome, args = '') => comoPapel(banco.url, { papel: 'anonymous', sub: 'anonimo-m11' }, `SELECT public.${nome}(${args})::text`);
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
const contar = (tabela, onde) => Number(adm(`SELECT count(*) FROM public.${tabela} WHERE ${onde}`));
const variacao = (produto) => adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(produto)} ORDER BY padrao DESC, id LIMIT 1`);
const SERV_INDISP = 'não está disponível para novas solicitações';
const PROD_INDISP = 'Um dos produtos não está disponível para pedido';
const EMP_INDISP = 'Esta empresa não está disponível para novas solicitações';

const E = {};
const S = {};
const PR = {};
const PERG = {};

function empresa(dono, nome, extra = {}) {
  return ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', bairro: 'Cambuí', uf: 'SP', email_contato: 'privado-m11@teste.example', ...extra })}, ${q(k())}`).id;
}
function aprovar(id, dono) {
  ok(dono, 'enviar_vitrine_para_analise', `${q(id)}, ${versao('empresas', id)}, ${q(k())}`);
  const sol = adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(id)} AND estado = 'aberta'`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(sol)}, 'aprovar', NULL, NULL, ${q(k())}`);
}
/** Serviço com orçamento automático por regras (o orçamento nasce no envio) ou de preço fixo com análise manual. */
function servicoAuto(dono, emp, nome) {
  const s = ok(dono, 'criar_servico', `${q(emp)}, ${j({ nome, politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  ok(dono, 'salvar_formulario_servico', `${q(s.id)}, ${j([{ texto: 'Metros', tipo: 'numero', obrigatoria: true, configuracao: { minimo: 1, maximo: 200 } }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  PERG[s.id] = adm(`SELECT id FROM public.servico_perguntas WHERE servico_id = ${q(s.id)} AND ativa`);
  ok(dono, 'salvar_regras_servico', `${q(s.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: PERG[s.id], rotulo: 'Por metro', valor_unitario_centavos: 1200 }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  return s.id;
}
const servicoFixo = (dono, emp, nome) => ok(dono, 'criar_servico', `${q(emp)}, ${j({ nome, politica_preco: 'fixo', preco_centavos: 5000 })}, ${q(k())}`).id;
const produto = (dono, emp, nome, finalidade = 'comercializavel') =>
  ok(dono, 'criar_produto', `${q(emp)}, ${j({ nome, finalidade, preco_centavos: 1000, quantidade_inicial: 10 })}, NULL, ${q(k())}`).id;
const vitrineServ = (dono, id, exibir = true) => ok(dono, 'definir_vitrine_servico', `${q(id)}, ${exibir}, ${versao('servicos', id)}, ${q(k())}`);
const vitrineProd = (dono, id, exibir = true) => ok(dono, 'definir_vitrine_produto', `${q(id)}, ${exibir}, ${versao('produtos', id)}, ${q(k())}`);
const dadosSol = (servicoId, relato = 'Preciso do serviço na sala de casa.') => j({ respostas: PERG[servicoId] ? { [PERG[servicoId]]: 10 } : {}, relato });
const solicitar = (p, servicoId, chaveOp = k()) => rpc(p, 'criar_solicitacao', `${q(servicoId)}, ${dadosSol(servicoId)}, ${q(chaveOp)}`);
const pedir = (p, emp, prodId, chaveOp = k(), qtd = 1) => rpc(p, 'criar_pedido', `${q(emp)}, ${j([{ variacao_id: variacao(prodId), quantidade: qtd }])}, NULL, ${q(chaveOp)}`);
const vigente = (sol) => adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(sol)}`);
const aceitar = (p, sol, chaveOp = k()) => rpc(p, 'aceitar_orcamento', `${q(sol)}, ${q(vigente(sol))}, true, ${q(chaveOp)}`);
const osDe = (sol) => adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(sol)}`);
const suspender = (emp, gravidade, fundamento = null) => ok(P.CK, 'ck_suspender_vitrine',
  `${q(emp)}, 'Motivo interno da CK que o cliente não deve ver.', ${q(gravidade)}, ${q(fundamento)}, ${q(k())}`);
const reativar = (emp) => ok(P.CK, 'ck_reativar_vitrine', `${q(emp)}, 'Reativação após análise.', ${q(k())}`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    if (p.tipo) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste M11')`);

  // Empresas reais com cartão aprovado (só neste banco descartável) e uma "publicada" sem cartão (prática antiga do M06).
  E.real = empresa(P.O, 'Costura da Olga');
  E.susp = empresa(P.O, 'Ateliê Suspensão', { bairro: 'Centro' });
  E.semCartao = empresa(P.O, 'Loja Sem Cartão');
  for (const id of [E.real, E.susp]) aprovar(id, P.O);
  adm(`UPDATE public.empresas SET situacao_vitrine = 'publicada' WHERE id = ${q(E.semCartao)}`);
  // Empresa fictícia aprovada e marcada (área de demonstração).
  E.demo = empresa(P.O2, '[TESTE] Costura Demo M11');
  aprovar(E.demo, P.O2);
  adm(`SELECT app_private.marcar_empresa_de_teste(${q(E.demo)}, 'teste M11: área de demonstração')`);
  adm(`SELECT app_private.autorizar_demonstracao(${q(P.D1.id)}, 'teste M11: conta de demonstração autorizada', 'teste M11 (SQL operacional)', 30)`);

  S.pub = servicoAuto(P.O, E.real, 'Barra de calça');
  S.retira = servicoAuto(P.O, E.real, 'Ajuste de cintura');
  S.oculto = servicoFixo(P.O, E.real, 'Revisão interna de máquinas');
  S.semCartao = servicoAuto(P.O, E.semCartao, 'Serviço sem cartão');
  S.susp = servicoAuto(P.O, E.susp, 'Bainha suspensa');
  S.demo = servicoAuto(P.O2, E.demo, 'Costura demonstrativa');
  for (const [dono, id] of [[P.O, S.pub], [P.O, S.retira], [P.O, S.semCartao], [P.O, S.susp], [P.O2, S.demo]]) vitrineServ(dono, id);

  PR.pub = produto(P.O, E.real, 'Linha de costura');
  PR.retira = produto(P.O, E.real, 'Botão de madrepérola');
  PR.oculto = produto(P.O, E.real, 'Tecido só do balcão');
  PR.pausado = produto(P.O, E.real, 'Zíper pausado');
  PR.insumo = produto(P.O, E.real, 'Agulha industrial', 'uso_interno');
  PR.susp = produto(P.O, E.susp, 'Linha suspensa');
  PR.semCartao = produto(P.O, E.semCartao, 'Produto sem cartão');
  PR.demo = produto(P.O2, E.demo, 'Linha demonstrativa');
  for (const [dono, id] of [[P.O, PR.pub], [P.O, PR.retira], [P.O, PR.pausado], [P.O, PR.susp], [P.O, PR.semCartao], [P.O2, PR.demo]]) vitrineProd(dono, id);
  ok(P.O, 'pausar_venda_produto', `${q(PR.pausado)}, true, 'Sem estoque no fornecedor.', ${versao('produtos', PR.pausado)}, ${q(k())}`);
});
after(() => banco?.encerrar());

test('jornada de serviço: vitrine → solicitação → orçamento → aceite → OS → acompanhamento → recebimento confirmado', opcoes, () => {
  assert.ok(JSON.parse(anon('vitrine_publica', q(E.real)).saida).servicos.some((s) => s.id === S.pub), 'serviço na vitrine pública');
  const lista = ok(P.C1, 'servicos_para_cliente', q(E.real));
  assert.ok(lista.servicos.some((s) => s.id === S.pub));
  assert.equal(ok(P.C1, 'estimar_servico', `${q(S.pub)}, ${j({ [PERG[S.pub]]: 10 })}`).valor_centavos, 12000);
  const sol = JSON.parse(solicitar(P.C1, S.pub).saida);
  assert.equal(sol.estado, 'orcamento_enviado', 'orçamento automático já disponível');
  assert.equal(ok(P.C1, 'minhas_solicitacoes').find((s) => s.id === sol.id).estado, 'orcamento_enviado');
  const ac = aceitar(P.C1, sol.id);
  assert.ok(ac.ok, ac.erro);
  const os = osDe(sol.id);
  assert.equal(ok(P.C1, 'minhas_os').find((o) => o.id === os).estado, 'aguardando_inicio');
  ok(P.O, 'mudar_estado_os', `${q(os)}, 'iniciar', NULL, ${versao('ordens_servico', os)}, ${q(k())}`);
  ok(P.O, 'publicar_atualizacao_os', `${q(os)}, 'Barra medida e alfinetada.', true, ${q(k())}`);
  const andamento = ok(P.C1, 'minha_os', q(os));
  assert.equal(andamento.estado, 'em_execucao');
  assert.equal(andamento.suspensao, null);
  assert.ok(JSON.stringify(andamento).includes('Barra medida e alfinetada.'), 'atualização pública visível');
  ok(P.O, 'mudar_estado_os', `${q(os)}, 'concluir', NULL, ${versao('ordens_servico', os)}, ${q(k())}`);
  assert.equal(ok(P.C1, 'minhas_os').find((o) => o.id === os).acao_pendente, 'confirmar_recebimento');
  ok(P.C1, 'confirmar_recebimento_servico', `${q(os)}, ${q(k())}`);
  assert.equal(ok(P.C1, 'minha_os', q(os)).estado, 'encerrada', 'a confirmação do cliente encerra o atendimento (M09)');
});

test('jornada de produto: vitrine → pedido → aceite com reserva → concluído; pedido não é pagamento', opcoes, () => {
  const itens = ok(P.C1, 'itens_para_pedido', q(E.real));
  assert.ok(itens.some((i) => i.variacao_id === variacao(PR.pub)));
  const p = JSON.parse(pedir(P.C1, E.real, PR.pub, k(), 2).saida);
  assert.equal(p.estado, 'solicitado');
  assert.equal(contar('reservas_estoque', `origem_id = ${q(p.id)}`), 0, 'nada reservado antes do aceite');
  ok(P.O, 'aceitar_pedido', `${q(p.id)}, ${versao('pedidos', p.id)}, ${q(k())}`);
  assert.equal(ok(P.C1, 'meus_pedidos').find((x) => x.id === p.id).estado, 'aceito');
  ok(P.O, 'concluir_pedido', `${q(p.id)}, ${j({})}, ${versao('pedidos', p.id)}, ${q(k())}`);
  const meu = ok(P.C1, 'meus_pedidos').find((x) => x.id === p.id);
  assert.equal(meu.estado, 'concluido');
  assert.equal(meu.empresa_id, E.real);
  assert.equal(meu.suspensao, null);
});

test('D11-01: login não amplia o catálogo (lista, estimativa e envio); mensagem única para indisponível', opcoes, () => {
  assert.ok(!ok(P.C1, 'servicos_para_cliente', q(E.real)).servicos.some((s) => s.id === S.oculto), 'serviço ativo fora da vitrine não aparece');
  falha(rpc(P.C1, 'estimar_servico', `${q(S.oculto)}, '{}'::jsonb`), SERV_INDISP);
  falha(solicitar(P.C1, S.oculto), SERV_INDISP);
  const ids = ok(P.C1, 'itens_para_pedido', q(E.real)).map((i) => i.variacao_id);
  for (const pr of [PR.oculto, PR.pausado, PR.insumo]) assert.ok(!ids.includes(variacao(pr)));
  // Mesma resposta para fora da vitrine, pausado, interno, de outra empresa e inexistente (ADR-004).
  for (const pr of [PR.oculto, PR.pausado, PR.insumo, PR.susp]) falha(pedir(P.C1, E.real, pr), PROD_INDISP);
  falha(rpc(P.C1, 'criar_pedido', `${q(E.real)}, ${j([{ variacao_id: 'eb000000-0000-4000-8000-00000000ffff', quantidade: 1 }])}, NULL, ${q(k())}`), PROD_INDISP);
  // A equipe continua estimando qualquer serviço da própria empresa.
  ok(P.O, 'estimar_servico', `${q(S.oculto)}, '{}'::jsonb`);
  // Publicado, passa a valer na chamada seguinte.
  vitrineServ(P.O, S.oculto);
  assert.ok(ok(P.C1, 'servicos_para_cliente', q(E.real)).servicos.some((s) => s.id === S.oculto));
  vitrineServ(P.O, S.oculto, false);
});

test('D11-02: empresa sem cartão aprovado e de outro conjunto não recebe novas solicitações nem pedidos', opcoes, () => {
  falha(rpc(P.C1, 'servicos_para_cliente', q(E.semCartao)), EMP_INDISP);
  falha(solicitar(P.C1, S.semCartao), SERV_INDISP);
  falha(rpc(P.C1, 'itens_para_pedido', q(E.semCartao)), EMP_INDISP);
  falha(pedir(P.C1, E.semCartao, PR.semCartao), EMP_INDISP);
  assert.ok(!ok(P.C1, 'empresas_para_pedido').some((e) => e.id === E.semCartao));
  // Conta real não alcança fictícia; conta fictícia autorizada não alcança real.
  falha(solicitar(P.C1, S.demo), SERV_INDISP);
  falha(pedir(P.C1, E.demo, PR.demo), EMP_INDISP);
  falha(solicitar(P.D1, S.pub), SERV_INDISP);
  falha(pedir(P.D1, E.real, PR.pub), EMP_INDISP);
  // Conta só empresarial: recusada nas funções do cliente, sem troca automática.
  falha(solicitar(P.BZ, S.pub), 'perfil de cliente');
  falha(pedir(P.BZ, E.real, PR.pub), 'perfil de cliente');
});

test('D11-08: conta fictícia só com autorização válida, conferida também no envio; separação do M10 preservada', opcoes, () => {
  assert.ok(ok(P.D1, 'servicos_para_cliente', q(E.demo)).servicos.some((s) => s.id === S.demo));
  falha(rpc(P.D2, 'servicos_para_cliente', q(E.demo)), EMP_INDISP);
  falha(solicitar(P.D2, S.demo), SERV_INDISP);
  falha(pedir(P.D2, E.demo, PR.demo), EMP_INDISP);
  const sol = JSON.parse(solicitar(P.D1, S.demo).saida);
  const ped = JSON.parse(pedir(P.D1, E.demo, PR.demo).saida);
  // Formulário aberto e autorização revogada: o envio seguinte é recusado; o que já existe continua acompanhável.
  adm(`SELECT app_private.revogar_demonstracao(${q(P.D1.id)}, 'teste M11: revogada com o formulário aberto', 'teste M11 (SQL operacional)')`);
  falha(solicitar(P.D1, S.demo), SERV_INDISP);
  falha(pedir(P.D1, E.demo, PR.demo), EMP_INDISP);
  falha(rpc(P.D1, 'estimar_servico', `${q(S.demo)}, ${j({ [PERG[S.demo]]: 3 })}`), SERV_INDISP);
  assert.equal(ok(P.D1, 'minha_solicitacao', q(sol.id)).id, sol.id);
  assert.ok(ok(P.D1, 'meus_pedidos').some((x) => x.id === ped.id));
  assert.ok(aceitar(P.D1, sol.id).ok, 'aceitar orçamento já enviado é fluxo privado: não depende da autorização');
  // Vencida: também recusa novas.
  adm(`SELECT app_private.autorizar_demonstracao(${q(P.D1.id)}, 'teste M11: nova autorização', 'teste M11 (SQL operacional)', 1)`);
  assert.ok(solicitar(P.D1, S.demo).ok);
  adm(`UPDATE app_private.autorizacoes_demonstracao SET autorizada_em = now() - interval '2 days', expira_em = now() - interval '1 day'
        WHERE auth_user_id = ${q(P.D1.id)} AND revogada_em IS NULL`);
  falha(solicitar(P.D1, S.demo), SERV_INDISP);
  // M10 intacto: fictícia fora da busca pública e do link direto, mesmo com autorização válida.
  adm(`SELECT app_private.autorizar_demonstracao(${q(P.D1.id)}, 'teste M11: autorizada de novo', 'teste M11 (SQL operacional)', 30)`);
  assert.ok(!JSON.parse(rpc(P.D1, 'buscar_vitrine', `${j({ termo: 'demonstrativa' })}, 1`).saida).itens.some((i) => i.empresa_id === E.demo));
  falha(rpc(P.D1, 'vitrine_publica', q(E.demo)), 'não está disponível');
});

test('item retirado da vitrine: bloqueia novas operações (inclusive entre abrir e enviar) sem apagar o histórico', opcoes, () => {
  // Cliente abre a tela (lista traz o item) e envia antes da retirada: atendimento criado.
  assert.ok(ok(P.C2, 'servicos_para_cliente', q(E.real)).servicos.some((s) => s.id === S.retira));
  const sol = JSON.parse(solicitar(P.C2, S.retira).saida);
  const ped = JSON.parse(pedir(P.C2, E.real, PR.retira).saida);
  // Outro cliente abre a tela; a empresa retira os itens antes do envio.
  assert.ok(ok(P.C1, 'itens_para_pedido', q(E.real)).some((i) => i.variacao_id === variacao(PR.retira)));
  const antesSol = contar('solicitacoes_servico', `empresa_id = ${q(E.real)}`);
  const antesPed = contar('pedidos', `empresa_id = ${q(E.real)}`);
  const contador = adm(`SELECT proxima_solicitacao FROM app_private.contadores_empresa WHERE empresa_id = ${q(E.real)}`);
  vitrineServ(P.O, S.retira, false);
  vitrineProd(P.O, PR.retira, false);
  falha(solicitar(P.C1, S.retira), SERV_INDISP);
  falha(pedir(P.C1, E.real, PR.retira), PROD_INDISP);
  falha(rpc(P.C1, 'estimar_servico', `${q(S.retira)}, ${j({ [PERG[S.retira]]: 5 })}`), SERV_INDISP);
  assert.equal(contar('solicitacoes_servico', `empresa_id = ${q(E.real)}`), antesSol, 'nada criado');
  assert.equal(contar('pedidos', `empresa_id = ${q(E.real)}`), antesPed, 'nada criado');
  assert.equal(adm(`SELECT proxima_solicitacao FROM app_private.contadores_empresa WHERE empresa_id = ${q(E.real)}`), contador, 'numeração intacta');
  // Histórico e fluxos privados continuam para quem já enviou.
  assert.equal(ok(P.C2, 'minha_solicitacao', q(sol.id)).servico, 'Ajuste de cintura');
  ok(P.C2, 'pedir_revisao', `${q(sol.id)}, 'Pode incluir a barra também?', ${q(k())}`);
  assert.ok(ok(P.C2, 'meus_pedidos').some((x) => x.id === ped.id && x.itens[0].produto === 'Botão de madrepérola'));
  ok(P.O, 'aceitar_pedido', `${q(ped.id)}, ${versao('pedidos', ped.id)}, ${q(k())}`);
  assert.equal(ok(P.C2, 'meus_pedidos').find((x) => x.id === ped.id).estado, 'aceito', 'a empresa aceita e reserva normalmente');
});

test('fluxo interno do ERP inalterado: venda interna e balcão com itens fora da vitrine', opcoes, () => {
  const venda = ok(P.O, 'registrar_venda_direta', `${q(E.real)}, '{}'::jsonb, ${j([{ variacao_id: variacao(PR.oculto), quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`);
  assert.ok(venda.id, 'venda interna de produto fora da vitrine');
  const cli = ok(P.O, 'criar_cliente', `${q(E.real)}, ${j({ nome: 'Seu Zeca (balcão)', telefone: '19999990000' })}, ${q(k())}`);
  const balcao = ok(P.O, 'criar_solicitacao_interna', `${q(E.real)}, ${q(cli.id)}, ${q(S.oculto)}, ${j({ relato: 'Revisar a máquina do Seu Zeca.' })}, ${q(k())}`);
  assert.ok(balcao.id, 'solicitação de balcão de serviço fora da vitrine');
});

test('idempotência e duplo clique: mesma chave devolve o mesmo atendimento, sem segundo efeito', opcoes, () => {
  const ch1 = k();
  const a = JSON.parse(solicitar(P.C2, S.pub, ch1).saida);
  assert.equal(JSON.parse(solicitar(P.C2, S.pub, ch1).saida).id, a.id);
  const ch2 = k();
  const p = JSON.parse(pedir(P.C2, E.real, PR.pub, ch2).saida);
  assert.equal(JSON.parse(pedir(P.C2, E.real, PR.pub, ch2).saida).id, p.id);
  const ch3 = k();
  assert.ok(aceitar(P.C2, a.id, ch3).ok);
  assert.ok(aceitar(P.C2, a.id, ch3).ok);
  assert.equal(contar('ordens_servico', `solicitacao_id = ${q(a.id)}`), 1);
});

test('histórico de outro cliente: NOT_FOUND como inexistente; listas só da própria conta', opcoes, () => {
  const sol = JSON.parse(solicitar(P.C2, S.pub).saida);
  const ped = JSON.parse(pedir(P.C2, E.real, PR.pub).saida);
  falha(rpc(P.C1, 'minha_solicitacao', q(sol.id)), 'NOT_FOUND');
  // cancelar_pedido é do M06 e serve cliente e empresa: recusa sem efeito e sem revelar dados do pedido.
  falha(rpc(P.C1, 'cancelar_pedido', `${q(ped.id)}, NULL, ${versao('pedidos', ped.id)}, ${q(k())}`), 'NOT_FOUND|não encontrado|acesso');
  assert.equal(adm(`SELECT estado FROM public.pedidos WHERE id = ${q(ped.id)}`), 'solicitado');
  falha(aceitar(P.C1, sol.id), 'NOT_FOUND|não encontrad');
  assert.ok(!ok(P.C1, 'meus_pedidos').some((x) => x.id === ped.id));
  assert.ok(!ok(P.C1, 'minhas_solicitacoes').some((x) => x.id === sol.id));
  ok(P.C2, 'aceitar_orcamento', `${q(sol.id)}, ${q(vigente(sol.id))}, true, ${q(k())}`);
  falha(rpc(P.C1, 'minha_os', q(osDe(sol.id))), 'NOT_FOUND');
});

test('versão substituída: aceite da versão antiga recusado (QUOTE_VERSION_STALE), a vigente é aceita; versão inexistente NOT_FOUND', opcoes, () => {
  // A vencida (QUOTE_EXPIRED) é coberta pelo M08 local e pela verificação real em duas fases (P-M08-01); aqui a imutabilidade
  // das versões fica ligada.
  const sol = JSON.parse(solicitar(P.C1, S.pub).saida);
  const velha = vigente(sol.id);
  ok(P.C1, 'pedir_revisao', `${q(sol.id)}, 'Pode fazer por um valor menor?', ${q(k())}`);
  let v2 = ok(P.O, 'salvar_rascunho_orcamento', `${q(sol.id)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Barra com desconto', quantidade: 1, valor_unitario_centavos: 10000 }] })}, ${versao('solicitacoes_servico', sol.id)}, ${q(k())}`);
  v2 = ok(P.O, 'enviar_orcamento', `${q(v2.id)}, ${v2.versao}, ${q(k())}`);
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(sol.id)}, ${q(velha)}, true, ${q(k())}`), 'QUOTE_VERSION_STALE');
  assert.equal(contar('ordens_servico', `solicitacao_id = ${q(sol.id)}`), 0);
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(sol.id)}, 'eb000000-0000-4000-8000-00000000eeee', true, ${q(k())}`), 'NOT_FOUND');
  assert.ok(aceitar(P.C1, sol.id).ok, 'a versão vigente é aceita');
  assert.equal(contar('ordens_servico', `solicitacao_id = ${q(sol.id)}`), 1);
});

test('D11-06: suspensão comum bloqueia novas, congela aceites pendentes, deixa desistir sem custo e mantém o já aceito', opcoes, () => {
  const pendente = JSON.parse(solicitar(P.C1, S.susp).saida);
  const outra = JSON.parse(solicitar(P.C1, S.susp).saida);
  const aceita = JSON.parse(solicitar(P.C2, S.susp).saida);
  assert.ok(aceitar(P.C2, aceita.id).ok);
  const osAceita = osDe(aceita.id);
  const pedPend = JSON.parse(pedir(P.C1, E.susp, PR.susp).saida);
  const pedCanc = JSON.parse(pedir(P.C2, E.susp, PR.susp).saida);
  const pedAceito = JSON.parse(pedir(P.C2, E.susp, PR.susp).saida);
  ok(P.O, 'aceitar_pedido', `${q(pedAceito.id)}, ${versao('pedidos', pedAceito.id)}, ${q(k())}`);

  suspender(E.susp, 'comum');
  falha(solicitar(P.C1, S.susp), SERV_INDISP);
  falha(pedir(P.C1, E.susp, PR.susp), EMP_INDISP);
  falha(aceitar(P.C1, pendente.id), 'vitrine desta empresa está suspensa');
  falha(rpc(P.O, 'aceitar_pedido', `${q(pedPend.id)}, ${versao('pedidos', pedPend.id)}, ${q(k())}`), 'vitrine desta empresa está suspensa');
  assert.equal(contar('ordens_servico', `solicitacao_id = ${q(pendente.id)}`), 0);
  assert.equal(contar('reservas_estoque', `origem_id = ${q(pedPend.id)}`), 0, 'nada reservado');
  // Desistência sem custo continua.
  ok(P.C1, 'recusar_orcamento', `${q(outra.id)}, ${q(vigente(outra.id))}, ${j({ motivo: 'preco' })}, ${q(k())}`);
  ok(P.C2, 'cancelar_pedido', `${q(pedCanc.id)}, NULL, ${versao('pedidos', pedCanc.id)}, ${q(k())}`);
  ok(P.C1, 'pedir_revisao', `${q(pendente.id)}, 'Quando reativar, ainda vale?', ${q(k())}`);
  // O já aceito continua.
  ok(P.O, 'mudar_estado_os', `${q(osAceita)}, 'iniciar', NULL, ${versao('ordens_servico', osAceita)}, ${q(k())}`);
  ok(P.O, 'concluir_pedido', `${q(pedAceito.id)}, ${j({})}, ${versao('pedidos', pedAceito.id)}, ${q(k())}`);
  // O cliente vê "comum", nunca o motivo interno.
  const os = ok(P.C2, 'minha_os', q(osAceita));
  assert.equal(os.suspensao, 'comum');
  assert.equal(ok(P.C1, 'minha_solicitacao', q(pendente.id)).suspensao, 'comum');
  assert.equal(ok(P.C1, 'meus_pedidos').find((x) => x.id === pedPend.id).suspensao, 'comum');
  assert.equal(ok(P.C2, 'minhas_os').find((x) => x.id === osAceita).suspensao, 'comum');
  for (const r of [os, ok(P.C1, 'minhas_solicitacoes'), ok(P.C1, 'meus_pedidos')]) assert.ok(!JSON.stringify(r).includes('Motivo interno'));
  // ERP da empresa suspensa continua (ADR-005).
  assert.ok(ok(P.O, 'registrar_venda_direta', `${q(E.susp)}, '{}'::jsonb, ${j([{ variacao_id: variacao(PR.susp), quantidade: 1 }])}, '{}'::jsonb, NULL, ${q(k())}`).id);
  // Reativada: o aceite volta na chamada seguinte (o orçamento ainda está válido).
  reativar(E.susp);
  assert.ok(aceitar(P.C1, pendente.id).ok);
  ok(P.O, 'aceitar_pedido', `${q(pedPend.id)}, ${versao('pedidos', pedPend.id)}, ${q(k())}`);
  assert.equal(ok(P.C1, 'meus_pedidos').find((x) => x.id === pedPend.id).suspensao, null);
});

test('D11-07: suspensão grave mantém os bloqueios, mostra "grave" e não altera estados, valores nem expõe o fundamento', opcoes, () => {
  const pend = JSON.parse(solicitar(P.C1, S.susp).saida);
  const acc = JSON.parse(solicitar(P.C2, S.susp).saida);
  assert.ok(aceitar(P.C2, acc.id).ok);
  const os = osDe(acc.id);
  const antes = adm(`SELECT estado || '|' || versao FROM public.ordens_servico WHERE id = ${q(os)}`);
  const totalAntes = adm(`SELECT total FROM public.orcamento_versoes WHERE id = ${q(vigente(acc.id))}`);
  suspender(E.susp, 'grave', 'risco_consumidor');
  falha(aceitar(P.C1, pend.id), 'vitrine desta empresa está suspensa');
  falha(solicitar(P.C1, S.susp), SERV_INDISP);
  const visto = ok(P.C2, 'minha_os', q(os));
  assert.equal(visto.suspensao, 'grave');
  // Nem o motivo escrito pela CK nem o fundamento da suspensão grave chegam ao cliente.
  for (const r of [visto, ok(P.C1, 'minhas_solicitacoes'), ok(P.C2, 'minhas_os')]) {
    assert.ok(!/Motivo interno|risco_consumidor|fundamento/i.test(JSON.stringify(r)));
  }
  assert.equal(adm(`SELECT estado || '|' || versao FROM public.ordens_servico WHERE id = ${q(os)}`), antes, 'estado e versão da OS intactos');
  assert.equal(adm(`SELECT total FROM public.orcamento_versoes WHERE id = ${q(vigente(acc.id))}`), totalAntes, 'valor intacto');
  ok(P.C1, 'cancelar_solicitacao', `${q(pend.id)}, 'Prefiro outra empresa.', ${q(k())}`);
  reativar(E.susp);
});

test('privilégios: anônimo continua com as 3 funções do M10; auxiliares fechadas; nenhuma tabela nova', opcoes, () => {
  assert.equal(adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'execute')`), 'buscar_vitrine,filtros_vitrine,vitrine_publica');
  for (const f of ['app_private.empresa_aceita_novas(uuid, text)', 'app_private.suspensao_da_vitrine(uuid)']) {
    assert.equal(adm(`SELECT has_function_privilege('authenticated', '${f}', 'execute')`), 'f', f);
  }
  for (const f of ['public.servicos_para_cliente(uuid)', 'public.criar_pedido(uuid, jsonb, text, text)', 'public.aceitar_orcamento(uuid, uuid, boolean, text)']) {
    assert.equal(adm(`SELECT prosecdef AND 'search_path=""' = ANY(proconfig) FROM pg_proc WHERE oid = '${f}'::regprocedure`), 't', f);
  }
  assert.equal(adm("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity"), '0');
  assert.equal(adm("SELECT count(*) FROM public.permissoes_catalogo"), '55');
});
