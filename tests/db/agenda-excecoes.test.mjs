/**
 * Testes de banco do E04 (migration 202611260001): exceções da agenda por data.
 * - Salvar (fechado ou horário especial), substituir no mesmo dia e remover; outra empresa e anônimo negados.
 * - Validações: data passada, motivo, intervalos; idempotência por chave.
 * - Avisos de conflito: dia fechado avisa com o motivo; horário especial substitui a grade só naquele dia.
 * - Rollback sem resíduo (impressão do esquema e dos privilégios).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql, comoPapel } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const TODAS = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const ID = (n) => `ea040000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = {
  O: { id: ID(1), email: 'dona-e04@teste.example', nome: 'Dona Olga', tipo: 'business' },
  OUT: { id: ID(2), email: 'outra-e04@teste.example', nome: 'Dona de Outra', tipo: 'business' },
};
let chave = 0;
const k = () => `e04-teste-${String(++chave).padStart(4, '0')}`;
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
const E = {};
let hoje;
const dia = (n) => adm(`SELECT (app_private.hoje_sp() + ${n})::text`);
// Avisos para um horário local de São Paulo (data + HH:MM, duração em minutos), sem solicitação.
const avisos = (data, hora, minutos = 60) => JSON.parse(adm(`SELECT app_private.avisos_horario(${q(E.a)}, '00000000-0000-4000-8000-000000000000',
  (${q(`${data} ${hora}`)}::timestamp AT TIME ZONE 'America/Sao_Paulo'), (${q(`${data} ${hora}`)}::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '${minutos} minutes')::text`));

before(() => {
  if (!banco) return;
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of TODAS) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  for (const p of Object.values(P)) {
    adm(`INSERT INTO neon_auth."user" (id, email, name, "emailVerified") VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.nome)}, true)`);
    assert.ok(comoPapel(banco.url, { sub: p.id }, `SELECT public.garantir_perfil(${q(p.tipo)}, ${q(p.nome)})`).ok);
  }
  const nova = (dono, nome) => ok(dono, 'criar_empresa', `${j({ nome_publico: nome, modalidade: 'servicos', categoria_id: adm("SELECT id FROM public.categorias_plataforma WHERE slug = 'costura-moda'"),
    cidade: 'Campinas', uf: 'SP', email_contato: 'privado-e04@teste.example' })}, ${q(k())}`).id;
  E.a = nova(P.O, 'Costura da Olga');
  E.b = nova(P.OUT, 'Outra Costura');
  hoje = dia(0);
  // Grade: todos os dias das 09:00 às 18:00.
  ok(P.O, 'salvar_horarios_empresa', `${q(E.a)}, ${j([0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, intervalos: [{ abre: '09:00', fecha: '18:00' }] })))}, ${q(k())}`);
});
after(() => banco?.encerrar());

test('salvar, substituir no mesmo dia e remover; idempotente; outra empresa e anônimo negados', opcoes, () => {
  const d = dia(10);
  const chaveOp = k();
  const x = ok(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(d)}, 'fechado', '[]'::jsonb, 'Feriado municipal', ${q(chaveOp)}`);
  assert.equal(x.tipo, 'fechado');
  assert.equal(x.criado_por, 'Dona Olga');
  assert.equal(ok(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(d)}, 'fechado', '[]'::jsonb, 'Feriado municipal', ${q(chaveOp)}`).id, x.id);
  const y = ok(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(d)}, 'horario_especial', ${j([{ abre: '10:00', fecha: '14:00' }])}, 'Meio período', ${q(k())}`);
  assert.equal(y.id, x.id, 'um registro por dia: substitui');
  assert.deepEqual(y.intervalos, [{ abre: '10:00', fecha: '14:00' }]);
  const lista = ok(P.O, 'excecoes_agenda', `${q(E.a)}, ${q(hoje)}, ${q(dia(30))}`);
  assert.equal(lista.length, 1);
  falha(rpc(P.OUT, 'excecoes_agenda', `${q(E.a)}`), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.OUT, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(11))}, 'fechado', '[]'::jsonb, 'Invasão', ${q(k())}`), 'TENANT_FORBIDDEN|acesso');
  falha(rpc(P.OUT, 'remover_excecao_agenda', `${q(x.id)}, ${q(k())}`), 'NOT_FOUND|não encontrada');
  falha(comoPapel(banco.url, { papel: 'anonymous' }, `SELECT public.excecoes_agenda(${q(E.a)})`), 'permission denied');
  falha(comoPapel(banco.url, { papel: 'authenticated', sub: P.O.id }, 'SELECT count(*) FROM public.excecoes_agenda'), 'permission denied');
  assert.equal(ok(P.O, 'remover_excecao_agenda', `${q(x.id)}, ${q(k())}`).removida, true);
  assert.equal(ok(P.O, 'excecoes_agenda', `${q(E.a)}`).length, 0);
  assert.ok(Number(adm(`SELECT count(*) FROM app_private.eventos_auditoria WHERE recurso_id = ${q(x.id)}`)) >= 3);
});

test('validações: data passada, motivo, tipo e intervalos', opcoes, () => {
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(-1))}, 'fechado', '[]'::jsonb, 'Ontem', ${q(k())}`), 'data de hoje');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(800))}, 'fechado', '[]'::jsonb, 'Longe demais', ${q(k())}`), 'dois anos');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(3))}, 'fechado', '[]'::jsonb, ' ', ${q(k())}`), 'motivo');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(3))}, 'meio_fechado', '[]'::jsonb, 'Tipo errado', ${q(k())}`), 'fechado ou com horário especial');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(3))}, 'horario_especial', '[]'::jsonb, 'Sem horas', ${q(k())}`), 'um ou dois intervalos');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(3))}, 'horario_especial', ${j([{ abre: '14:00', fecha: '10:00' }])}, 'Invertido', ${q(k())}`), 'abre antes de fechar');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(3))}, 'horario_especial', ${j([{ abre: '08:00', fecha: '12:00' }, { abre: '11:00', fecha: '15:00' }])}, 'Sobreposto', ${q(k())}`), 'segundo começa depois');
  falha(rpc(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(3))}, 'horario_especial', ${j([{ abre: '25:00', fecha: '26:00' }])}, 'Hora inválida', ${q(k())}`), 'HH:MM');
  // Fechado ignora intervalos enviados por engano (grava vazio).
  assert.deepEqual(ok(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(dia(4))}, 'fechado', ${j([{ abre: '09:00', fecha: '10:00' }])}, 'Inventário', ${q(k())}`).intervalos, []);
});

test('avisos ao marcar horário: dia fechado e horário especial substituem a grade só naquele dia', opcoes, () => {
  const normal = dia(20);
  assert.deepEqual(avisos(normal, '10:00'), [], 'dia comum dentro da grade: sem aviso');
  assert.equal(avisos(normal, '19:00')[0].tipo, 'fora_do_horario');
  const fechado = dia(21);
  ok(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(fechado)}, 'fechado', '[]'::jsonb, 'Feriado da cidade', ${q(k())}`);
  const af = avisos(fechado, '10:00');
  assert.equal(af[0].tipo, 'dia_fechado');
  assert.match(af[0].mensagem, /Feriado da cidade/);
  const especial = dia(22);
  ok(P.O, 'salvar_excecao_agenda', `${q(E.a)}, ${q(especial)}, 'horario_especial', ${j([{ abre: '13:00', fecha: '16:00' }])}, 'Só à tarde', ${q(k())}`);
  assert.equal(avisos(especial, '10:00')[0].tipo, 'fora_do_horario', 'de manhã está fora do horário especial');
  assert.match(avisos(especial, '10:00')[0].mensagem, /Só à tarde/);
  assert.deepEqual(avisos(especial, '14:00'), [], 'dentro do horário especial');
  assert.equal(avisos(especial, '15:30')[0].tipo, 'fora_do_horario', 'termina depois do fim do horário especial');
});

test('rollback da 202611260001 sem resíduo e reaplicação', opcoes, () => {
  const impressao = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
  const foto = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${impressao}) x`);
  const depois = foto();
  adm('DELETE FROM public.excecoes_agenda');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611260001_agenda_excecoes.down.sql');
  const sem = foto();
  assert.notEqual(sem, depois);
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611260001'"), '0');
  assert.equal(adm("SELECT to_regclass('public.excecoes_agenda') IS NULL"), 't');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611260001_agenda_excecoes.sql');
  assert.equal(foto(), depois, 'reaplicada, volta ao mesmo esquema');
});
