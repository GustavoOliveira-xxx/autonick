/**
 * Testes de banco do M08 (migration 202611120003): catálogo de serviços e políticas de preço (D8-04, D8-05), formulário
 * com proteção contra dado sensível (D8-06), motor determinístico (D8-07, D8-08), solicitação do cliente e interna com
 * limites e retrato (D8-02, D8-03, D8-19, D8-23, D8-25), orçamento automático só onde ligado (D8-09), rascunho, aprovação
 * e desconto pelo limite do perfil (D8-10, D8-11), validade e versão vigente (D8-12, D8-13), negociação e notas internas
 * (D8-14), aceite com retrato e cliente da empresa (D8-15), recusa e cancelamento sem cobrança (D8-16), horários gerais e
 * confirmação com avisos (D8-18, D8-20, D8-21), permissões (D8-22), nada de OS, título ou estoque (D8-01, D8-24),
 * concorrência real, isolamento, identidade vazia e privilégios. Inclui a correção 202611120004 (estimativa exige perfil
 * de cliente fora da equipe). PostgreSQL LOCAL com emulação do Neon.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const MIGRATIONS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) <= '202611120004').sort();

const ID = (n) => `e8000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-m08@teste.example', nome: 'Dona Olívia' },
  G: { id: ID(2), email: 'gerente-m08@teste.example', nome: 'Gerente Gabriel' },
  A: { id: ID(3), email: 'atendente-m08@teste.example', nome: 'Atendente Ana' },
  V: { id: ID(4), email: 'vendas-m08@teste.example', nome: 'Vendas Vitor' },
  X: { id: ID(5), email: 'outra-m08@autonick-teste.example', nome: 'Xuxa Outra' },
  C1: { id: ID(6), email: 'cliente1-m08@autonick-teste.example', nome: 'Cliente Carla' },
  C2: { id: ID(7), email: 'cliente2-m08@autonick-teste.example', nome: 'Cliente César' },
  R: { id: ID(8), email: 'real-m08@gmail.example', nome: 'Conta Comum' },
  CK: { id: ID(9), email: 'ck-m08@teste.example', nome: 'Admin CK' },
};
let chave = 0;
const k = () => `m08-teste-${String(++chave).padStart(4, '0')}`;
const q = (t) => (t === null || t === undefined ? 'NULL' : `'${String(t).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const rpc = (p, nome, args) => comoPapel(banco.url, { sub: p.id }, `SELECT public.${nome}(${args})::text`);
function ok(p, nome, args) {
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
const versaoServ = (id) => Number(adm(`SELECT versao FROM public.servicos WHERE id = ${q(id)}`));
// Próxima segunda-feira às HH:MM no horário de São Paulo (sempre no futuro).
const segunda = (hora, semanas = 1) => adm(`SELECT ((date_trunc('week', app_private.hoje_sp()) + interval '${7 * semanas} days')::date + time '${hora}')
  AT TIME ZONE 'America/Sao_Paulo'`);

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of MIGRATIONS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    sql(banco.url, `INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
  }
  for (const p of [P.O, P.X]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('business', ${q(p.nome)})`);
  for (const p of [P.C1, P.C2, P.R]) comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil('cliente', ${q(p.nome)})`);
  adm(`INSERT INTO app_private.administradores_ck (auth_user_id, concedido_por) VALUES (${q(P.CK.id)}, 'teste')`);
  const cat = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE slug = 'comercio-varejo'").saida;
  M.catServ = sql(banco.url, "SELECT id FROM public.categorias_plataforma WHERE tipo = 'negocio' AND ativo AND slug <> 'comercio-varejo' ORDER BY ordem LIMIT 1").saida;
  const dados = (nome) => JSON.stringify({ nome_publico: nome, modalidade: 'ambos', categoria_id: cat, cidade: 'Campinas', uf: 'SP', email_contato: 'privado@teste.example' });
  A = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_empresa('${dados('[TESTE] Oficina A')}'::jsonb, 'm08-setup-01')::text`).saida).id;
  B = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_empresa('${dados('[TESTE] Oficina B')}'::jsonb, 'm08-setup-02')::text`).saida).id;
  sql(banco.url, `UPDATE public.empresas SET situacao_vitrine = 'publicada', dado_de_teste = true WHERE id IN ('${A}', '${B}')`);
  const perfil = (nome, perms) => JSON.parse(comoPapel(banco.url, { sub: P.O.id },
    `SELECT public.criar_perfil_permissao(${q(A)}, ${q(nome)}, NULL, ARRAY[${perms.map(q).join(',')}]::text[], ${q(k())})::text`).saida);
  M.perfis = {
    gerente: perfil('Gerente', ['catalogo_servicos.visualizar', 'catalogo_servicos.alterar', 'orcamentos.visualizar', 'orcamentos.criar', 'orcamentos.aprovar',
      'orcamentos.cancelar', 'agenda.visualizar', 'agenda.alterar', 'vendas.aplicar_desconto', 'produtos.visualizar']),
    atendente: perfil('Atendente', ['catalogo_servicos.visualizar', 'orcamentos.visualizar', 'orcamentos.criar', 'agenda.visualizar', 'clientes.visualizar']),
    vendas: perfil('Vendas', ['vendas.visualizar', 'vendas.criar']),
  };
  comoPapel(banco.url, { sub: P.O.id }, `SELECT public.definir_desconto_maximo(${q(M.perfis.gerente.id)}, 10, 1, ${q(k())})`);
  for (const [p, perfilId] of [[P.G, M.perfis.gerente.id], [P.A, M.perfis.atendente.id], [P.V, M.perfis.vendas.id]]) {
    const c = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.convidar_funcionario(${q(A)}, ${q(p.email)}, ${q(perfilId)}, ${q(k())})::text`).saida);
    comoPapel(banco.url, { sub: p.id }, `SELECT public.aceitar_convite(${q(c.id)}, ${q(k())})`);
  }
  M.insumo = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_produto(${q(A)}, ${j({ nome: 'Graxa de oficina', finalidade: 'uso_interno',
    preco_centavos: 100, custo_centavos: 800, quantidade_inicial: 5 })}, NULL, ${q(k())})::text`).saida).variacoes[0].id;
  M.insumoB = JSON.parse(comoPapel(banco.url, { sub: P.X.id }, `SELECT public.criar_produto(${q(B)}, ${j({ nome: 'Peça B', finalidade: 'comercializavel',
    preco_centavos: 100, quantidade_inicial: 1 })}, NULL, ${q(k())})::text`).saida).variacoes[0].id;
  M.clienteInterno = JSON.parse(comoPapel(banco.url, { sub: P.O.id }, `SELECT public.criar_cliente(${q(A)}, ${j({ nome: 'Seu Joaquim (balcão)', telefone: '19999990000' })}, ${q(k())})::text`).saida).id;
});
after(() => banco?.encerrar());

test('catálogo com 55 permissões; nenhum perfil existente ganha as novas sozinho (D8-22)', opcoes, () => {
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55');
  assert.equal(adm("SELECT string_agg(codigo, ',' ORDER BY codigo) FROM public.permissoes_catalogo WHERE modulo IN ('catalogo_servicos', 'agenda')"),
    'agenda.alterar,agenda.visualizar,catalogo_servicos.alterar,catalogo_servicos.visualizar');
  assert.equal(adm(`SELECT count(*) FROM public.perfil_permissoes WHERE perfil_id = ${q(M.perfis.vendas.id)} AND codigo LIKE 'agenda.%'`), '0');
  assert.deepEqual(ok(P.O, 'minhas_permissoes', q(A)).permissoes.filter((c) => /^(agenda|catalogo_servicos)\./.test(c)).length, 4);
});

test('serviços (D8-04, D8-05, D8-09, D8-12): políticas de preço, categoria opcional, validade, automático só por regras', opcoes, () => {
  falha(rpc(P.A, 'criar_servico', `${q(A)}, ${j({ nome: 'Troca de óleo', politica_preco: 'fixo', preco_centavos: 9000 })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Troca de óleo', politica_preco: 'fixo' })}, ${q(k())}`), 'Informe o preço');
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Diagnóstico', politica_preco: 'sob_consulta', modalidade: 'orcamento_automatico' })}, ${q(k())}`), 'só existe para serviços com preço calculado por regras');
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'X', politica_preco: 'fixo', preco_centavos: 1 })}, ${q(k())}`), '2 a 80');
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Valid', politica_preco: 'sob_consulta', validade_dias: 91 })}, ${q(k())}`), '1 a 90');
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Preço livre', politica_preco: 'por_regras', total_centavos: 1 })}, ${q(k())}`), 'VALIDATION_ERROR');
  M.fixo = ok(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Troca de óleo', politica_preco: 'fixo', preco_centavos: 9000, duracao_min: 45 })}, ${q(k())}`);
  assert.equal(M.fixo.validade_dias, 15);
  assert.equal(M.fixo.modalidade, 'analise_manual');
  M.consulta = ok(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Diagnóstico elétrico', politica_preco: 'sob_consulta', categoria_id: M.catServ, descricao: 'Avaliação no local.' })}, ${q(k())}`);
  assert.equal(M.consulta.categoria_id, M.catServ);
  assert.equal(M.consulta.preco_centavos, null);
  M.regras = ok(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Pintura de parede', politica_preco: 'por_regras', exibicao: 'faixa', faixa_percentual: 10, validade_dias: 10 })}, ${q(k())}`);
  M.auto = ok(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'Limpeza de calha', politica_preco: 'por_regras', modalidade: 'orcamento_automatico', duracao_min: 60 })}, ${q(k())}`);
  falha(rpc(P.G, 'criar_servico', `${q(A)}, ${j({ nome: 'troca de óleo', politica_preco: 'sob_consulta' })}, ${q(k())}`), 'Já existe');
  falha(rpc(P.G, 'alterar_servico', `${q(M.fixo.id)}, ${j({ nome: 'Óleo' })}, 99, ${q(k())}`), 'VERSION_CONFLICT');
  assert.equal(ok(P.V, 'minhas_permissoes', q(A)).permissoes.includes('catalogo_servicos.visualizar'), false);
  falha(rpc(P.V, 'servicos_da_empresa', q(A)), 'FORBIDDEN_ACTION');
  falha(rpc(P.X, 'servicos_da_empresa', q(A)), 'TENANT_FORBIDDEN');
  assert.equal(ok(P.A, 'servicos_da_empresa', q(A)).length, 4);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'servicos.criado'"), '4');
});

test('formulário (D8-06): tipos fechados, 15 perguntas, opções válidas, dado sensível recusado; regras órfãs desativadas', opcoes, () => {
  const form = [
    { texto: 'Área a pintar', tipo: 'numero', obrigatoria: true, configuracao: { unidade: 'm²', minimo: 1, maximo: 500, casas: 1 } },
    { texto: 'Acabamento', tipo: 'escolha_unica', obrigatoria: true, configuracao: { opcoes: ['Fosco', 'Acetinado', 'Brilho'] } },
    { texto: 'Precisa mover móveis?', tipo: 'sim_nao' },
    { texto: 'Cômodos', tipo: 'escolha_multipla', configuracao: { opcoes: ['Sala', 'Quarto', 'Cozinha'] } },
    { texto: 'Cor desejada', tipo: 'texto_curto' },
  ];
  falha(rpc(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j([{ texto: 'Informe seu CPF', tipo: 'texto_curto' }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'dado sensível');
  falha(rpc(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j([{ texto: 'Número do cartão para sinal', tipo: 'texto_curto' }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'dado sensível');
  falha(rpc(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j([{ texto: 'Cor', tipo: 'escolha_unica', configuracao: { opcoes: ['Azul'] } }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), '2 a 10 opções');
  falha(rpc(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j([{ texto: 'Cor', tipo: 'escolha_unica', configuracao: { opcoes: ['Azul', 'azul'] } }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'diferentes');
  falha(rpc(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j([{ texto: 'Cor', tipo: 'livre' }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'Tipo inválido');
  falha(rpc(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j(Array.from({ length: 16 }, (_, i) => ({ texto: `Pergunta ${i}`, tipo: 'sim_nao' })))}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'no máximo 15');
  falha(rpc(P.A, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j(form)}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  const s = ok(P.G, 'salvar_formulario_servico', `${q(M.regras.id)}, ${j(form)}, ${versaoServ(M.regras.id)}, ${q(k())}`);
  assert.equal(s.perguntas.length, 5);
  M.p = Object.fromEntries(s.perguntas.map((x) => [x.texto, x.id]));
  const autoForm = ok(P.G, 'salvar_formulario_servico', `${q(M.auto.id)}, ${j([{ texto: 'Metros de calha', tipo: 'numero', obrigatoria: false, configuracao: { minimo: 1, maximo: 200 } }])}, ${versaoServ(M.auto.id)}, ${q(k())}`);
  M.pAuto = autoForm.perguntas[0].id;
});

test('motor de estimativa (D8-07, D8-08): tipos fechados, determinístico, faixa, mínimo, falta de dado vai para análise manual', opcoes, () => {
  const regras = [
    { tipo: 'valor_base', rotulo: 'Visita técnica', valor_centavos: 5000 },
    { tipo: 'por_quantidade', pergunta_id: M.p['Área a pintar'], rotulo: 'Pintura por m²', valor_unitario_centavos: 2500 },
    { tipo: 'por_opcao', pergunta_id: M.p.Acabamento, rotulo: 'Acabamento', valores: { Fosco: 0, Acetinado: 1500, Brilho: 3000 } },
    { tipo: 'se_sim', pergunta_id: M.p['Precisa mover móveis?'], rotulo: 'Mover móveis', valor_centavos: 4000 },
    { tipo: 'minimo', rotulo: 'Mínimo do serviço', valor_centavos: 20000 },
  ];
  falha(rpc(P.G, 'salvar_regras_servico', `${q(M.regras.id)}, ${j([{ tipo: 'formula', rotulo: 'x * 2' }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'Tipo inválido');
  falha(rpc(P.G, 'salvar_regras_servico', `${q(M.regras.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: M.p.Acabamento, rotulo: 'Errada', valor_unitario_centavos: 1 }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'compatível');
  falha(rpc(P.G, 'salvar_regras_servico', `${q(M.regras.id)}, ${j([{ tipo: 'por_opcao', pergunta_id: M.p.Acabamento, rotulo: 'Op', valores: { Metálico: 10 } }])}, ${versaoServ(M.regras.id)}, ${q(k())}`), 'opções existentes');
  falha(rpc(P.G, 'salvar_regras_servico', `${q(M.consulta.id)}, ${j(regras)}, ${versaoServ(M.consulta.id)}, ${q(k())}`), 'preço calculado por regras');
  ok(P.G, 'salvar_regras_servico', `${q(M.regras.id)}, ${j(regras)}, ${versaoServ(M.regras.id)}, ${q(k())}`);
  ok(P.G, 'salvar_regras_servico', `${q(M.auto.id)}, ${j([{ tipo: 'por_quantidade', pergunta_id: M.pAuto, rotulo: 'Calha por metro', valor_unitario_centavos: 1200 },
    { tipo: 'minimo', rotulo: 'Mínimo', valor_centavos: 8000 }])}, ${versaoServ(M.auto.id)}, ${q(k())}`);
  const resp = { [M.p['Área a pintar']]: 12.5, [M.p.Acabamento]: 'Acetinado', [M.p['Precisa mover móveis?']]: true };
  const e = ok(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j(resp)}`);
  // 50 + 12,5 × 25 + 15 + 40 = 417,50; faixa de 10%
  assert.equal(e.completa, true);
  assert.equal(e.valor_centavos, 41750);
  assert.deepEqual([e.minimo_centavos, e.maximo_centavos], [37575, 45925]);
  assert.match(e.rotulo, /não é o valor final/);
  assert.equal(e.base.length, 4);
  for (let i = 0; i < 20; i += 1) assert.equal(ok(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j(resp)}`).valor_centavos, 41750);
  // Mínimo aplicado
  const pequena = ok(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j({ [M.p['Área a pintar']]: 1, [M.p.Acabamento]: 'Fosco', [M.p['Precisa mover móveis?']]: false })}`);
  assert.equal(pequena.valor_centavos, 20000);
  assert.match(pequena.base.at(-1).rotulo, /mínimo/);
  // Falta de dado: estimativa incompleta, sem valor
  const falta = ok(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j({ [M.p['Área a pintar']]: 10, [M.p.Acabamento]: 'Fosco' })}`);
  assert.equal(falta.completa, false);
  assert.equal(falta.valor_centavos, undefined);
  assert.match(falta.rotulo, /a empresa vai analisar/);
  falha(rpc(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j({ [M.p['Área a pintar']]: 501 })}`), 'entre 1 e 500');
  falha(rpc(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j({ [M.p['Área a pintar']]: 10.25 })}`), 'casa');
  falha(rpc(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j({ [M.p.Acabamento]: 'Metálico' })}`), 'Escolha uma das opções');
  falha(rpc(P.A, 'estimar_servico', `${q(M.regras.id)}, ${j({ 'e8000000-0000-4000-8000-000000009999': 1 })}`), 'não existe neste serviço');
  assert.equal(ok(P.A, 'estimar_servico', `${q(M.fixo.id)}, '{}'::jsonb`).valor_centavos, 9000);
  assert.equal(ok(P.A, 'estimar_servico', `${q(M.consulta.id)}, '{}'::jsonb`).completa, false);
  // Cliente de empresa de teste estima; conta comum não vê a empresa de teste; outra empresa não estima.
  assert.equal(ok(P.C1, 'estimar_servico', `${q(M.regras.id)}, ${j(resp)}`).valor_centavos, 41750);
  falha(rpc(P.R, 'estimar_servico', `${q(M.regras.id)}, ${j(resp)}`), 'NOT_FOUND');
  // Correção 202611120004: a dona de outra empresa de teste (domínio fictício, sem perfil de cliente) não estima.
  falha(rpc(P.X, 'estimar_servico', `${q(M.regras.id)}, ${j(resp)}`), 'NOT_FOUND');
  assert.equal(ok(P.G, 'estimar_servico', `${q(M.regras.id)}, ${j(resp)}`).valor_centavos, 41750);   // equipe continua estimando
  const publico = ok(P.C1, 'servicos_para_cliente', q(A));
  assert.equal(publico.servicos.length, 4);
  assert.equal(JSON.stringify(publico).includes('valor_unitario_centavos'), false);
  assert.equal('regras' in publico.servicos[0], false);
});

test('solicitação do cliente (D8-02, D8-19, D8-25): retrato, estimativa do banco, preferência sem reserva, sem endereço; valores do navegador recusados', opcoes, () => {
  const resp = { [M.p['Área a pintar']]: 12.5, [M.p.Acabamento]: 'Acetinado', [M.p['Precisa mover móveis?']]: true };
  falha(rpc(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'curto' })}, ${q(k())}`), '10 a 2.000');
  falha(rpc(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: { [M.p.Acabamento]: 'Fosco' }, relato: 'Pintar a sala de casa toda.' })}, ${q(k())}`), 'Responda: "Área a pintar"');
  falha(rpc(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala de casa toda.', valor_centavos: 1 })}, ${q(k())}`), 'VALIDATION_ERROR');
  falha(rpc(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala de casa toda.', endereco: 'Rua X, 10' })}, ${q(k())}`), 'VALIDATION_ERROR');
  falha(rpc(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala de casa toda.', preferencia: { datas: ['2020-01-01'] } })}, ${q(k())}`), 'até 90 dias');
  falha(rpc(P.R, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala de casa toda.' })}, ${q(k())}`), 'NOT_FOUND');
  falha(rpc(P.G, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala de casa toda.' })}, ${q(k())}`), 'perfil de cliente');
  const hoje = adm('SELECT app_private.hoje_sp()::text');
  const ch = k();
  const s = ok(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala e o quarto, parede com mofo.', cidade: 'Campinas',
    bairro: 'Cambuí', preferencia: { datas: [hoje], turno: 'manha', observacao: 'Prefiro cedo' } })}, ${q(ch)}`);
  assert.equal(ok(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar a sala e o quarto, parede com mofo.', cidade: 'Campinas',
    bairro: 'Cambuí', preferencia: { datas: [hoje], turno: 'manha', observacao: 'Prefiro cedo' } })}, ${q(ch)}`).id, s.id);
  assert.equal(s.estado, 'nova');
  assert.equal(s.numero, 1);
  assert.equal(s.estimativa.valor_centavos, 41750);
  assert.equal(s.preferencia.reserva, false);
  assert.equal(s.respostas.length, 3);
  assert.equal(s.versoes.length, 0);
  M.s1 = s.id;
  // O retrato não muda quando o serviço muda.
  ok(P.G, 'alterar_servico', `${q(M.regras.id)}, ${j({ nome: 'Pintura residencial' })}, ${versaoServ(M.regras.id)}, ${q(k())}`);
  assert.equal(ok(P.C1, 'minha_solicitacao', q(s.id)).servico, 'Pintura de parede');
  // Isolamento: outro cliente e outra empresa não leem.
  falha(rpc(P.C2, 'minha_solicitacao', q(s.id)), 'NOT_FOUND');
  falha(rpc(P.X, 'solicitacao_detalhe', q(s.id)), 'TENANT_FORBIDDEN');
  falha(rpc(P.V, 'solicitacao_detalhe', q(s.id)), 'FORBIDDEN_ACTION');
  assert.equal(ok(P.A, 'solicitacoes_da_empresa', `${q(A)}, '{}'::jsonb, 50, 0`).total, 1);
  assert.equal(ok(P.X, 'solicitacoes_da_empresa', `${q(B)}, '{}'::jsonb, 50, 0`).total, 0);
});

test('orçamento automático (D8-09): nasce enviado só com regras completas; incompleto vai para análise manual', opcoes, () => {
  const completo = ok(P.C2, 'criar_solicitacao', `${q(M.auto.id)}, ${j({ respostas: { [M.pAuto]: 10 }, relato: 'Limpar a calha da frente da casa.' })}, ${q(k())}`);
  assert.equal(completo.estado, 'orcamento_enviado');
  assert.equal(completo.versoes.length, 1);
  assert.equal(completo.versoes[0].tipo, 'automatico');
  assert.equal(completo.versoes[0].total_centavos, 12000);
  assert.match(completo.versoes[0].condicoes, /regras cadastradas pela empresa/);
  M.sAuto = completo;
  const incompleto = ok(P.C2, 'criar_solicitacao', `${q(M.auto.id)}, ${j({ respostas: {}, relato: 'Não sei quantos metros, venham ver.' })}, ${q(k())}`);
  assert.equal(incompleto.estado, 'nova');
  assert.equal(incompleto.versoes.length, 0);
  assert.equal(incompleto.estimativa.completa, false);
  M.sAutoIncompleto = incompleto.id;
  // Serviço manual nunca gera versão sozinho, mesmo com estimativa completa.
  assert.equal(ok(P.A, 'solicitacao_detalhe', q(M.s1)).versoes.length, 0);
});

test('rascunho, aprovação e desconto (D8-10, D8-11): total do banco, material do M05 privado, limite do perfil', opcoes, () => {
  const comp = [
    { tipo: 'mao_de_obra', descricao: 'Pintura de 12,5 m²', quantidade: 12.5, valor_unitario_centavos: 2500 },
    { tipo: 'material', descricao: 'Massa e lixa', quantidade: 2, valor_unitario_centavos: 3000, variacao_id: M.insumo },
    { tipo: 'deslocamento', descricao: 'Ida e volta', quantidade: 1, valor_unitario_centavos: 2000 },
  ];
  falha(rpc(P.V, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: comp })}, ${versaoSol(M.s1)}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.A, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: [{ ...comp[0], total_centavos: 1 }] })}, ${versaoSol(M.s1)}, ${q(k())}`), 'calculado pelo sistema');
  falha(rpc(P.A, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: [{ ...comp[1], variacao_id: M.insumoB }] })}, ${versaoSol(M.s1)}, ${q(k())}`), 'NOT_FOUND');
  falha(rpc(P.A, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: [{ ...comp[2], variacao_id: M.insumo }] })}, ${versaoSol(M.s1)}, ${q(k())}`), 'Só itens de material');
  falha(rpc(P.A, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: comp })}, 999, ${q(k())}`), 'VERSION_CONFLICT');
  let v = ok(P.A, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: comp, prazo_execucao: '2 dias', condicoes: 'Tinta por conta do cliente.' })}, ${versaoSol(M.s1)}, ${q(k())}`);
  assert.equal(v.total_centavos, 31250 + 6000 + 2000);
  assert.equal(v.estado, 'rascunho');
  assert.equal(v.componentes[1].uso_interno, true);
  assert.equal(ok(P.A, 'solicitacao_detalhe', q(M.s1)).estado, 'em_analise');
  // Sem orcamentos.aprovar: vai para aprovação; o cliente não vê rascunho nem aguardando.
  v = ok(P.A, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  assert.equal(v.estado, 'aguardando_aprovacao');
  assert.equal(ok(P.C1, 'minha_solicitacao', q(M.s1)).versoes.length, 0);
  falha(rpc(P.A, 'aprovar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`), 'FORBIDDEN_ACTION');
  // Desconto de 20% passa do limite do gerente (10%): ao aprovar, recusa; o proprietário aprova.
  v = ok(P.G, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: comp, desconto_geral_centavos: 7850 })}, ${versaoSol(M.s1)}, ${q(k())}`);
  assert.equal(v.estado, 'rascunho');
  assert.equal(v.desconto_percentual, 20);
  v = ok(P.G, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  assert.equal(v.estado, 'aguardando_aprovacao');
  falha(rpc(P.G, 'aprovar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`), 'DISCOUNT_EXCEEDS_LIMIT');
  // Dentro do limite (5%), o gerente envia direto.
  v = ok(P.G, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: comp, desconto_geral_centavos: 1962 })}, ${versaoSol(M.s1)}, ${q(k())}`);
  v = ok(P.G, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  assert.equal(v.estado, 'enviada');
  assert.equal(v.numero, 1);
  assert.equal(v.total_centavos, 39250 - 1962);
  M.v1 = v;
  // Para o cliente: sem ligação com o catálogo, sem autor, sem rascunho.
  const cli = ok(P.C1, 'minha_solicitacao', q(M.s1));
  assert.equal(cli.estado, 'orcamento_enviado');
  assert.equal(cli.versoes.length, 1);
  const txt = JSON.stringify(cli);
  for (const proibido of ['variacao_id', 'uso_interno', 'criada_por', 'desconto_percentual', M.insumo, 'Graxa']) assert.equal(txt.includes(proibido), false, proibido);
  // Versão enviada é imutável (gatilho), mesmo para o dono do banco.
  falha(sql(banco.url, `UPDATE public.orcamento_versoes SET total = 1 WHERE id = ${q(v.id)}`), 'não pode ser alterada');
  falha(sql(banco.url, `DELETE FROM public.orcamento_versoes WHERE id = ${q(v.id)}`), 'não são excluídas');
  falha(sql(banco.url, `UPDATE public.orcamento_componentes SET valor_unitario = 1 WHERE versao_id = ${q(v.id)}`), 'não podem ser alterados');
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'orcamentos.enviado'"), '1');
});

test('revisão e versão vigente (D8-13, D8-14): nova versão substitui a anterior; antiga e vencida não são aceitas; notas internas privadas', opcoes, () => {
  falha(rpc(P.C1, 'registrar_mensagem', `${q(M.s1)}, 'oi', true, ${q(k())}`), 'só da empresa');
  ok(P.C1, 'registrar_mensagem', `${q(M.s1)}, 'Dá para fazer sem mover os móveis?', false, ${q(k())}`);
  ok(P.A, 'registrar_mensagem', `${q(M.s1)}, 'Cliente parece aceitar 10% a menos.', true, ${q(k())}`);
  falha(rpc(P.C2, 'registrar_mensagem', `${q(M.s1)}, 'intrometido', false, ${q(k())}`), 'NOT_FOUND');
  ok(P.C1, 'pedir_revisao', `${q(M.s1)}, 'Sem a parte de mover móveis, por favor.', ${q(k())}`);
  assert.equal(ok(P.A, 'solicitacao_detalhe', q(M.s1)).estado, 'revisao_pedida');
  const cli = ok(P.C1, 'minha_solicitacao', q(M.s1));
  assert.equal(JSON.stringify(cli).includes('10% a menos'), false);
  assert.equal(cli.eventos.some((e) => e.interno), false);
  assert.equal(ok(P.A, 'solicitacao_detalhe', q(M.s1)).eventos.some((e) => e.tipo === 'nota_interna'), true);
  let v2 = ok(P.G, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Pintura sem mover móveis', quantidade: 1, valor_unitario_centavos: 33000 }] })}, ${versaoSol(M.s1)}, ${q(k())}`);
  // Enquanto a v2 é rascunho, a v1 continua aceitável; depois de enviada, a v1 vira substituída.
  v2 = ok(P.G, 'enviar_orcamento', `${q(v2.id)}, ${v2.versao}, ${q(k())}`);
  assert.equal(v2.numero, 2);
  const det = ok(P.A, 'solicitacao_detalhe', q(M.s1));
  assert.deepEqual(det.versoes.map((x) => `${x.numero}:${x.estado}`), ['2:enviada', '1:substituida']);
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.v1.id)}, true, ${q(k())}`), 'QUOTE_VERSION_STALE');
  falha(rpc(P.C1, 'recusar_orcamento', `${q(M.s1)}, ${q(M.v1.id)}, '{}'::jsonb, ${q(k())}`), 'QUOTE_VERSION_STALE');
  M.v2 = v2;
  // Vencida: a validade passou (simulada direto no banco, como o relógio faria).
  adm(`ALTER TABLE public.orcamento_versoes DISABLE TRIGGER versoes_protegidas; UPDATE public.orcamento_versoes SET valido_ate = app_private.hoje_sp() - 1 WHERE id = ${q(M.sAuto.versoes[0].id)}; ALTER TABLE public.orcamento_versoes ENABLE TRIGGER versoes_protegidas`);
  assert.equal(ok(P.C2, 'minha_solicitacao', q(M.sAuto.id)).estado_exibicao, 'vencido');
  falha(rpc(P.C2, 'aceitar_orcamento', `${q(M.sAuto.id)}, ${q(M.sAuto.versoes[0].id)}, true, ${q(k())}`), 'QUOTE_EXPIRED');
  assert.equal(adm(`SELECT estado FROM public.solicitacoes_servico WHERE id = ${q(M.sAuto.id)}`), 'orcamento_enviado');
});

test('horários gerais e confirmação (D8-18, D8-20, D8-21): grade validada, avisos sem gravar, aceitar aviso registra; troca preserva histórico', opcoes, () => {
  falha(rpc(P.A, 'salvar_horarios_empresa', `${q(A)}, ${j([])}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'salvar_horarios_empresa', `${q(A)}, ${j([{ dia_semana: 1, intervalos: [{ abre: '12:00', fecha: '08:00' }] }])}, ${q(k())}`), 'abre antes de fechar');
  falha(rpc(P.G, 'salvar_horarios_empresa', `${q(A)}, ${j([{ dia_semana: 1, intervalos: [{ abre: '08:00', fecha: '12:00' }, { abre: '11:00', fecha: '18:00' }] }])}, ${q(k())}`), 'segundo começa depois');
  falha(rpc(P.G, 'salvar_horarios_empresa', `${q(A)}, ${j([{ dia_semana: 1, intervalos: [{ abre: '08:00', fecha: '12:00' }, { abre: '13:00', fecha: '15:00' }, { abre: '16:00', fecha: '18:00' }] }])}, ${q(k())}`), '0 a 2 intervalos');
  const semana = [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, intervalos: [{ abre: '08:00', fecha: '12:00' }, { abre: '13:00', fecha: '18:00' }] }));
  ok(P.G, 'salvar_horarios_empresa', `${q(A)}, ${j([...semana, { dia_semana: 6, intervalos: [{ abre: '08:00', fecha: '12:00' }] }])}, ${q(k())}`);
  assert.equal(ok(P.A, 'horarios_empresa', q(A)).grade[0].intervalos.length, 0);   // domingo fechado
  assert.equal(ok(P.C1, 'servicos_para_cliente', q(A)).horarios[1].intervalos.length, 2);
  falha(rpc(P.A, 'confirmar_horario', `${q(M.s1)}, ${q(segunda('09:00'))}, 120, false, NULL, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'confirmar_horario', `${q(M.s1)}, now() - interval '1 hour', 60, false, NULL, ${q(k())}`), 'a partir de agora');
  // Dentro do horário: confirma sem aviso.
  let r = ok(P.G, 'confirmar_horario', `${q(M.s1)}, ${q(segunda('09:00'))}, 120, false, NULL, ${q(k())}`);
  assert.equal(r.confirmado, true);
  assert.deepEqual(r.avisos, []);
  // Outra solicitação no mesmo horário: avisa (sobreposição) e não grava; com confirmação explícita, grava e registra.
  r = ok(P.G, 'confirmar_horario', `${q(M.sAutoIncompleto)}, ${q(segunda('10:00'))}, 60, false, NULL, ${q(k())}`);
  assert.equal(r.confirmado, false);
  assert.equal(r.avisos[0].tipo, 'sobreposicao');
  assert.equal(adm(`SELECT count(*) FROM public.agendamentos WHERE solicitacao_id = ${q(M.sAutoIncompleto)}`), '0');
  r = ok(P.G, 'confirmar_horario', `${q(M.sAutoIncompleto)}, ${q(segunda('10:00'))}, 60, true, 'Dois técnicos disponíveis neste dia.', ${q(k())}`);
  assert.equal(r.confirmado, true);
  assert.equal(adm(`SELECT avisos->0->>'tipo' || '|' || justificativa FROM public.agendamentos WHERE solicitacao_id = ${q(M.sAutoIncompleto)} AND estado = 'confirmado'`),
    'sobreposicao|Dois técnicos disponíveis neste dia.');
  // Fora do expediente (domingo): aviso fora_do_horario.
  const domingo = adm(`SELECT ((date_trunc('week', app_private.hoje_sp()) + interval '13 days')::date + time '10:00') AT TIME ZONE 'America/Sao_Paulo'`);
  r = ok(P.G, 'confirmar_horario', `${q(M.s1)}, ${q(domingo)}, 60, false, NULL, ${q(k())}`);
  assert.equal(r.avisos[0].tipo, 'fora_do_horario');
  // Troca antes do aceite: substitui e guarda o anterior no histórico; o cliente vê o horário e o aviso de que foi a empresa que definiu.
  ok(P.G, 'confirmar_horario', `${q(M.s1)}, ${q(segunda('14:00'))}, 120, false, NULL, ${q(k())}`);
  const det = ok(P.A, 'solicitacao_detalhe', q(M.s1));
  assert.deepEqual(det.historico_horarios.map((h) => h.estado), ['confirmado', 'substituido']);
  const cli = ok(P.C1, 'minha_solicitacao', q(M.s1));
  assert.match(cli.horario.aviso, /definido pela empresa/);
  assert.equal('avisos' in cli.horario, false);
  assert.equal(cli.eventos.filter((e) => e.tipo.startsWith('horario_')).length, 2);
  const ag = ok(P.A, 'agenda_basica', `${q(A)}, NULL, NULL`);
  assert.equal(ag.confirmados.length, 2);
  falha(rpc(P.V, 'agenda_basica', `${q(A)}, NULL, NULL`), 'FORBIDDEN_ACTION');
});

test('aceite (D8-01, D8-15, D8-24): retrato com horário, cliente da empresa, idempotente; nenhuma OS, título, lançamento ou movimento de estoque', opcoes, () => {
  const antes = adm(`SELECT (SELECT count(*) FROM public.titulos_financeiros) || '/' || (SELECT count(*) FROM public.lancamentos_financeiros) || '/'
    || (SELECT count(*) FROM public.movimentacoes_estoque) || '/' || (SELECT count(*) FROM public.reservas_estoque)`);
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.v2.id)}, false, ${q(k())}`), 'leu e aceita');
  falha(rpc(P.A, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.v2.id)}, true, ${q(k())}`), 'NOT_FOUND');
  const ch = k();
  const s = ok(P.C1, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.v2.id)}, true, ${q(ch)}`);
  assert.equal(ok(P.C1, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.v2.id)}, true, ${q(ch)}`).estado, 'aceita');
  assert.equal(s.estado, 'aceita');
  assert.equal(s.aguarda_os, true);
  assert.equal(s.aceite.total_centavos, 33000);
  assert.ok(s.aceite.horario.inicio);
  assert.equal(s.aceite.aceito_por, 'cliente');
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.v2.id)}, true, ${q(k())}`), 'já foi aceito');
  assert.equal(adm(`SELECT count(*) FROM public.clientes_empresa WHERE empresa_id = ${q(A)} AND perfil_cliente_id = ${q(P.C1.id)}`), '1');
  assert.equal(adm(`SELECT (SELECT count(*) FROM public.titulos_financeiros) || '/' || (SELECT count(*) FROM public.lancamentos_financeiros) || '/'
    || (SELECT count(*) FROM public.movimentacoes_estoque) || '/' || (SELECT count(*) FROM public.reservas_estoque)`), antes);
  // Depois do aceite: o horário não muda (reagendamento é do M09) e o cancelamento também é do M09.
  falha(rpc(P.G, 'confirmar_horario', `${q(M.s1)}, ${q(segunda('15:00', 2))}, 60, true, NULL, ${q(k())}`), 'reagendamento');
  falha(rpc(P.C1, 'cancelar_solicitacao', `${q(M.s1)}, NULL, ${q(k())}`), 'ordem de serviço');
  falha(rpc(P.G, 'salvar_rascunho_orcamento', `${q(M.s1)}, ${j({ componentes: [{ tipo: 'outro', descricao: 'Extra', quantidade: 1, valor_unitario_centavos: 1 }] })}, ${versaoSol(M.s1)}, ${q(k())}`), 'encerrada');
  assert.deepEqual(ok(P.O, 'reconciliar_orcamentos', q(A)).ok, true);
  falha(rpc(P.G, 'reconciliar_orcamentos', q(A)), 'Só o proprietário');
});

test('solicitação interna (D8-03): equipe registra para cliente do balcão; aceite informado exige orcamentos.aprovar', opcoes, () => {
  falha(rpc(P.V, 'criar_solicitacao_interna', `${q(A)}, ${q(M.clienteInterno)}, ${q(M.fixo.id)}, ${j({ relato: 'Troca de óleo do carro do Joaquim.' })}, ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.A, 'criar_solicitacao_interna', `${q(A)}, ${q(M.clienteInterno)}, ${q(M.insumoB)}, ${j({ relato: 'Troca de óleo do carro do Joaquim.' })}, ${q(k())}`), 'Serviço não encontrado');
  const s = ok(P.A, 'criar_solicitacao_interna', `${q(A)}, ${q(M.clienteInterno)}, ${q(M.fixo.id)}, ${j({ relato: 'Troca de óleo do carro do Joaquim.' })}, ${q(k())}`);
  assert.equal(s.origem, 'interna');
  let v = ok(P.A, 'salvar_rascunho_orcamento', `${q(s.id)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Troca de óleo', quantidade: 1, valor_unitario_centavos: 9000 }] })}, ${versaoSol(s.id)}, ${q(k())}`);
  v = ok(P.A, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  v = ok(P.G, 'aprovar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  assert.equal(v.estado, 'enviada');
  assert.equal(v.aprovada_por, 'Gerente Gabriel');
  falha(rpc(P.A, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(k())}`), 'FORBIDDEN_ACTION');
  const ac = ok(P.G, 'aceitar_orcamento', `${q(s.id)}, ${q(v.id)}, true, ${q(k())}`);
  assert.equal(ac.aceite.aceito_por, 'equipe (aceite informado pelo cliente)');
  assert.equal(ac.aceite.registrado_por, 'Gerente Gabriel');
  assert.equal(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'orcamentos.aceito' AND dados_minimizados->>'por' = 'equipe'`), '1');
});

test('recusa e cancelamento (D8-16): encerram sem cobrança; motivo da empresa obrigatório e visível; horário cancelado', opcoes, () => {
  const resp = { [M.p['Área a pintar']]: 5, [M.p.Acabamento]: 'Fosco', [M.p['Precisa mover móveis?']]: false };
  const nova = ok(P.C2, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar o muro da garagem.' })}, ${q(k())}`);
  let v = ok(P.G, 'salvar_rascunho_orcamento', `${q(nova.id)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Muro', quantidade: 1, valor_unitario_centavos: 25000 }] })}, ${versaoSol(nova.id)}, ${q(k())}`);
  v = ok(P.G, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
  falha(rpc(P.C2, 'recusar_orcamento', `${q(nova.id)}, ${q(v.id)}, ${j({ opcao: 'caro' })}, ${q(k())}`), 'Motivo inválido');
  const rec = ok(P.C2, 'recusar_orcamento', `${q(nova.id)}, ${q(v.id)}, ${j({ opcao: 'preco', texto: 'Achei caro.' })}, ${q(k())}`);
  assert.equal(rec.estado, 'recusada');
  assert.equal(rec.versoes[0].estado, 'recusada');
  falha(rpc(P.C2, 'aceitar_orcamento', `${q(nova.id)}, ${q(v.id)}, true, ${q(k())}`), 'Não há orçamento');
  // Empresa cancela com motivo; o horário confirmado é cancelado junto.
  falha(rpc(P.A, 'cancelar_solicitacao', `${q(M.sAutoIncompleto)}, 'Sem agenda neste mês, desculpe.', ${q(k())}`), 'FORBIDDEN_ACTION');
  falha(rpc(P.G, 'cancelar_solicitacao', `${q(M.sAutoIncompleto)}, 'curto', ${q(k())}`), '10 a 300');
  const canc = ok(P.G, 'cancelar_solicitacao', `${q(M.sAutoIncompleto)}, 'Sem agenda neste mês, desculpe.', ${q(k())}`);
  assert.equal(canc.estado, 'cancelada');
  assert.equal(adm(`SELECT count(*) FROM public.agendamentos WHERE solicitacao_id = ${q(M.sAutoIncompleto)} AND estado = 'confirmado'`), '0');
  const cli = ok(P.C2, 'minha_solicitacao', q(M.sAutoIncompleto));
  assert.equal(cli.motivo_encerramento, 'Sem agenda neste mês, desculpe.');
  assert.equal(cli.eventos.at(-1).dados.sem_cobranca, true);
  // Cliente cancela a própria (motivo opcional).
  const c2 = ok(P.C2, 'cancelar_solicitacao', `${q(M.sAuto.id)}, NULL, ${q(k())}`);
  assert.equal(c2.estado, 'cancelada');
  assert.equal(adm('SELECT count(*) FROM public.titulos_financeiros WHERE origem_tipo NOT IN (\'venda\', \'manual\', \'compra\', \'recorrencia\')'), '0');
  assert.deepEqual(ok(P.O, 'reconciliar_orcamentos', q(A)).ok, true);
});

test('limites (D8-23): 5 abertas por empresa e 20 por dia, no banco; a CK ajusta sem acesso a dados de cliente', opcoes, () => {
  const resp = { [M.p['Área a pintar']]: 5, [M.p.Acabamento]: 'Fosco' };
  const pedir = (p) => rpc(p, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Pintar mais uma parede de teste.' })}, ${q(k())}`);
  const abertas = () => Number(adm(`SELECT count(*) FROM public.solicitacoes_servico WHERE cliente_auth_id = ${q(P.C2.id)} AND estado IN ('nova','em_analise','orcamento_enviado','revisao_pedida')`));
  while (abertas() < 5) assert.ok(pedir(P.C2).ok);
  falha(pedir(P.C2), '5 solicitações abertas');
  falha(rpc(P.G, 'ck_definir_limite', `'solicitacoes_abertas_por_empresa', 6, 'Mais folga para testes', ${q(k())}`), 'administração CK');
  falha(rpc(P.CK, 'ck_definir_limite', `'solicitacoes_abertas_por_empresa', 50, 'Mais folga para testes', ${q(k())}`), '1 a 20');
  ok(P.CK, 'ck_definir_limite', `'solicitacoes_abertas_por_empresa', 6, 'Mais folga para testes', ${q(k())}`);
  assert.ok(pedir(P.C2).ok);
  falha(pedir(P.C2), '6 solicitações abertas');
  assert.equal(ok(P.CK, 'ck_limites', '').length, 2);
  // A CK não ganhou leitura de solicitação nenhuma.
  falha(rpc(P.CK, 'solicitacao_detalhe', q(M.s1)), 'TENANT_FORBIDDEN');
  falha(rpc(P.CK, 'solicitacoes_da_empresa', `${q(A)}, '{}'::jsonb, 50, 0`), 'TENANT_FORBIDDEN');
  ok(P.CK, 'ck_definir_limite', `'solicitacoes_abertas_por_empresa', 5, 'Volta ao padrão aprovado', ${q(k())}`);
  assert.equal(adm("SELECT count(*) FROM app_private.eventos_auditoria WHERE tipo_acao = 'ck.limite_alterado'"), '2');
});

test('concorrência real: aceites simultâneos, aceite × nova versão, solicitações em paralelo, numeração, horários simultâneos', opcoes, async () => {
  const resp = { [M.p['Área a pintar']]: 8, [M.p.Acabamento]: 'Brilho', [M.p['Precisa mover móveis?']]: false };
  adm(`UPDATE app_private.limites_plataforma SET valor = 20 WHERE chave = 'solicitacoes_abertas_por_empresa'`);
  const criar = () => ok(P.C1, 'criar_solicitacao', `${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Concorrência de teste em paralelo.' })}, ${q(k())}`);
  const enviar = (s, valor) => {
    let v = ok(P.G, 'salvar_rascunho_orcamento', `${q(s.id)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Serviço', quantidade: 1, valor_unitario_centavos: valor }] })}, ${versaoSol(s.id)}, ${q(k())}`);
    v = ok(P.G, 'enviar_orcamento', `${q(v.id)}, ${v.versao}, ${q(k())}`);
    return v;
  };
  // 1. Dois aceites simultâneos da mesma versão: um efeito.
  const s1 = criar();
  const v1 = enviar(s1, 10000);
  const dois = await Promise.all([1, 2].map(() => sessao(P.C1, `SELECT public.aceitar_orcamento(${q(s1.id)}, ${q(v1.id)}, true, ${q(k())})`, 0.3)));
  assert.equal(dois.filter((r) => r.ok).length, 1, JSON.stringify(dois.map((r) => r.erro)));
  assert.match(dois.find((r) => !r.ok).erro, /já foi aceito/);
  assert.equal(adm(`SELECT count(*) FROM public.orcamento_versoes WHERE solicitacao_id = ${q(s1.id)} AND estado = 'aceita'`), '1');
  // 2. Aceite da v1 × envio da v2 ao mesmo tempo: nunca os dois.
  const s2 = criar();
  const a1 = enviar(s2, 10000);
  let rasc = ok(P.G, 'salvar_rascunho_orcamento', `${q(s2.id)}, ${j({ componentes: [{ tipo: 'mao_de_obra', descricao: 'Revisto', quantidade: 1, valor_unitario_centavos: 12000 }] })}, ${versaoSol(s2.id)}, ${q(k())}`);
  const [aceite, envio] = await Promise.all([
    sessao(P.C1, `SELECT public.aceitar_orcamento(${q(s2.id)}, ${q(a1.id)}, true, ${q(k())})`, 0.3),
    sessao(P.G, `SELECT public.enviar_orcamento(${q(rasc.id)}, ${rasc.versao}, ${q(k())})`, 0.3)]);
  const estado = adm(`SELECT string_agg(numero || ':' || estado, ',' ORDER BY numero) FROM public.orcamento_versoes WHERE solicitacao_id = ${q(s2.id)}`);
  assert.equal(aceite.ok !== envio.ok, true, `${aceite.erro} | ${envio.erro}`);
  assert.ok(['1:aceita,2:rascunho', '1:substituida,2:enviada'].includes(estado), estado);
  if (!aceite.ok) assert.match(aceite.erro, /QUOTE_VERSION_STALE/);
  if (!envio.ok) assert.match(envio.erro, /encerrada/);
  // 3. Aceite × cancelamento pela empresa.
  const s3 = criar();
  const c3 = enviar(s3, 10000);
  const [ac3, cc3] = await Promise.all([
    sessao(P.C1, `SELECT public.aceitar_orcamento(${q(s3.id)}, ${q(c3.id)}, true, ${q(k())})`, 0.3),
    sessao(P.G, `SELECT public.cancelar_solicitacao(${q(s3.id)}, 'Cancelado pela empresa no teste.', ${q(k())})`, 0.3)]);
  assert.equal(ac3.ok !== cc3.ok, true);
  // 4. 8 solicitações simultâneas do mesmo cliente com limite 3 abertas a mais: nunca passa do limite.
  const abertasAntes = Number(adm(`SELECT count(*) FROM public.solicitacoes_servico WHERE empresa_id = ${q(A)} AND cliente_auth_id = ${q(P.C2.id)} AND estado IN ('nova','em_analise','orcamento_enviado','revisao_pedida')`));
  adm(`UPDATE app_private.limites_plataforma SET valor = ${abertasAntes + 3} WHERE chave = 'solicitacoes_abertas_por_empresa'`);
  const oito = await Promise.all(Array.from({ length: 8 }, () => sessao(P.C2, `SELECT public.criar_solicitacao(${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Rajada de solicitações paralelas.' })}, ${q(k())})`, 0.1)));
  assert.equal(oito.filter((r) => r.ok).length, 3, oito.map((r) => r.erro.slice(0, 60)).join(' | '));
  adm(`UPDATE app_private.limites_plataforma SET valor = 5 WHERE chave = 'solicitacoes_abertas_por_empresa'`);
  // 5. Numeração sem repetição.
  assert.equal(adm(`SELECT count(*) - count(DISTINCT numero) FROM public.solicitacoes_servico WHERE empresa_id = ${q(A)}`), '0');
  assert.equal(adm(`SELECT max(numero) - count(*) FROM public.solicitacoes_servico WHERE empresa_id = ${q(A)}`), '0');
  // 6. Duas confirmações de horário simultâneas na mesma solicitação: um confirmado; o outro fica substituído.
  const s6 = criar();
  const hs = await Promise.all(['09:00', '15:00'].map((h) => sessao(P.G, `SELECT public.confirmar_horario(${q(s6.id)}, ${q(segunda(h, 3))}, 60, true, NULL, ${q(k())})`, 0.2)));
  assert.equal(hs.every((r) => r.ok), true, hs.map((r) => r.erro).join(' | '));
  assert.equal(adm(`SELECT count(*) FROM public.agendamentos WHERE solicitacao_id = ${q(s6.id)} AND estado = 'confirmado'`), '1');
  // 7. Mesma chave em paralelo: um efeito.
  const chave = k();
  const mesma = await Promise.all([1, 2].map(() => sessao(P.C1, `SELECT public.criar_solicitacao(${q(M.regras.id)}, ${j({ respostas: resp, relato: 'Mesma chave em paralelo.' })}, ${q(chave)})`, 0.2)));
  assert.equal(mesma.every((r) => r.ok), true);
  assert.equal(adm("SELECT count(*) FROM public.solicitacoes_servico WHERE relato = 'Mesma chave em paralelo.'"), '1');
  assert.deepEqual(ok(P.O, 'reconciliar_orcamentos', q(A)).ok, true);
  rasc = null;
});

test('isolamento, revogação, identidade vazia (D-07), acesso direto negado e privilégios', opcoes, () => {
  for (const t of ['servicos', 'servico_perguntas', 'servico_regras', 'horarios_empresa', 'solicitacoes_servico', 'orcamento_versoes',
    'orcamento_componentes', 'solicitacao_eventos', 'agendamentos']) {
    falha(comoPapel(banco.url, { sub: P.O.id }, `SELECT count(*) FROM public.${t}`), 'permission denied');
    falha(comoPapel(banco.url, { sub: P.C1.id }, `SELECT count(*) FROM public.${t}`), 'permission denied');
  }
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.servicos_para_cliente(${q(A)})`), 'permission denied');
  // Identidade vazia: erro explícito, nunca lista vazia.
  falha(comoPapel(banco.url, { sub: null }, 'SELECT public.minhas_solicitacoes()'), 'AUTH_REQUIRED|Sessão ausente');
  // Revogação: sem o vínculo, a mesma identidade perde o acesso na chamada seguinte.
  assert.ok(ok(P.A, 'solicitacoes_da_empresa', `${q(A)}, '{}'::jsonb, 5, 0`).total >= 1);
  adm(`UPDATE public.membros_empresa SET estado = 'encerrado', encerrado_em = now() WHERE empresa_id = ${q(A)} AND auth_user_id = ${q(P.A.id)}`);
  falha(rpc(P.A, 'solicitacoes_da_empresa', `${q(A)}, '{}'::jsonb, 5, 0`), 'TENANT_FORBIDDEN');
  // ID adulterado: versão de outra solicitação.
  falha(rpc(P.C1, 'aceitar_orcamento', `${q(M.s1)}, ${q(M.sAuto.versoes[0].id)}, true, ${q(k())}`), 'NOT_FOUND|já foi aceito');
  const internas = adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app_private'
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anonymous', p.oid, 'EXECUTE'))`);
  assert.equal(internas, '0');
  const publicas = adm(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN ('criar_solicitacao', 'aceitar_orcamento', 'confirmar_horario', 'enviar_orcamento', 'ck_definir_limite')
    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND NOT has_function_privilege('anonymous', p.oid, 'EXECUTE')`);
  assert.equal(publicas, '5');
});

test('rollback e reaplicação da 202611120004 (estimativa)', opcoes, () => {
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120004_correcao_estimativa.down.sql');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120004'"), '0');
  assert.equal(adm("SELECT prosrc LIKE '%tipo_conta%' FROM pg_proc WHERE proname = 'estimar_servico'"), 'f');
  assert.equal(rpc(P.X, 'estimar_servico', `${q(M.regras.id)}, '{}'::jsonb`).ok, true);   // reproduz a falha da verificação real
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611120004_correcao_estimativa.sql');
  assert.equal(adm("SELECT prosrc LIKE '%tipo_conta%' FROM pg_proc WHERE proname = 'estimar_servico'"), 't');
  falha(rpc(P.X, 'estimar_servico', `${q(M.regras.id)}, '{}'::jsonb`), 'NOT_FOUND');
});

test('rollback da 202611120003: recusado com dados do M08', opcoes, () => {
  assert.throws(() => aplicarArquivo(banco.url, 'db/migrations_propostas/202611120003_servicos_orcamentos.down.sql'), /Rollback recusado/);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611120003'"), '1');
  assert.equal(adm('SELECT count(*) FROM public.permissoes_catalogo'), '55');
});
