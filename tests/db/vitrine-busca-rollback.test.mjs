/**
 * Rollback da 202611130002 (M10): em banco limpo aplica, desfaz sem resíduo (esquema e privilégios idênticos aos anteriores,
 * pela mesma impressão digital da integridade das migrations, mais o uso do esquema pelo `anonymous`) e reaplica.
 * Com item publicado na vitrine, o rollback é recusado. Só testado localmente: no Neon o rollback NÃO foi validado.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { iniciarBanco, aplicarArquivo, sql } from '../../db/tests/ambiente.mjs';

const banco = iniciarBanco();
const opcoes = { skip: banco ? false : 'PostgreSQL local não encontrado (defina PG_BIN ou AUTONICK_DB_URL)' };
const ANTES = readdirSync(new URL('../../db/migrations_propostas/', import.meta.url))
  .filter((f) => /^\d{12}_.+\.sql$/.test(f) && !f.endsWith('.down.sql') && f.slice(0, 12) <= '202611130001').sort();
const SOBE = 'db/migrations_propostas/202611130002_vitrine_busca.sql';
const DESCE = 'db/migrations_propostas/202611130002_vitrine_busca.down.sql';
const IMPRESSAO = readFileSync(new URL('../../db/tests/impressao-esquema.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
const adm = (c) => { const r = sql(banco.url, c); assert.ok(r.ok, r.erro); return r.saida; };
const impressao = () => adm(`SELECT md5(string_agg(tipo || '|' || objeto || '|' || impressao, E'\\n' ORDER BY tipo, objeto)) FROM (${IMPRESSAO}) x`)
  + adm("SELECT has_schema_privilege('anonymous', 'public', 'USAGE')::text");
after(() => banco?.encerrar());

test('aplica, desfaz e reaplica a 202611130002 sem resíduo; recusa o rollback com item publicado', opcoes, () => {
  aplicarArquivo(banco.url, 'db/tests/emulacao-neon.sql');
  for (const m of ANTES) aplicarArquivo(banco.url, `db/migrations_propostas/${m}`);
  const antes = impressao();
  assert.match(antes, /false$/, 'antes do M10 o anônimo não usa o esquema public');
  aplicarArquivo(banco.url, SOBE);
  assert.notEqual(impressao(), antes);
  aplicarArquivo(banco.url, DESCE);
  assert.equal(impressao(), antes, 'o esquema depois do rollback precisa ser idêntico ao anterior');
  assert.equal(adm("SELECT count(*) FROM app_private.historico_migracoes WHERE id = '202611130002'"), '0');
  aplicarArquivo(banco.url, SOBE);
  const empresa = adm("INSERT INTO public.empresas (nome_publico, modalidade, categoria_id, cidade, uf, email_contato, criada_por) SELECT 'RB M10', 'servicos', id, 'Campinas', 'SP', 'rb@teste.example', 'teste' FROM public.categorias_plataforma WHERE tipo = 'negocio' ORDER BY ordem LIMIT 1 RETURNING id");
  adm(`INSERT INTO public.servicos (empresa_id, nome, politica_preco, exibir_na_vitrine, criado_por) VALUES ('${empresa}', 'Serviço RB', 'sob_consulta', true, 'teste')`);
  const depois = impressao();
  assert.throws(() => aplicarArquivo(banco.url, DESCE), /Decisão humana/);
  assert.equal(impressao(), depois);
  // Correção 202611130003: aplica e desfaz sem resíduo sobre a 0002.
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611130003_vitrine_anonimo_real.sql');
  assert.notEqual(impressao(), depois);
  aplicarArquivo(banco.url, 'db/migrations_propostas/202611130003_vitrine_anonimo_real.down.sql');
  assert.equal(impressao(), depois, 'a 0003 desfeita volta exatamente ao esquema da 0002');
});
