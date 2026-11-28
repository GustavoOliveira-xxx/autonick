/**
 * Testes de banco do M12 (migration 202611170001): comunicação, avaliações e moderação ampliada (ADR-G12 aprovada).
 * - Conversa por atendimento (D12-01, D12-02): solicitação e OS compartilham; pedido tem a sua; mensagens do M08 e
 *   atualizações públicas da OS lidas na origem, sem cópia; notas internas nunca aparecem.
 * - Acesso (D12-03): titular e equipe autorizada pela área; permissão antes e depois da OS; ninguém mais.
 * - Suspensão (D12-05), prazo depois do fim com garantia registrada (D12-06), limites no servidor (D12-07).
 * - Avaliação (D12-09 a D12-14), denúncia (D12-16, D12-17), ocultação (D12-18 = C) e contestação (D12-22).
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

const ID = (n) => `ec120000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m12@teste.example', nome: 'Dona Olga', tipo: 'business' },
  C1: { id: ID(2), email: 'cliente1-m12@teste.example', nome: 'Cliente Cida', tipo: 'cliente' },
  C2: { id: ID(3), email: 'cliente2-m12@teste.example', nome: 'Cliente Davi', tipo: 'cliente' },
  TEC: { id: ID(4), email: 'tecnico-m12@teste.example', nome: 'Técnico Tião', tipo: 'business' },
  ORC: { id: ID(5), email: 'orcamentista-m12@teste.example', nome: 'Orçamentista Rita', tipo: 'business' },
  FIN: { id: ID(6), email: 'financeiro-m12@teste.example', nome: 'Financeiro Fábio', tipo: 'business' },
  VIT: { id: ID(7), email: 'vitrine-m12@teste.example', nome: 'Vitrine Vera', tipo: 'business' },
  CK: { id: ID(8), email: 'ck1-m12@teste.example', nome: 'Admin CK Um', tipo: null },
  CK2: { id: ID(9), email: 'ck2-m12@teste.example', nome: 'Admin CK Dois', tipo: null },
  D1: { id: ID(10), email: 'demo1-m12@autonick-teste.example', nome: 'Demo Autorizada', tipo: 'cliente' },
};
let chave = 0;
const k = () => `m12-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args = '') => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
const anon = (nome, args = '') => comoPapel(banco.url, { papel: 'anonymous', sub: 'anonimo-m12' }, `SELECT public.${nome}(${args})::text`);
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
const contar = (tabela, onde = 'true') => Number(adm(`SELECT count(*) FROM public.${tabela} WHERE ${onde}`));
const variacao = (produto) => adm(`SELECT id FROM public.produto_variacoes WHERE produto_id = ${q(produto)} ORDER BY padrao DESC, id LIMIT 1`);

const E = {};
const S = {};
const PR = {};
const PERG = {};

function empresa(dono, nome) {
  return ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'ambos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', bairro: 'Cambuí', uf: 'SP', email_contato: 'privado-m12@teste.example' })}, ${q(k())}`).id;
}
function aprovar(id, dono) {
  ok(dono, 'enviar_vitrine_para_analise', `${q(id)}, ${versao('empresas', id)}, ${q(k())}`);
  const sol = adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(id)} AND estado = 'aberta'`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(sol)}, 'aprovar', NULL, NULL, ${q(k())}`);
}
function servicoAuto(dono, emp, nome) {
  const s = ok(dono, 'criar_servico', `${q(emp)}, ${j({ nome, politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  ok(dono, 'salvar_formulario_servico', `${q(s.id)}, ${j([{ texto: 'Metros', tipo: 'numero', obrigatoria: true, configuracao: { minimo: 1, maximo: 200 } }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  PERG[s.id] = adm(`SELECT id FROM public.servico_perguntas WHERE servico_id = ${q(s.id)} AND ativa`);
  ok(dono, 'salvar_regras_servico', `${q(s.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: PERG[s.id], rotulo: 'Por metro', valor_unitario_centavos: 1200 }])}, ${versao('servicos', s.id)}, ${q(k())}`);
  ok(dono, 'definir_vitrine_servico', `${q(s.id)}, true, ${versao('servicos', s.id)}, ${q(k())}`);
  return s.id;
}
function produto(dono, emp, nome) {
  const id = ok(dono, 'criar_produto', `${q(emp)}, ${j({ nome, finalidade: 'comercializavel', preco_centavos: 1000, quantidade_inicial: 50 })}, NULL, ${q(k())}`).id;
  ok(dono, 'definir_vitrine_produto', `${q(id)}, true, ${versao('produtos', id)}, ${q(k())}`);
  return id;
}
const solicitar = (p, servicoId) => ok(p, 'criar_solicitacao', `${q(servicoId)}, ${j({ respostas: { [PERG[servicoId]]: 10 }, relato: 'Preciso do serviço na sala de casa.' })}, ${q(k())}`);
const vigente = (sol) => adm(`SELECT versao_vigente_id FROM public.solicitacoes_servico WHERE id = ${q(sol)}`);
const aceitar = (p, sol) => ok(p, 'aceitar_orcamento', `${q(sol)}, ${q(vigente(sol))}, true, ${q(k())}`);
const osDe = (sol) => adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(sol)}`);
const estadoOs = (os, acao) => ok(P.O, 'mudar_estado_os', `${q(os)}, ${q(acao)}, NULL, ${versao('ordens_servico', os)}, ${q(k())}`);
const conversa = (p, tipo, id) => rpc(p, 'conversa_atendimento', `${q(tipo)}, ${q(id)}`);
const ler = (p, tipo, id) => { const r = conversa(p, tipo, id); assert.ok(r.ok, r.erro); return JSON.parse(r.saida); };
const enviar = (p, tipo, id, texto, chaveOp = k()) => rpc(p, 'enviar_mensagem', `${q(tipo)}, ${q(id)}, ${q(texto)}, ${q(chaveOp)}`);
/** Atendimento completo até a OS encerrada (recebimento confirmado pelo cliente). */
function osEncerrada(cliente, garantiaDias = null) {
  const sol = solicitar(cliente, S.pub);
  aceitar(cliente, sol.id);
  const os = osDe(sol.id);
  estadoOs(os, 'iniciar');
  estadoOs(os, 'concluir');
  if (garantiaDias !== null) ok(P.O, 'registrar_garantia_os', `${q(os)}, ${garantiaDias}, 'Garantia do serviço.', ${q(k())}`);
  ok(cliente, 'confirmar_recebimento_servico', `${q(os)}, ${q(k())}`);
  return { sol: sol.id, os };
}
const ck = (p, nome, args) => ok(p, nome, args);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    if (p.tipo) assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'teste M12')`);
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK2.id)}, 'teste M12')`);
  adm("UPDATE app_private.limites_plataforma SET valor = maximo WHERE chave IN ('solicitacoes_abertas_por_empresa', 'solicitacoes_novas_por_dia')");
  E.real = empresa(P.O, 'Costura da Olga');
  aprovar(E.real, P.O);
  S.pub = servicoAuto(P.O, E.real, 'Barra de calça');
  PR.pub = produto(P.O, E.real, 'Linha de costura');
  const perfil = (nome, perms) => ok(P.O, 'criar_perfil_permissao', `${q(E.real)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())}`).id;
  const perfis = {
    TEC: perfil('Técnico', ['servicos.visualizar', 'servicos.alterar']),
    ORC: perfil('Orçamentista', ['orcamentos.visualizar']),
    FIN: perfil('Financeiro', ['financeiro.visualizar']),
    VIT: perfil('Vitrine', ['vitrine.visualizar', 'vitrine.alterar']),
  };
  for (const [nome, perfilId] of Object.entries(perfis)) {
    const c = ok(P.O, 'convidar_funcionario', `${q(E.real)}, ${q(P[nome].email)}, ${q(perfilId)}, ${q(k())}`);
    assert.ok(comoPapel(banco.url, { sub: P[nome].id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`).ok);
  }
});
after(() => banco?.encerrar());

test('conversa da solicitação até a OS: uma só conversa, M08 e atualizações da OS na origem, sem cópia e sem notas internas', opcoes, () => {
  const sol = solicitar(P.C1, S.pub);
  // Mensagem antiga do M08, gravada na linha do tempo antes do M12 (simulada direto no registro de origem).
  adm(`INSERT INTO public.solicitacao_eventos (empresa_id, solicitacao_id, tipo, autor_tipo, autor_auth_id, texto, visivel_cliente)
       VALUES (${q(E.real)}, ${q(sol.id)}, 'mensagem', 'cliente', ${q(P.C1.id)}, 'Mensagem antiga do M08.', true)`);
  const eventosAntes = contar('solicitacao_eventos', `solicitacao_id = ${q(sol.id)}`);
  assert.ok(JSON.parse(enviar(P.C1, 'solicitacao', sol.id, 'Pode ser na sexta?').saida).proprio);
  // A função do M08 continua e grava no registro novo; a nota interna continua evento interno.
  ok(P.O, 'registrar_mensagem', `${q(sol.id)}, 'Sexta às 14h, combinado.', false, ${q(k())}`);
  ok(P.O, 'registrar_mensagem', `${q(sol.id)}, 'NOTA INTERNA: cliente exigente.', true, ${q(k())}`);
  assert.equal(contar('mensagens_atendimento', `solicitacao_id = ${q(sol.id)}`), 2);
  assert.equal(contar('solicitacao_eventos', `solicitacao_id = ${q(sol.id)}`), eventosAntes + 1, 'só a nota interna virou evento');
  aceitar(P.C1, sol.id);
  const os = osDe(sol.id);
  estadoOs(os, 'iniciar');
  ok(P.O, 'publicar_atualizacao_os', `${q(os)}, 'Barra medida e alfinetada.', true, ${q(k())}`);
  ok(P.O, 'publicar_atualizacao_os', `${q(os)}, 'NOTA INTERNA DA OS: faltou linha.', false, ${q(k())}`);
  assert.ok(enviar(P.C1, 'os', os, 'Obrigada pelo aviso!').ok);
  const pelaOs = ler(P.C1, 'os', os);
  const pelaSol = ler(P.C1, 'solicitacao', sol.id);
  assert.deepEqual(pelaOs.itens.map((i) => i.id), pelaSol.itens.map((i) => i.id), 'mesma conversa');
  assert.deepEqual(pelaOs.itens.map((i) => i.texto), ['Mensagem antiga do M08.', 'Pode ser na sexta?', 'Sexta às 14h, combinado.',
    'Barra medida e alfinetada.', 'Obrigada pelo aviso!']);
  assert.deepEqual(pelaOs.itens.map((i) => i.alvo_tipo), ['mensagem_m08', 'mensagem', 'mensagem', 'atualizacao_os', 'mensagem']);
  assert.equal(JSON.stringify(pelaOs).includes('NOTA INTERNA'), false);
  assert.equal(JSON.stringify(ler(P.O, 'os', os)).includes('NOTA INTERNA'), false, 'nem a equipe vê nota interna na conversa');
  assert.equal(pelaOs.rotulo.startsWith('OS nº'), true);
  assert.equal(pelaOs.pode_enviar, true);
  assert.equal(pelaOs.atualizar_a_cada_s, 20);
  assert.equal(contar('mensagens_atendimento', `solicitacao_id = ${q(sol.id)}`), 3, 'nada copiado: só as três mensagens novas');
  S.conversa = { sol: sol.id, os };
});

test('acesso (D12-03): permissão antes e depois da OS; titular mantém o histórico; ninguém mais', opcoes, () => {
  const { sol, os } = S.conversa;
  // Orçamentista (orcamentos.visualizar): lê toda a conversa, como no M08; não vê atualizações da OS; não envia.
  const orc = ler(P.ORC, 'solicitacao', sol);
  assert.equal(orc.itens.length, 4);
  assert.equal(orc.itens.some((i) => i.alvo_tipo === 'atualizacao_os'), false);
  assert.equal(orc.pode_enviar, false);
  falha(enviar(P.ORC, 'solicitacao', sol, 'Tentativa.'), 'não enviar');
  // Técnico (só servicos.*): lê a partir do aceite e as atualizações da OS, sem ganhar as mensagens anteriores; envia.
  const tec = ler(P.TEC, 'os', os);
  assert.deepEqual(tec.itens.map((i) => i.texto), ['Barra medida e alfinetada.', 'Obrigada pelo aviso!']);
  assert.ok(enviar(P.TEC, 'os', os, 'Volto amanhã para a prova.').ok);
  // Antes da OS o técnico não é autorizado para a solicitação.
  const outra = solicitar(P.C1, S.pub);
  falha(conversa(P.TEC, 'solicitacao', outra.id), 'não permite ver a conversa');
  falha(conversa(P.FIN, 'os', os), 'não permite ver a conversa');
  falha(conversa(P.C2, 'os', os), 'Atendimento não encontrado');
  falha(conversa(P.CK, 'os', os), 'Atendimento não encontrado');
  falha(anon('conversa_atendimento', `'os', ${q(os)}`), 'permission denied');
  // O titular continua com todo o histórico depois da OS.
  assert.equal(ler(P.C1, 'os', os).itens.length, 6);
  // Ex-funcionário perde o acesso na chamada seguinte.
  const membro = adm(`SELECT id FROM public.membros_empresa WHERE empresa_id = ${q(E.real)} AND auth_user_id = ${q(P.TEC.id)}`);
  assert.ok(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.desligar_membro(${q(membro)}, 'Fim do contrato de teste.', ${q(k())})`).ok);
  falha(conversa(P.TEC, 'os', os), 'Atendimento não encontrado');
});

test('conversa do pedido de produto: própria, só titular e equipe com pedidos.*', opcoes, () => {
  const ped = ok(P.C1, 'criar_pedido', `${q(E.real)}, ${j([{ variacao_id: variacao(PR.pub), quantidade: 1 }])}, NULL, ${q(k())}`);
  assert.ok(enviar(P.C1, 'pedido', ped.id, 'Tem na cor azul?').ok);
  assert.ok(enviar(P.O, 'pedido', ped.id, 'Temos, sim.').ok);
  const c = ler(P.C1, 'pedido', ped.id);
  assert.equal(c.tipo, 'pedido');
  assert.deepEqual(c.itens.map((i) => i.autor), ['cliente', 'empresa']);
  falha(conversa(P.ORC, 'pedido', ped.id), 'não permite ver a conversa');
  falha(conversa(P.C2, 'pedido', ped.id), 'Atendimento não encontrado');
  ok(P.O, 'aceitar_pedido', `${q(ped.id)}, ${versao('pedidos', ped.id)}, ${q(k())}`);
  ok(P.O, 'concluir_pedido', `${q(ped.id)}, ${j({})}, ${versao('pedidos', ped.id)}, ${q(k())}`);
  assert.ok(enviar(P.C1, 'pedido', ped.id, 'Chegou certinho.').ok, 'envio dentro de 30 dias depois de concluído');
  adm(`UPDATE public.pedidos SET concluido_em = now() - interval '31 days' WHERE id = ${q(ped.id)}`);
  falha(enviar(P.C1, 'pedido', ped.id, 'Depois do prazo.'), 'prazo para enviar mensagens');
  assert.equal(ler(P.C1, 'pedido', ped.id).pode_enviar, false);
});

test('prazo (D12-06): 30 dias depois do encerramento; garantia registrada amplia até a data final; cancelada só leitura', opcoes, () => {
  const sem = osEncerrada(P.C1);
  assert.ok(enviar(P.C1, 'os', sem.os, 'Dentro do prazo.').ok);
  adm(`UPDATE public.ordens_servico SET encerrada_em = now() - interval '31 days' WHERE id = ${q(sem.os)}`);
  falha(enviar(P.C1, 'os', sem.os, 'Fora do prazo.'), 'prazo para enviar mensagens');
  const com = osEncerrada(P.C1, 90);
  adm(`UPDATE public.ordens_servico SET encerrada_em = now() - interval '31 days', concluida_em = now() - interval '31 days' WHERE id = ${q(com.os)}`);
  const c = ler(P.C1, 'os', com.os);
  assert.equal(c.pode_enviar, true, 'garantia de 90 dias registrada ainda vale');
  assert.ok(new Date(c.envio_ate) > new Date(Date.now() + 50 * 86400000));
  assert.ok(enviar(P.C1, 'os', com.os, 'Acionando a garantia.').ok);
  const cancelada = solicitar(P.C1, S.pub);
  ok(P.C1, 'cancelar_solicitacao', `${q(cancelada.id)}, 'Desisti do serviço.', ${q(k())}`);
  falha(enviar(P.C1, 'solicitacao', cancelada.id, 'Oi?'), 'só para leitura');
  falha(rpc(P.C1, 'registrar_mensagem', `${q(cancelada.id)}, 'Oi?', false, ${q(k())}`), 'encerrada');
});

test('suspensão (D12-05): conversa continua nos atendimentos existentes, com o aviso, sem atendimento novo', opcoes, () => {
  const { os } = S.conversa;
  ck(P.CK, 'ck_suspender_vitrine', `${q(E.real)}, 'Motivo interno que o cliente não vê.', 'comum', NULL, ${q(k())}`);
  const c = ler(P.C1, 'os', os);
  assert.equal(c.suspensao, 'comum');
  assert.equal(JSON.stringify(c).includes('Motivo interno'), false);
  assert.ok(enviar(P.C1, 'os', os, 'Mesmo suspensa, posso falar?').ok);
  assert.ok(enviar(P.O, 'os', os, 'Pode, sim.').ok);
  falha(rpc(P.C2, 'criar_solicitacao', `${q(S.pub)}, ${j({ respostas: { [PERG[S.pub]]: 5 }, relato: 'Quero um atendimento novo.' })}, ${q(k())}`), 'não está disponível');
  ck(P.CK, 'ck_reativar_vitrine', `${q(E.real)}, 'Reativação após análise.', ${q(k())}`);
});

test('limites (D12-07) no servidor e idempotência', opcoes, () => {
  const { os } = S.conversa;
  assert.equal(adm("SELECT valor || '/' || minimo || '/' || maximo FROM app_private.limites_plataforma WHERE chave = 'mensagens_por_conversa_dia'"), '50/1/500');
  assert.equal(adm("SELECT valor FROM app_private.limites_plataforma WHERE chave = 'denuncias_por_dia'"), '10');
  const hoje = contar('mensagens_atendimento', `autor_auth_id = ${q(P.C1.id)} AND solicitacao_id = ${q(S.conversa.sol)}`);
  adm(`UPDATE app_private.limites_plataforma SET valor = ${hoje + 1} WHERE chave = 'mensagens_por_conversa_dia'`);
  const chaveOp = k();
  const a = JSON.parse(enviar(P.C1, 'os', os, 'Última de hoje.', chaveOp).saida);
  const b = JSON.parse(enviar(P.C1, 'os', os, 'Última de hoje.', chaveOp).saida);
  assert.equal(a.id, b.id, 'mesma chave: mesma mensagem');
  falha(enviar(P.C1, 'os', os, 'Passou do limite.'), 'Limite de .* mensagens por dia');
  adm("UPDATE app_private.limites_plataforma SET valor = 50 WHERE chave = 'mensagens_por_conversa_dia'");
  falha(enviar(P.C1, 'os', os, ''), 'Escreva a mensagem');
  falha(enviar(P.C1, 'os', os, 'x'.repeat(1001)), 'Escreva a mensagem');
  // CK ajusta pelo painel existente, com motivo e histórico.
  ck(P.CK, 'ck_definir_limite', `'mensagens_por_conversa_dia', 60, 'Ajuste de teste do M12 com motivo.', ${q(k())}`);
  assert.equal(adm("SELECT valor FROM app_private.limites_plataforma WHERE chave = 'mensagens_por_conversa_dia'"), '60');
  assert.ok(ok(P.CK, 'ck_historico_limites').some((h) => JSON.stringify(h).includes('mensagens_por_conversa_dia')));
  ck(P.CK, 'ck_definir_limite', `'mensagens_por_conversa_dia', 50, 'Volta ao valor aprovado no M12.', ${q(k())}`);
});

test('avaliação do envio à publicação: só OS encerrada do titular, uma por OS, pré-moderada, resposta única e vitrine', opcoes, () => {
  const { os: aberta } = S.conversa;
  falha(rpc(P.C1, 'avaliar_os', `${q(aberta)}, 5, 'Ótimo.', ${q(k())}`), 'atendimento encerrado');
  const at = osEncerrada(P.C1);
  falha(rpc(P.C2, 'avaliar_os', `${q(at.os)}, 5, NULL, ${q(k())}`), 'Atendimento não encontrado');
  falha(rpc(P.C1, 'avaliar_os', `${q(at.os)}, 6, NULL, ${q(k())}`), 'nota de 1 a 5');
  assert.equal(ok(P.C1, 'minha_avaliacao_os', q(at.os)).elegivel, true);
  const av = ok(P.C1, 'avaliar_os', `${q(at.os)}, 5, 'Serviço caprichado, ligue 11 99999-0000.', ${q(k())}`);
  assert.equal(av.estado, 'aguardando');
  falha(rpc(P.C1, 'avaliar_os', `${q(at.os)}, 4, NULL, ${q(k())}`), 'já foi avaliado');
  // Antes da aprovação: fora da vitrine e fora da lista da empresa.
  assert.equal(JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes.quantidade, 0);
  assert.equal(ok(P.VIT, 'avaliacoes_da_empresa', q(E.real)).itens.length, 0);
  const fila = ok(P.CK, 'ck_fila_moderacao');
  const item = fila.avaliacoes.find((x) => x.id === av.id);
  assert.equal(item.conteudo.sinaliza_contato, true, 'comentário com contato sinalizado');
  assert.equal(JSON.stringify(item).includes(P.C1.email), false, 'a CK não recebe o e-mail do cliente');
  ck(P.CK, 'ck_moderar_publicacao', `'avaliacao', ${q(av.id)}, 'aprovar', NULL, NULL, ${q(k())}`);
  let vit = JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes;
  assert.equal(vit.quantidade, 1);
  assert.equal(vit.media, null, 'média só a partir de 3');
  assert.equal(vit.itens[0].autor, 'Cliente verificado');
  assert.match(vit.itens[0].data, /^\d{2}\/\d{4}$/);
  assert.equal(JSON.stringify(vit).includes('Cliente Cida'), false);
  // Resposta: sem vitrine.alterar negado; uma só; moderada antes de publicar.
  falha(rpc(P.ORC, 'responder_avaliacao', `${q(av.id)}, 'Obrigada!', ${q(k())}`), 'não permite esta ação');
  falha(rpc(P.C2, 'responder_avaliacao', `${q(av.id)}, 'Intruso.', ${q(k())}`), 'Avaliação não encontrada');
  const resp = ok(P.VIT, 'responder_avaliacao', `${q(av.id)}, 'Obrigada pela confiança!', ${q(k())}`);
  falha(rpc(P.O, 'responder_avaliacao', `${q(av.id)}, 'Segunda resposta.', ${q(k())}`), 'já tem resposta');
  assert.equal(JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes.itens[0].resposta, null, 'resposta só depois da moderação');
  ck(P.CK, 'ck_moderar_publicacao', `'resposta', ${q(resp.id)}, 'aprovar', NULL, NULL, ${q(k())}`);
  assert.equal(JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes.itens[0].resposta.texto, 'Obrigada pela confiança!');
  // Mais duas publicadas: a média aparece e considera só as públicas.
  for (const nota of [3, 4]) {
    const o = osEncerrada(P.C2);
    const a = ok(P.C2, 'avaliar_os', `${q(o.os)}, ${nota}, NULL, ${q(k())}`);
    ck(P.CK, 'ck_moderar_publicacao', `'avaliacao', ${q(a.id)}, 'aprovar', NULL, NULL, ${q(k())}`);
  }
  vit = JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes;
  assert.equal(vit.quantidade, 3);
  assert.equal(Number(vit.media), 4);
  // Retirada pelo cliente: sai da vitrine com a resposta; a média volta a sumir (menos de 3); não pode avaliar de novo.
  ok(P.C1, 'retirar_avaliacao', `${q(av.id)}, ${q(k())}`);
  vit = JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes;
  assert.equal(vit.quantidade, 2);
  assert.equal(vit.media, null);
  assert.equal(JSON.stringify(vit).includes('Obrigada pela confiança'), false, 'a resposta não fica pública sozinha');
  falha(rpc(P.C1, 'avaliar_os', `${q(at.os)}, 5, NULL, ${q(k())}`), 'já foi avaliado');
  // Prazo de 60 dias.
  const velha = osEncerrada(P.C1);
  adm(`UPDATE public.ordens_servico SET encerrada_em = now() - interval '61 days' WHERE id = ${q(velha.os)}`);
  falha(rpc(P.C1, 'avaliar_os', `${q(velha.os)}, 5, NULL, ${q(k())}`), '60 dias');
  // OS cancelada e pedido de produto não são avaliados.
  const canc = solicitar(P.C1, S.pub);
  aceitar(P.C1, canc.id);
  assert.equal(ok(P.C1, 'minha_avaliacao_os', q(osDe(canc.id))).elegivel, false);
});

test('recusa com motivo resumido e contestação decidida por outra pessoa da CK', opcoes, () => {
  const at = osEncerrada(P.C2);
  const av = ok(P.C2, 'avaliar_os', `${q(at.os)}, 1, 'Comentário que a CK vai recusar.', ${q(k())}`);
  falha(rpc(P.CK, 'ck_moderar_publicacao', `'avaliacao', ${q(av.id)}, 'recusar', 'curto', NULL, ${q(k())}`), 'motivo resumido');
  ck(P.CK, 'ck_moderar_publicacao', `'avaliacao', ${q(av.id)}, 'recusar', 'Comentário com linguagem imprópria.', 'Análise interna da CK sobre o comentário recusado.', ${q(k())}`);
  const minha = ok(P.C2, 'minha_avaliacao_os', q(at.os)).avaliacao;
  assert.equal(minha.estado, 'recusada');
  assert.equal(minha.moderacao.motivo, 'Comentário com linguagem imprópria.');
  assert.equal(JSON.stringify(minha).includes('Análise interna'), false, 'justificativa interna não vai para a parte');
  falha(rpc(P.C1, 'contestar_moderacao', `${q(minha.moderacao.decisao_id)}, 'Não sou o autor, mas contesto.', ${q(k())}`), 'Decisão não encontrada');
  const ct = ok(P.C2, 'contestar_moderacao', `${q(minha.moderacao.decisao_id)}, 'Não usei linguagem imprópria, revejam.', ${q(k())}`);
  falha(rpc(P.C2, 'contestar_moderacao', `${q(minha.moderacao.decisao_id)}, 'Segunda contestação da mesma decisão.', ${q(k())}`), 'uma contestação por decisão');
  falha(rpc(P.CK, 'ck_assumir_contestacao_moderacao', `${q(ct.id)}, ${q(k())}`), 'Outra pessoa da CK precisa decidir');
  ck(P.CK2, 'ck_assumir_contestacao_moderacao', `${q(ct.id)}, ${q(k())}`);
  const dec = ck(P.CK2, 'ck_decidir_contestacao_moderacao', `${q(ct.id)}, 'restaurar', 'Revisto: o comentário pode ser publicado.', 'Segunda análise por outra pessoa da CK.', ${q(k())}`);
  assert.equal(dec.mesmo_decisor, false);
  assert.equal(ok(P.C2, 'minha_avaliacao_os', q(at.os)).avaliacao.estado, 'publicada');
});

test('denúncia de mensagem até a decisão e a contestação: CK vê só o denunciado; ocultação (D12-18 = C)', opcoes, () => {
  const { os, sol } = S.conversa;
  const msg = JSON.parse(enviar(P.O, 'os', os, 'Mensagem ofensiva da empresa.').saida);
  falha(rpc(P.C2, 'denunciar', `'mensagem', ${q(msg.id)}, 'ofensivo', NULL, ${q(k())}`), 'Não encontramos');
  falha(rpc(P.O, 'denunciar', `'mensagem', ${q(msg.id)}, 'ofensivo', NULL, ${q(k())}`), 'próprio conteúdo');
  falha(rpc(P.C1, 'denunciar', `'mensagem', ${q(msg.id)}, 'outro', 'curto', ${q(k())}`), 'pelo menos 10');
  const den = ok(P.C1, 'denunciar', `'mensagem', ${q(msg.id)}, 'ofensivo', 'A empresa me ofendeu na conversa.', ${q(k())}`);
  assert.ok(den.protocolo > 0);
  falha(rpc(P.C1, 'denunciar', `'mensagem', ${q(msg.id)}, 'ofensivo', NULL, ${q(k())}`), 'já denunciou');
  // CK vê só a mensagem denunciada, o papel do autor, a data e o atendimento; nada do resto da conversa nem o denunciante.
  const fila = ok(P.CK, 'ck_fila_moderacao');
  const d = fila.denuncias.find((x) => x.protocolo === den.protocolo);
  assert.equal(d.conteudo.texto, 'Mensagem ofensiva da empresa.');
  assert.equal(d.conteudo.autor, 'empresa');
  assert.match(d.conteudo.atendimento, /^OS nº/);
  const txt = JSON.stringify(fila);
  for (const outro of ['Pode ser na sexta?', 'Barra medida', 'Obrigada pelo aviso', P.C1.id, P.C1.email, 'Cliente Cida']) {
    assert.equal(txt.includes(outro), false, `a CK não deve ver: ${outro}`);
  }
  // A CK continua sem acesso à conversa.
  falha(conversa(P.CK, 'solicitacao', sol), 'Atendimento não encontrado');
  // Conflito de interesse: CK que é membro da empresa não assume.
  adm(`SELECT app_private.conceder_ck_admin(${q(P.VIT.id)}, 'teste M12: CK membro da empresa')`);
  falha(rpc(P.VIT, 'ck_assumir_denuncia', `${q(d.id)}, ${q(k())}`), 'conflito de interesse');
  adm(`SELECT app_private.revogar_ck_admin(${q(P.VIT.id)}, 'teste M12')`);
  falha(rpc(P.CK, 'ck_decidir_denuncia', `${q(d.id)}, 'ocultar', 'Mensagem ofensiva ocultada.', 'Linguagem ofensiva contra o cliente.', ${q(k())}`), 'Assuma');
  ck(P.CK, 'ck_assumir_denuncia', `${q(d.id)}, ${q(k())}`);
  ck(P.CK, 'ck_decidir_denuncia', `${q(d.id)}, 'ocultar', 'Mensagem ofensiva ocultada.', 'Linguagem ofensiva contra o cliente na conversa.', ${q(k())}`);
  // Os demais veem só a indicação; o autor vê o próprio texto com a marca e o motivo resumido.
  const doCliente = ler(P.C1, 'os', os).itens.find((i) => i.id === msg.id);
  assert.equal(doCliente.oculta, true);
  assert.equal(doCliente.texto, null);
  const doAutor = ler(P.O, 'os', os).itens.find((i) => i.id === msg.id);
  assert.equal(doAutor.texto, 'Mensagem ofensiva da empresa.');
  assert.equal(doAutor.moderacao.motivo, 'Mensagem ofensiva ocultada.');
  assert.equal(JSON.stringify(doAutor).includes(P.C1.id), false, 'o denunciante não é revelado');
  assert.equal(adm(`SELECT texto FROM public.mensagens_atendimento WHERE id = ${q(msg.id)}`), 'Mensagem ofensiva da empresa.', 'original preservado');
  // A ocultação não amplia acesso: quem não via a conversa continua sem ver.
  falha(conversa(P.C2, 'os', os), 'Atendimento não encontrado');
  // Denunciante acompanha com resultado genérico.
  const minhas = ok(P.C1, 'minhas_denuncias');
  assert.equal(minhas[0].estado, 'resolvida');
  assert.match(minhas[0].resultado, /medidas cabíveis/);
  // Contestação pelo autor; a decisora original não decide quando há outra pessoa elegível.
  const ct = ok(P.O, 'contestar_moderacao', `${q(doAutor.moderacao.decisao_id)}, 'Foi um mal-entendido, peço revisão.', ${q(k())}`);
  falha(rpc(P.CK, 'ck_assumir_contestacao_moderacao', `${q(ct.id)}, ${q(k())}`), 'Outra pessoa da CK');
  ck(P.CK2, 'ck_assumir_contestacao_moderacao', `${q(ct.id)}, ${q(k())}`);
  const dec = ck(P.CK2, 'ck_decidir_contestacao_moderacao', `${q(ct.id)}, 'manter', 'A ocultação foi mantida.', 'A mensagem continua ofensiva na segunda análise.', ${q(k())}`);
  assert.equal(dec.medida, 'manter');
  assert.equal(ler(P.C1, 'os', os).itens.find((i) => i.id === msg.id).oculta, true);
  assert.equal(ler(P.O, 'os', os).itens.find((i) => i.id === msg.id).moderacao.contestacao.resultado, 'manter');
  // Registro imutável.
  falha(sql(banco.url, `UPDATE public.decisoes_moderacao SET motivo_resumo = 'alterado agora' WHERE id = ${q(dec.decisao_id)}`), 'histórico|não pode');
  falha(sql(banco.url, `DELETE FROM public.mensagens_atendimento WHERE id = ${q(msg.id)}`), 'histórico|não pode');
});

test('administrador único: a mesma pessoa decide a contestação com justificativa e registro explícito', opcoes, () => {
  const { os } = S.conversa;
  const msg = JSON.parse(enviar(P.O, 'os', os, 'Outra mensagem a denunciar.').saida);
  const den = ok(P.C1, 'denunciar', `'mensagem', ${q(msg.id)}, 'spam', NULL, ${q(k())}`);
  const d = ok(P.CK, 'ck_fila_moderacao').denuncias.find((x) => x.protocolo === den.protocolo);
  ck(P.CK, 'ck_assumir_denuncia', `${q(d.id)}, ${q(k())}`);
  ck(P.CK, 'ck_decidir_denuncia', `${q(d.id)}, 'ocultar', 'Mensagem considerada spam.', 'Conteúdo repetitivo e sem relação com o atendimento.', ${q(k())}`);
  const decisao = ler(P.O, 'os', os).itens.find((i) => i.id === msg.id).moderacao.decisao_id;
  const ct = ok(P.O, 'contestar_moderacao', `${q(decisao)}, 'Não era spam, era o orçamento.', ${q(k())}`);
  adm(`SELECT app_private.revogar_ck_admin(${q(P.CK2.id)}, 'teste M12: administrador único')`);
  ck(P.CK, 'ck_assumir_contestacao_moderacao', `${q(ct.id)}, ${q(k())}`);
  const dec = ck(P.CK, 'ck_decidir_contestacao_moderacao', `${q(ct.id)}, 'restaurar', 'Mensagem restaurada.', 'Única pessoa da CK: decide com justificativa registrada.', ${q(k())}`);
  assert.equal(dec.mesmo_decisor, true);
  assert.equal(adm(`SELECT mesmo_decisor FROM public.decisoes_moderacao WHERE id = ${q(dec.decisao_id)}`), 't');
  assert.equal(ler(P.C1, 'os', os).itens.find((i) => i.id === msg.id).oculta, false);
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK2.id)}, 'teste M12')`);
});

test('denúncia de avaliação e de empresa: ocultar atualiza a vitrine; encaminhar à suspensão; limite diário', opcoes, () => {
  const publica = JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes;
  const alvo = publica.itens.find((i) => !i.oculta);
  falha(anon('denunciar', `'avaliacao', ${q(alvo.id)}, 'falso', NULL, 'x'`), 'permission denied');
  const den = ok(P.O, 'denunciar', `'avaliacao', ${q(alvo.id)}, 'falso', 'Esta avaliação não corresponde ao serviço.', ${q(k())}`);
  const d = ok(P.CK2, 'ck_fila_moderacao').denuncias.find((x) => x.protocolo === den.protocolo);
  assert.equal(d.conteudo.nota, alvo.nota);
  ck(P.CK2, 'ck_assumir_denuncia', `${q(d.id)}, ${q(k())}`);
  ck(P.CK2, 'ck_decidir_denuncia', `${q(d.id)}, 'ocultar', 'Avaliação ocultada pela moderação.', 'Indícios de que a avaliação não trata deste serviço.', ${q(k())}`);
  const depois = JSON.parse(anon('vitrine_publica', q(E.real)).saida).avaliacoes;
  assert.equal(depois.quantidade, publica.quantidade - 1, 'oculta sai da contagem e da média');
  const marca = depois.itens.find((i) => i.id === alvo.id);
  assert.equal(marca.oculta, true);
  assert.equal(marca.nota, undefined);
  assert.equal(marca.resposta, undefined);
  // Empresa: arquivar ou encaminhar à suspensão (a suspensão continua pelo fluxo existente).
  const denE = ok(P.C2, 'denunciar', `'empresa', ${q(E.real)}, 'golpe', 'Cobrou por fora do combinado.', ${q(k())}`);
  const de = ok(P.CK2, 'ck_fila_moderacao').denuncias.find((x) => x.protocolo === denE.protocolo);
  ck(P.CK2, 'ck_assumir_denuncia', `${q(de.id)}, ${q(k())}`);
  falha(rpc(P.CK2, 'ck_decidir_denuncia', `${q(de.id)}, 'ocultar', 'Não se oculta empresa.', 'Medida inválida para empresa.', ${q(k())}`), 'Medida inválida');
  const r = ck(P.CK2, 'ck_decidir_denuncia', `${q(de.id)}, 'encaminhar_suspensao', 'Encaminhada para análise de suspensão.', 'Relato grave que pede a suspensão da vitrine.', ${q(k())}`);
  assert.equal(r.medida, 'encaminhar_suspensao');
  assert.equal(adm(`SELECT situacao_vitrine FROM public.empresas WHERE id = ${q(E.real)}`), 'publicada', 'encaminhar não suspende sozinho');
  // Limite diário de denúncias.
  adm("UPDATE app_private.limites_plataforma SET valor = 1 WHERE chave = 'denuncias_por_dia'");
  falha(rpc(P.C2, 'denunciar', `'empresa', ${q(E.real)}, 'spam', NULL, ${q(k())}`), 'Limite de 1 denúncias');
  adm("UPDATE app_private.limites_plataforma SET valor = 10 WHERE chave = 'denuncias_por_dia'");
  // Quem não é CK não chega à fila.
  falha(rpc(P.O, 'ck_fila_moderacao'), 'Somente a equipe da CK');
});

test('dados fictícios nunca na rota pública; privilégios: tabelas fechadas, 3 funções anônimas, 55 permissões', opcoes, () => {
  // Avaliação de conta fictícia numa empresa real (só por SQL, neste banco descartável) não aparece na rota pública.
  const at = osEncerrada(P.C1);
  const av = ok(P.C1, 'avaliar_os', `${q(at.os)}, 2, 'Avaliação fictícia.', ${q(k())}`);
  adm(`UPDATE public.avaliacoes SET dado_de_teste = true WHERE id = ${q(av.id)}`);
  ck(P.CK, 'ck_moderar_publicacao', `'avaliacao', ${q(av.id)}, 'aprovar', NULL, NULL, ${q(k())}`);
  assert.equal(JSON.stringify(JSON.parse(anon('vitrine_publica', q(E.real)).saida)).includes('Avaliação fictícia.'), false);
  for (const t of ['mensagens_atendimento', 'avaliacoes', 'respostas_avaliacao', 'denuncias', 'decisoes_moderacao', 'conteudos_moderados', 'contestacoes_moderacao']) {
    falha(comoPapel(banco.url, { sub: P.C1.id }, `SELECT count(*) FROM public.${t}`), 'permission denied');
    falha(comoPapel(banco.url, { papel: 'anonymous', sub: 'x' }, `SELECT count(*) FROM public.${t}`), 'permission denied');
    assert.equal(adm(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass`), 't');
  }
  assert.equal(adm(`SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anonymous', p.oid, 'execute')`), 'buscar_vitrine,filtros_vitrine,flags_ativas,imagens_publicas_de_produtos,logos_publicos,vitrine_publica' /* flags_ativas (202612010002): só liga/desliga de recursos da plataforma */);
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55');
});
