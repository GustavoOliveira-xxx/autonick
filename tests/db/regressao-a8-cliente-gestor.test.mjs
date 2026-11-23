/**
 * Regressão do fluxo validado na A8 da prévia protegida (19/11/2026): Cliente aceita um orçamento e o Gestor, que entrou
 * por CONVITE com o perfil "Gestor da demonstração" (catálogo inteiro menos equipe.alterar, equipe.convidar e
 * equipe.revogar), vê a OS correspondente. Mesmo cenário da prévia: empresa fictícia [TESTE] aprovada pela CK e marcada
 * como teste, serviço de análise manual ("Instalação de chuveiro") e cliente autorizado na área de demonstração.
 *
 * Dados isolados: banco PostgreSQL LOCAL descartável, com as 22 migrations, emulação do Neon e IDs próprios. Nada toca o
 * Neon; a OS 1 da prévia (referência histórica) não é usada nem alterada.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();

const ID = (n) => `eaa80000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  DONO: { id: ID(1), email: 'dono-a8@autonick-teste.example', nome: 'Dono da Elétrica (fictício)', tipo: 'business' },
  GESTOR: { id: ID(2), email: 'gestor-a8@autonick-teste.example', nome: 'Gestor Demo A8', tipo: 'business' },
  CLIENTE: { id: ID(3), email: 'cliente-a8@autonick-teste.example', nome: 'Cliente Demo A8', tipo: 'cliente' },
  OUTRO_CLIENTE: { id: ID(4), email: 'outro-cliente-a8@autonick-teste.example', nome: 'Outro Cliente A8', tipo: 'cliente' },
  DONO_B: { id: ID(5), email: 'dono-b-a8@autonick-teste.example', nome: 'Dona de outra empresa', tipo: 'business' },
  CK: { id: ID(6), email: 'ck-a8@autonick-teste.example', nome: 'CK fictícia A8', tipo: 'business' },
};
const SEM_GESTAO_DE_EQUIPE = ['equipe.alterar', 'equipe.convidar', 'equipe.revogar'];

let chave = 0;
const k = () => `a8-regressao-${String(++chave).padStart(4, '0')}`;
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
const ids = (lista) => (lista ?? []).map((o) => o.id ?? o.os_id);

const E = {};
const M = {};

function empresa(dono, nome) {
  return ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'servicos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'construcao-reformas'"),
    cidade: 'Campinas', bairro: 'Taquaral', uf: 'SP', email_contato: 'privado-a8@autonick-teste.example' })}, ${q(k())}`).id;
}
function aprovar(id, dono) {
  ok(dono, 'enviar_vitrine_para_analise', `${q(id)}, ${versao('empresas', id)}, ${q(k())}`);
  const sol = adm(`SELECT id FROM public.solicitacoes_publicacao WHERE empresa_id = ${q(id)} AND estado = 'aberta'`);
  ok(P.CK, 'ck_decidir_solicitacao', `${q(sol)}, 'aprovar', NULL, NULL, ${q(k())}`);
}
function servicoManual(dono, emp, nome) {
  const s = ok(dono, 'criar_servico', `${q(emp)}, ${j({ nome, politica_preco: 'sob_consulta', modalidade: 'analise_manual', duracao_min: 120 })}, ${q(k())}`);
  ok(dono, 'definir_vitrine_servico', `${q(s.id)}, true, ${versao('servicos', s.id)}, ${q(k())}`);
  return s.id;
}

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  adm(`SELECT app_private.conceder_ck_admin(${q(P.CK.id)}, 'regressão A8 (banco local)')`);

  // Empresa fictícia como na prévia: aprovada pela CK e marcada como teste; outra empresa para o isolamento.
  E.eletrica = empresa(P.DONO, '[TESTE] Elétrica Luz Forte (regressão A8)');
  aprovar(E.eletrica, P.DONO);
  adm(`SELECT app_private.marcar_empresa_de_teste(${q(E.eletrica)}, 'regressão A8: empresa fictícia')`);
  E.outra = empresa(P.DONO_B, '[TESTE] Outra empresa (regressão A8)');
  aprovar(E.outra, P.DONO_B);
  adm(`SELECT app_private.marcar_empresa_de_teste(${q(E.outra)}, 'regressão A8: empresa fictícia')`);
  M.chuveiro = servicoManual(P.DONO, E.eletrica, 'Instalação de chuveiro');
  M.servicoOutra = servicoManual(P.DONO_B, E.outra, 'Serviço da outra empresa');

  // Clientes autorizados na área de demonstração (a prévia usou 7 dias).
  for (const c of [P.CLIENTE, P.OUTRO_CLIENTE]) {
    adm(`SELECT app_private.autorizar_demonstracao(${q(c.id)}, 'regressão A8: cliente da demonstração', 'regressão A8 (SQL operacional)', 7)`);
  }
});
after(() => banco?.encerrar());

test('perfil "Gestor da demonstração": 52 permissões, convite aceito e sem gestão de equipe', opcoes, () => {
  const perms = adm(`SELECT string_agg(codigo, ',' ORDER BY codigo) FROM public.permissoes_catalogo WHERE codigo NOT IN (${SEM_GESTAO_DE_EQUIPE.map(q).join(',')})`).split(',');
  assert.equal(perms.length, 52);
  const perfil = ok(P.DONO, 'criar_perfil_permissao', `${q(E.eletrica)}, 'Gestor da demonstração', 'Regressão A8', ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())}`);
  const convite = ok(P.DONO, 'convidar_funcionario', `${q(E.eletrica)}, ${q(P.GESTOR.email)}, ${q(perfil.id)}, ${q(k())}`);
  assert.equal(convite.estado, 'pendente');
  const meus = comoPapel(banco.url, { sub: P.GESTOR.id }, `SELECT coalesce(json_agg(c.convite_id), '[]')::text FROM public.meus_convites() c`);
  assert.ok(meus.ok, meus.erro);
  assert.deepEqual(JSON.parse(meus.saida), [convite.id]);
  ok(P.GESTOR, 'aceitar_convite', `${q(convite.id)}, ${q(k())}`);
  assert.equal(adm(`SELECT estado FROM public.convites_empresa WHERE id = ${q(convite.id)}`), 'aceito');
  // Sem gestão de equipe: não convida ninguém.
  falha(rpc(P.GESTOR, 'convidar_funcionario', `${q(E.eletrica)}, 'qualquer-a8@autonick-teste.example', ${q(perfil.id)}, ${q(k())}`), 'FORBIDDEN|permiss');
  M.perfil = perfil.id;
});

test('fluxo da A8: cliente pede, gestor responde, cliente aceita e a OS nasce no aceite', opcoes, () => {
  const s = ok(P.CLIENTE, 'criar_solicitacao', `${q(M.chuveiro)}, ${j({ relato: 'Trocar o chuveiro do banheiro (regressão A8).' })}, ${q(k())}`);
  let v = ok(P.GESTOR, 'salvar_rascunho_orcamento', `${q(s.id)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Instalação do chuveiro', quantidade: 1, valor_unitario_centavos: 18000 }] })}, ${versao('solicitacoes_servico', s.id)}, ${q(k())}`);
  v = ok(P.GESTOR, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  // Outro cliente não aceita o orçamento de quem pediu.
  falha(rpc(P.OUTRO_CLIENTE, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(k())}`), '.');
  const ac = ok(P.CLIENTE, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(k())}`);
  assert.equal(ac.os.estado, 'aguardando_inicio');
  assert.equal(ac.os.numero, 1);
  assert.equal(adm(`SELECT estado FROM public.solicitacoes_servico WHERE id = ${q(s.id)}`), 'aceita');
  assert.equal(adm(`SELECT count(*) FROM public.ordens_servico WHERE solicitacao_id = ${q(s.id)}`), '1');
  const eventos = adm(`SELECT string_agg(DISTINCT tipo, ',' ORDER BY tipo) FROM public.solicitacao_eventos WHERE solicitacao_id = ${q(s.id)}`).split(',');
  for (const e of ['criada', 'versao_enviada', 'aceita']) assert.ok(eventos.includes(e), `evento ${e} ausente: ${eventos}`);
  M.os = adm(`SELECT id FROM public.ordens_servico WHERE solicitacao_id = ${q(s.id)}`);
});

test('quem vê a OS: o gestor convidado e o cliente titular; ninguém de fora', opcoes, () => {
  // Gestor (membro por convite, não dono) vê a OS na lista da empresa.
  const daEmpresa = ok(P.GESTOR, 'ordens_da_empresa', `${q(E.eletrica)}, '{}'::jsonb, 50, 0`);
  const lista = Array.isArray(daEmpresa) ? daEmpresa : (daEmpresa.itens ?? daEmpresa.ordens ?? []);
  assert.ok(ids(lista).includes(M.os), 'o gestor convidado não viu a OS da empresa');
  // Cliente titular vê a OS; o outro cliente não.
  const minhas = (p) => { const r = ok(p, 'minhas_os'); return ids(Array.isArray(r) ? r : (r.itens ?? r.ordens ?? [])); };
  assert.ok(minhas(P.CLIENTE).includes(M.os), 'o cliente não viu a própria OS');
  assert.equal(minhas(P.OUTRO_CLIENTE).includes(M.os), false, 'outro cliente viu a OS de alguém');
  // Dono de outra empresa não lista as OS desta; o gestor não lista as da outra empresa.
  falha(rpc(P.DONO_B, 'ordens_da_empresa', `${q(E.eletrica)}, '{}'::jsonb, 50, 0`), 'TENANT_FORBIDDEN');
  falha(rpc(P.GESTOR, 'ordens_da_empresa', `${q(E.outra)}, '{}'::jsonb, 50, 0`), 'TENANT_FORBIDDEN');
  // Tabela direta fechada para o papel autenticado (RLS ou sem GRANT): nada vaza fora das funções.
  const direto = comoPapel(banco.url, { sub: P.OUTRO_CLIENTE.id }, `SELECT count(*) FROM public.ordens_servico WHERE id = ${q(M.os)}`);
  assert.ok(!direto.ok || direto.saida === '0', `leitura direta da OS por outro cliente: ${direto.saida}`);
});
