BEGIN;
DROP FUNCTION IF EXISTS public.atividades_da_empresa(uuid, timestamptz, integer);
DROP FUNCTION IF EXISTS app_private.permissao_da_atividade(text);
DROP INDEX IF EXISTS app_private.eventos_auditoria_empresa_data;
DELETE FROM app_private.historico_migracoes WHERE id = '202611270003';
COMMIT;
