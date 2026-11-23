-- Impressão digital do esquema da aplicação (usada por scripts/integridade-migrations.mjs).
-- Só leitura de catálogo: nenhum dado de usuário, nenhum segredo. Roda igual no PostgreSQL local e no Neon.
-- Cada linha: tipo | objeto | md5 da definição normalizada. O nome do papel dono (postgres local, neondb_owner no Neon)
-- vira DONO nas permissões; o privilégio MAINTAIN (m, PG 17+) do dono é ignorado; NOT NULL do PG 18 fica só na impressão da tabela.
WITH esquemas AS (SELECT unnest(ARRAY['public', 'app_private', 'authz']) AS nome),
funcoes AS (
  SELECT 'funcao' AS tipo, p.oid::regprocedure::text AS objeto,
         md5(concat_ws('|', p.prosrc, pg_get_function_result(p.oid), p.prosecdef, p.provolatile, p.proconfig::text,
             (SELECT string_agg(app_acl, ',' ORDER BY app_acl) FROM (SELECT replace(replace(a::text, pg_get_userbyid(p.proowner) || '=', 'DONO='), '/' || pg_get_userbyid(p.proowner), '/DONO') AS app_acl FROM unnest(coalesce(p.proacl, '{}')) a) acl))) AS impressao
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN (SELECT nome FROM esquemas) AND p.prokind IN ('f', 'p')
),
tabelas AS (
  SELECT 'tabela' AS tipo, c.oid::regclass::text AS objeto,
         md5(concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity,
             (SELECT string_agg(app_acl, ',' ORDER BY app_acl) FROM (SELECT replace(replace(replace(a::text, pg_get_userbyid(c.relowner) || '=', 'DONO='), '/' || pg_get_userbyid(c.relowner), '/DONO'), 'DONO=arwdDxtm/', 'DONO=arwdDxt/') AS app_acl FROM unnest(coalesce(c.relacl, '{}')) a) acl),
             (SELECT string_agg(concat_ws(':', at.attname, format_type(at.atttypid, at.atttypmod), at.attnotnull,
                       pg_get_expr(d.adbin, d.adrelid),
                       (SELECT string_agg(app_acl, ',' ORDER BY app_acl) FROM (SELECT replace(replace(x::text, pg_get_userbyid(c.relowner) || '=', 'DONO='), '/' || pg_get_userbyid(c.relowner), '/DONO') AS app_acl FROM unnest(coalesce(at.attacl, '{}')) x) acl)), ';' ORDER BY at.attname)
                FROM pg_attribute at LEFT JOIN pg_attrdef d ON d.adrelid = at.attrelid AND d.adnum = at.attnum
               WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped))) AS impressao
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN (SELECT nome FROM esquemas) AND c.relkind IN ('r', 'v', 'p')
),
restricoes AS (
  SELECT 'restricao' AS tipo, co.conrelid::regclass::text || '.' || co.conname AS objeto, md5(pg_get_constraintdef(co.oid)) AS impressao
    FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
   WHERE n.nspname IN (SELECT nome FROM esquemas) AND co.conrelid <> 0 AND co.contype <> 'n'  -- PG 18 grava NOT NULL como restrição; já está na impressão da tabela
),
indices AS (
  SELECT 'indice' AS tipo, i.indexrelid::regclass::text AS objeto, md5(pg_get_indexdef(i.indexrelid)) AS impressao
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN (SELECT nome FROM esquemas)
),
politicas AS (
  SELECT 'politica' AS tipo, schemaname || '.' || tablename || '.' || policyname AS objeto,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) AS impressao
    FROM pg_policies WHERE schemaname IN (SELECT nome FROM esquemas)
),
gatilhos AS (
  SELECT 'gatilho' AS tipo, t.tgrelid::regclass::text || '.' || t.tgname AS objeto, md5(pg_get_triggerdef(t.oid)) AS impressao
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN (SELECT nome FROM esquemas) AND NOT t.tgisinternal
)
SELECT tipo, objeto, impressao FROM (
  SELECT * FROM funcoes UNION ALL SELECT * FROM tabelas UNION ALL SELECT * FROM restricoes
  UNION ALL SELECT * FROM indices UNION ALL SELECT * FROM politicas UNION ALL SELECT * FROM gatilhos) x
ORDER BY tipo, objeto
