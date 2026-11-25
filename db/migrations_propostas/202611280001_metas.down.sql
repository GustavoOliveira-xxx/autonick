BEGIN;
DROP FUNCTION IF EXISTS public.definir_meta(uuid, text, date, bigint, text);
DROP FUNCTION IF EXISTS public.metas_da_empresa(uuid, date);
DROP FUNCTION IF EXISTS app_private.realizado_da_meta(uuid, text, date);
DROP FUNCTION IF EXISTS app_private.permissao_da_meta(text);
DROP TABLE IF EXISTS public.metas_empresa;
DELETE FROM app_private.historico_migracoes WHERE id = '202611280001';
COMMIT;
