-- Rollback da 202611120005: remove a função de diagnóstico do D-07.
BEGIN;
DROP FUNCTION IF EXISTS public.diagnostico_conexao();
DELETE FROM app_private.historico_migracoes WHERE id = '202611120005';
COMMIT;
