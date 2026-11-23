/**
 * Rollback da 202611130001 (M09): em banco limpo aplica, desfaz sem resíduo (esquema idêntico ao anterior, pela mesma
 * impressão digital usada na integridade das migrations) e reaplica. Com dado próprio do M09, o rollback é recusado.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ANTES = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) <= '202611120005').sort();
const IMPRESSAO = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const impressao = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${IMPRESSAO}) x`);
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica a 202611130001 sem resíduo; recusa o rollback com dado do M09', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ANTES) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  const antes = impressao();
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611130001_ordens_servico.sql');
  assert.notEqual(impressao(), antes);
  assert.equal(adm("SELECT count(*) FROM pg_proc WHERE proname IN ('mudar_estado_os', 'cancelar_os', 'agenda_operacional')"), '3');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611130001_ordens_servico.down.sql');
  assert.equal(impressao(), antes, 'o esquema depois do rollback precisa ser idêntico ao anterior');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611130001'"), '0');
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611130001_ordens_servico.sql');
  // Dado próprio do M09 (uma política de cancelamento): o rollback é recusado e nada muda.
  const empresa = adm("INSERT INTO public.empresas (nome_publico, modalidade, categoria_id, cidade, uf, email_contato, criada_por) SELECT '[TESTE] RB M09', 'servicos', id, 'Campinas', 'SP', 'rb@teste.example', 'teste' FROM public.categorias_plataforma WHERE tipo = 'negocio' ORDER BY ordem LIMIT 1 RETURNING id");
  adm(`INSERT INTO public.politicas_cancelamento (empresa_id, versao, texto, criada_por) VALUES ('${empresa}', 1, 'Política de teste do rollback do M09.', 'teste')`);
  const depois = impressao();
  assert.throws(() => aplicarArquivo(banco.url, 'db/migrations_propostas/202611130001_ordens_servico.down.sql'), /Decisão humana/);
  assert.equal(impressao(), depois);
});
